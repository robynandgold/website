/**
 * BANNERS.JS — the band above the header
 * ======================================
 *
 * One band, shown while a sale is running and read from the same `sale.json`
 * the shop and the Worker price from, so there is no claim written down here
 * to go stale.
 *
 * This file is loaded by every page (and by the generated product pages via
 * the build template), so the markup lives here once rather than in each
 * page's own inline loader — unlike the per-page product loaders, a banner has
 * no page-specific behaviour to follow.
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
    if (document.querySelector('.sale-banner')) return;
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
    readJson('/data/sale.json', { cache: 'no-store' }).then(function (sale) {
      if (!saleRunning(sale)) return;
      const label = String((sale && sale.label) || 'Sale').trim();
      show('sale-banner', `${label} — <strong>${Number(sale.percent)}% off</strong> everything`);
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
