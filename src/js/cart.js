/**
 * CART.JS - Shopping Cart Management
 * ===================================
 * 
 * Manages shopping cart state using localStorage
 * Cart persists across page refreshes and browser sessions
 */

const CART_KEY = 'robyn_gold_cart';

/**
 * Get current cart items from localStorage
 */
function getCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (error) {
    console.error('Error reading cart:', error);
    return [];
  }
}

/**
 * Save cart to localStorage
 */
function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
    updateCartCount();
    dispatchCartUpdateEvent();
  } catch (error) {
    console.error('Error saving cart:', error);
  }
}

/**
 * Add product to cart
 */
function addToCart(product) {
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);
  
  if (existing) {
    // For antique jewelry, each item is unique, so we don't increment quantity
    // Instead, show a message that item is already in cart
    return { success: false, message: 'This item is already in your cart' };
  }
  
  cart.push({
    id: product.id,
    name: product.name,
    slug: product.slug,
    era: product.era,
    price: product.price,
    currency: product.currency || 'EUR',
    image: product.images[0], // First image for cart display
    quantity: 1 // Always 1 for unique antiques
  });
  
  saveCart(cart);
  return { success: true, message: 'Added to cart' };
}

/**
 * Remove product from cart
 */
function removeFromCart(productId) {
  const cart = getCart().filter(item => item.id !== productId);
  saveCart(cart);
}

/**
 * Clear entire cart
 */
function clearCart() {
  localStorage.removeItem(CART_KEY);
  updateCartCount();
  dispatchCartUpdateEvent();
}

/**
 * Get cart total
 */
function getCartTotal() {
  const cart = getCart();
  return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
}

/**
 * Get cart item count
 */
function getCartCount() {
  const cart = getCart();
  return cart.reduce((count, item) => count + item.quantity, 0);
}

/**
 * Update cart count badge in header
 */
function updateCartCount() {
  const countElement = document.querySelector('.cart-count');
  if (countElement) {
    const count = getCartCount();
    countElement.textContent = count;
    countElement.style.display = count > 0 ? 'inline-block' : 'none';
  }
}

/**
 * Dispatch custom event when cart changes
 */
function dispatchCartUpdateEvent() {
  const event = new CustomEvent('cartUpdated', {
    detail: { cart: getCart(), total: getCartTotal(), count: getCartCount() }
  });
  window.dispatchEvent(event);
}

/**
 * Format cart items for Stripe checkout
 */
function formatCartForCheckout() {
  const cart = getCart();
  return cart.map(item => ({
    id: item.id,
    name: item.name,
    description: item.era,
    price: item.price,
    quantity: item.quantity,
    currency: item.currency || 'EUR'
  }));
}

// Initialize cart count on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateCartCount);
} else {
  updateCartCount();
}

// Export cart API
if (typeof window !== 'undefined') {
  window.CartAPI = {
    getCart,
    saveCart,
    addToCart,
    removeFromCart,
    clearCart,
    getCartTotal,
    getCartCount,
    updateCartCount,
    formatCartForCheckout
  };
}