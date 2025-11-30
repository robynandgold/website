async function checkoutCart() {
  const cart = window.RGCart.getCart();
  if (!cart || cart.length === 0) {
    alert('Your cart is empty.');
    return;
  }

  try {
    const body = {
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, quantity: i.quantity, description: i.description })),
      successUrl: `${window.location.origin}/src/pages/success.html`,
      cancelUrl: `${window.location.origin}/src/pages/cart.html`
    };

    const resp = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if (data.url) {
      window.RGCart.clearCart();
      window.location.href = data.url;
    } else {
      throw new Error(data.error || 'No session URL returned');
    }
  } catch (err) {
    console.error('Checkout error', err);
    alert('Checkout failed: ' + (err.message || 'Unknown error'));
  }
}
window.checkoutCart = checkoutCart;