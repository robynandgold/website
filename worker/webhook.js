// POST /api/webhook — Stripe webhook (checkout.session.completed → mark sold).
//
// The signature check uses Stripe's ASYNC verifier with the Web Crypto
// provider (no synchronous Node crypto on Workers). The raw body is read with
// request.text() — Stripe must see the exact bytes it signed, so do NOT parse
// before verifying.
import Stripe from 'stripe';
import { Buffer } from 'node:buffer';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleWebhook(request, env) {
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

      // Send the buyer a branded order confirmation. Wrapped so an email
      // problem can never fail the webhook (which would make Stripe retry and
      // re-run the sold-marking); the sale is already recorded above.
      try {
        await sendConfirmationEmail(session, productIds, env);
      } catch (mailErr) {
        console.error('[Webhook] Confirmation email failed:', mailErr);
      }

      return json({ received: true }, 200);
    } catch (err) {
      console.error('[Webhook] Error processing webhook:', err);
      return json({ error: 'Failed to process webhook' }, 500);
    }
  }

  // Abandoned checkout: the session lapsed (35-minute expiry) after the
  // shopper got far enough to enter their email. Send them Stripe's recovery
  // link (valid 30 days) so they can resume with their cart intact.
  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    try {
      await sendRecoveryEmail(session, env);
    } catch (err) {
      // Never make Stripe retry over a courtesy email — log and acknowledge.
      console.error('[Webhook] Recovery email failed:', err);
    }
    return json({ received: true }, 200);
  }

  return json({ received: true }, 200);
}

// Look up the purchased pieces in the live catalogue to get their names and a
// photo for the confirmation email. Best-effort: returns [] on any failure.
async function lookupProducts(productIds) {
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/robynandgold/website/main/src/data/products.json',
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (!resp.ok) return [];
    const products = await resp.json();
    const byId = new Map(products.map((p) => [String(p.id), p]));
    return productIds.map((id) => byId.get(String(id))).filter(Boolean);
  } catch (err) {
    console.warn('[Webhook] Could not load catalogue for email:', err.message);
    return [];
  }
}

function money(amountMinor, currency) {
  const cur = (currency || 'eur').toUpperCase();
  const symbol = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur + ' ';
  return `${symbol}${(Number(amountMinor || 0) / 100).toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Order confirmation, sent on checkout.session.completed. A completed session
// always carries the buyer's email (they paid), so unlike the recovery email
// this fires reliably every time.
async function sendConfirmationEmail(session, productIds, env) {
  if (!env.RESEND_API_KEY) {
    console.log('[Webhook] Purchase completed but RESEND_API_KEY is not set — skipping confirmation email');
    return;
  }

  const email =
    (session.customer_details && session.customer_details.email) || session.customer_email;
  if (!email) {
    console.log('[Webhook] Completed session had no customer email — cannot send confirmation');
    return;
  }

  const name =
    (session.customer_details && session.customer_details.name) || 'there';
  const firstName = String(name).split(' ')[0];

  const products = await lookupProducts(productIds);
  const photoUrl =
    products.find((p) => p.images && p.images[0]) &&
    'https://robynandgold.com' + products.find((p) => p.images && p.images[0]).images[0];

  const currency = session.currency || 'eur';
  const shippingAmount =
    (session.shipping_cost && session.shipping_cost.amount_total) || 0;
  const shippingName =
    (session.shipping_cost &&
      session.shipping_cost.shipping_rate &&
      typeof session.shipping_cost.shipping_rate === 'object' &&
      session.shipping_cost.shipping_rate.display_name) ||
    'Shipping';

  // The delivery address location differs by Stripe API version: newer
  // versions (2024+) nest it under collected_information.shipping_details;
  // older ones expose session.shipping_details. Fall back through both, then
  // to the billing address in customer_details, so we read it wherever it is.
  const ship =
    (session.collected_information && session.collected_information.shipping_details) ||
    session.shipping_details ||
    session.customer_details ||
    null;
  const addr = ship && ship.address;
  const shipName = (ship && ship.name) || (session.customer_details && session.customer_details.name);
  const addressLines = addr
    ? [shipName, addr.line1, addr.line2, [addr.postal_code, addr.city].filter(Boolean).join(' '), addr.state, addr.country]
        .filter(Boolean)
        .map((l) => escapeHtml(l))
        .join('<br>')
    : '';

  const itemRows = (products.length
    ? products.map((p) => `${escapeHtml(p.name)}`)
    : ['Your order']
  )
    .map(
      (n) =>
        `<tr><td style="padding:6px 0; font-size:14px; color:#3d372e;">${n}</td></tr>`
    )
    .join('');

  const html = `
  <div style="font-family: Georgia, 'Times New Roman', serif; background:#faf7f2; padding:32px 16px;">
    <div style="max-width:520px; margin:0 auto; background:#fdfbf8; border:1px solid #ddd1c2; border-radius:10px; padding:36px 32px; color:#3d372e;">
      <p style="text-align:center; margin:0 0 8px;">
        <img src="https://robynandgold.com/images/rg-logo.png" alt="Robyn &amp; Gold" width="120" style="width:120px; height:auto; display:inline-block;" />
      </p>
      <p style="font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#8b7355; text-align:center; margin:0 0 26px;">Vintage Jewellery</p>
      <h1 style="font-size:22px; font-weight:500; text-align:center; margin:0 0 6px;">Thank you, ${escapeHtml(firstName)}</h1>
      <p style="font-size:14px; line-height:1.7; text-align:center; color:#8a8172; margin:0 0 22px;">Your order is confirmed &mdash; here are the details.</p>
      ${photoUrl ? `<p style="text-align:center; margin:0 0 22px;"><img src="${photoUrl}" alt="" width="190" style="width:190px; max-width:100%; height:auto; border-radius:8px; display:inline-block;" /></p>` : ''}
      <table style="width:100%; border-collapse:collapse; margin:0 0 18px;">
        ${itemRows}
      </table>
      <table style="width:100%; border-collapse:collapse; border-top:1px solid #eadfce; padding-top:10px;">
        <tr><td style="padding:8px 0 2px; font-size:13px; color:#8a8172;">${escapeHtml(shippingName)}</td><td style="padding:8px 0 2px; font-size:13px; color:#8a8172; text-align:right;">${money(shippingAmount, currency)}</td></tr>
        <tr><td style="padding:2px 0; font-size:15px; color:#3d372e;"><strong>Total paid</strong></td><td style="padding:2px 0; font-size:15px; color:#3d372e; text-align:right;"><strong>${money(session.amount_total, currency)}</strong></td></tr>
      </table>
      ${addressLines ? `<p style="font-size:13px; line-height:1.7; color:#8a8172; margin:22px 0 0;"><strong style="color:#3d372e;">Shipping to</strong><br>${addressLines}</p>` : ''}
      <p style="font-size:14px; line-height:1.7; margin:24px 0 0;">
        Each piece is checked and lovingly prepared before it's sent, fully insured, from Ireland.
        We'll be in touch when your order is on its way.
      </p>
      <p style="font-size:13px; line-height:1.7; color:#8a8172; margin:14px 0 0;">
        Any questions? Just reply to this email &mdash; we'd love to help.
      </p>
    </div>
    <p style="max-width:520px; margin:14px auto 0; font-size:11px; color:#a99; text-align:center;">
      Robyn &amp; Gold &middot; robynandgold.com
    </p>
  </div>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Robyn & Gold <info@robynandgold.com>',
      reply_to: 'info@robynandgold.com',
      to: [email],
      subject: 'Your order is confirmed — Robyn & Gold',
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend rejected the confirmation (${resp.status}): ${body}`);
  }
  console.log(`[Webhook] Confirmation email sent to ${email} for session ${session.id}`);
}

async function sendRecoveryEmail(session, env) {
  if (!env.RESEND_API_KEY) {
    console.log('[Webhook] checkout.session.expired received but RESEND_API_KEY is not set — skipping recovery email');
    return;
  }

  const email =
    (session.customer_details && session.customer_details.email) || session.customer_email;
  const recoveryUrl =
    session.after_expiration && session.after_expiration.recovery && session.after_expiration.recovery.url;

  if (!email) {
    console.log('[Webhook] Expired session had no customer email — nothing to send');
    return;
  }
  if (!recoveryUrl) {
    console.log('[Webhook] Expired session had no recovery URL — nothing to send');
    return;
  }

  // Every piece is one of a kind: if anything in the abandoned cart has sold
  // in the meantime, a "come back and buy it" email would be cruel. Check the
  // live catalogue and stay silent unless everything is still available.
  const productIds =
    session.metadata && session.metadata.product_ids
      ? session.metadata.product_ids.split(',')
      : [];
  let names = [];
  let photoUrl = null;
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/robynandgold/website/main/src/data/products.json',
      { headers: { 'Cache-Control': 'no-cache' } }
    );
    if (resp.ok) {
      const products = await resp.json();
      const byId = new Map(products.map((p) => [String(p.id), p]));
      for (const id of productIds) {
        const p = byId.get(String(id));
        if (!p || p.available === false) {
          console.log(`[Webhook] Skipping recovery email — "${id}" is no longer available`);
          return;
        }
        names.push(p.name);
        if (!photoUrl && p.images && p.images[0]) {
          photoUrl = 'https://robynandgold.com' + p.images[0];
        }
      }
    }
  } catch (err) {
    console.warn('[Webhook] Could not verify availability for recovery email, sending anyway:', err.message);
  }

  const pieceLabel =
    names.length === 1 ? `&ldquo;${names[0]}&rdquo;` : names.length > 1 ? 'the pieces in your bag' : 'your piece';

  const html = `
  <div style="font-family: Georgia, 'Times New Roman', serif; background:#faf7f2; padding:32px 16px;">
    <div style="max-width:520px; margin:0 auto; background:#fdfbf8; border:1px solid #ddd1c2; border-radius:10px; padding:36px 32px; color:#3d372e;">
      <p style="text-align:center; margin:0 0 8px;">
        <img src="https://robynandgold.com/images/rg-logo.png" alt="Robyn &amp; Gold" width="120" style="width:120px; height:auto; display:inline-block;" />
      </p>
      <p style="font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#8b7355; text-align:center; margin:0 0 26px;">Vintage Jewellery</p>
      <h1 style="font-size:22px; font-weight:500; text-align:center; margin:0 0 18px;">Still thinking it over?</h1>
      ${photoUrl ? `<p style="text-align:center; margin:0 0 18px;">
        <img src="${photoUrl}" alt="${pieceLabel.replace(/&[a-z]+;/g, '')}" width="190" style="width:190px; max-width:100%; height:auto; border-radius:8px; display:inline-block;" />
      </p>` : ''}
      <p style="font-size:15px; line-height:1.7; margin:0 0 12px;">
        You were moments away from bringing ${pieceLabel} home. Your bag is saved &mdash;
        you can pick up right where you left off.
      </p>
      <p style="font-size:15px; line-height:1.7; margin:0 0 24px;">
        A gentle note: every piece we sell is one of a kind, so once it finds a home, it's gone.
      </p>
      <p style="text-align:center; margin:0 0 24px;">
        <a href="${recoveryUrl}" style="display:inline-block; background:#3d372e; color:#fdfbf8; text-decoration:none; padding:13px 30px; border-radius:999px; font-size:14px; letter-spacing:0.06em;">Complete your order</a>
      </p>
      <p style="font-size:13px; line-height:1.7; color:#8a8172; margin:0 0 10px;">
        Prefer to spread the cost? Klarna instalments are available at checkout in Ireland, the UK and
        most of Europe.
      </p>
      <p style="font-size:13px; line-height:1.7; color:#8a8172; margin:0;">
        Questions about sizing, or want more photos first? Just reply to this email &mdash; we'd rather you
        feel completely confident before you buy.
      </p>
    </div>
    <p style="max-width:520px; margin:14px auto 0; font-size:11px; color:#a99; text-align:center;">
      Robyn &amp; Gold &middot; robynandgold.com &middot; This is a one-time reminder about the order you started.
    </p>
  </div>`;

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Robyn & Gold <info@robynandgold.com>',
      reply_to: 'info@robynandgold.com',
      to: [email],
      subject: 'Your piece is still waiting — Robyn & Gold',
      html,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Resend rejected the email (${resp.status}): ${body}`);
  }
  console.log(`[Webhook] Recovery email sent to ${email} for session ${session.id}`);
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
