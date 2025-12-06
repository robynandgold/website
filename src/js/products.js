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
  if (cachedProducts) {
    console.log('Products.js: Returning cached products:', cachedProducts.length);
    return cachedProducts;
  }
  
  try {
    // Determine the correct path based on current location
    const isInPagesDir = window.location.pathname.includes('/pages/');
    const dataPath = isInPagesDir ? '../data/products.json' : 'data/products.json';
    
    console.log('Products.js: Current location:', window.location.pathname);
    console.log('Products.js: Is in pages dir:', isInPagesDir);
    console.log('Products.js: Fetching from path:', dataPath);
    
    const response = await fetch(dataPath);
    console.log('Products.js: Fetch response status:', response.status, 'OK:', response.ok);
    
    if (!response.ok) {
      throw new Error(`Failed to load products: ${response.status} ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log('Products.js: Response text length:', text.length);
    console.log('Products.js: Response text preview:', text.substring(0, 200));
    
    cachedProducts = JSON.parse(text);
    console.log('Products.js: Parsed products successfully:', cachedProducts.length, 'products');
    console.log('Products.js: First product:', cachedProducts[0]);
    
    return cachedProducts;
  } catch (error) {
    console.error('Products.js: Error loading products:', error);
    console.error('Products.js: Error details:', error.message, error.stack);
    return [];
  }
}

/**
 * Get all products
 */
async function getAllProducts() {
  console.log('Products.js: getAllProducts() called');
  const products = await loadProducts();
  console.log('Products.js: loadProducts() returned:', products.length, 'products');
  
  // Filter to only show available products
  const availableProducts = products.filter(product => product.available !== false);
  console.log('Products.js: After filtering for available:', availableProducts.length, 'products');
  console.log('Products.js: Available products:', availableProducts.map(p => `${p.name} (available: ${p.available})`));
  
  return availableProducts;
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
  console.log('Products.js: getProductBySlug() called with slug:', slug);
  const products = await loadProducts();
  console.log('Products.js: Searching through', products.length, 'products for slug:', slug);
  
  const product = products.find(product => product.slug === slug);
  console.log('Products.js: Found product:', product ? product.name : 'null');
  
  return product;
}

/**
 * Get product by ID
 */
async function getProductById(id) {
  const products = await loadProducts();
  return products.find(product => product.id === id);
}

/**
 * Filter products by period
 */
async function filterByPeriod(period) {
  const products = await loadProducts();
  if (!period || period === 'all') {
    return products;
  }
  return products.filter(product => 
    product.period.toLowerCase() === period.toLowerCase()
  );
}

/**
 * Filter products by style
 */
async function filterByStyle(style) {
  const products = await loadProducts();
  if (!style || style === 'all') {
    return products;
  }
  return products.filter(product => 
    product.style.toLowerCase() === style.toLowerCase()
  );
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
 * Get unique periods from all products
 */
async function getAllPeriods() {
  const products = await loadProducts();
  const periods = [...new Set(products.map(p => p.period))];
  return periods.sort();
}

/**
 * Get unique styles from all products
 */
async function getAllStyles() {
  const products = await loadProducts();
  const styles = [...new Set(products.map(p => p.style))];
  return styles.sort();
}

// Export functions for use in other files
if (typeof window !== 'undefined') {
  window.ProductsAPI = {
    loadProducts,
    getAllProducts,
    getFeaturedProducts,
    getProductBySlug,
    getProductById,
    filterByPeriod,
    filterByStyle,
    formatPrice,
    getAllPeriods,
    getAllStyles
  };
}