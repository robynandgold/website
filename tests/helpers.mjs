// Shared test plumbing.
//
// The site has no build step and no modules: src/js/products.js is a plain
// browser script that hangs its API off `window`. Rather than keep a second
// copy of that logic for tests, it's executed here in a sandbox with a minimal
// window/document, so the tests exercise the file the browser actually loads.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SRC = path.join(ROOT, 'src');

export const catalogue = () =>
  JSON.parse(readFileSync(path.join(SRC, 'data', 'products.json'), 'utf8'));

export const saleConfig = () =>
  JSON.parse(readFileSync(path.join(SRC, 'data', 'sale.json'), 'utf8'));

export const read = (...parts) => readFileSync(path.join(SRC, ...parts), 'utf8');

/** src/js/products.js as the browser sees it: window.ProductsAPI. */
export function loadProductsApi() {
  const listeners = {};
  const sandbox = {
    console,
    fetch: async () => ({ ok: false }),          // no network in unit tests
    window: {},
    document: {
      readyState: 'complete',
      addEventListener: (ev, fn) => { (listeners[ev] ||= []).push(fn); },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { add() {}, contains: () => false } }),
      body: { insertBefore() {}, firstChild: null },
    },
    Intl,
    IntersectionObserver: class { observe() {} unobserve() {} },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(path.join(SRC, 'js', 'products.js'), 'utf8'), sandbox, {
    filename: 'products.js',
  });
  if (!sandbox.window.ProductsAPI) throw new Error('products.js did not expose ProductsAPI');
  return sandbox.window.ProductsAPI;
}

/** scripts/build.js predicates, without running a build. */
export const loadBuild = () =>
  createRequire(import.meta.url)(path.join(ROOT, 'scripts', 'build.js'));

/**
 * The cases both price implementations must agree on. Shared so the browser
 * and the Worker are checked against one table rather than two.
 */
export function priceCases(now = Date.UTC(2026, 8, 26, 12, 0, 0)) {
  const hour = 3600e3;
  const at = ms => new Date(now + ms).toISOString();
  return [
    { label: 'no sale configured', sale: {}, price: 825, expect: 825 },
    { label: 'sale at 0%', sale: { percent: 0, endsAt: at(hour) }, price: 825, expect: 825 },
    { label: '20% running', sale: { percent: 20, endsAt: at(hour) }, price: 825, expect: 660 },
    { label: '20% on a bigger piece', sale: { percent: 20, endsAt: at(hour) }, price: 1050, expect: 840 },
    { label: 'sale already ended', sale: { percent: 20, endsAt: at(-hour) }, price: 825, expect: 825 },
    { label: 'sale not started', sale: { percent: 20, startsAt: at(24 * hour), endsAt: at(48 * hour) }, price: 825, expect: 825 },
    { label: 'started, still running', sale: { percent: 20, startsAt: at(-24 * hour), endsAt: at(hour) }, price: 825, expect: 660 },
    { label: 'rounding, 15% of 325', sale: { percent: 15, endsAt: at(hour) }, price: 325, expect: 276 },
    { label: '100% refused', sale: { percent: 100, endsAt: at(hour) }, price: 825, expect: 825 },
    { label: 'negative refused', sale: { percent: -10, endsAt: at(hour) }, price: 825, expect: 825 },
    { label: 'nonsense percent', sale: { percent: 'abc', endsAt: at(hour) }, price: 825, expect: 825 },
    { label: 'unparseable end date', sale: { percent: 20, endsAt: 'not a date' }, price: 825, expect: 660 },
    { label: 'ends exactly now', sale: { percent: 20, endsAt: at(0) }, price: 825, expect: 825 },
  ];
}
