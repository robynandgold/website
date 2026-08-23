// POST /api/abandoned — checkouts that were started and never paid for.
//
// Read straight from Stripe rather than stored here: a Checkout Session
// already records which pieces were in it (metadata.product_ids, set in
// checkout.js) and expires 35 minutes after it's created, so Stripe is both
// the source of truth and the history. Nothing to keep in sync, and it works
// retroactively over sessions that pre-date this endpoint.
//
// Gated by the admin password, like /api/insights and /api/costs.
import Stripe from 'stripe';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleAbandoned(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'Admin access is not configured on the server.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'Invalid request body' }, 400);
  }

  const password = (body && body.password) || '';
  const given = Buffer.from(String(password));
  const expected = Buffer.from(String(env.ADMIN_PASSWORD));
  const ok = given.length === expected.length && timingSafeEqual(given, expected);
  if (!ok) return json({ error: 'Incorrect password' }, 401);

  if (!env.STRIPE_SECRET_KEY) {
    return json({ error: 'Stripe is not configured on the server.' }, 500);
  }

  const days = Math.max(1, Math.min(365, Number(body && body.days) || 90));
  const since = Math.floor(Date.now() / 1000) - days * 86400;

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  const rows = [];
  try {
    // Expired sessions only: an 'open' one may still be paid, and a shopper
    // sitting on the payment page isn't an abandonment yet.
    for await (const session of stripe.checkout.sessions.list({
      status: 'expired',
      created: { gte: since },
      limit: 100,
    })) {
      const ids = String((session.metadata && session.metadata.product_ids) || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      if (!ids.length) continue;   // a Payment Link or hand-made session

      rows.push({
        ids,
        at: session.created ? session.created * 1000 : null,
        amount: typeof session.amount_total === 'number' ? session.amount_total / 100 : null,
        currency: (session.currency || 'eur').toUpperCase(),
        // Whether the recovery email had somewhere to go. Stripe only exposes
        // an email when the shopper typed one into the plain email field —
        // wallet users (Link, Apple Pay) don't reach us.
        emailCaptured: Boolean(
          (session.customer_details && session.customer_details.email) || session.customer_email
        ),
      });

      if (rows.length >= 300) break;   // plenty for a shop this size
    }
  } catch (err) {
    return json({ error: 'Could not read checkouts from Stripe.' }, 502);
  }

  return json({ rows, days });
}
