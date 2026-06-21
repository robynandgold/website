// Cloudflare Pages Function — POST /api/create-checkout-session
//
// Ported from the Vercel handler. Differences forced by the Workers runtime:
//   - env vars come from context.env, not process.env
//   - Stripe uses its fetch-based HTTP client (no Node http)
//   - returns a Response instead of mutating res
//   - the on-disk products.json fallback is dropped (no filesystem on
//     Workers); we fall open if both GitHub sources are unreachable, exactly
//     as the original did when the file couldn't be read.
import Stripe from 'stripe';
import { Buffer } from 'node:buffer';

const GH_OWNER = 'robynandgold';
const GH_REPO = 'website';
const PRODUCTS_PATH = 'src/data/products.json';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * Load the current product catalogue, preferring the freshest source so a
 * just-sold item is caught even before the site finishes rebuilding.
 * Order: GitHub Contents API (authenticated, no CDN cache) → raw GitHub.
 */
async function getCurrentProducts(env) {
  const token = env.GITHUB_TOKEN;

  if (token) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${PRODUCTS_PATH}?ref=main`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'robynandgold-checkout',
          },
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
      }
      console.error('[checkout] GitHub contents fetch failed:', resp.status);
    } catch (err) {
      console.error('[checkout] GitHub contents fetch error:', err);
    }
  }

  try {
    const resp = await fetch(
      `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/${PRODUCTS_PATH}`,
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (resp.ok) return await resp.json();
    console.error('[checkout] raw GitHub fetch failed:', resp.status);
  } catch (err) {
    console.error('[checkout] raw GitHub fetch error:', err);
  }

  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in environment variables');
    return json(
      { error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY in the Cloudflare Pages environment variables.' },
      500
    );
  }

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    const { items, successUrl, cancelUrl } = await request.json();

    if (!items || !Array.isArray(items) || items.length === 0) {
      return json({ error: 'No items provided' }, 400);
    }

    // Re-check availability before taking payment. Shrinks (but does not fully
    // eliminate) the window where two people buy the same unique piece. If the
    // catalogue can't be loaded we fail open so a transient outage doesn't
    // block every sale.
    const products = await getCurrentProducts(env);
    if (products) {
      const byId = new Map(products.map((p) => [String(p.id), p]));
      const unavailable = items
        .filter((item) => {
          const product = byId.get(String(item.id));
          return !product || product.available === false;
        })
        .map((item) => ({ id: item.id, name: item.name }));

      if (unavailable.length > 0) {
        console.log('[checkout] Rejected — unavailable items:', unavailable.map((u) => u.id).join(', '));
        return json({ error: 'Some items are no longer available', unavailable }, 409);
      }
    } else {
      console.warn('[checkout] Could not verify availability; proceeding (fail open)');
    }

    const line_items = items.map((item) => ({
      price_data: {
        currency: item.currency || env.STRIPE_CURRENCY || 'eur',
        product_data: {
          name: item.name,
          description: item.description || undefined,
          metadata: { product_id: item.id },
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items,
      shipping_address_collection: {
        allowed_countries: ['AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CV', 'CW', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MK', 'ML', 'MM', 'MN', 'MO', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SZ', 'TA', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW', 'ZZ'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 1000, currency: 'eur' },
            display_name: 'Ireland shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 2 },
              maximum: { unit: 'business_day', value: 5 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 1500, currency: 'eur' },
            display_name: 'UK and European shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 5 },
              maximum: { unit: 'business_day', value: 10 },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: 4500, currency: 'eur' },
            display_name: 'Rest of the world shipping',
            delivery_estimate: {
              minimum: { unit: 'business_day', value: 7 },
              maximum: { unit: 'business_day', value: 14 },
            },
          },
        },
      ],
      success_url: successUrl || `${env.SITE_URL}/pages/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${env.SITE_URL}/pages/cart.html`,
      metadata: {
        product_ids: items.map((item) => item.id).join(','),
      },
    });

    return json({ url: session.url, id: session.id }, 200);
  } catch (err) {
    console.error('Stripe session creation error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}
