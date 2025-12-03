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