// POST /api/insights — admin-only analytics readout (most-viewed pieces).
//
// Gated by the admin password (same as the publish/VIP endpoints). Combines two
// sources with no third-party API key:
//   • a one-time historical baseline imported from a Umami export (views-baseline.js)
//   • live first-party view counts recorded in the D1 `DB` binding (views.js)
// Returns the top product pages by views for the requested window.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { topViews } from './views.js';
import { VIEWS_BASELINE } from './views-baseline.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const slugFromUrl = (url) => (String(url).match(/\/pages\/product\/(.+?)\.html/) || [])[1] || '';

export async function handleInsights(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'Admin access is not configured on the server.' }, 500);
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

  // Live counts (may be null when the D1 database isn't bound yet).
  let live;
  try {
    live = await topViews(env, days, 1000);
  } catch (err) {
    return json({ error: 'Could not read the views database.' }, 502);
  }
  const liveTracking = live !== null;

  // The baseline is a cumulative Umami snapshot, so only fold it into windows
  // at least as long as the period it covers (e.g. it shows for 30/90 days, not
  // for "last 7 days" where only live counts are meaningful).
  const baseline = VIEWS_BASELINE || { views: {}, spanDays: 30, asOf: '' };
  const baselineIncluded = days >= (baseline.spanDays || 30);

  const totals = new Map();
  if (baselineIncluded) {
    for (const [slug, v] of Object.entries(baseline.views || {})) {
      totals.set(slug, (totals.get(slug) || 0) + (Number(v) || 0));
    }
  }
  for (const r of live || []) {
    const slug = slugFromUrl(r.url);
    if (!slug) continue;
    totals.set(slug, (totals.get(slug) || 0) + (Number(r.views) || 0));
  }

  const rows = [...totals.entries()]
    .map(([slug, views]) => ({ url: `/pages/product/${slug}.html`, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 25);

  return json({
    rows,
    days,
    liveTracking,
    baselineIncluded,
    baselineAsOf: baseline.asOf || null,
  }, 200);
}
