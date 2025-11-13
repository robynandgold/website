// Simple frontend: loads products.json, handles cart in localStorage, and calls /create-checkout-session
const PRODUCTS_URL = '/products.json';
let products = [];

async function loadProducts(){
  const res = await fetch(PRODUCTS_URL);
  products = await res.json();
  renderHomeFeatured();
  renderShop();
  renderProductDetail();
  renderCart();
}

// Render featured on index
function renderHomeFeatured(){
  const el = document.getElementById('featured-grid');
  if(!el) return;
  el.innerHTML = products.slice(0,3).map(p => `
    <div class="card">
      <a href="/product.html?id=${p.id}"><img src="${p.image}" alt="${p.name}"></a>
      <div class="muted">${p.name}</div>
      <div class="price">€${p.price.toFixed(2)}</div>
    </div>
  `).join('');
}

function renderShop(){
  const el = document.getElementById('product-grid');
  if(!el) return;
  el.innerHTML = products.map(p => `
    <div class="card">
      <a href="/product.html?id=${p.id}"><img src="${p.image}" alt="${p.name}"></a>
      <div class="muted">${p.name}</div>
      <div class="price">€${p.price.toFixed(2)}</div>
    </div>
  `).join('');
}

function renderProductDetail(){
  const el = document.getElementById('product-detail');
  if(!el) return;
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  const p = products.find(x=>x.id===id);
  if(!p){ el.innerHTML='<p>Product not found</p>'; return; }
  el.innerHTML = `
    <div>
      <img src="${p.image}" style="width:100%; max-height:520px; object-fit:cover; border-radius:6px">
    </div>
    <div>
      <h2>${p.name}</h2>
      <p class="muted">${p.description}</p>
      <div class="price">€${p.price.toFixed(2)}</div>
      <div style="margin-top:12px">
        <label>Quantity: <input id="qty" type="number" value="1" min="1" style="width:72px"></label>
      </div>
      <div style="margin-top:16px">
        <button id="add" class="btn">Add to Cart</button>
        <a class="btn" href="/cart.html" style="background:#333; margin-left:8px">View Cart</a>
      </div>
    </div>
  `;
  document.getElementById('add').addEventListener('click', ()=>{
    const qty = parseInt(document.getElementById('qty').value||'1',10);
    addToCart(p.id, qty);
    window.location.href = '/cart.html';
  });
}

// Cart functions
function getCart(){ return JSON.parse(localStorage.getItem('rg_cart')||'[]'); }
function setCart(c){ localStorage.setItem('rg_cart', JSON.stringify(c)); }
function addToCart(id, qty=1){
  const cart = getCart();
  const existing = cart.find(i=>i.id===id);
  if(existing){ existing.quantity += qty } else { cart.push({id, quantity: qty}) }
  setCart(cart);
}

function renderCart(){
  const el = document.getElementById('cart-contents');
  if(!el) return;
  const cart = getCart();
  if(cart.length===0){ el.innerHTML = '<p>Your cart is empty.</p>'; document.getElementById('cart-actions').innerHTML=''; return; }
  const rows = cart.map(item=>{
    const p = products.find(x=>x.id===item.id);
    return `<div class="card" style="display:flex; gap:12px; align-items:center">
      <img src="${p.image}" style="width:80px; height:80px; object-fit:cover">
      <div style="flex:1">
        <div class="muted">${p.name}</div>
        <div>€${p.price.toFixed(2)} × ${item.quantity}</div>
      </div>
      <div style="font-weight:600">€${(p.price*item.quantity).toFixed(2)}</div>
    </div>`;
  }).join('');
  el.innerHTML = rows;
  document.getElementById('cart-actions').innerHTML = '<button id="checkout" class="btn">Checkout</button>';
  document.getElementById('checkout').addEventListener('click', onCheckout);
}

async function onCheckout(){
  const cart = getCart();
  if(cart.length===0) return alert('Cart is empty');
  // build items
  const items = cart.map(ci => {
    const p = products.find(x=>x.id===ci.id);
    return { id: p.id, name: p.name, price: p.price, quantity: ci.quantity, image: p.image, sku: p.sku };
  });
  try {
    const res = await fetch('/create-checkout-session', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ items })
    });
    const data = await res.json();
    if(data.url){
      // redirect to Stripe Checkout
      window.location = data.url;
    } else {
      alert('Checkout failed');
      console.error(data);
    }
  } catch (err) {
    console.error(err);
    alert('Error creating checkout session');
  }
}

// Initialize
loadProducts();
