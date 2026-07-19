// VIP early-access links.
//
// A piece can be scheduled as a "drop" (a future GMT `dropAt`). Until the drop,
// it's hidden from every listing and can't be bought. A VIP link lets a chosen
// recipient buy that one piece early: the link carries `?vip=<token>`, a
// per-product HMAC of the product id signed with the server-only VIP_SECRET.
//
// The token is minted here (POST /api/vip-link, gated by the admin password) so
// the secret never reaches the browser, and it's re-checked at checkout
// (checkout.js) so early purchase is genuinely enforced, not just hidden in the
// UI. A token unlocks exactly one piece; without VIP_SECRET set, early purchase
// is simply never allowed.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** True when a piece has a drop scheduled for the future (server clock). */
export function isScheduled(product, now = Date.now()) {
  if (!product || !product.dropAt) return false;
  const t = Date.parse(product.dropAt);
  return !isNaN(t) && t > now;
}

/** HMAC-SHA256(secret, message) as lowercase hex, via the Workers Web Crypto API. */
export async function vipToken(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(String(message)));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare of two hex strings. */
export function tokensMatch(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Whether a checkout is allowed to include this product. A live piece is always
 * fine; a scheduled piece is allowed only when the request carries a valid VIP
 * token for it. Async because token verification hashes with Web Crypto.
 */
export async function purchaseAllowed(product, providedVip, env) {
  if (!isScheduled(product)) return true;
  if (!env.VIP_SECRET) return false; // early access not configured → never sellable early
  if (!providedVip) return false;
  const expected = await vipToken(env.VIP_SECRET, String(product.id));
  return tokensMatch(providedVip, expected);
}

// POST /api/vip-link — { password, id } → { token }. Gated by the admin
// password (constant-time), so only the shopkeeper can mint early-access links.
export async function handleVipLink(request, env) {
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return json({ error: 'Admin access is not configured on the server.' }, 500);
  }
  if (!env.VIP_SECRET) {
    return json(
      { error: 'VIP early access is not configured. Add a VIP_SECRET secret to the Worker (Settings → Variables and Secrets), then try again.' },
      501
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const password = (body && body.password) || '';
  const id = (body && body.id) || '';

  const given = Buffer.from(String(password));
  const expected = Buffer.from(String(adminPassword));
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  if (!ok) return json({ error: 'Incorrect password' }, 401);

  if (!id) return json({ error: 'Missing product id' }, 400);

  const token = await vipToken(env.VIP_SECRET, String(id));
  return json({ token }, 200);
}
