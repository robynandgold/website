// Integration tests — the real pages, in a real browser, against a local
// server serving src/ exactly as Cloudflare does.
//
//   node --test tests/integration.test.mjs
//
// Playwright isn't a project dependency (there's no node_modules here), so it's
// resolved from the global install and the whole file skips cleanly if it isn't
// there, rather than failing the suite on a machine that can't run it.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { catalogue, loadProductsApi, SRC } from './helpers.mjs';
import { SHIPPING_ZONES, shippingTable } from '../worker/shipping.js';

const PORT = 8123;
const BASE = `http://localhost:${PORT}`;
const API = loadProductsApi();
const products = catalogue();
const listed = products.filter(p => API.isListed(p));
const sold = products.filter(p => p.available === false);

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg', '.JPG': 'image/jpeg', '.mp4': 'video/mp4',
  '.ico': 'image/x-icon', '.xml': 'application/xml', '.webmanifest': 'application/json',
  '.svg': 'image/svg+xml', '.txt': 'text/plain',
};

let server, browser;

async function resolvePlaywright() {
  for (const spec of ['playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try { return (await import(spec)).chromium; } catch { /* try the next */ }
  }
  return null;
}

// Resolved at module load, not in before(): node:test evaluates each test's
// options when the file is read, so a skip decided in before() would skip
// everything.
const chromium = await resolvePlaywright();

before(async () => {
  server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    // The Worker's endpoints don't exist in a static server. Product pages
    // beacon /api/view on load, so stub the API surface rather than let the
    // page log a 404 it would never see in production.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // The postage table is served for real, from the same module the Worker
      // uses, so the cart's quote and the free-postage band are tested against
      // the actual rates rather than a fixture that can drift from them.
      // "detected" stands in for Cloudflare's country header.
      if (p === '/api/shipping') {
        return res.end(JSON.stringify({ ...shippingTable(), detected: 'IE' }));
      }
      return res.end('{}');
    }
    if (p === '/') p = '/index.html';
    const file = path.join(SRC, p);
    if (!file.startsWith(SRC) || !existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(PORT, r));
  if (chromium) browser = await chromium.launch();
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(r => server.close(r));
});

/** A page with console errors and failed requests collected. */
async function visit(url, { viewport = { width: 1200, height: 900 }, routes } = {}) {
  const page = await browser.newPage({ viewport });
  const problems = [];
  const ours = url => { try { return new URL(url).host === `localhost:${PORT}`; } catch { return false; } };

  page.on('pageerror', e => problems.push(`js error: ${e.message}`));
  page.on('console', m => {
    // Fonts and analytics are third-party and blocked in the sandbox; their
    // failures say nothing about the site.
    if (m.type() === 'error' && ours(m.location()?.url || '')) problems.push(`console: ${m.text()}`);
  });
  page.on('requestfailed', r => {
    if (!ours(r.url())) return;
    // A cancelled video preload is normal: the player aborts the fetch when a
    // card scrolls out of view or the page closes.
    const why = r.failure()?.errorText || '';
    if (why.includes('ERR_ABORTED')) return;
    problems.push(`request failed (${why}): ${new URL(r.url()).pathname}`);
  });
  // The real missing-asset signal: something we serve answered 4xx/5xx.
  page.on('response', r => {
    if (r.status() >= 400 && ours(r.url())) problems.push(`${r.status()} for ${new URL(r.url()).pathname}`);
  });
  if (routes) for (const [pattern, body] of Object.entries(routes)) {
    await page.route(`**${pattern}`, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  }
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  page.problems = problems;
  return page;
}

const skip = () => (chromium ? false : 'Playwright is not installed — skipping browser tests');

const PAGES = [
  '/', '/pages/shop.html', '/pages/keepsake-collection.html', '/pages/archive.html',
  '/pages/cart.html', '/pages/about.html', '/pages/faq.html', '/pages/contact.html',
  '/pages/terms.html', '/pages/returns.html', '/pages/care.html', '/pages/success.html',
];

describe('every page loads cleanly', () => {
  for (const url of PAGES) {
    test(url, { skip: skip() }, async () => {
      const page = await visit(url);
      assert.deepEqual(page.problems, [], `${url} reported problems`);
      assert.ok(await page.title(), `${url} has no title`);
      await page.close();
    });
  }
});

describe('the shop', () => {
  test('shows every listed piece and nothing sold', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    const hrefs = await page.$$eval('#product-list .product-card a', els =>
      els.map(a => a.getAttribute('href')));
    assert.equal(hrefs.length, listed.length,
      `grid shows ${hrefs.length}, catalogue lists ${listed.length}`);
    for (const p of sold) {
      assert.ok(!hrefs.some(h => h.endsWith(`${p.slug}.html`)), `${p.slug} is sold but in the shop`);
    }
    await page.close();
  });

  test('the count line agrees with the grid', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    const text = await page.textContent('#product-count');
    const cards = await page.$$eval('#product-list .product-card', els => els.length);
    assert.ok(text.includes(String(cards)), `"${text}" does not mention ${cards}`);
    await page.close();
  });

  test('category filter narrows the grid', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    const before = await page.$$eval('#product-list .product-card', e => e.length);
    await page.selectOption('#filter-category', 'rings');
    await page.waitForTimeout(300);
    const after = await page.$$eval('#product-list .product-card', e => e.length);
    const rings = listed.filter(p => (p.category || '').toLowerCase() === 'rings').length;
    assert.equal(after, rings, `filtered to ${after}, expected ${rings}`);
    assert.ok(after <= before);
    await page.close();
  });

  test('price sort actually sorts', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    await page.selectOption('#filter-sort', 'price-asc');
    await page.waitForTimeout(300);
    const prices = await page.$$eval('#product-list .product-card-price', els =>
      els.map(e => Number(e.textContent.replace(/[^\d]/g, ''))));
    const sorted = [...prices].sort((a, b) => a - b);
    assert.deepEqual(prices, sorted, 'low-to-high is not in order');
    await page.close();
  });
});

describe('the archive', () => {
  test('shows sold pieces only', { skip: skip() }, async () => {
    const page = await visit('/pages/archive.html');
    const hrefs = await page.$$eval('#archive-list .product-card a', els =>
      els.map(a => a.getAttribute('href')));
    assert.equal(hrefs.length, sold.length);
    for (const p of listed) {
      assert.ok(!hrefs.some(h => h.endsWith(`${p.slug}.html`)), `${p.slug} is for sale but in the archive`);
    }
    await page.close();
  });
});

describe('product pages', () => {
  test('every generated page is reachable', { skip: skip() }, async () => {
    for (const p of products) {
      const res = await fetch(`${BASE}/pages/product/${p.slug}.html`);
      assert.equal(res.status, 200, `${p.slug} returned ${res.status}`);
    }
  });

  test('a live piece can be added to the cart', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await visit(`/pages/product/${piece.slug}.html`);
    assert.deepEqual(page.problems, []);
    await page.click('#add-to-cart-btn');
    await page.waitForTimeout(300);
    const cart = await page.evaluate(() => JSON.parse(localStorage.getItem('robyn_gold_cart') || '[]'));
    assert.equal(cart.length, 1);
    assert.equal(cart[0].id, piece.id);
    await page.close();
  });

  test('a sold piece cannot be bought', { skip: skip() }, async () => {
    const piece = sold[0];
    const page = await visit(`/pages/product/${piece.slug}.html`);
    assert.equal(await page.$('#add-to-cart-btn'), null, 'sold piece still has a buy button');
    assert.ok((await page.textContent('body')).includes('SOLD'));
    await page.close();
  });

  test('structured data matches the visible price', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await visit(`/pages/product/${piece.slug}.html`);
    const ld = await page.evaluate(() => {
      const el = [...document.querySelectorAll('script[type="application/ld+json"]')]
        .find(e => e.textContent.includes('"Product"'));
      return JSON.parse(el.textContent);
    });
    assert.equal(Number(ld.offers.price), piece.price);
    assert.equal(ld.offers.availability, 'https://schema.org/InStock');
    await page.close();
  });
});

describe('the cart', () => {
  test('adds, totals and removes', { skip: skip() }, async () => {
    const [a, b] = listed.filter(p => !API.isScheduled(p)).slice(0, 2);
    const page = await visit('/pages/cart.html');
    await page.evaluate(items => localStorage.setItem('robyn_gold_cart', JSON.stringify(items)),
      [a, b].map(p => ({ id: p.id, name: p.name, price: p.price, currency: 'EUR', image: p.images[0], quantity: 1 })));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    assert.equal(await page.$$eval('.cart-item', e => e.length), 2);
    const total = Number((await page.textContent('#cart-subtotal')).replace(/[^\d]/g, ''));
    assert.equal(total, a.price + b.price, 'subtotal does not match the two pieces');

    await page.click('.cart-item-remove');
    await page.waitForTimeout(400);
    assert.equal(await page.$$eval('.cart-item', e => e.length), 1);
    await page.close();
  });
});

// The whole point of quoting postage in the bag is that Stripe's payment page
// can't: it shows whatever rates it is handed without matching them to the
// address typed in. So these check the shopper sees the right number *here*,
// and that the number follows the country they pick.
describe('postage in the cart', () => {
  const bag = (p) => [{ id: p.id, name: p.name, price: p.price, currency: 'EUR', image: p.images[0], quantity: 1 }];

  /** The cart with one piece in it and the postage rows settled. */
  async function cartWith(piece) {
    const page = await visit('/pages/cart.html');
    await page.evaluate(items => localStorage.setItem('robyn_gold_cart', JSON.stringify(items)), bag(piece));
    // The last country chosen is remembered, so clear it for a clean default.
    await page.evaluate(() => localStorage.removeItem('rg_ship_country'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    return page;
  }

  const money = el => page => page.textContent(el).then(t => t.trim());

  test('opens on the visitor’s own country, free for Ireland', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await cartWith(piece);

    assert.equal(await page.evaluate(() => document.getElementById('cart-shipping').hidden), false,
      'the postage rows never appeared');
    assert.equal(await page.inputValue('#ship-country'), 'IE',
      'the picker did not open on the detected country');
    assert.equal(await money('#cart-postage')(page), 'Free', 'Irish postage is not shown as free');

    const total = Number((await money('#cart-total')(page)).replace(/[^\d]/g, ''));
    assert.equal(total, piece.price, 'free postage changed the total');

    assert.match(await money('#cart-postage-estimate')(page), /business days/);
    assert.equal(await page.problems.length, 0, page.problems.join('\n'));
    await page.close();
  });

  test('picking Australia adds the rest-of-world rate to the total', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await cartWith(piece);

    await page.selectOption('#ship-country', 'AU');
    await page.waitForTimeout(250);

    const postage = SHIPPING_ZONES.world.amount / 100;
    assert.ok((await money('#cart-postage')(page)).includes(String(postage)),
      `expected €${postage} postage to Australia`);
    const total = Number((await money('#cart-total')(page)).replace(/[^\d]/g, ''));
    assert.equal(total, piece.price + postage, 'the total does not include postage to Australia');
    await page.close();
  });

  test('the UK gets the European rate', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await cartWith(piece);

    await page.selectOption('#ship-country', 'GB');
    await page.waitForTimeout(250);
    const postage = SHIPPING_ZONES.europe.amount / 100;
    assert.ok((await money('#cart-postage')(page)).includes(String(postage)),
      `expected €${postage} postage to the UK`);
    await page.close();
  });

  test('the chosen country is remembered and sent to checkout', { skip: skip() }, async () => {
    const piece = listed.find(p => !API.isScheduled(p));
    const page = await cartWith(piece);

    await page.selectOption('#ship-country', 'US');
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => localStorage.getItem('rg_ship_country')), 'US');
    assert.equal(await page.evaluate(() => window.getShippingCountry()), 'US');

    // What the browser would actually post to the Worker.
    let sent = null;
    await page.route('**/api/create-checkout-session', route => {
      sent = JSON.parse(route.request().postData() || '{}');
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: BASE + '/pages/cart.html' }) });
    });
    await page.click('#checkout-button');
    await page.waitForTimeout(500);
    assert.equal(sent && sent.shippingCountry, 'US', 'checkout was not told the destination');
    await page.close();
  });

  test('countries are listed by name, and the catch-all is not offered', { skip: skip() }, async () => {
    const page = await cartWith(listed.find(p => !API.isScheduled(p)));
    const options = await page.$$eval('#ship-country option', els =>
      els.map(e => ({ code: e.value, name: e.textContent })));

    assert.ok(options.length > 150, `only ${options.length} countries offered`);
    assert.ok(!options.some(o => o.code === 'ZZ'), 'the ZZ catch-all is in the list');
    assert.equal(options.find(o => o.code === 'IE').name, 'Ireland');
    assert.equal(options.find(o => o.code === 'AU').name, 'Australia');
    // Sorted by name, which is the only order a shopper can scan.
    const names = options.map(o => o.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)), 'the list is not alphabetical');
    await page.close();
  });

  test('with no postage table, the bag falls back to a subtotal', { skip: skip() }, async () => {
    const page = await visit('/pages/cart.html', { routes: { '/api/shipping': {} } });
    await page.evaluate(items => localStorage.setItem('robyn_gold_cart', JSON.stringify(items)),
      bag(listed.find(p => !API.isScheduled(p))));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);

    assert.equal(await page.evaluate(() => document.getElementById('cart-shipping').hidden), true,
      'postage rows shown without any rates to show');
    assert.equal(await page.evaluate(() => document.getElementById('cart-total-row').hidden), true,
      'a total was claimed without postage');
    assert.equal(await page.evaluate(() => window.getShippingCountry()), null,
      'a country was reported without a table behind it');
    // Checkout must still work — the Worker falls back to the request's country.
    assert.equal(await page.evaluate(() => document.getElementById('checkout-button').disabled), false);
    await page.close();
  });
});

describe('the free-postage band', () => {
  test('appears site-wide while Ireland is free', { skip: skip() }, async () => {
    for (const url of ['/', '/pages/shop.html', '/pages/faq.html', '/pages/terms.html']) {
      const page = await visit(url);
      const band = await page.$eval('.postage-banner', e => e.textContent).catch(() => null);
      assert.match(band || '', /Free insured postage/, `${url} has no free-postage band`);
      await page.close();
    }
  });

  test('a running sale takes the slot instead', { skip: skip() }, async () => {
    const sale = { percent: 20, label: 'Test sale', endsAt: new Date(Date.now() + 86400e3).toISOString() };
    const page = await visit('/pages/shop.html', { routes: { '/data/sale.json': sale } });
    assert.ok(await page.$('.sale-banner'), 'the sale band is missing');
    assert.equal(await page.$('.postage-banner'), null, 'both bands are showing at once');
    await page.close();
  });

  test('it retires itself if Ireland stops being free', { skip: skip() }, async () => {
    const paid = shippingTable();
    paid.zones.ireland = { ...paid.zones.ireland, amount: 1000 };
    const page = await visit('/pages/shop.html', { routes: { '/api/shipping': { ...paid, detected: 'IE' } } });
    assert.equal(await page.$('.postage-banner'), null,
      'the band still claims free postage after the rate changed');
    await page.close();
  });

  test('the band links to the postage rates', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    await page.click('.postage-banner a');
    await page.waitForTimeout(600);
    assert.match(page.url(), /faq\.html#postage$/, 'the band does not reach the postage section');
    assert.ok(await page.$('#postage'), 'the FAQ has no postage section to land on');
    await page.close();
  });
});

describe('a scheduled drop', () => {
  // Injected rather than written to the catalogue, so the test never touches
  // real data.
  const withDrop = (previewDrop) => {
    const copy = JSON.parse(JSON.stringify(products));
    const target = copy.find(p => p.slug === listed.find(x => !API.isScheduled(x)).slug);
    target.dropAt = new Date(Date.now() + 3 * 86400e3).toISOString();
    target.previewDrop = previewDrop;
    return { copy, slug: target.slug };
  };

  test('is shown with a badge and cannot be bought', { skip: skip() }, async () => {
    const { copy, slug } = withDrop(true);
    const page = await visit('/pages/shop.html', { routes: { '/data/products.json': copy } });
    const card = await page.$(`#product-list .product-card a[href$="${slug}.html"]`);
    assert.ok(card, 'previewed drop is missing from the shop');
    const badge = await page.$eval(`#product-list .product-card:has(a[href$="${slug}.html"]) .drop-badge`,
      e => e.textContent.trim()).catch(() => null);
    assert.match(badge || '', /^Drops /, `expected a Drops badge, got ${badge}`);
    await page.close();
  });

  test('previewDrop: false keeps it out of the shop', { skip: skip() }, async () => {
    const { copy, slug } = withDrop(false);
    const page = await visit('/pages/shop.html', { routes: { '/data/products.json': copy } });
    assert.equal(await page.$(`#product-list .product-card a[href$="${slug}.html"]`), null,
      'a piece held back before its drop is visible');
    await page.close();
  });
});

describe('a running sale', () => {
  const sale = { percent: 20, label: 'Test sale', startsAt: '', endsAt: new Date(Date.now() + 86400e3).toISOString() };

  test('reduces displayed prices and announces itself', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html', { routes: { '/data/sale.json': sale } });
    assert.ok(await page.$('.sale-banner'), 'no sale banner');
    const first = listed.find(p => !API.isScheduled(p));
    const shown = await page.$eval(`#product-list .product-card:has(a[href$="${first.slug}.html"]) .product-card-price`,
      e => e.textContent.replace(/\s+/g, ' ').trim());
    const expected = Math.round(first.price * 0.8);
    assert.ok(shown.includes(String(expected)), `"${shown}" does not show the reduced ${expected}`);
    assert.ok(await page.$('.price-was'), 'no struck-through original price');
    await page.close();
  });

  test('is absent when no sale is configured', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html', { routes: { '/data/sale.json': { percent: 0 } } });
    assert.equal(await page.$('.sale-banner'), null);
    assert.equal(await page.$('.price-was'), null);
    await page.close();
  });
});

describe('the keepsake collection', () => {
  test('shows the coming-soon card or the grid, never both', { skip: skip() }, async () => {
    const page = await visit('/pages/keepsake-collection.html');
    const card = await page.evaluate(() => !document.getElementById('keepsake-coming').hidden);
    const grid = await page.evaluate(() => !document.getElementById('keepsake-collection').hidden);
    assert.notEqual(card, grid, 'both states visible, or neither');
    const keepsakes = listed.filter(API.isKeepsake);
    assert.equal(grid, keepsakes.length > 0,
      `${keepsakes.length} keepsakes listed but grid shown = ${grid}`);
    await page.close();
  });
});

describe('navigation is consistent', () => {
  test('every page carries the same primary nav', { skip: skip() }, async () => {
    let reference = null;
    for (const url of PAGES) {
      const page = await visit(url);
      const links = await page.$$eval('#primary-nav .nav-link', els =>
        els.map(a => a.textContent.trim()));
      if (reference === null) reference = links;
      else assert.deepEqual(links, reference, `${url} has a different menu`);
      await page.close();
    }
  });

  test('no internal link 404s', { skip: skip() }, async () => {
    const page = await visit('/pages/shop.html');
    const hrefs = await page.$$eval('a[href]', els => els.map(a => a.href));
    await page.close();
    const internal = [...new Set(hrefs.filter(h => h.startsWith(BASE)))];
    for (const href of internal) {
      const res = await fetch(href.split('#')[0]);
      assert.equal(res.status, 200, `${href} returned ${res.status}`);
    }
  });
});

describe('phones', () => {
  for (const url of ['/', '/pages/shop.html', '/pages/keepsake-collection.html', '/pages/cart.html']) {
    test(`${url} does not scroll sideways at 390px`, { skip: skip() }, async () => {
      const page = await visit(url, { viewport: { width: 390, height: 844 } });
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `${url} overflows by ${overflow}px`);
      await page.close();
    });
  }
});

describe('the sitemap', () => {
  test('every URL it lists exists', { skip: skip() }, async () => {
    const xml = readFileSync(path.join(SRC, 'sitemap.xml'), 'utf8');
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.ok(locs.length > 0, 'sitemap is empty');
    for (const loc of locs) {
      const res = await fetch(BASE + new URL(loc).pathname);
      assert.equal(res.status, 200, `${loc} is in the sitemap but returns ${res.status}`);
    }
  });

  test('it lists every listed piece and no sold ones', { skip: skip() }, async () => {
    const xml = readFileSync(path.join(SRC, 'sitemap.xml'), 'utf8');
    for (const p of listed) {
      assert.ok(xml.includes(`/pages/product/${p.slug}.html`), `${p.slug} is missing from the sitemap`);
    }
    for (const p of sold) {
      assert.ok(!xml.includes(`/pages/product/${p.slug}.html`), `${p.slug} is sold but in the sitemap`);
    }
  });
});

describe('the admin page', () => {
  test('is behind the password gate', { skip: skip() }, async () => {
    const page = await visit('/pages/add-product.html');
    const gated = await page.evaluate(() => {
      const gate = document.getElementById('auth-gate');
      return gate && getComputedStyle(gate).display !== 'none';
    });
    assert.ok(gated, 'the admin page is not gated');
    await page.close();
  });

  test('the sold box is unticked by default and says what it does', { skip: skip() }, async () => {
    const page = await visit('/pages/add-product.html');
    const box = await page.evaluate(() => {
      const el = document.getElementById('f-sold');
      return { exists: !!el, checked: el?.checked, label: el?.parentElement.innerText.trim() };
    });
    assert.ok(box.exists, 'the sold checkbox is missing');
    assert.equal(box.checked, false, 'a new piece would be published as sold');
    assert.match(box.label, /sold/i);
    await page.close();
  });
});
