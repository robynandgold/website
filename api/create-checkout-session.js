const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

    const line_items = items.map(item => ({
      price_data: {
        currency: item.currency || process.env.STRIPE_CURRENCY || 'eur',
        product_data: {
          name: item.name,
          description: item.description || undefined,
          metadata: {
            product_id: item.id
          }
        },
        unit_amount: Math.round(item.price * 100)
      },
      quantity: item.quantity || 1
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
            fixed_amount: {
              amount: 12.50, // €0.00 in cents
              currency: 'eur',
            },
            display_name: 'Ireland Shipping',
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
              amount: 2500, // €25.00 in cents
              currency: 'eur',
            },
            display_name: 'International Shipping',
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
              amount: 45, // €40.00 in cents
              currency: 'eur',
            },
            display_name: 'USA Shipping',
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