/**
 * PRODUCTS.JS - Product Data Management
 * ========================================
 * 
 * This module handles loading and filtering product data from /src/data/products.json
 * All pages (home, shop, product detail) use this centralized data source.
 * 
 * HOW TO MANAGE PRODUCTS:
 * 
 * 1. ADD A NEW PRODUCT:
 *    - Open /src/data/products.json
 *    - Copy an existing product object and modify all fields
 *    - Add product images to /src/images/products/ folder
 *    - Update the "images" array with correct paths (e.g., "/images/products/your-ring-1.jpg")
 *    - Set "featured": true if you want it on the homepage
 * 
 * 2. UPDATE PRICE/DESCRIPTION:
 *    - Open /src/data/products.json
 *    - Find the product by "id" or "name"
 *    - Edit "price", "description", or any other field
 *    - Save the file - changes appear immediately
 * 
 * 3. CHANGE IMAGES:
 *    - Upload new images to /src/images/products/
 *    - Update the "images" array in products.json with new filenames
 *    - Keep 3-5 images per product for best presentation
 */

let cachedProducts = null;

/**
 * Load products from JSON file
 */
async function loadProducts() {
  if (cachedProducts) return cachedProducts;

  try {
    const isInPagesDir = window.location.pathname.includes('/pages/');
    const dataPath = isInPagesDir ? '../data/products.json' : 'data/products.json';

    const response = await fetch(dataPath);
    if (!response.ok) {
      throw new Error(`Failed to load products: ${response.status} ${response.statusText}`);
    }

    cachedProducts = await response.json();
    return cachedProducts;
  } catch (error) {
    console.error('Error loading products:', error);
    return [];
  }
}

/**
 * Whether a product should be shown to shoppers right now.
 * A piece is public when it isn't sold and any scheduled drop (an ISO UTC
 * instant in `dropAt`) has already passed. A missing/empty dropAt means it's
 * live immediately.
 */
function isPubliclyLive(product) {
  if (product.available === false) return false;
  if (product.dropAt) {
    const dropTime = Date.parse(product.dropAt);
    if (!isNaN(dropTime) && dropTime > Date.now()) return false;
  }
  return true;
}

/**
 * SALE
 * ====
 * A site-wide percentage off, running until a set moment. Held in
 * src/data/sale.json (public — a sale is public information) and applied at
 * render time rather than written into prices, so the sale ends by itself the
 * second it's due, with nothing scheduled to run. The Worker applies the same
 * rules to the price it sends to Stripe, so the till agrees with the shelf.
 */
let cachedSale = null;

async function loadSale() {
  if (cachedSale) return cachedSale;
  try {
    const response = await fetch('/data/sale.json', { cache: 'no-store' });
    // No file at all is a legitimate "no sale", not a failure.
    cachedSale = response.ok ? await response.json() : {};
  } catch (error) {
    cachedSale = {};
  }
  return cachedSale;
}

/** Whether a sale is running right now. */
function saleActive(sale, now = Date.now()) {
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

/**
 * What a piece costs right now, and what it was before. `was` is null when no
 * sale applies, which is what callers key their strike-through off.
 * Rounded to whole euro — the catalogue is priced in whole euro.
 */
function priceNow(product, sale, now = Date.now()) {
  const full = Number(product.price) || 0;
  if (!saleActive(sale, now)) return { price: full, was: null };
  const reduced = Math.round(full * (1 - Number(sale.percent) / 100));
  // A discount that rounds to no change isn't worth striking through.
  if (reduced >= full) return { price: full, was: null };
  return { price: reduced, was: full };
}

/** Card/grid price markup: the sale price with the old one struck through. */
function priceMarkup(product, sale, now = Date.now()) {
  const { price, was } = priceNow(product, sale, now);
  const currency = product.currency || 'EUR';
  if (was === null) return formatPrice(price, currency);
  return `<span class="price-was">${formatPrice(was, currency)}</span> ` +
    `<span class="price-now">${formatPrice(price, currency)}</span>`;
}

/**
 * Whether a piece belongs to the Keepsake collection — our finest pieces,
 * ticked one by one on the add-product page. Keepsakes are gathered on
 * pages/keepsake-collection.html and still sit in the shop with everything
 * else; until any piece is ticked, that page stands as a "coming soon" note.
 */
function isKeepsake(product) {
  return product.keepsake === true;
}

/**
 * Get all products
 */
async function getAllProducts() {
  const products = await loadProducts();
  return products.filter(isPubliclyLive);
}

/**
 * Get featured products for homepage
 */
async function getFeaturedProducts() {
  const products = await loadProducts();
  return products.filter(product =>
    product.featured === true && isPubliclyLive(product)
  );
}

/**
 * Get product by slug
 */
async function getProductBySlug(slug) {
  const products = await loadProducts();
  return products.find(product => product.slug === slug);
}

/**
 * Get product by ID
 */
async function getProductById(id) {
  const products = await loadProducts();
  return products.find(product => product.id === id);
}

/**
 * Format price for display
 */
function formatPrice(price, currency = 'EUR') {
  const formatter = new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return formatter.format(price);
}

/**
 * Play product-card videos only while they're in view, pausing them
 * otherwise. Saves mobile data/CPU vs. autoplaying everything at once.
 * Call after rendering cards into `container`. Falls back to plain
 * autoplay if IntersectionObserver isn't available.
 */
let _videoObserver = null;
let _videoWarmObserver = null;
function lazyPlayVideos(container) {
  const scope = container || document;
  const videos = scope.querySelectorAll('video');
  if (!videos.length) return;

  if (!('IntersectionObserver' in window)) {
    videos.forEach(v => { v.muted = true; const p = v.play(); if (p) p.catch(() => {}); });
    return;
  }

  // Start buffering while a video is still ~600px below the fold, so that by
  // the time it scrolls into view playback can begin on its first frame
  // instead of dropping the poster and flashing an empty element while the
  // first bytes download.
  if (!_videoWarmObserver) {
    _videoWarmObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const v = entry.target;
        if (v.readyState === 0 && v.paused) {
          v.preload = 'auto';
          try { v.load(); } catch (e) { /* ignore */ }
        }
        _videoWarmObserver.unobserve(v);
      });
    }, { rootMargin: '600px 0px' });
  }

  if (!_videoObserver) {
    _videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        const v = entry.target;
        if (entry.isIntersecting) {
          v.muted = true;
          const p = v.play();
          if (p) p.catch(() => {});
        } else {
          v.pause();
        }
      });
    }, { threshold: 0.25 });
  }

  // Cards render the product photo as an overlay on top of the video
  // (.product-media > .media-poster). Fade it out only once the video is
  // actually presenting frames, so the photo-to-video handover is a soft
  // crossfade instead of the browser's hard poster swap.
  function fadePosterOnFirstFrame(v) {
    const wrap = v.closest('.product-media');
    const poster = wrap ? wrap.querySelector('.media-poster') : null;
    if (!poster || poster.classList.contains('is-hidden')) return;
    const hide = () => poster.classList.add('is-hidden');
    if (typeof v.requestVideoFrameCallback === 'function') {
      v.requestVideoFrameCallback(hide);
    } else {
      v.addEventListener('playing', hide, { once: true });
    }
  }

  videos.forEach(v => {
    v.muted = true;
    v.setAttribute('playsinline', '');
    fadePosterOnFirstFrame(v);
    _videoWarmObserver.observe(v);
    _videoObserver.observe(v);
  });
}

/**
 * Announce a running sale in a band above the header. Injected from here so
 * every page that loads this file gets it without twelve copies of the markup;
 * product pages do the same from product-page.js.
 */
function renderSaleBanner(sale) {
  if (!saleActive(sale) || document.querySelector('.sale-banner')) return;
  const banner = document.createElement('div');
  banner.className = 'sale-banner';
  const label = String(sale.label || 'Sale').trim();
  banner.innerHTML = `${label} — <strong>${Number(sale.percent)}% off</strong> everything`;
  document.body.insertBefore(banner, document.body.firstChild);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const showBanner = () => loadSale().then(renderSaleBanner).catch(() => {});
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', showBanner);
  } else {
    showBanner();
  }
}

// Export functions for use in other files
if (typeof window !== 'undefined') {
  window.lazyPlayVideos = lazyPlayVideos;
  window.ProductsAPI = {
    loadProducts,
    getAllProducts,
    getFeaturedProducts,
    getProductBySlug,
    getProductById,
    formatPrice,
    isPubliclyLive,
    isKeepsake,
    loadSale,
    saleActive,
    priceNow,
    priceMarkup,
    lazyPlayVideos
  };
}