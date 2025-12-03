const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs').promises;
const path = require('path');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // Get line items from the session
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

      // Extract product IDs from metadata (you'll need to add this to checkout session creation)
      const productIds = [];
      for (const item of lineItems.data) {
        if (item.price && item.price.metadata && item.price.metadata.product_id) {
          productIds.push(item.price.metadata.product_id);
        }
      }

      if (productIds.length > 0) {
        // Update products.json to mark items as sold
        await markProductsAsSold(productIds);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('Error processing webhook:', err);
      return res.status(500).json({ error: 'Failed to process webhook' });
    }
  }

  res.status(200).json({ received: true });
}

async function markProductsAsSold(productIds) {
  const productsPath = path.join(process.cwd(), 'src', 'data', 'products.json');
  
  // Read products.json
  const data = await fs.readFile(productsPath, 'utf8');
  const products = JSON.parse(data);

  // Mark products as unavailable
  let updated = false;
  for (const product of products) {
    if (productIds.includes(product.id)) {
      product.available = false;
      updated = true;
    }
  }

  // Write back to file if changes were made
  if (updated) {
    await fs.writeFile(productsPath, JSON.stringify(products, null, 2), 'utf8');
    console.log(`Marked products as sold: ${productIds.join(', ')}`);
  }
}
