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
    return cachedProducts;
  }
  
  try {
    console.log('Fetching products from /data/products.json');
    const response = await fetch('/data/products.json');
    console.log('Fetch response:', response.status, response.ok);
    if (!response.ok) {
      throw new Error(`Failed to load products: ${response.status}`);
    }
    cachedProducts = await response.json();
    console.log('Products loaded:', cachedProducts);
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
  // Filter to only show available products
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