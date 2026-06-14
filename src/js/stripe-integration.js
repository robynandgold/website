/**
 * STRIPE-INTEGRATION.JS - Stripe Checkout Integration
 * ====================================================
 * 
 * Handles creating Stripe Checkout sessions via our serverless function
 * Environment variables needed (set in Vercel):
 * - STRIPE_SECRET_KEY
 * - STRIPE_CURRENCY (default: gbp)
 * - SITE_URL
 */

/**
 * Create Stripe Checkout session and redirect
 */
async function initiateCheckout() {
  // Get cart items
  const cartItems = window.CartAPI.formatCartForCheckout();
  
  if (!cartItems || cartItems.length === 0) {
    showError('Your cart is empty');
    return;
  }

  // Track checkout intent (cart abandonment funnel: Add to cart → Begin checkout → Purchase)
  trackEvent(
    'Begin checkout',
    { items: cartItems.length },
    { currency: window.CartAPI.getCartCurrency(), amount: window.CartAPI.getCartTotal() }
  );

  // Show loading state
  const checkoutButton = document.getElementById('checkout-button');
  if (checkoutButton) {
    checkoutButton.disabled = true;
    checkoutButton.textContent = 'Processing...';
  }

  try {
    // Call our serverless function to create Stripe Checkout session
    const response = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        items: cartItems,
        successUrl: `${window.location.origin}/pages/success.html`,
        cancelUrl: `${window.location.origin}/pages/cart.html`
      })
    });

    // An item sold out between adding to cart and checkout
    if (response.status === 409) {
      const data = await response.json().catch(() => ({}));
      const unavailable = data.unavailable || [];
      unavailable.forEach(u => { if (u.id) window.CartAPI.removeFromCart(u.id); });

      const names = unavailable.map(u => u.name).filter(Boolean).join(', ');
      const plural = unavailable.length > 1;
      showError(
        names
          ? `Sorry — ${names} ${plural ? 'are' : 'is'} no longer available and ${plural ? 'have' : 'has'} been removed from your cart.`
          : 'Sorry — one or more items in your cart are no longer available.'
      );

      if (checkoutButton) {
        checkoutButton.disabled = false;
        checkoutButton.textContent = 'Proceed to secure checkout';
      }

      // Refresh so the cart view reflects the removed item(s)
      setTimeout(() => window.location.reload(), 2500);
      return;
    }

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create checkout session');
    }

    const data = await response.json();

    if (data.url) {
      // Redirect to Stripe Checkout
      window.location.href = data.url;
    } else {
      throw new Error('No checkout URL returned');
    }

  } catch (error) {
    console.error('Checkout error:', error);
    showError(`Checkout failed: ${error.message}`);
    
    // Reset button state
    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = 'Proceed to secure checkout';
    }
  }
}

/**
 * Display error message to user
 */
function showError(message) {
  // Try to find existing error container
  let errorContainer = document.querySelector('.error-message');
  
  if (!errorContainer) {
    // Create error container if it doesn't exist
    errorContainer = document.createElement('div');
    errorContainer.className = 'error-message';
    
    const cartSummary = document.querySelector('.cart-summary');
    if (cartSummary) {
      cartSummary.insertBefore(errorContainer, cartSummary.firstChild);
    }
  }
  
  errorContainer.textContent = message;
  errorContainer.style.display = 'block';
  
  // Auto-hide after 5 seconds
  setTimeout(() => {
    errorContainer.style.display = 'none';
  }, 5000);
}

// Export for use in cart.html
if (typeof window !== 'undefined') {
  window.StripeCheckout = {
    initiateCheckout,
    showError
  };
}