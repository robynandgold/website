#!/usr/bin/env node
/**
 * BUILD.JS — generate static, crawlable product pages + the sitemap.
 * ====================================================================
 *
 * The site is otherwise plain static HTML. The one weak spot for SEO/GEO was
 * the product pages: they were a single template (product-detail.html) that
 * fetched products.json and built the page in the browser. Search engines and
 * AI crawlers that don't run JavaScript saw an empty "Vintage Ring" shell with
 * no price, description or structured data.
 *
 * This script reads src/data/products.json (the single source of truth) and
 * writes one real, fully-rendered HTML file per product into
 * src/pages/product/<slug>.html — with the title, meta description, Open
 * Graph/Twitter tags, Product + BreadcrumbList JSON-LD and the visible content
 * all baked into the markup. It also regenerates src/sitemap.xml so every live
 * product is listed.
 *
 * It runs in the convert-videos GitHub Action after each publish and can be run by hand:
 *     node scripts/build.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DATA_FILE = path.join(SRC, 'data', 'products.json');
const PRODUCT_DIR = path.join(SRC, 'pages', 'product');
const SITEMAP_FILE = path.join(SRC, 'sitemap.xml');

const SITE = 'https://robynandgold.com';

// --- helpers ----------------------------------------------------------------

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPrice(price, currency = 'EUR') {
  const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
  return `${symbol}${Number(price).toFixed(2)}`;
}

// Build a concise meta description (~155 chars) from the product copy.
function metaDescription(product) {
  const base = (product.description || '').trim().replace(/\s+/g, ' ');
  const suffix = ' Personally sourced vintage jewellery from Robyn & Gold, Ireland.';
  let desc = base;
  if (desc.length + suffix.length <= 158) {
    desc = desc + suffix;
  } else if (desc.length > 158) {
    desc = desc.slice(0, 155).replace(/\s+\S*$/, '') + '…';
  }
  return desc;
}

// Best-effort metal/material from the product name, e.g. "18ct Yellow Gold".
function deriveMaterial(name) {
  const m = String(name).match(/\b(?:9|10|14|15|18|22|24)\s*ct\b[^,]*?\bgold\b/i);
  if (m) return m[0].replace(/\s+/g, ' ').trim();
  if (/platinum/i.test(name)) return 'Platinum';
  if (/silver/i.test(name)) return 'Silver';
  if (/gold/i.test(name)) return 'Gold';
  return undefined;
}

function priceValidUntil() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

// --- per-product structured data -------------------------------------------

function productJsonLd(product, url) {
  const inStock = product.available !== false;
  const material = deriveMaterial(product.name);

  const offer = {
    '@type': 'Offer',
    url,
    price: product.price,
    priceCurrency: product.currency || 'EUR',
    priceValidUntil: priceValidUntil(),
    itemCondition: 'https://schema.org/UsedCondition',
    availability: inStock ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
    seller: { '@type': 'Organization', name: 'Robyn & Gold' },
    hasMerchantReturnPolicy: {
      '@type': 'MerchantReturnPolicy',
      applicableCountry: 'IE',
      returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
      merchantReturnDays: 14,
      returnMethod: 'https://schema.org/ReturnByMail',
      returnFees: 'https://schema.org/ReturnShippingFees'
    }
  };

  const product_ld = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    image: (product.images || []).map(i => SITE + i),
    brand: { '@type': 'Brand', name: 'Robyn & Gold' },
    category: 'Vintage Jewellery',
    itemCondition: 'https://schema.org/UsedCondition',
    offers: offer
  };
  if (material) product_ld.material = material;
  if (product.size) product_ld.size = product.size;
  if (product.createdAt) product_ld.releaseDate = product.createdAt;

  return product_ld;
}

function breadcrumbJsonLd(product, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE + '/' },
      { '@type': 'ListItem', position: 2, name: 'Shop', item: SITE + '/pages/shop.html' },
      { '@type': 'ListItem', position: 3, name: product.name, item: url }
    ]
  };
}

// --- visible product markup (mirrors the old client-rendered layout) -------

function carouselMarkup(product) {
  const images = (product.images || []).map(src => ({ type: 'image', src }));
  const videos = (product.videos || []).map(src => ({ type: 'video', src }));
  const slides = [...videos, ...images];
  const poster = product.images && product.images[0];

  const slidesHTML = slides.map((item, index) => {
    const activeClass = index === 0 ? ' active' : '';
    if (item.type === 'video') {
      return `
            <div class="carousel-slide${activeClass}" data-index="${index}">
              <video src="${escapeHtml(item.src)}" autoplay muted loop playsinline preload="metadata" class="carousel-video"${poster ? ` poster="${escapeHtml(poster)}"` : ''}></video>
            </div>`;
    }
    return `
            <div class="carousel-slide${activeClass}" data-index="${index}">
              <img src="${escapeHtml(item.src)}" alt="${escapeHtml(product.name)} view ${index + 1}" onerror="this.style.display='none'" />
            </div>`;
  }).join('');

  const controls = slides.length > 1 ? `
            <button class="carousel-control prev" aria-label="Previous" id="carousel-prev"><svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,1 1,9 9,17"/></svg></button>
            <button class="carousel-control next" aria-label="Next" id="carousel-next"><svg width="10" height="18" viewBox="0 0 10 18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,1 9,9 1,17"/></svg></button>` : '';

  const dots = slides.length > 1 ? `
            <div class="carousel-dots" id="carousel-dots">
              ${slides.map((item, i) => `
                <button class="carousel-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="${item.type === 'video' ? 'Video' : 'Image ' + (i + 1)}">
                  ${item.type === 'video' ? '<svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor"><polygon points="1,0 7,4 1,8"/></svg>' : ''}
                </button>`).join('')}
            </div>` : '';

  return `
        <div class="product-detail-image" role="region" aria-label="Product media">
          <div class="carousel" id="image-carousel">${controls}
            <div class="carousel-track" id="carousel-track">
              ${slidesHTML}
            </div>${dots}
          </div>
        </div>`;
}

function infoMarkup(product) {
  const isSold = product.available === false;
  const price = formatPrice(product.price, product.currency);

  const buyBlock = isSold ? `
          <div style="background: var(--muted); color: white; padding: 1rem; border-radius: var(--radius-md); margin-top: 1.5rem; text-align: center;">
            <strong style="font-size: 1.1rem;">SOLD</strong>
            <p style="margin: 0.5rem 0 0 0; font-size: 0.9rem;">This piece has found its home</p>
          </div>` : `
          <button id="add-to-cart-btn" class="btn btn-primary" style="margin-top: 1.5rem;">
            Add to cart
          </button>
          <p id="cart-message" style="margin-top: 0.8rem; font-size: 0.9rem; color: var(--muted); display: none;"></p>`;

  const trust = isSold ? '' : `
          <ul class="product-trust">
            <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg> Insured shipping from Ireland</li>
            <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg> Secure checkout via Stripe</li>
            <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 9l9 12 9-12z"/><path d="M3 9h18"/></svg> Personally sourced &amp; professionally prepared</li>
          </ul>`;

  return `
        <div class="product-detail-info">
          <h1 class="product-detail-title">${escapeHtml(product.name)}</h1>
          <p class="product-detail-meta">Size ${escapeHtml(product.size || '')}</p>
          <p class="product-detail-price">${price}</p>
          ${isSold ? '' : `<p class="product-detail-oneoff">✦ One of a kind — only one available</p>`}
          ${buyBlock}
          <div class="product-detail-copy" style="margin-top: 1.8rem;">${escapeHtml(product.description || '')}</div>
          ${trust}
        </div>`;
}

function stickyBarMarkup(product) {
  const isSold = product.available === false;
  const price = formatPrice(product.price, product.currency);
  return `
  <div class="product-sticky-bar" id="product-sticky-bar" hidden>
    <div class="psb-info">
      <small id="psb-name">${escapeHtml(product.name)}</small>
      <strong id="psb-price">${price}</strong>
    </div>
    ${isSold
      ? `<span class="psb-sold" id="psb-sold">Sold</span>`
      : `<button class="btn btn-primary" id="psb-add-btn">Add to cart</button>`}
  </div>`;
}

// --- full page template -----------------------------------------------------

function renderPage(product) {
  const url = `${SITE}/pages/product/${product.slug}.html`;
  const title = `${product.name} | Robyn & Gold`;
  const description = metaDescription(product);
  const image = (product.images && product.images[0]) ? SITE + product.images[0] : `${SITE}/images/homepage.png`;
  const availability = product.available === false ? 'oldsold' : 'instock';

  const ld = JSON.stringify(productJsonLd(product, url));
  const breadcrumb = JSON.stringify(breadcrumbJsonLd(product, url));
  const embedded = JSON.stringify(product);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${url}" />

  <!-- Open Graph -->
  <meta property="og:type" content="product" />
  <meta property="og:site_name" content="Robyn &amp; Gold" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:image" content="${escapeHtml(image)}" />
  <meta property="og:url" content="${url}" />
  <meta property="product:price:amount" content="${product.price}" />
  <meta property="product:price:currency" content="${product.currency || 'EUR'}" />
  <meta property="product:availability" content="${availability === 'instock' ? 'in stock' : 'out of stock'}" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  <meta name="twitter:image" content="${escapeHtml(image)}" />

  <!-- Structured Data -->
  <script type="application/ld+json">${ld}</script>
  <script type="application/ld+json">${breadcrumb}</script>

  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link
    href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap"
    rel="stylesheet"
  />

  <link rel="stylesheet" href="../../css/styles.css" />
  <link rel="icon" type="image/png" sizes="32x32" href="/images/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="16x16" href="/images/favicon-16x16.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/images/apple-touch-icon.png" />
  <link rel="manifest" href="/images/site.webmanifest" />
  <!-- Plausible Analytics (privacy-friendly, cookieless) -->
  <script defer data-domain="robynandgold.com" src="https://plausible.io/js/script.js"></script>
  <script>window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)};</script>

  <!-- Product data for client-side interactivity (carousel, cart, related) -->
  <script type="application/json" id="product-data">${embedded}</script>
</head>
<body class="page product-page">
  <header class="site-header">
    <div class="container header-inner">
      <button class="nav-toggle" type="button" aria-label="Toggle menu" aria-controls="primary-nav" aria-expanded="false">
        <span></span>
        <span></span>
        <span></span>
      </button>
      <nav class="nav nav-left" id="primary-nav" aria-label="Primary">
        <a href="../shop.html" class="nav-link">Shop</a>
        <a href="../about.html" class="nav-link">Our story</a>
        <a href="../../index.html#ethos" class="nav-link">Ethos</a>
      </nav>
      <div class="brand-banner">
        <div class="brand-center">
          <a href="../../index.html">
            <img src="../../images/rg-logo.png" alt="Robyn & Gold" width="120" height="40" loading="eager" />
          </a>
          <a href="../../index.html" class="brand-main">Robyn &amp; Gold</a>
          <span class="brand-tagline">Vintage Jewellery</span>
        </div>
      </div>
      <nav class="nav nav-right" aria-label="Utilities">
        <a href="../cart.html" class="nav-link nav-link--cart" aria-label="Cart">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="icon-cart"><path d="M5 8h14l-1.1 11a1.3 1.3 0 0 1-1.3 1.2H7.4A1.3 1.3 0 0 1 6.1 19Z"/><path d="M9 8V6.6a3 3 0 0 1 6 0V8"/><path d="M9.7 12v5M14.3 12v5"/></svg>
          <span id="cart-count" class="cart-count">0</span>
        </a>
      </nav>
    </div>
  </header>

  <main>
    <section class="section">
      <div class="container">
        <div id="product-detail" class="product-detail-layout">
          <div style="grid-column: 1 / -1; margin-bottom: 0.5rem;">
            <a href="../shop.html" class="btn btn-ghost" style="padding: 0.5rem 1.1rem; font-size: 0.8rem;">← Back to shop</a>
          </div>
${carouselMarkup(product)}
${infoMarkup(product)}
        </div>

        <div class="related-section" id="related-section" hidden>
          <h2 class="related-title">You might also like</h2>
          <div class="product-grid" id="related-grid"></div>
        </div>
      </div>
    </section>
  </main>
${stickyBarMarkup(product)}

  <footer class="site-footer">
    <div class="container footer-inner">
      <div class="footer-brand">
        <span class="brand-main">Robyn &amp; Gold</span>
        <span class="brand-tagline">Vintage Jewellery</span>
      </div>
      <div class="footer-links">
        <a href="/pages/shop.html" class="footer-link">Shop</a>
        <a href="/pages/about.html" class="footer-link">Our story</a>
        <a href="/pages/faq.html" class="footer-link">FAQ</a>
        <a href="/#ethos" class="footer-link">Ethos</a>
        <a href="/pages/contact.html" class="footer-link">Contact</a>
        <a href="/pages/terms.html" class="footer-link">T&amp;Cs</a>
        <a href="/pages/returns.html" class="footer-link">Returns</a>
      </div>
      <p class="footer-meta">© <span id="year"></span> Robyn &amp; Gold. All rights reserved.</p>
    </div>
  </footer>

  <script src="../../js/cart.js"></script>
  <script src="../../js/product-page.js"></script>
</body>
</html>
`;
}

// --- sitemap ----------------------------------------------------------------

function renderSitemap(products) {
  const staticPages = [
    { loc: `${SITE}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE}/pages/shop.html`, changefreq: 'weekly', priority: '0.9' },
    { loc: `${SITE}/pages/about.html`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${SITE}/pages/faq.html`, changefreq: 'monthly', priority: '0.7' },
    { loc: `${SITE}/pages/contact.html`, changefreq: 'monthly', priority: '0.6' },
    { loc: `${SITE}/pages/returns.html`, changefreq: 'monthly', priority: '0.5' },
    { loc: `${SITE}/pages/terms.html`, changefreq: 'yearly', priority: '0.4' }
  ];

  const productUrls = products
    .filter(p => p.available !== false)
    .map(p => ({
      loc: `${SITE}/pages/product/${p.slug}.html`,
      lastmod: p.createdAt ? String(p.createdAt).slice(0, 10) : undefined,
      changefreq: 'weekly',
      priority: '0.8'
    }));

  const urls = [...staticPages, ...productUrls]
    .map(u => {
      const lastmod = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
      return `  <url>\n    <loc>${u.loc}</loc>${lastmod}\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`;
    })
    .join('\n\n');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n\n${urls}\n\n</urlset>\n`;
}

// --- run --------------------------------------------------------------------

function main() {
  const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));

  fs.mkdirSync(PRODUCT_DIR, { recursive: true });

  // Clean out stale generated pages so removed products don't linger.
  for (const file of fs.readdirSync(PRODUCT_DIR)) {
    if (file.endsWith('.html')) fs.unlinkSync(path.join(PRODUCT_DIR, file));
  }

  let written = 0;
  for (const product of products) {
    if (!product.slug) continue;
    fs.writeFileSync(path.join(PRODUCT_DIR, `${product.slug}.html`), renderPage(product));
    written++;
  }

  fs.writeFileSync(SITEMAP_FILE, renderSitemap(products));

  console.log(`Generated ${written} product page(s) in src/pages/product/`);
  console.log(`Wrote sitemap with ${products.filter(p => p.available !== false).length} live product URL(s)`);
}

main();
