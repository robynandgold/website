// Cloudflare Pages Function — POST /api/admin-token
//
// Admin login for the product-publishing page. The browser sends the admin
// password; if it matches ADMIN_PASSWORD this returns the GITHUB_TOKEN used to
// commit products/media. The GitHub token therefore lives only in the Pages
// environment variables — never in the page or long-term in the browser.
//
// Required env vars (Cloudflare Pages → Settings → Environment variables):
//   ADMIN_PASSWORD  — the password you choose for the admin page
//   GITHUB_TOKEN    — a token with write access to the repo
//
// timingSafeEqual comes from node:crypto (needs the nodejs_compat flag, set in
// wrangler.toml) to keep the original constant-time comparison.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  const adminPassword = env.ADMIN_PASSWORD;
  const githubToken = env.GITHUB_TOKEN;

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

  return json({ token: githubToken }, 200);
}
