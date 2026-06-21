// Cloudflare Pages Function — POST /api/webhook (Stripe events)
//
// Ported from the Vercel handler. The signature check uses Stripe's ASYNC
// verifier with the Web Crypto provider, because the Workers runtime has no
// synchronous Node crypto. The raw body is read with request.text() (Stripe
// must see the exact bytes it signed, so do NOT parse before verifying).
import Stripe from 'stripe';
import { Buffer } from 'node:buffer';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function onRequestPost(context) {
  const { request, env } = context;

  const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });
  const cryptoProvider = Stripe.createSubtleCryptoProvider();

  const sig = request.headers.get('stripe-signature');
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const body = await request.text();
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      webhookSecret,
      undefined,
      cryptoProvider
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return json({ error: `Webhook Error: ${err.message}` }, 400);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    try {
      let productIds =
        session.metadata && session.metadata.product_ids
          ? session.metadata.product_ids.split(',')
          : [];

      console.log('[Webhook] checkout.session.completed received');
      console.log(`[Webhook] Session ID: ${session.id}`);
      console.log(`[Webhook] Product IDs in metadata: ${productIds.join(', ') || '(none)'}`);
      console.log(`[Webhook] Env check -> STRIPE_WEBHOOK_SECRET set: ${env.STRIPE_WEBHOOK_SECRET ? 'yes' : 'no'}, GITHUB_TOKEN set: ${env.GITHUB_TOKEN ? 'yes' : 'no'}`);

      // Fallback: if no product IDs in session metadata, fetch line items.
      if (productIds.length === 0) {
        try {
          const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
            expand: ['data.price.product'],
          });
          const derivedIds = [];
          for (const li of lineItems.data) {
            const prod = li.price && li.price.product;
            if (prod && prod.metadata && prod.metadata.product_id) {
              derivedIds.push(prod.metadata.product_id);
            }
          }
          if (derivedIds.length > 0) {
            productIds = derivedIds;
            console.log('[Webhook] Derived product IDs from line items:', productIds.join(', '));
          } else {
            console.log('[Webhook] No product IDs found in line items metadata');
          }
        } catch (e) {
          console.error('[Webhook] Failed to list line items for session:', session.id, e);
        }
      }

      if (productIds.length > 0) {
        await markProductsAsSoldViaGitHub(productIds, env);
        console.log('[Webhook] GitHub commit flow completed');
      }

      return json({ received: true }, 200);
    } catch (err) {
      console.error('[Webhook] Error processing webhook:', err);
      return json({ error: 'Failed to process webhook' }, 500);
    }
  }

  return json({ received: true }, 200);
}

async function markProductsAsSoldViaGitHub(productIds, env) {
  const token = env.GITHUB_TOKEN;
  const owner = 'robynandgold';
  const repo = 'website';
  const filePath = 'src/data/products.json';
  const branch = 'main';

  if (!token) {
    console.error('GITHUB_TOKEN not set');
    return;
  }

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'robynandgold-webhook',
  };

  try {
    // 1. Get current file content and SHA
    const fileResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`,
      { headers: ghHeaders }
    );

    if (!fileResponse.ok) {
      const txt = await fileResponse.text();
      console.error('[Webhook] GitHub contents fetch failed:', fileResponse.status, txt);
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
        product.featured = false;
        updated = true;
      }
    }

    if (!updated) {
      console.log('[Webhook] No products matched the IDs. Skipping commit. IDs:', productIds.join(', '));
      return;
    }

    // 3. Commit updated file
    const newContent = JSON.stringify(products, null, 2);
    const encodedContent = Buffer.from(newContent).toString('base64');

    const commitResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
      {
        method: 'PUT',
        headers: { ...ghHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Mark products as sold: ${productIds.join(', ')}`,
          content: encodedContent,
          sha: fileData.sha,
          branch,
        }),
      }
    );

    if (!commitResponse.ok) {
      const errorText = await commitResponse.text();
      console.error('[Webhook] GitHub commit failed:', commitResponse.status, errorText);
      let errMsg = 'Failed to commit to GitHub';
      try {
        const errorData = JSON.parse(errorText);
        if (errorData && errorData.message) errMsg = `${errMsg}: ${errorData.message}`;
      } catch {}
      throw new Error(errMsg);
    }

    console.log('[Webhook] Successfully marked products as sold:', productIds.join(', '));
  } catch (error) {
    console.error('[Webhook] Error updating products via GitHub:', error);
    throw error;
  }
}
