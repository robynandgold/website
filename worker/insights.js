// POST /api/insights — admin-only analytics readout (most-viewed pieces).
//
// Gated by the admin password (same as the publish/VIP endpoints). Calls the
// Umami Cloud reporting API server-side using the UMAMI_API_KEY secret, so the
// key never reaches the browser. Returns the top product pages by views for the
// requested window; the admin page maps slugs to piece names.
//
// Requires (Workers project → Settings → Variables and Secrets):
//   ADMIN_PASSWORD  — the admin-page password (already set)
//   UMAMI_API_KEY   — a Umami Cloud API key (paid plan). Unset → feature is off.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

// Public identifiers (already in the site's tracking script).
const UMAMI_WEBSITE_ID = '6730344d-0b4f-433f-85fd-a0ae7004f103';
const UMAMI_API = 'https://api.umami.is/v1';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export async function handleInsights(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'Admin access is not configured on the server.' }, 500);
  }
  if (!env.UMAMI_API_KEY) {
    return json(
      { error: 'Analytics is not configured yet. Add a UMAMI_API_KEY secret to the Worker (Settings → Variables and Secrets) — it needs a paid Umami Cloud plan — then reload this page.' },
      501
    );
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

  const days = Math.max(1, Math.min(730, Number(body && body.days) || 30));
  const endAt = Date.now();
  const startAt = endAt - days * 86400000;

  const url = `${UMAMI_API}/websites/${UMAMI_WEBSITE_ID}/metrics?type=url&startAt=${startAt}&endAt=${endAt}&limit=500`;

  let resp;
  try {
    resp = await fetch(url, {
      headers: { 'x-umami-api-key': env.UMAMI_API_KEY, 'Accept': 'application/json' },
    });
  } catch (err) {
    return json({ error: 'Could not reach Umami. Please try again in a moment.' }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    const hint = resp.status === 401 || resp.status === 403
      ? ' The API key may be wrong or your Umami plan may not include API access.'
      : '';
    return json({ error: `Umami API error (${resp.status}).${hint}`, detail: detail.slice(0, 300) }, 502);
  }

  const metrics = await resp.json().catch(() => []);
  const rows = (Array.isArray(metrics) ? metrics : [])
    .filter(m => typeof m.x === 'string' && m.x.startsWith('/pages/product/'))
    .map(m => ({ url: m.x, views: Number(m.y) || 0 }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 25);

  return json({ rows, days }, 200);
}
