/**
 * BANNERS.JS — the band above the header
 * ======================================
 *
 * Two messages compete for one slot and only one is ever shown:
 *
 *   1. a running sale, which takes precedence because it's time-limited;
 *   2. otherwise, free postage within Ireland.
 *
 * This file is loaded by every page (and by the generated product pages via
 * the build template), so the markup lives here once rather than in each
 * page's own inline loader — unlike the per-page product loaders, a banner has
 * no page-specific behaviour to follow.
 *
 * Both messages are read from the same sources the rest of the site uses:
 * `sale.json` for the sale, and `GET /api/shipping` for the postage table. The
 * postage banner therefore retires itself if Ireland ever stops being free —
 * there is no claim written down here to go stale.
 */
(function () {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  /**
   * Whether a sale is running right now.
   *
   * Deliberately the same rule as `saleActive()` in products.js and
   * `saleActive()` in worker/pricing.js; `npm run test:unit` checks all three
   * agree. Kept here rather than imported so a content page needs nothing but
   * this file to show the band.
   */
  function saleRunning(sale, now) {
    if (!sale) return false;
    const at = now === undefined ? Date.now() : now;
    const percent = Number(sale.percent);
    if (!isFinite(percent) || percent <= 0 || percent >= 100) return false;
    if (sale.startsAt) {
      const from = Date.parse(sale.startsAt);
      if (!isNaN(from) && from > at) return false;
    }
    if (sale.endsAt) {
      const until = Date.parse(sale.endsAt);
      if (!isNaN(until) && until <= at) return false;
    }
    return true;
  }

  function show(className, html) {
    if (document.querySelector('.sale-banner, .postage-banner')) return;
    const banner = document.createElement('div');
    banner.className = className;
    banner.innerHTML = html;
    document.body.insertBefore(banner, document.body.firstChild);
  }

  // A failed fetch is a silent no-banner: the band is an announcement, never
  // something a page depends on.
  const readJson = (url, init) =>
    fetch(url, init).then(r => (r.ok ? r.json() : null)).catch(() => null);

  function render() {
    Promise.all([
      readJson('/data/sale.json', { cache: 'no-store' }),
      readJson('/api/shipping', { headers: { 'Accept': 'application/json' } }),
    ]).then(function (results) {
      const sale = results[0];
      const shipping = results[1];

      if (saleRunning(sale)) {
        const label = String((sale && sale.label) || 'Sale').trim();
        show('sale-banner', `${label} — <strong>${Number(sale.percent)}% off</strong> everything`);
        return;
      }

      const ireland = shipping && shipping.zones && shipping.zones.ireland;
      if (ireland && ireland.amount === 0) {
        show(
          'postage-banner',
          '<strong>Free insured postage</strong> within Ireland — ' +
            '<a href="/pages/faq.html#postage">see all postage rates</a>'
        );
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }

  // Exposed only so the test suite can check this file's sale rule against the
  // other two copies of it.
  window.BannersInternal = { saleRunning };
})();
