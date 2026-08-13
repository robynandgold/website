// POST /api/insights — admin-only analytics readout (most-viewed pieces).
//
// Gated by the admin password (same as the publish/VIP endpoints). Reads
// first-party view counts recorded in the D1 `DB` binding (see views.js) — no
// third-party API or key needed. Returns the top product pages by views for the
// requested window; the admin page maps slugs to piece names.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';
import { topViews } from './views.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

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

  let rows;
  try {
    rows = await topViews(env, days, 25);
  } catch (err) {
    return json({ error: 'Could not read the views database.' }, 502);
  }

  if (rows === null) {
    return json(
      { error: 'View tracking is not set up yet. Create the Cloudflare D1 database and add the DB binding to the Worker (see ARCHITECTURE.md), then reload.' },
      501
    );
  }

  return json({ rows, days }, 200);
}
