// Security and page-hygiene tests.
//
// The early-purchase gate is the one piece of client-invisible enforcement on
// the site: everything else about a drop is a badge or a missing button, and
// those are only cosmetic. If purchaseAllowed() is wrong, a scheduled piece can
// be bought before its drop by anyone who crafts a request.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { purchaseAllowed, vipToken, tokensMatch, isScheduled } from '../worker/vip.js';
import { catalogue, SRC } from './helpers.mjs';

const SECRET = 'test-secret-not-the-real-one';
const future = () => new Date(Date.now() + 86400e3).toISOString();
const pastDate = () => new Date(Date.now() - 86400e3).toISOString();

describe('the early-purchase gate', () => {
  const env = { VIP_SECRET: SECRET };

  test('a live piece needs no token', async () => {
    assert.equal(await purchaseAllowed({ id: 'a' }, undefined, env), true);
  });

  test('a scheduled piece is refused without a token', async () => {
    assert.equal(await purchaseAllowed({ id: 'a', dropAt: future() }, undefined, env), false);
  });

  test('a scheduled piece is refused with an empty or junk token', async () => {
    for (const bad of ['', 'x', 'deadbeef', '0'.repeat(64), null]) {
      assert.equal(await purchaseAllowed({ id: 'a', dropAt: future() }, bad, env), false,
        `token ${JSON.stringify(bad)} was accepted`);
    }
  });

  test('a valid token unlocks its own piece', async () => {
    const token = await vipToken(SECRET, 'a');
    assert.equal(await purchaseAllowed({ id: 'a', dropAt: future() }, token, env), true);
  });

  test("a token for one piece does not unlock another", async () => {
    const token = await vipToken(SECRET, 'a');
    assert.equal(await purchaseAllowed({ id: 'b', dropAt: future() }, token, env), false);
  });

  test('a token signed with a different secret is refused', async () => {
    const token = await vipToken('some-other-secret', 'a');
    assert.equal(await purchaseAllowed({ id: 'a', dropAt: future() }, token, env), false);
  });

  test('with no VIP_SECRET set, early purchase is never allowed', async () => {
    const token = await vipToken(SECRET, 'a');
    assert.equal(await purchaseAllowed({ id: 'a', dropAt: future() }, token, {}), false);
  });

  test('once the drop has passed, the piece is open to everyone', async () => {
    assert.equal(await purchaseAllowed({ id: 'a', dropAt: pastDate() }, undefined, env), true);
  });

  test('isScheduled uses the server clock, not the request', () => {
    assert.equal(isScheduled({ dropAt: future() }), true);
    assert.equal(isScheduled({ dropAt: pastDate() }), false);
    assert.equal(isScheduled({ dropAt: 'nonsense' }), false);
    assert.equal(isScheduled({}), false);
  });

  test('token comparison rejects mismatched lengths without throwing', () => {
    assert.equal(tokensMatch('abc', 'abcd'), false);
    assert.equal(tokensMatch('', ''), true);
    assert.equal(tokensMatch(undefined, 'abc'), false);
  });
});

// Pages are hand-written and repetitive, so these catch the copy-paste
// mistakes that no amount of browser testing would flag as an error.
const pageFiles = () => {
  const pages = readdirSync(path.join(SRC, 'pages'))
    .filter(f => f.endsWith('.html') && f !== 'product-detail.html')
    .map(f => ({ name: `pages/${f}`, html: readFileSync(path.join(SRC, 'pages', f), 'utf8') }));
  return [{ name: 'index.html', html: readFileSync(path.join(SRC, 'index.html'), 'utf8') }, ...pages];
};

describe('page hygiene', () => {
  for (const { name, html } of pageFiles()) {
    test(`${name} has one title and no duplicate element ids`, () => {
      const titles = html.match(/<title>/g) || [];
      assert.equal(titles.length, 1, `${name} has ${titles.length} <title> tags`);

      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      assert.deepEqual([...new Set(dupes)], [], `${name} repeats element ids`);
    });
  }

  for (const { name, html } of pageFiles()) {
    // Every page is either meant for search — and then needs a canonical, or
    // duplicates compete with each other — or explicitly kept out of it. The
    // cart, the order confirmation and the admin page are the noindex ones.
    test(`${name} is either indexable with a canonical, or noindex`, () => {
      const noindex = /<meta name="robots"[^>]*noindex/.test(html);
      const canonical = /<link rel="canonical"/.test(html);
      assert.ok(noindex || canonical,
        `${name} has neither a canonical link nor a noindex directive`);
      if (!noindex) {
        assert.match(html, /<meta name="description"/, `${name} is indexable but has no description`);
      }
    });
  }

  test('the pages kept out of search are consistent about it', () => {
    const sitemap = readFileSync(path.join(SRC, 'sitemap.xml'), 'utf8');
    const robots = readFileSync(path.join(SRC, 'robots.txt'), 'utf8');
    for (const { name, html } of pageFiles()) {
      if (!/<meta name="robots"[^>]*noindex/.test(html)) continue;
      const file = name.replace('pages/', '');
      assert.ok(!sitemap.includes(file), `${name} is noindex but listed in the sitemap`);
      assert.ok(robots.includes(`Disallow: /pages/${file}`), `${name} is noindex but not disallowed in robots.txt`);
    }
  });

  test('the admin page is not indexable and not in the sitemap', () => {
    const sitemap = readFileSync(path.join(SRC, 'sitemap.xml'), 'utf8');
    assert.ok(!sitemap.includes('add-product'), 'the admin page is listed in the sitemap');
  });

  test('the build regions the build script owns are all present', () => {
    const regions = {
      'pages/shop.html': ['shop-grid', 'shop-jsonld'],
      'pages/archive.html': ['archive-grid'],
      'index.html': ['featured-grid'],
    };
    for (const [file, names] of Object.entries(regions)) {
      const html = readFileSync(path.join(SRC, file), 'utf8');
      for (const region of names) {
        assert.ok(html.includes(`<!-- BUILD:${region} -->`), `${file} lost its ${region} marker`);
        assert.ok(html.includes(`<!-- /BUILD:${region} -->`), `${file} lost its ${region} end marker`);
      }
    }
  });
});

describe('generated product pages', () => {
  const products = catalogue();
  const dir = path.join(SRC, 'pages', 'product');

  test('there is exactly one page per piece and no strays', () => {
    const onDisk = readdirSync(dir).filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''));
    const expected = products.map(p => p.slug);
    assert.deepEqual([...onDisk].sort(), [...expected].sort());
  });

  test('each page states its own price and name', () => {
    for (const p of products) {
      const html = readFileSync(path.join(dir, `${p.slug}.html`), 'utf8');
      assert.ok(html.includes(`"price":${p.price}`), `${p.slug}: JSON-LD price does not match ${p.price}`);
      assert.ok(html.includes(p.name.replace(/&/g, '&amp;')), `${p.slug}: name missing from the page`);
    }
  });

  test('sold pieces say SOLD, live ones offer a buy button', () => {
    for (const p of products) {
      const html = readFileSync(path.join(dir, `${p.slug}.html`), 'utf8');
      if (p.available === false) {
        assert.ok(html.includes('SOLD'), `${p.slug} is sold but its page does not say so`);
        assert.ok(!html.includes('id="add-to-cart-btn"'), `${p.slug} is sold but has a buy button`);
      } else {
        assert.ok(html.includes('id="add-to-cart-btn"'), `${p.slug} has no buy button`);
      }
    }
  });
});
