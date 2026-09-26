// Sale pricing, shared by the checkout and covered by the unit tests.
//
// Kept in its own module with no imports so it can be exercised without a
// Stripe client or a network. The browser has its own copy of these rules in
// src/js/products.js (priceNow/saleActive) — the two must agree, or the till
// charges something different from what the shelf shows, and
// tests/unit.test.mjs asserts exactly that against the same table of cases.

/** Whether a sale is running at `now`. */
export function saleActive(sale, now = Date.now()) {
  if (!sale) return false;
  const percent = Number(sale.percent);
  if (!isFinite(percent) || percent <= 0 || percent >= 100) return false;
  if (sale.startsAt) {
    const from = Date.parse(sale.startsAt);
    if (!isNaN(from) && from > now) return false;
  }
  if (sale.endsAt) {
    const until = Date.parse(sale.endsAt);
    if (!isNaN(until) && until <= now) return false;
  }
  return true;
}

/** What a piece costs right now — the listed price, less any running sale. */
export function priceFor(product, sale, now = Date.now()) {
  const full = Number(product.price) || 0;
  if (!saleActive(sale, now)) return full;
  const reduced = Math.round(full * (1 - Number(sale.percent) / 100));
  return reduced < full ? reduced : full;
}
