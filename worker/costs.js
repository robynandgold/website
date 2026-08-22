// POST /api/costs — what each piece cost to buy, for the admin Sales tab.
//
// Kept in the D1 `DB` binding rather than in products.json on purpose: the
// repository is public and the catalogue is served straight off the site, so
// anything written there publishes the shop's buying prices and margins. This
// database is only reachable through the Worker, behind the admin password.
//
// Two shapes, both POST and both password-gated:
//   { password }                  → { costs: { slug: cost, … } }
//   { password, slug, cost }      → save one (cost: null clears it)
//
// No-ops safely when the D1 binding is missing, the same way views.js does, so
// the admin page degrades to "not set up" instead of erroring.
import { Buffer } from 'node:buffer';
import { timingSafeEqual } from 'node:crypto';

const SCHEMA =
  'CREATE TABLE IF NOT EXISTS product_costs (' +
  'slug TEXT PRIMARY KEY, ' +
  'cost REAL NOT NULL, ' +
  'updated TEXT NOT NULL)';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

// Same slug rule as views.js — lowercase letters, digits and hyphens.
function cleanSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(s) ? s : null;
}

export async function handleCosts(request, env) {
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

  if (!env.DB) return json({ costs: {}, storage: false });

  // Saving one piece's cost.
  if (body && body.slug !== undefined) {
    const slug = cleanSlug(body.slug);
    if (!slug) return json({ error: 'Invalid slug' }, 400);

    const raw = body.cost;
    const clearing = raw === null || raw === '' || raw === undefined;
    const cost = clearing ? null : Number(raw);
    if (!clearing && (!isFinite(cost) || cost < 0 || cost > 1e7)) {
      return json({ error: 'Invalid cost' }, 400);
    }

    try {
      if (clearing) {
        await env.DB.batch([
          env.DB.prepare(SCHEMA),
          env.DB.prepare('DELETE FROM product_costs WHERE slug = ?1').bind(slug),
        ]);
      } else {
        await env.DB.batch([
          env.DB.prepare(SCHEMA),
          env.DB.prepare(
            'INSERT INTO product_costs (slug, cost, updated) VALUES (?1, ?2, ?3) ' +
            'ON CONFLICT(slug) DO UPDATE SET cost = ?2, updated = ?3'
          ).bind(slug, cost, new Date().toISOString()),
        ]);
      }
    } catch (err) {
      return json({ error: 'Could not save to the costs database.' }, 502);
    }
    return json({ ok: true, slug, cost: clearing ? null : cost, storage: true });
  }

  // Reading them all — the catalogue is small enough that paging would be
  // more code than it saves.
  try {
    await env.DB.prepare(SCHEMA).run();
    const rs = await env.DB.prepare('SELECT slug, cost FROM product_costs').all();
    const costs = {};
    (rs.results || []).forEach(r => { costs[r.slug] = Number(r.cost); });
    return json({ costs, storage: true });
  } catch (err) {
    // Table not created yet → nothing recorded, which isn't an error.
    return json({ costs: {}, storage: true });
  }
}
