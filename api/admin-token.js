const crypto = require('crypto');

/**
 * Admin login for the product-publishing page.
 *
 * The browser sends the admin password; if it matches ADMIN_PASSWORD this
 * returns the GITHUB_TOKEN used to commit products/media. The GitHub token
 * therefore lives only in Vercel's environment variables — never hard-coded
 * in the page or stored long-term in the browser.
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

  return res.status(200).json({ token: githubToken });
};
