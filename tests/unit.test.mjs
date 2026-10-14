// Unit tests — pure logic and catalogue integrity. No browser, no network.
//
//   node --test tests/
//
// Three things are being protected here:
//   1. the rules that decide what's shown and what's buyable,
//   2. the pricing the Worker charges matching the pricing the shop displays,
//   3. the catalogue itself staying well-formed, since it's hand-edited and
//      written by three different places (admin page, webhook, by hand).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { saleActive, priceFor } from '../worker/pricing.js';
import {
  SHIPPING_ZONES,
  ALLOWED_COUNTRIES,
  zoneForCountry,
  resolveShippingCountry,
  shippingOptionsForCountry,
  shippingTable,
} from '../worker/shipping.js';
import {
  catalogue, saleConfig, loadProductsApi, loadBuild, loadBanners, priceCases, read, SRC,
} from './helpers.mjs';

const API = loadProductsApi();
const BUILD = loadBuild();
const BANNERS = loadBanners();
const products = catalogue();

const HOUR = 3600e3;
const future = ms => new Date(Date.now() + ms).toISOString();
const past = ms => new Date(Date.now() - ms).toISOString();

describe('what is buyable (isPubliclyLive)', () => {
  test('an ordinary piece is buyable', () => {
    assert.equal(API.isPubliclyLive({ price: 100 }), true);
  });
  test('a sold piece is not', () => {
    assert.equal(API.isPubliclyLive({ available: false }), false);
  });
  test('a piece awaiting its drop is not', () => {
    assert.equal(API.isPubliclyLive({ dropAt: future(HOUR) }), false);
  });
  test('a piece whose drop has passed is', () => {
    assert.equal(API.isPubliclyLive({ dropAt: past(HOUR) }), true);
  });
  test('an unparseable dropAt does not block the sale', () => {
    assert.equal(API.isPubliclyLive({ dropAt: 'nonsense' }), true);
  });
});

describe('what is shown (isListed)', () => {
  test('a scheduled piece is shown by default', () => {
    assert.equal(API.isListed({ dropAt: future(HOUR) }), true);
  });
  test('previewDrop: false hides it until it drops', () => {
    assert.equal(API.isListed({ dropAt: future(HOUR), previewDrop: false }), false);
  });
  test('a sold piece is never shown, previewed or not', () => {
    assert.equal(API.isListed({ available: false, dropAt: future(HOUR) }), false);
    assert.equal(API.isListed({ available: false }), false);
  });
  test('shown does not mean buyable — the whole point of the split', () => {
    const piece = { dropAt: future(HOUR) };
    assert.equal(API.isListed(piece), true);
    assert.equal(API.isPubliclyLive(piece), false);
  });
});

describe('the build mirrors the browser', () => {
  // CLAUDE.md requires these to agree; a drift here means crawlers and
  // shoppers see different shops.
  const cases = [
    { label: 'ordinary', piece: { price: 10 } },
    { label: 'sold', piece: { available: false } },
    { label: 'scheduled, previewed', piece: { dropAt: future(HOUR) } },
    { label: 'scheduled, hidden', piece: { dropAt: future(HOUR), previewDrop: false } },
    { label: 'drop passed', piece: { dropAt: past(HOUR) } },
  ];
  for (const { label, piece } of cases) {
    test(`isListed agrees for a ${label} piece`, () => {
      assert.equal(BUILD.isListed(piece), API.isListed(piece));
    });
    test(`isScheduled agrees for a ${label} piece`, () => {
      assert.equal(BUILD.isScheduled(piece), API.isScheduled(piece));
    });
  }
  test('the sitemap follows what is listed', () => {
    for (const { piece } of cases) {
      assert.equal(BUILD.isSitemapEligible(piece), API.isListed(piece));
    }
  });
});

describe('sale pricing: the till agrees with the shelf', () => {
  for (const { label, sale, price, expect } of priceCases(Date.now())) {
    test(label, () => {
      const worker = priceFor({ price }, sale);
      const browser = API.priceNow({ price }, sale).price;
      assert.equal(worker, expect, `worker charged ${worker}, expected ${expect}`);
      assert.equal(browser, expect, `shop showed ${browser}, expected ${expect}`);
      assert.equal(worker, browser, 'worker and shop disagree');
    });
  }
  test('saleActive agrees between worker and browser', () => {
    for (const { sale } of priceCases(Date.now())) {
      assert.equal(saleActive(sale), API.saleActive(sale), JSON.stringify(sale));
    }
  });
  test('a struck-through price is shown only when the price actually drops', () => {
    const on = { percent: 20, endsAt: future(HOUR) };
    assert.equal(API.priceNow({ price: 825 }, on).was, 825);
    assert.equal(API.priceNow({ price: 825 }, {}).was, null);
    // 1% of 2 rounds to no change — nothing to strike through
    assert.equal(API.priceNow({ price: 2 }, { percent: 1, endsAt: future(HOUR) }).was, null);
  });
  test('a sale never raises a price', () => {
    for (const p of products) {
      for (const percent of [1, 5, 20, 50, 99]) {
        const reduced = priceFor(p, { percent, endsAt: future(HOUR) });
        assert.ok(reduced <= p.price, `${p.slug} at ${percent}% went up`);
        assert.ok(reduced >= 0, `${p.slug} at ${percent}% went negative`);
      }
    }
  });
});

describe('keepsakes', () => {
  test('only an explicit flag counts', () => {
    assert.equal(API.isKeepsake({ keepsake: true }), true);
    assert.equal(API.isKeepsake({ keepsake: 'true' }), false);
    assert.equal(API.isKeepsake({}), false);
  });
});

describe('the catalogue is well formed', () => {
  test('every piece has the fields the site relies on', () => {
    for (const p of products) {
      for (const field of ['id', 'name', 'slug', 'price', 'currency', 'category']) {
        assert.ok(p[field] !== undefined && p[field] !== '', `${p.slug || p.id}: missing ${field}`);
      }
    }
  });
  test('ids and slugs are unique', () => {
    for (const key of ['id', 'slug']) {
      const seen = new Set();
      for (const p of products) {
        assert.ok(!seen.has(p[key]), `duplicate ${key}: ${p[key]}`);
        seen.add(p[key]);
      }
    }
  });
  test('slugs are URL-safe and match their generated page', () => {
    for (const p of products) {
      assert.match(p.slug, /^[a-z0-9-]+$/, `${p.slug} is not URL-safe`);
      const page = path.join(SRC, 'pages', 'product', `${p.slug}.html`);
      assert.ok(existsSync(page), `${p.slug} has no generated page — run npm run build`);
    }
  });
  test('prices are positive whole numbers in euro', () => {
    for (const p of products) {
      assert.ok(Number.isFinite(p.price) && p.price > 0, `${p.slug}: bad price ${p.price}`);
      assert.equal(p.price, Math.round(p.price), `${p.slug}: fractional price`);
      assert.equal(p.currency, 'EUR', `${p.slug}: unexpected currency`);
    }
  });
  test('every referenced image and video exists on disk', () => {
    for (const p of products) {
      for (const asset of [...(p.images || []), ...(p.videos || [])]) {
        assert.ok(existsSync(path.join(SRC, asset.replace(/^\//, ''))), `${p.slug}: missing ${asset}`);
      }
    }
  });
  test('dates parse', () => {
    for (const p of products) {
      for (const field of ['createdAt', 'soldAt', 'dropAt']) {
        if (p[field]) assert.ok(!isNaN(Date.parse(p[field])), `${p.slug}: bad ${field}`);
      }
    }
  });
  test('no piece is both sold and dropping later — the Asteria failure', () => {
    for (const p of products) {
      if (p.available === false && API.isScheduled(p)) {
        assert.fail(`${p.slug} is marked sold but has a future drop`);
      }
    }
  });
  test('nothing is marked sold the moment it was created', () => {
    for (const p of products) {
      if (!p.soldAt || !p.createdAt) continue;
      const gap = Date.parse(p.soldAt) - Date.parse(p.createdAt);
      assert.ok(gap > 60e3 || gap < 0,
        `${p.slug} sold ${gap}ms after being created — likely published as sold by mistake`);
    }
  });
  test('the homepage cap of three featured pieces is respected', () => {
    const featured = products.filter(p => p.featured === true && API.isListed(p));
    assert.ok(featured.length <= 3, `${featured.length} featured pieces, cap is 3`);
  });
  test('sold pieces carry a sold date (bar the known pre-launch few)', () => {
    const undated = products.filter(p => p.available === false && !p.soldAt);
    assert.ok(undated.length <= 6,
      `${undated.length} sold pieces without a soldAt — expected at most the 6 pre-launch ones`);
  });
});

describe('the sale config on disk is sane', () => {
  const sale = saleConfig();
  test('it parses and has a percent field', () => {
    assert.equal(typeof sale, 'object');
    assert.ok('percent' in sale);
  });
  test('if a sale is running it has an end date', () => {
    if (saleActive(sale)) {
      assert.ok(sale.endsAt && !isNaN(Date.parse(sale.endsAt)),
        'a running sale with no end date would never stop by itself');
    }
  });
  test('a configured sale is within sane bounds', () => {
    if (Number(sale.percent) > 0) {
      assert.ok(sale.percent > 0 && sale.percent < 100, `percent ${sale.percent} out of range`);
    }
  });
});

describe('build helpers', () => {
  test('meta descriptions stay within a sensible length', () => {
    for (const p of products) {
      const d = BUILD.metaDescription(p);
      assert.ok(d.length <= 230, `${p.slug}: meta description ${d.length} chars`);
    }
  });
  test('material is derived from the name where possible', () => {
    assert.equal(BUILD.deriveMaterial('18ct Yellow Gold Diamond Ring'), '18ct Yellow Gold');
    assert.equal(BUILD.deriveMaterial('Platinum Solitaire'), 'Platinum');
    assert.equal(BUILD.deriveMaterial('Something Else'), undefined);
  });
  test('related pieces exclude the piece itself and anything unlisted', () => {
    const anchor = products.find(p => API.isListed(p));
    const related = BUILD.relatedTo(anchor, products);
    assert.ok(related.length <= 3);
    for (const r of related) {
      assert.notEqual(r.slug, anchor.slug);
      assert.ok(API.isListed(r), `${r.slug} is not listed but was suggested`);
    }
  });
  test('the drop label is Irish time, not UTC', () => {
    // 04 Oct 2026 16:00Z is 17:00 in Dublin (IST), and still the 4th
    assert.equal(BUILD.dropLabel({ dropAt: '2026-10-04T16:00:00.000Z' }), '4 Oct');
    // 31 Dec 23:30 UTC is still the 31st in Dublin (GMT in winter)
    assert.equal(BUILD.dropLabel({ dropAt: '2026-12-31T23:30:00.000Z' }), '31 Dec');
    // but 30 June 23:30 UTC is already 1 July in Dublin (IST, +1)
    assert.equal(BUILD.dropLabel({ dropAt: '2026-06-30T23:30:00.000Z' }), '1 Jul');
  });
});

// Postage. The amounts live in exactly one place (worker/shipping.js) and are
// read from there by the cart, the Stripe session and the webhook's
// underpayment check — but they're also written out as prose on the FAQ and
// Terms pages, which nothing can derive. These tests are what stops those two
// drifting apart, and what stops the free Irish rate leaking to destinations
// nobody has said are Irish.
describe('postage zones', () => {
  test('Ireland is free, Europe €15, the rest of the world €35', () => {
    assert.equal(SHIPPING_ZONES.ireland.amount, 0);
    assert.equal(SHIPPING_ZONES.europe.amount, 1500);
    assert.equal(SHIPPING_ZONES.world.amount, 3500);
  });

  test('every zone has a name and a sane delivery estimate', () => {
    for (const [key, zone] of Object.entries(SHIPPING_ZONES)) {
      assert.ok(zone.name && zone.name.length > 3, `${key} has no display name`);
      assert.ok(Number.isInteger(zone.amount) && zone.amount >= 0, `${key} has a bad amount`);
      assert.ok(zone.minDays >= 1, `${key} promises delivery in under a day`);
      assert.ok(zone.maxDays >= zone.minDays, `${key} has an inverted estimate`);
    }
  });

  test('countries land in the right zone', () => {
    assert.equal(zoneForCountry('IE'), 'ireland');
    for (const code of ['GB', 'FR', 'DE', 'ES', 'PL', 'NO', 'CH', 'UA']) {
      assert.equal(zoneForCountry(code), 'europe', `${code} should be the European tier`);
    }
    for (const code of ['AU', 'US', 'CA', 'NZ', 'JP', 'ZA', 'BR', 'CN']) {
      assert.equal(zoneForCountry(code), 'world', `${code} should be the rest-of-world tier`);
    }
  });

  test('no country at all has no zone', () => {
    assert.equal(zoneForCountry(undefined), null);
    assert.equal(zoneForCountry(null), null);
    assert.equal(zoneForCountry(''), null);
  });

  test('Ireland is the only free destination', () => {
    const free = ALLOWED_COUNTRIES.filter(c => SHIPPING_ZONES[zoneForCountry(c)].amount === 0);
    assert.deepEqual(free, ['IE']);
  });

  test('the countries Stripe takes an address for all have a rate', () => {
    for (const code of ALLOWED_COUNTRIES) {
      assert.ok(zoneForCountry(code), `${code} is offered but has no zone`);
    }
    assert.ok(ALLOWED_COUNTRIES.includes('IE'));
    assert.ok(ALLOWED_COUNTRIES.includes('AU'));
    assert.equal(new Set(ALLOWED_COUNTRIES).size, ALLOWED_COUNTRIES.length, 'duplicate country codes');
  });
});

describe('which destination a checkout is quoted for', () => {
  test("the shopper's own choice wins over where they appear to be", () => {
    assert.equal(resolveShippingCountry('AU', 'IE'), 'AU');
    assert.equal(resolveShippingCountry('IE', 'US'), 'IE');
  });

  test('a lowercase or padded choice is still understood', () => {
    assert.equal(resolveShippingCountry('au', 'IE'), 'AU');
    assert.equal(resolveShippingCountry(' ie ', 'US'), 'IE');
  });

  test('with no choice, Cloudflare’s country is used', () => {
    assert.equal(resolveShippingCountry(undefined, 'GB'), 'GB');
    assert.equal(resolveShippingCountry(null, 'AU'), 'AU');
    assert.equal(resolveShippingCountry('', 'US'), 'US');
  });

  test('junk is ignored rather than quoted', () => {
    // T1/XX are Cloudflare's non-countries; the rest is what a tampered
    // request body might carry.
    for (const bad of ['T1', 'XX', 'IRELAND', 'I', '', '  ', 42, {}, [], null, undefined, true]) {
      assert.equal(resolveShippingCountry(bad, undefined), null,
        `${JSON.stringify(bad)} was accepted as a country`);
    }
  });

  test('junk falls through to a usable detected country', () => {
    assert.equal(resolveShippingCountry('ZZZ', 'IE'), 'IE');
    assert.equal(resolveShippingCountry({}, 'AU'), 'AU');
  });

  test('a known destination is offered exactly one rate', () => {
    for (const [country, cents] of [['IE', 0], ['GB', 1500], ['AU', 3500]]) {
      const options = shippingOptionsForCountry(country);
      assert.equal(options.length, 1, `${country} was offered ${options.length} rates`);
      assert.equal(options[0].shipping_rate_data.fixed_amount.amount, cents);
      assert.equal(options[0].shipping_rate_data.fixed_amount.currency, 'eur');
      assert.equal(options[0].shipping_rate_data.type, 'fixed_amount');
    }
  });

  test('an unknown destination is never offered the free Irish rate', () => {
    const options = shippingOptionsForCountry(null);
    const amounts = options.map(o => o.shipping_rate_data.fixed_amount.amount);
    assert.deepEqual(amounts, [1500, 3500]);
    assert.ok(!amounts.includes(0), 'free postage was offered to an unknown destination');
  });
});

describe('the postage table the browser is served', () => {
  const table = shippingTable();

  test('it carries every zone with its amount in cents', () => {
    assert.deepEqual(Object.keys(table.zones).sort(), ['europe', 'ireland', 'world']);
    assert.equal(table.zones.ireland.amount, SHIPPING_ZONES.ireland.amount);
    assert.equal(table.zones.world.maxDays, SHIPPING_ZONES.world.maxDays);
  });

  test('every offered country is paired with a zone that exists', () => {
    assert.equal(table.countries.length, ALLOWED_COUNTRIES.length);
    for (const [code, zone] of table.countries) {
      assert.ok(table.zones[zone], `${code} maps to the unknown zone ${zone}`);
    }
  });

  test('it leaks nothing but postage', () => {
    assert.deepEqual(Object.keys(table).sort(), ['countries', 'zones']);
  });
});

describe('the postage rates the pages promise', () => {
  const euros = cents => cents / 100;

  test('the FAQ quotes the real rates', () => {
    const faq = read('pages', 'faq.html');
    assert.match(faq, /id="postage"/, 'the FAQ has no postage section to link to');
    assert.match(faq, /Ireland<\/th><td><strong>Free<\/strong>/,
      'the FAQ table no longer says Irish postage is free');
    assert.ok(faq.includes(`€${euros(SHIPPING_ZONES.europe.amount)}`),
      `the FAQ does not quote €${euros(SHIPPING_ZONES.europe.amount)} for Europe`);
    assert.ok(faq.includes(`€${euros(SHIPPING_ZONES.world.amount)}`),
      `the FAQ does not quote €${euros(SHIPPING_ZONES.world.amount)} for the rest of the world`);
  });

  test('the Terms quote the real rates', () => {
    const terms = read('pages', 'terms.html');
    assert.match(terms, /free within\s+Ireland/,
      'the Terms no longer say Irish postage is free');
    assert.ok(terms.includes(`€${euros(SHIPPING_ZONES.europe.amount)}`),
      'the Terms do not quote the European rate');
    assert.ok(terms.includes(`€${euros(SHIPPING_ZONES.world.amount)}`),
      'the Terms do not quote the rest-of-world rate');
  });

  test('the cart asks the Worker for the rates rather than naming them', () => {
    const cart = read('pages', 'cart.html');
    assert.match(cart, /\/api\/shipping/, 'the cart no longer loads the postage table');
    assert.match(cart, /id="ship-country"/, 'the cart has lost its country picker');
    assert.match(cart, /getShippingCountry/, 'the cart no longer tells checkout where to quote for');
  });

  test('checkout sends the chosen country', () => {
    assert.match(read('js', 'stripe-integration.js'), /shippingCountry/);
  });
});

describe('the band above the header', () => {
  test('banners.js agrees with the other two copies of the sale rule', () => {
    // Three implementations of "is a sale running": the shop's, the Worker's
    // and the banner's. priceCases() is the shared table the first two are
    // already checked against.
    const now = Date.UTC(2026, 8, 26, 12, 0, 0);
    for (const { label, sale, expect, price } of priceCases(now)) {
      const running = expect !== price;
      assert.equal(BANNERS.saleRunning(sale, now), running, `banners.js: ${label}`);
      assert.equal(saleActive(sale, now), running, `worker: ${label}`);
      assert.equal(API.saleActive(sale, now), running, `shop: ${label}`);
    }
  });

  test('every hand-written page loads it', () => {
    const pages = [
      'index.html', 'pages/about.html', 'pages/archive.html', 'pages/care.html',
      'pages/cart.html', 'pages/contact.html', 'pages/faq.html',
      'pages/keepsake-collection.html', 'pages/returns.html', 'pages/shop.html',
      'pages/success.html', 'pages/terms.html',
    ];
    for (const page of pages) {
      assert.match(read(...page.split('/')), /js\/banners\.js/, `${page} does not load banners.js`);
    }
  });

  test('the markup lives in one place only', () => {
    // The sale band used to be duplicated in products.js and product-page.js.
    for (const file of ['products.js', 'product-page.js']) {
      assert.ok(!/className = 'sale-banner'/.test(read('js', file)),
        `${file} has grown its own copy of the banner again`);
    }
  });
});
