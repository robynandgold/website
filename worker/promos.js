// POST /api/promos — create, list and switch off promo codes.
//
// These are Stripe promotion codes, not a discount scheme of our own. The
// shopper types the code into Stripe's hosted checkout (enabled by
// `allow_promotion_codes` in checkout.js) and Stripe validates it, applies the
// percentage, enforces the expiry and counts redemptions. Nothing here touches
// the price we send, so a bug in this file cannot mis-charge an order — the
// worst case is a code that doesn't exist.
//
// Gated by the admin password, like the other admin endpoints.
import Stripe from 'stripe';
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Stripe accepts upper-case letters, numbers, hyphens and underscores, and
// matches case-insensitively at the till.
const CODE_RE = /^[A-Z0-9_-]{3,32}$/;

function shape(pc) {
  const coupon = pc.coupon || {};
  return {
    id: pc.id,
    code: pc.code,
    percent: coupon.percent_off ?? null,
    active: pc.active !== false && coupon.valid !== false,
    redeemed: pc.times_redeemed || 0,
    maxRedemptions: pc.max_redemptions || null,
    expiresAt: pc.expires_at ? pc.expires_at * 1000 : null,
    createdAt: pc.created ? pc.created * 1000 : null,
  };
}

export async function handlePromos(request, env) {
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

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  const action = (body && body.action) || 'list';

  try {
    if (action === 'create') {
      const code = String(body.code || '').trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        return json({ error: 'Use 3–32 characters: letters, numbers, hyphens or underscores.' }, 400);
      }

      const percent = Number(body.percent);
      if (!isFinite(percent) || percent <= 0 || percent > 100) {
        return json({ error: 'The discount must be between 1% and 100%.' }, 400);
      }

      // Seconds, from the admin page's Irish-time picker. Stripe rejects a
      // past expiry, so catch it here with a clearer message.
      let expiresAt = body.expiresAt ? Math.floor(Number(body.expiresAt) / 1000) : null;
      if (expiresAt !== null) {
        if (!isFinite(expiresAt)) return json({ error: 'Invalid expiry date.' }, 400);
        if (expiresAt <= Math.floor(Date.now() / 1000)) {
          return json({ error: 'That expiry is in the past.' }, 400);
        }
      }

      const maxRedemptions = body.maxRedemptions ? Math.floor(Number(body.maxRedemptions)) : null;
      if (maxRedemptions !== null && (!isFinite(maxRedemptions) || maxRedemptions < 1)) {
        return json({ error: 'Maximum uses must be 1 or more.' }, 400);
      }

      // duration 'once' — every order is a one-off purchase here, so there is
      // no subscription for a repeating discount to apply to.
      const coupon = await stripe.coupons.create({
        percent_off: percent,
        duration: 'once',
        name: `${code} — ${percent}% off`,
      });

      const promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code,
        ...(expiresAt ? { expires_at: expiresAt } : {}),
        ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
      });

      return json({ promo: shape({ ...promo, coupon }) });
    }

    if (action === 'deactivate') {
      const id = String(body.id || '');
      if (!/^promo_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Invalid code id.' }, 400);
      const promo = await stripe.promotionCodes.update(id, { active: false });
      return json({ promo: shape(promo) });
    }

    if (action === 'activate') {
      const id = String(body.id || '');
      if (!/^promo_[A-Za-z0-9]+$/.test(id)) return json({ error: 'Invalid code id.' }, 400);
      const promo = await stripe.promotionCodes.update(id, { active: true });
      return json({ promo: shape(promo) });
    }

    // Default: list. A shop this size will never approach the page limit.
    const list = await stripe.promotionCodes.list({ limit: 100 });
    const promos = (list.data || []).map(shape)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return json({ promos });
  } catch (err) {
    // Stripe's own messages are the useful ones here ("code already exists"),
    // so pass them through rather than flattening to a generic failure.
    const message = (err && err.raw && err.raw.message) || (err && err.message) || 'Stripe rejected that.';
    return json({ error: message }, 400);
  }
}
