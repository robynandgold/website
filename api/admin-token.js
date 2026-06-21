const crypto = require('crypto');

const REPO = 'robynandgold/website';

/**
 * Ask GitHub whether the token actually works for this repo, so we can return
 * a precise reason instead of a generic "Bad credentials" at publish time.
 *
 * Returns { ok: true } when the token can write, or
 * { ok: false, status, reason } describing what's wrong. On a validator-side
 * hiccup (GitHub unreachable / 5xx / rate limit) we fail OPEN — returning ok
 * so a transient glitch can't lock the admin out; the publish call would then
 * surface any real error itself.
 */
async function validateToken(token) {
  let resp;
  try {
    resp = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        // GitHub rejects requests with no User-Agent (403), so always send one.
        'User-Agent': 'robynandgold-admin',
      },
    });
  } catch (err) {
    console.warn('admin-token: could not reach GitHub to validate token, allowing anyway —', err.message);
    return { ok: true };
  }

  const ssoHeader = resp.headers.get('x-github-sso');

  if (resp.status === 200) {
    let body = {};
    try { body = await resp.json(); } catch (_) { /* ignore */ }
    if (body && body.permissions && body.permissions.push === false) {
      return {
        ok: false,
        status: 422,
        reason: `The GitHub token can read ${REPO} but lacks write access. Set its "Contents" permission to "Read and write" (fine-grained) or give it the "repo" scope (classic), then update GITHUB_TOKEN in Vercel and redeploy.`,
      };
    }
    return { ok: true };
  }

  if (resp.status === 401) {
    return {
      ok: false,
      status: 422,
      reason: 'GitHub rejected the token (Bad credentials). It has been revoked or the GITHUB_TOKEN value in Vercel is wrong/incomplete. Generate a new token, update GITHUB_TOKEN in Vercel, and redeploy — a stale value persists until you redeploy.',
    };
  }

  if (resp.status === 403) {
    if (ssoHeader) {
      return {
        ok: false,
        status: 422,
        reason: 'The token must be authorised for SSO on the robynandgold organisation before GitHub will accept it. Open the token on GitHub and click "Configure SSO" / "Authorize".',
      };
    }
    return {
      ok: false,
      status: 422,
      reason: 'GitHub returned 403 (forbidden) for the token — usually a temporary rate limit. Wait a minute and try again.',
    };
  }

  if (resp.status === 404) {
    return {
      ok: false,
      status: 422,
      reason: `The token cannot see ${REPO}. For a fine-grained token, make sure this repository is selected under "Repository access" and "Contents" is set to "Read and write", then update GITHUB_TOKEN in Vercel and redeploy.`,
    };
  }

  // Anything else (5xx, 429, …) is the validator's problem, not the token's —
  // fail open and let the actual publish call report any genuine issue.
  console.warn(`admin-token: unexpected GitHub status ${resp.status} while validating, allowing anyway`);
  return { ok: true };
}

/**
 * Admin login for the product-publishing page.
 *
 * The browser sends the admin password; if it matches ADMIN_PASSWORD this
 * returns the GITHUB_TOKEN used to commit products/media. The GitHub token
 * therefore lives only in Vercel's environment variables — never hard-coded
 * in the page or stored long-term in the browser.
 *
 * Before handing the token back, we validate it against GitHub so a
 * revoked/wrong/under-permissioned token is reported clearly at login rather
 * than as an opaque failure mid-publish.
 *
 * Required env vars (set in Vercel → Settings → Environment Variables):
 *   ADMIN_PASSWORD  — the password you choose for the admin page
 *   GITHUB_TOKEN    — a token with write access to the repo (already used by the webhook)
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  // Trim so a stray newline/space in the Vercel env var can't end up in the
  // Authorization header and trigger a "Bad credentials" rejection from GitHub.
  const githubToken = (process.env.GITHUB_TOKEN || '').trim();

  if (!adminPassword || !githubToken) {
    console.error('admin-token: ADMIN_PASSWORD or GITHUB_TOKEN not set');
    return res.status(500).json({ error: 'Publishing is not configured on the server.' });
  }

  let password = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    password = body.password || '';
  } catch (err) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Constant-time comparison (length check first so timingSafeEqual gets equal-length buffers)
  const given = Buffer.from(String(password));
  const expected = Buffer.from(String(adminPassword));
  const ok = given.length === expected.length && crypto.timingSafeEqual(given, expected);

  if (!ok) {
    return res.status(401).json({ error: 'Incorrect password' });
  }

  // Password is correct — now make sure the GitHub token will actually work,
  // returning a specific reason if not. (Non-401 status so the client doesn't
  // mistake a token problem for a wrong password.)
  const check = await validateToken(githubToken);
  if (!check.ok) {
    console.error('admin-token: GitHub token validation failed —', check.reason);
    return res.status(check.status || 422).json({ error: check.reason });
  }

  return res.status(200).json({ token: githubToken });
};

