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
 * Get all products
 */
async function getAllProducts() {
  const products = await loadProducts();
  return products.filter(product => product.available !== false);
}

/**
 * Get featured products for homepage
 */
async function getFeaturedProducts() {
  const products = await loadProducts();
  return products.filter(product => 
    product.featured === true && product.available !== false
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
    lazyPlayVideos
  };
}