// POST /api/hint — "Drop a hint" from a product page.
//
// A shopper gives their own first name, the name of the person they're hinting
// to, and that person's email address. We send that person one email with a
// photo of the piece and a link to its page.
//
// An endpoint that emails any address it's given, from the shop's own domain,
// is an open relay waiting to happen, so the shape of the email is fixed:
//   - there is no free-text message: the only things a sender controls are two
//     short names, limited to letters, spaces, apostrophes and hyphens, so no
//     link, address or phone number can ride along in them;
//   - the piece must be on sale right now (not sold, reserved or pre-drop);
//   - sends are rate limited per sender and per recipient in D1, and the
//     endpoint fails closed when the database isn't there to count them.
// Only SHA-256 hashes of the IP and the recipient's address are kept, and only
// long enough to enforce the limits.
//
// The validation and the email markup are pure functions with no imports
// beyond pricing.js, so the tests can exercise them without a network.
import { priceFor } from './pricing.js';

const SITE = 'https://robynandgold.com';

export const NAME_MAX = 40;
// Per sender (IP) and per recipient in a rolling day, plus one hint per piece
// per recipient a month, so nobody can be pestered about the same ring.
export const LIMITS = { perIpPerDay: 5, perRecipientPerDay: 2, samePieceDays: 30 };
const DAY = 86400e3;

const SCHEMA =
  'CREATE TABLE IF NOT EXISTS hint_log (' +
  'sent_at INTEGER NOT NULL, ip_hash TEXT NOT NULL, ' +
  'to_hash TEXT NOT NULL, slug TEXT NOT NULL)';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/** A first name as typed, tidied, or null if it isn't plausibly just a name. */
export function cleanName(raw) {
  const s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  if (!s || s.length > NAME_MAX) return null;
  return /^[\p{L}\p{M}][\p{L}\p{M}' ’-]*$/u.test(s) ? s : null;
}

/** A single, ordinary-looking email address, lowercased, or null. */
export function cleanEmail(raw) {
  const s = String(raw == null ? '' : raw).trim().toLowerCase();
  if (s.length > 254) return null;
  return /^[^\s@<>()",;:]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

/** Whether a piece can be hinted at: listed, unsold, unreserved and dropped. */
export function hintable(product, now = Date.now()) {
  if (!product || product.available === false || product.reserved === true) return false;
  if (product.dropAt) {
    const t = Date.parse(product.dropAt);
    if (!isNaN(t) && t > now) return false;
  }
  return true;
}

/** Check a request body. Returns { value } or { error }. */
export function validateHint(body) {
  const b = body || {};
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return { error: 'That piece could not be found.' };
  const fromName = cleanName(b.fromName);
  if (!fromName) return { error: 'Please enter your first name (letters only).' };
  const toName = cleanName(b.toName);
  if (!toName) return { error: 'Please enter their first name (letters only).' };
  const toEmail = cleanEmail(b.toEmail);
  if (!toEmail) return { error: 'Please enter a valid email address for them.' };
  return { value: { slug, fromName, toName, toEmail } };
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatPrice(price, currency = 'EUR') {
  const cur = String(currency || 'EUR').toUpperCase();
  const symbol = cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'USD' ? '$' : cur + ' ';
  return `${symbol}${Number(price).toFixed(2)}`;
}

export function hintSubject({ fromName }) {
  return `${fromName} has dropped a hint | Robyn & Gold`;
}

/** The email itself, in the same dress as the order and recovery emails. */
export function hintEmailHtml({ fromName, toName, product, sale, now = Date.now() }) {
  const from = escapeHtml(fromName);
  const to = escapeHtml(toName);
  const name = escapeHtml(product.name);
  const url = `${SITE}/pages/product/${product.slug}.html` +
    '?utm_source=hint&utm_medium=email&utm_campaign=drop-a-hint';
  const photo = product.images && product.images[0] ? SITE + product.images[0] : '';
  const full = Number(product.price) || 0;
  const current = priceFor(product, sale, now);
  const priceLine = current < full
    ? `<span style="text-decoration:line-through; color:#8a8172;">${formatPrice(full, product.currency)}</span> ${formatPrice(current, product.currency)}`
    : formatPrice(full, product.currency);
  const meta = [product.size ? `Size ${escapeHtml(product.size)}` : '', priceLine]
    .filter(Boolean).join(' &middot; ');

  return `
  <div style="font-family: Georgia, 'Times New Roman', serif; background:#faf7f2; padding:32px 16px;">
    <div style="max-width:520px; margin:0 auto; background:#fdfbf8; border:1px solid #ddd1c2; border-radius:10px; padding:36px 32px; color:#3d372e;">
      <p style="text-align:center; margin:0 0 26px;">
        <img src="${SITE}/images/rg-logo.png" alt="Robyn &amp; Gold" width="120" style="width:120px; height:auto; display:inline-block;" />
      </p>
      <h1 style="font-size:22px; font-weight:500; text-align:center; margin:0 0 6px;">A little hint from ${from}</h1>
      <p style="font-size:14px; line-height:1.7; text-align:center; color:#8a8172; margin:0 0 22px;">Hi ${to}, someone has their eye on something.</p>
      ${photo ? `<p style="text-align:center; margin:0 0 14px;"><a href="${url}"><img src="${photo}" alt="${name}" width="220" style="width:220px; max-width:100%; height:auto; border-radius:8px; display:inline-block;" /></a></p>` : ''}
      <p style="font-size:16px; text-align:center; margin:0 0 4px;">${name}</p>
      <p style="font-size:13px; text-align:center; color:#8a8172; margin:0 0 24px;">${meta}</p>
      <p style="font-size:15px; line-height:1.7; margin:0 0 12px;">
        ${from} has been browsing our vintage jewellery and fell for this piece. They asked us to
        pass the hint along to you, in case you were ever stuck for a gift idea.
      </p>
      <p style="font-size:15px; line-height:1.7; margin:0 0 24px;">
        A gentle note: every piece we sell is one of a kind, so once it finds a home, it's gone.
      </p>
      <p style="text-align:center; margin:0 0 24px;">
        <a href="${url}" style="display:inline-block; background:#3d372e; color:#fdfbf8; text-decoration:none; padding:13px 30px; border-radius:999px; font-size:14px; letter-spacing:0.06em;">View the piece</a>
      </p>
      <p style="font-size:13px; line-height:1.7; color:#8a8172; margin:0;">
        Not sure about sizing, or want more photos first? Just reply to this email and we'll help you
        get it right. ${from} won't hear about it from us.
      </p>
    </div>
    <p style="max-width:520px; margin:14px auto 0; font-size:11px; line-height:1.6; color:#a99; text-align:center;">
      Robyn &amp; Gold &middot; robynandgold.com<br>
      You're receiving this because ${from} entered your email address on our site. This is a one-off
      message: we haven't added you to any mailing list.
    </p>
  </div>`;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// The catalogue and sale as deployed, so the email describes the page the
// link opens.
async function loadJson(env, path) {
  try {
    const resp = await env.ASSETS.fetch(new Request(`${SITE}${path}`));
    return resp.ok ? await resp.json() : null;
  } catch (err) {
    return null;
  }
}

export async function handleHint(request, env) {
  // Only the shop's own pages may post here. Browsers always send Origin on a
  // cross-origin POST, so this stops another site quietly using the form.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: 'Not allowed' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'Invalid request' }, 400);
  }

  // Honeypot: a field people never see. A bot that fills it gets a cheerful
  // "sent" and no email goes anywhere.
  if (body && body.website) return json({ ok: true });

  const { value, error } = validateHint(body);
  if (error) return json({ error }, 400);

  if (!env.RESEND_API_KEY || !env.DB) {
    console.error('[hint] RESEND_API_KEY or DB missing; refusing (fail closed)');
    return json({ error: 'Hints are unavailable just now. Please try again later.' }, 503);
  }

  const products = await loadJson(env, '/data/products.json');
  const product = products && products.find(p => p.slug === value.slug);
  if (!hintable(product)) {
    return json({ error: 'Sorry, this piece is no longer available.' }, 409);
  }

  const now = Date.now();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const [ipHash, toHash] = await Promise.all([sha256('hint-ip:' + ip), sha256('hint-to:' + value.toEmail)]);

  try {
    await env.DB.prepare(SCHEMA).run();
    const [byIp, byTo, samePiece] = await env.DB.batch([
      env.DB.prepare('SELECT COUNT(*) AS n FROM hint_log WHERE ip_hash = ?1 AND sent_at > ?2')
        .bind(ipHash, now - DAY),
      env.DB.prepare('SELECT COUNT(*) AS n FROM hint_log WHERE to_hash = ?1 AND sent_at > ?2')
        .bind(toHash, now - DAY),
      env.DB.prepare('SELECT COUNT(*) AS n FROM hint_log WHERE to_hash = ?1 AND slug = ?2 AND sent_at > ?3')
        .bind(toHash, value.slug, now - LIMITS.samePieceDays * DAY),
    ]);
    const count = rs => Number(rs.results && rs.results[0] && rs.results[0].n) || 0;
    if (count(samePiece) > 0) {
      return json({ error: 'They have already had a hint about this piece recently.' }, 429);
    }
    if (count(byIp) >= LIMITS.perIpPerDay || count(byTo) >= LIMITS.perRecipientPerDay) {
      return json({ error: 'Too many hints for today. Please try again tomorrow.' }, 429);
    }
  } catch (err) {
    console.error('[hint] Rate limit check failed:', err && err.message);
    return json({ error: 'Hints are unavailable just now. Please try again later.' }, 503);
  }

  const sale = await loadJson(env, '/data/sale.json');
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Robyn & Gold <info@robynandgold.com>',
      reply_to: 'info@robynandgold.com',
      to: [value.toEmail],
      subject: hintSubject(value),
      html: hintEmailHtml({ ...value, product, sale, now }),
    }),
  });
  if (!resp.ok) {
    console.error('[hint] Resend rejected the hint:', resp.status, await resp.text());
    return json({ error: 'Your hint could not be sent. Please try again later.' }, 502);
  }

  // Logged only once it's sent, and old rows cleared on the way, so the table
  // never holds more than a month.
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO hint_log (sent_at, ip_hash, to_hash, slug) VALUES (?1, ?2, ?3, ?4)')
        .bind(now, ipHash, toHash, value.slug),
      env.DB.prepare('DELETE FROM hint_log WHERE sent_at < ?1')
        .bind(now - LIMITS.samePieceDays * DAY),
    ]);
  } catch (err) {
    console.error('[hint] Could not log the hint:', err && err.message);
  }
  console.log(`[hint] Sent a hint about ${value.slug}`);
  return json({ ok: true });
}
