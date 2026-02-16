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