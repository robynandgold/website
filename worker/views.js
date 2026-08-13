// First-party product-page view counting (no cookies, no personal data).
//
// Product pages send a small beacon to POST /api/view on load; we tally views
// per piece per day in a Cloudflare D1 database (the `DB` binding). The admin
// "Most viewed" tab reads these totals over a chosen window via /api/insights.
//
// Everything here no-ops safely when the D1 binding isn't configured, so the
// site keeps working before the database is set up.

// One row per piece per UTC day keeps storage tiny and lets the admin tab sum
// over any date range.
const SCHEMA =
  'CREATE TABLE IF NOT EXISTS product_views (' +
  'slug TEXT NOT NULL, day TEXT NOT NULL, ' +
  'views INTEGER NOT NULL DEFAULT 0, ' +
  'PRIMARY KEY (slug, day))';

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);

// Slugs are lowercase letters/digits/hyphens (see the product page filenames).
function cleanSlug(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,120}$/.test(s) ? s : null;
}

/** Record one view for a piece. Creates the table on first use. */
export async function recordView(env, slug) {
  if (!env || !env.DB) return false;
  const clean = cleanSlug(slug);
  if (!clean) return false;
  await env.DB.batch([
    env.DB.prepare(SCHEMA),
    env.DB.prepare(
      'INSERT INTO product_views (slug, day, views) VALUES (?1, ?2, 1) ' +
      'ON CONFLICT(slug, day) DO UPDATE SET views = views + 1'
    ).bind(clean, utcDay()),
  ]);
  return true;
}

/** Top pieces by views over the last `days` days. Returns [{url, views}]. */
export async function topViews(env, days, limit = 25) {
  if (!env || !env.DB) return null; // signals "not configured"
  const sinceDay = utcDay(Date.now() - days * 86400000);
  try {
    const rs = await env.DB.prepare(
      'SELECT slug, SUM(views) AS views FROM product_views ' +
      'WHERE day >= ?1 GROUP BY slug ORDER BY views DESC LIMIT ?2'
    ).bind(sinceDay, limit).all();
    return (rs.results || []).map(r => ({
      url: `/pages/product/${r.slug}.html`,
      views: Number(r.views) || 0,
    }));
  } catch (err) {
    // Table not created yet (no views recorded) → treat as empty.
    return [];
  }
}

const noContent = () => new Response(null, { status: 204 });

// POST /api/view — { slug }. Fire-and-forget beacon from product pages.
export async function handleView(request, env) {
  let slug = '';
  try {
    const body = await request.json();
    slug = body && body.slug;
  } catch (err) {
    return noContent();
  }
  try {
    await recordView(env, slug);
  } catch (err) {
    // Analytics must never affect the shopper — swallow and move on.
    console.error('[views] recordView failed:', err && err.message);
  }
  return noContent();
}
