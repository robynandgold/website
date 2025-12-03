const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const fs = require('fs').promises;
const path = require('path');

// Disable body parsing to get raw body for Stripe signature verification
export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Get raw body
    const buf = await buffer(req);
    const body = buf.toString('utf8');

    // Verify webhook signature
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  // Handle checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      // Get product IDs from metadata
      const productIds = session.metadata.product_ids ? session.metadata.product_ids.split(',') : [];

      if (productIds.length > 0) {
        // Update products via GitHub API
        await markProductsAsSoldViaGitHub(productIds);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('Error processing webhook:', err);
      return res.status(500).json({ error: 'Failed to process webhook' });
    }
  }

  res.status(200).json({ received: true });
}

async function markProductsAsSoldViaGitHub(productIds) {
  const token = process.env.GITHUB_TOKEN;
  const owner = 'robynandgold';
  const repo = 'website';
  const filePath = 'src/data/products.json';
  const branch = 'main';

  if (!token) {
    console.error('GITHUB_TOKEN not set');
    return;
  }

  try {
    // 1. Get current file content and SHA
    const fileResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
      },
    });

    if (!fileResponse.ok) {
      throw new Error('Failed to fetch products.json from GitHub');
    }

    const fileData = await fileResponse.json();
    const currentContent = Buffer.from(fileData.content, 'base64').toString('utf8');
    const products = JSON.parse(currentContent);

    // 2. Update products
    let updated = false;
    for (const product of products) {
      if (productIds.includes(product.id)) {
        product.available = false;
        updated = true;
      }
    }

    if (!updated) {
      console.log('No products matched the IDs');
      return;
    }

    // 3. Commit updated file
    const newContent = JSON.stringify(products, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');

    const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Mark products as sold: ${productIds.join(', ')}`,
        content: encodedContent,
        sha: fileData.sha,
        branch: branch,
      }),
    });

    if (!commitResponse.ok) {
      const errorData = await commitResponse.json();
      throw new Error(`Failed to commit to GitHub: ${errorData.message}`);
    }

    console.log(`Successfully marked products as sold: ${productIds.join(', ')}`);
  } catch (error) {
    console.error('Error updating products via GitHub:', error);
    throw error;
  }
}
