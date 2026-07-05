// POST /api/admin-token — admin login for the product-publishing page.
//
// The browser sends the admin password; if it matches ADMIN_PASSWORD this
// returns the GITHUB_TOKEN used to commit products/media. The token therefore
// lives only in the Worker's variables — never in the page or long-term in the
// browser.
//
// Before handing the token back, we validate it against GitHub so a revoked/
// wrong/under-permissioned token is reported clearly at login rather than as
// an opaque "Bad credentials" failure mid-publish.
//
// Required variables (Workers project → Settings → Variables and Secrets):
//   ADMIN_PASSWORD  — the password you choose for the admin page
//   GITHUB_TOKEN    — a token with write access to the repo
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const REPO = 'robynandgold/website';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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

  if (resp.status === 200) {
    let body = {};
    try { body = await resp.json(); } catch (_) { /* ignore */ }
    if (body && body.permissions && body.permissions.push === false) {
      return {
        ok: false,
        status: 422,
        reason: `The GitHub token can read ${REPO} but lacks write access. Set its "Contents" permission to "Read and write" (fine-grained) or give it the "repo" scope (classic), then update the GITHUB_TOKEN secret on the Cloudflare Worker (Settings → Variables and Secrets).`,
      };
    }

    // The publish page uploads large files (videos) through the Git Data
    // API, which rejects some token types — notably fine-grained PATs — with
    // a misleading "Bad credentials" even when the Contents API works.
    // Probe it with a tiny orphan blob so a token that can't upload videos
    // is caught here at login, with a plain-language reason. (Unreferenced
    // blobs are garbage-collected by GitHub; nothing lands on any branch.)
    try {
      const blobResp = await fetch(`https://api.github.com/repos/${REPO}/git/blobs`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'robynandgold-admin',
        },
        body: JSON.stringify({ content: 'robynandgold token probe', encoding: 'utf-8' }),
      });
      if (blobResp.status === 401 || blobResp.status === 403 || blobResp.status === 404) {
        return {
          ok: false,
          status: 422,
          reason: 'The token works for images but GitHub rejects it for the large-file (video) upload API. Use a CLASSIC personal access token with the "repo" scope (GitHub → Developer settings → Personal access tokens → Tokens (classic)), then update the GITHUB_TOKEN secret on the Cloudflare Worker.',
        };
      }
    } catch (err) {
      console.warn('admin-token: blob probe failed to run, allowing anyway —', err.message);
    }

    return { ok: true };
  }

  if (resp.status === 401) {
    return {
      ok: false,
      status: 422,
      reason: 'GitHub rejected the token (Bad credentials). It has been revoked, regenerated, or the stored value is wrong/incomplete. Generate a new token on GitHub and update the GITHUB_TOKEN secret on the Cloudflare Worker (Settings → Variables and Secrets).',
    };
  }

  if (resp.status === 403) {
    if (resp.headers.get('x-github-sso')) {
      return {
        ok: false,
        status: 422,
        reason: 'The token must be authorised for SSO before GitHub will accept it. Open the token on GitHub and click "Configure SSO" / "Authorize".',
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
      reason: `The token cannot see ${REPO}. For a fine-grained token, make sure this repository is selected under "Repository access" and "Contents" is set to "Read and write", then update the GITHUB_TOKEN secret on the Cloudflare Worker.`,
    };
  }

  // Anything else (5xx, 429, …) is the validator's problem, not the token's —
  // fail open and let the actual publish call report any genuine issue.
  console.warn(`admin-token: unexpected GitHub status ${resp.status} while validating, allowing anyway`);
  return { ok: true };
}

export async function handleAdminToken(request, env) {
  const adminPassword = env.ADMIN_PASSWORD;
  // Trim so a stray newline/space in the secret can't end up in the
  // Authorization header and trigger a "Bad credentials" rejection.
  const githubToken = (env.GITHUB_TOKEN || '').trim();

  if (!adminPassword || !githubToken) {
    console.error('admin-token: ADMIN_PASSWORD or GITHUB_TOKEN not set');
    return json({ error: 'Publishing is not configured on the server.' }, 500);
  }

  let password = '';
  try {
    const body = await request.json();
    password = (body && body.password) || '';
  } catch (err) {
    return json({ error: 'Invalid request body' }, 400);
  }

  // Constant-time comparison (length check first so timingSafeEqual gets
  // equal-length buffers).
  const given = Buffer.from(String(password));
  const expected = Buffer.from(String(adminPassword));
  const ok = given.length === expected.length && timingSafeEqual(given, expected);

  if (!ok) {
    return json({ error: 'Incorrect password' }, 401);
  }

  // Password is correct — now make sure the GitHub token will actually work,
  // returning a specific reason if not. (Non-401 status so the client doesn't
  // mistake a token problem for a wrong password.)
  const check = await validateToken(githubToken);
  if (!check.ok) {
    console.error('admin-token: GitHub token validation failed —', check.reason);
    return json({ error: check.reason }, check.status || 422);
  }

  return json({ token: githubToken }, 200);
}
