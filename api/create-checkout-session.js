const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs').promises;
const path = require('path');

const GH_OWNER = 'robynandgold';
const GH_REPO = 'website';
const PRODUCTS_PATH = 'src/data/products.json';

/**
 * Load the current product catalogue, preferring the freshest source so a
 * just-sold item is caught even before the site finishes rebuilding.
 * Order: GitHub Contents API (authenticated, no CDN cache) → raw GitHub
 * (may be briefly cached) → the file bundled with this deploy.
 */
async function getCurrentProducts() {
  const token = process.env.GITHUB_TOKEN;

  if (token) {
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${PRODUCTS_PATH}?ref=main`,
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } }
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

  try {
    const filePath = path.join(process.cwd(), PRODUCTS_PATH);
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    console.error('[checkout] local products read error:', err);
    return null;
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check for Stripe API key
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set in environment variables');
    return res.status(500).json({ 
      error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY in Vercel environment variables.' 
    });
  }

  try {
    const { items, successUrl, cancelUrl } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'No items provided' });
    }

    // The request body is only trusted for *which* products are wanted.
    // Name, price and currency always come from the live catalogue so a
    // tampered request can't set its own price, and quantity is forced to 1
    // because every piece is one of a kind. That means the catalogue is
    // required: if it can't be loaded we fail closed rather than fall back
    // to client-supplied prices.
    const products = await getCurrentProducts();
    if (!products) {
      console.error('[checkout] Could not load catalogue; refusing checkout (fail closed)');
      return res.status(503).json({
        error: 'Checkout is temporarily unavailable. Please try again in a few minutes.'
      });
    }

    const byId = new Map(products.map(p => [String(p.id), p]));
    const unavailable = [];
    const line_items = [];

    for (const item of items) {
      const product = byId.get(String(item.id));
      if (!product || product.available === false) {
        unavailable.push({ id: item.id, name: (product && product.name) || item.name });
        continue;
      }
      line_items.push({
        price_data: {
          currency: String(product.currency || process.env.STRIPE_CURRENCY || 'eur').toLowerCase(),
          product_data: {
            name: product.name,
            description: product.description || undefined,
            metadata: {
              product_id: product.id
            }
          },
          unit_amount: Math.round(product.price * 100)
        },
        quantity: 1
      });
    }

    if (unavailable.length > 0) {
      console.log('[checkout] Rejected — unavailable items:', unavailable.map(u => u.id).join(', '));
      return res.status(409).json({
        error: 'Some items are no longer available',
        unavailable
      });
    }

    const session = await stripe.checkout.sessions.create({
      // No payment_method_types: let Stripe offer every method enabled in the
      // Dashboard (cards, wallets, Link, …) based on the buyer's device/locale.
      mode: 'payment',
      // One-of-a-kind stock: keep the session short so an abandoned checkout
      // doesn't sit on a piece all day, and let Stripe issue a recovery URL
      // (via the checkout.session.expired webhook) if it does lapse.
      // Stripe's minimum is 30 minutes ahead; 35 leaves headroom for clock skew.
      expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
      after_expiration: {
        recovery: { enabled: true }
      },
      line_items,
      shipping_address_collection: {
        allowed_countries: ['AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CV', 'CW', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IS', 'IT', 'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MK', 'ML', 'MM', 'MN', 'MO', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU', 'RW', 'SA', 'SB', 'SC', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS', 'ST', 'SV', 'SX', 'SZ', 'TA', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE', 'VG', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW', 'ZZ'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: 1000, // €10.00 in cents
              currency: 'eur',
            },
            display_name: 'Ireland shipping',
            delivery_estimate: {
              minimum: {
                unit: 'business_day',
                value: 2,
              },
              maximum: {
                unit: 'business_day',
                value: 5,
              },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: 1500, // 15.00 in cents
              currency: 'eur',
            },
            display_name: 'UK and European shipping',
            delivery_estimate: {
              minimum: {
                unit: 'business_day',
                value: 5,
              },
              maximum: {
                unit: 'business_day',
                value: 10,
              },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: 4500, // €45.00 in cents
              currency: 'eur',
            },
            display_name: 'Rest of the world shipping',
            delivery_estimate: {
              minimum: {
                unit: 'business_day',
                value: 7,
              },
              maximum: {
                unit: 'business_day',
                value: 14,
              },
            },
          },
        },
      ],
      success_url: successUrl || `${process.env.SITE_URL}/pages/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl || `${process.env.SITE_URL}/pages/cart.html`,
      metadata: {
        product_ids: items.map(item => item.id).join(',')
      }
    });

    res.status(200).json({ url: session.url, id: session.id });
  } catch (err) {
    console.error('Stripe session creation error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
};