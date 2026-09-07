/**
 * PRODUCT-PAGE.JS — interactivity for pre-rendered product pages
 * ================================================================
 *
 * Each product page (src/pages/product/<slug>.html) is generated as static
 * HTML by scripts/build.js, with all SEO (title, meta, Open Graph, JSON-LD)
 * and the visible product content baked into the markup. That means search
 * engines and AI crawlers — which often don't run JavaScript — see the full
 * page immediately.
 *
 * This script only *rehydrates* the already-rendered page: it wires up the
 * image/video carousel, the add-to-cart buttons and the "you might also
 * like" row. The product's own data is embedded in the page as JSON
 * (#product-data), so no fetch is needed to render the page itself.
 */
(function () {
  const dataEl = document.getElementById('product-data');
  if (!dataEl) return;

  let currentProduct;
  try {
    currentProduct = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  // A `?vip=<token>` link grants early access: it lets this one scheduled piece
  // be bought before its public drop. The token is carried into the cart and
  // re-verified server-side at checkout, so a bogus value just fails there.
  const vipParam = new URLSearchParams(window.location.search).get('vip') || '';
  if (vipParam) currentProduct.vipToken = vipParam;
  const hasEarlyAccess = !!vipParam;

  function formatPrice(price, currency = 'EUR') {
    const symbol = currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : '$';
    return `${symbol}${Number(price).toFixed(2)}`;
  }

  // A piece scheduled as a drop is not yet purchasable — its drop time is
  // still in the future. dropAt is a UTC instant, so this comparison is
  // timezone-proof; only the displayed wall-clock is Irish.
  function isScheduled(product) {
    if (!product || !product.dropAt) return false;
    const t = Date.parse(product.dropAt);
    return !isNaN(t) && t > Date.now();
  }

  function formatDropTime(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-GB', {
      timeZone: 'Europe/Dublin', weekday: 'short', day: 'numeric', month: 'long',
      hour: '2-digit', minute: '2-digit'
    }) + ' Irish time';
  }

  // Insert an "early access" note above the buy button for a VIP visitor
  // reaching a scheduled piece before its public drop.
  function markEarlyAccess() {
    const btn = document.getElementById('add-to-cart-btn');
    if (!btn) return;
    const note = document.createElement('p');
    note.className = 'product-detail-oneoff';
    note.style.marginTop = '1.5rem';
    note.style.marginBottom = '0';
    note.textContent = `✦ Early access — yours before the ${formatDropTime(currentProduct.dropAt)} drop`;
    btn.parentNode.insertBefore(note, btn);
  }

  // If this piece hasn't dropped yet, replace the buy controls with a
  // "coming soon" note so it can't be added to the cart before its time —
  // unless the visitor arrived with a valid early-access (VIP) link.
  function applyDropGate() {
    if (!isScheduled(currentProduct)) return false;
    if (hasEarlyAccess) { markEarlyAccess(); return false; }
    const label = `Available ${formatDropTime(currentProduct.dropAt)}`;

    const btn = document.getElementById('add-to-cart-btn');
    if (btn) {
      const note = document.createElement('p');
      note.className = 'product-detail-oneoff';
      note.style.marginTop = '1.5rem';
      note.textContent = '✦ ' + label;
      btn.replaceWith(note);
    }
    const message = document.getElementById('cart-message');
    if (message) message.style.display = 'none';

    return true;
  }

  // ---- Carousel (images + videos) ---------------------------------------
  let currentSlideIndex = 0;
  function setupCarousel() {
    const track = document.getElementById('carousel-track');
    if (!track) return;
    const slides = Array.from(track.querySelectorAll('.carousel-slide'));
    if (slides.length === 0) return;

    // Keep the visible slide's video looping. Mobile browsers pause off-screen
    // videos as you scroll; resume the active video whenever the carousel is
    // back in view so it just loops (only the arrows/dots change the slide).
    if ('IntersectionObserver' in window) {
      const keepPlaying = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          const slide = slides[currentSlideIndex];
          const v = slide && slide.querySelector('video');
          if (v) { const p = v.play(); if (p) p.catch(() => {}); }
        });
      }, { threshold: 0.15 });
      keepPlaying.observe(track);
    }

    if (slides.length <= 1) return;

    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dotBtns = Array.from(document.querySelectorAll('#carousel-dots .carousel-dot'));
    let isAnimating = false;
    const ANIM_MS = 280;

    function updateActive(nextIndex, direction) {
      const prevIndex = currentSlideIndex;
      currentSlideIndex = nextIndex;

      slides.forEach(s => s.classList.remove('active', 'enter-left', 'enter-right', 'exit-left', 'exit-right'));
      dotBtns.forEach((d, i) => d.classList.toggle('active', i === nextIndex));

      const prevSlide = slides[prevIndex];
      const nextSlide = slides[nextIndex];

      const outVideo = prevSlide && prevSlide.querySelector('video');
      if (outVideo) outVideo.pause();

      if (prevSlide && nextSlide) {
        prevSlide.classList.add(direction === 'next' ? 'exit-left' : 'exit-right');
        nextSlide.classList.add(direction === 'next' ? 'enter-right' : 'enter-left');
      }
      if (nextSlide) {
        nextSlide.classList.add('active');
        const inVideo = nextSlide.querySelector('video');
        if (inVideo) inVideo.play();
      }
    }

    function goTo(index, directionHint) {
      if (isAnimating) return;
      isAnimating = true;
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;

      let nextIndex = (index + slides.length) % slides.length;
      const direction = directionHint || (nextIndex > currentSlideIndex ? 'next' : 'prev');

      updateActive(nextIndex, direction);
      setTimeout(() => {
        isAnimating = false;
        if (prevBtn) prevBtn.disabled = false;
        if (nextBtn) nextBtn.disabled = false;
        slides.forEach(s => s.classList.remove('enter-left', 'enter-right', 'exit-left', 'exit-right'));
      }, ANIM_MS);
    }

    if (prevBtn) prevBtn.addEventListener('click', () => goTo(currentSlideIndex - 1, 'prev'));
    if (nextBtn) nextBtn.addEventListener('click', () => goTo(currentSlideIndex + 1, 'next'));
    dotBtns.forEach(d => d.addEventListener('click', () => goTo(parseInt(d.dataset.index))));

    let startX = 0;
    track.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
    track.addEventListener('touchend', (e) => {
      const delta = e.changedTouches[0].clientX - startX;
      if (Math.abs(delta) > 30) goTo(currentSlideIndex + (delta > 0 ? -1 : 1));
    });

    track.setAttribute('tabindex', '0');
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(currentSlideIndex - 1, 'prev'); }
      if (e.key === 'ArrowRight') { e.preventDefault(); goTo(currentSlideIndex + 1, 'next'); }
    });
  }

  // ---- Add to cart ------------------------------------------------------
  function setupAddToCart() {
    if (isScheduled(currentProduct) && !hasEarlyAccess) return;
    const btn = document.getElementById('add-to-cart-btn');
    const message = document.getElementById('cart-message');
    if (!btn || !window.CartAPI) return;

    btn.addEventListener('click', () => {
      const result = window.CartAPI.addToCart(currentProduct);
      if (message) {
        message.textContent = result.message;
        message.style.display = 'block';
        message.style.color = result.success ? 'var(--accent)' : 'var(--muted)';
      }
      if (result.success) {
        btn.textContent = 'Go to checkout';
        btn.onclick = () => window.location.href = '../cart.html';
      }
    });
  }

  function setupStickyBar() {
    if (isScheduled(currentProduct) && !hasEarlyAccess) return;
    const bar = document.getElementById('product-sticky-bar');
    if (!bar) return;
    const addBtn = document.getElementById('psb-add-btn');
    if (addBtn && window.CartAPI) {
      addBtn.onclick = () => {
        const result = window.CartAPI.addToCart(currentProduct);
        if (result.success) {
          window.location.href = '../cart.html';
        } else {
          addBtn.textContent = 'In your bag — view';
          addBtn.onclick = () => window.location.href = '../cart.html';
        }
      };
    }
    bar.hidden = false;
  }

  // ---- "You might also like" -------------------------------------------
  async function renderRelated() {
    const section = document.getElementById('related-section');
    const grid = document.getElementById('related-grid');
    if (!section || !grid) return;

    let products = [];
    try {
      const res = await fetch('/data/products.json');
      if (res.ok) products = await res.json();
    } catch (e) { return; }

    // Same category first, then anything else live. Mirrors relatedTo() in
    // scripts/build.js so this matches the links already in the markup.
    const pool = products
      .filter(p => p.slug !== currentProduct.slug && p.available !== false && !isScheduled(p));
    const others = [
      ...pool.filter(p => p.category === currentProduct.category),
      ...pool.filter(p => p.category !== currentProduct.category)
    ].slice(0, 3);

    if (others.length === 0) { section.hidden = true; return; }

    grid.innerHTML = others.map(product => {
      const price = formatPrice(product.price, product.currency);
      const video = product.videos && product.videos[0];
      const image = product.images && product.images[0];
      const media = video
        ? `<video src="${video}" class="product-card-image" muted loop playsinline preload="none" ${image ? `poster="${image}"` : ''}></video>`
        : image
          ? `<img src="${image}" alt="${product.name}" class="product-card-image" width="600" height="600" loading="lazy" onerror="this.style.display='none'" />`
          : '';
      return `
        <article class="product-card">
          <a class="product-card-link-wrap" href="${product.slug}.html">
            ${media}
            <div class="product-card-body">
              <h3 class="product-card-title">${product.name}</h3>
              <p class="product-card-price">${price}</p>
              <span class="product-card-link">View details</span>
            </div>
          </a>
        </article>`;
    }).join('');

    grid.querySelectorAll('video').forEach(v => {
      v.muted = true;
      const p = v.play();
      if (p) p.catch(() => {});
    });

    section.hidden = false;
  }

  // Fire-and-forget first-party view ping (no cookies, no personal data) that
  // powers the admin "Most viewed" tab. No-ops server-side until the views
  // database is set up.
  function recordView() {
    try {
      const slug = currentProduct && currentProduct.slug;
      if (!slug) return;
      const body = JSON.stringify({ slug });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/view', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/view', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    } catch (e) { /* analytics must never break the page */ }
  }

  // ---- Sale ---------------------------------------------------------------
  // The page is generated with the full price baked in, because a sale starts
  // and ends on a clock rather than at build time. When one is running we
  // rewrite the visible prices here — and the JSON-LD offer with them, so a
  // crawler that runs JavaScript doesn't see a price that disagrees with the
  // page. checkout.js applies the same reduction to what Stripe charges.
  async function applySale() {
    let sale;
    try {
      const res = await fetch('/data/sale.json', { cache: 'no-store' });
      sale = res.ok ? await res.json() : null;
    } catch (e) { return; }
    if (!sale) return;

    const percent = Number(sale.percent);
    if (!isFinite(percent) || percent <= 0 || percent >= 100) return;
    const now = Date.now();
    if (sale.startsAt && !isNaN(Date.parse(sale.startsAt)) && Date.parse(sale.startsAt) > now) return;
    if (sale.endsAt && !isNaN(Date.parse(sale.endsAt)) && Date.parse(sale.endsAt) <= now) return;

    const full = Number(currentProduct.price) || 0;
    const reduced = Math.round(full * (1 - percent / 100));
    if (!(reduced < full)) return;

    const currency = currentProduct.currency || 'EUR';
    const was = `<span class="price-was">${formatPrice(full, currency)}</span>`;
    const nowMarkup = `<span class="price-now">${formatPrice(reduced, currency)}</span>`;

    const priceEl = document.querySelector('.product-detail-price');
    if (priceEl) priceEl.innerHTML = `${was} ${nowMarkup}`;
    const psbPrice = document.getElementById('psb-price');
    if (psbPrice) psbPrice.innerHTML = nowMarkup;

    // Keep the piece's own data in step, so anything added to the cart from
    // this page carries the sale price rather than the printed one.
    currentProduct.price = reduced;
    currentProduct.fullPrice = full;

    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        const ld = JSON.parse(el.textContent);
        if (ld && ld['@type'] === 'Product' && ld.offers) {
          ld.offers.price = reduced;
          el.textContent = JSON.stringify(ld);
        }
      } catch (e) { /* leave malformed blocks alone */ }
    });

    if (!document.querySelector('.sale-banner')) {
      const banner = document.createElement('div');
      banner.className = 'sale-banner';
      banner.innerHTML = `${String(sale.label || 'Sale').trim()} — <strong>${percent}% off</strong> everything`;
      document.body.insertBefore(banner, document.body.firstChild);
    }
  }

  function init() {
    const yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    setupCarousel();
    applyDropGate();
    // Prices are adjusted before the cart buttons are wired, so a piece added
    // to the basket carries the sale price from the first click.
    applySale().finally(() => {
      setupAddToCart();
      setupStickyBar();
    });
    renderRelated();
    recordView();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
