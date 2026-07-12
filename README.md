# Robyn & Gold - Antique Jewellery

An elegant ecommerce site for antique rings and jewellery, featuring a minimalist "old money" aesthetic with parchment backgrounds, gold accents, and refined typography.

**Live Site:** https://robynandgold.com

## Architecture

Full tech-stack documentation, diagrams and data flows: **`ARCHITECTURE.md`**.

- **Platform**: Cloudflare Workers with Static Assets (see `CLOUDFLARE.md` for the full hosting guide)
- **Backend**: One Worker (`worker/index.js`) handles the `/api/*` endpoints
- **Frontend**: Static HTML/CSS/JavaScript served from `src/`
- **Payments**: Stripe Checkout
- **Data**: JSON-based product catalog (`/src/data/products.json`)

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set Environment Variables

**For Local Development:**

1. Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

2. Edit `.env` and add your Stripe secret key:
```env
STRIPE_SECRET_KEY=sk_test_your_actual_stripe_secret_key
STRIPE_CURRENCY=eur
SITE_URL=http://localhost:8787
```

**For Production (Cloudflare):**

Set variables on the Worker: Cloudflare Dashboard → **Workers & Pages** →
**website** → **Settings** → **Variables and Secrets**. The full list is in
`CLOUDFLARE.md`.

**Important:**
- Never commit `.env` to git (it's in `.gitignore`)
- Use `sk_test_` keys for testing, `sk_live_` for production
- Get your keys from https://dashboard.stripe.com/apikeys

### 3. Run Locally

```bash
npm run dev
```

This starts `wrangler dev` (the Worker + static site) at `http://localhost:8787`.

### 4. Deploy

Push to `main` — Cloudflare builds and deploys automatically. If Cloudflare's
build service is having a bad day, run the **"Deploy to Cloudflare (failsafe)"**
workflow from the repo's GitHub Actions tab.

---

## Managing Products

### The easy way: the admin page

Open `https://robynandgold.com/pages/add-product.html`, log in with the admin
password, and fill in the form. Images upload directly; iPhone videos are
staged and automatically converted to compressed web-friendly `.mp4` about a
minute after you publish. Product pages and the sitemap regenerate
automatically, and the site redeploys itself.

### The manual way: edit the JSON

All products are stored in **`/src/data/products.json`**. This is the
**single source of truth** for the inventory.

```json
{
  "id": "unique-product-id",
  "name": "Victorian Ruby Ring",
  "slug": "victorian-ruby-ring",
  "description": "A charming Victorian cluster ring...",
  "size": "UK M / US 6.25",
  "price": 3200,
  "currency": "EUR",
  "featured": false,
  "category": "rings",
  "available": true,
  "images": ["/images/products/victorian-ruby-ring-1.jpg"],
  "videos": ["/images/products/victorian-ruby-ring-1.mp4"],
  "createdAt": "2026-01-01T12:00:00+01:00"
}
```

- Images live in `/src/images/products/` (the pipeline shrinks oversized ones)
- Raw videos go in `/incoming/` — the GitHub Action converts them into
  `/src/images/products/<name>.mp4`
- Commit and push to `main`; the site rebuilds and deploys itself

### Marking a product as SOLD

**Automatic (recommended):** when a customer completes payment, the Stripe
webhook marks the product as sold and commits the change — no action needed.

**Manual:** set `"available": false` on the product in `products.json`, then
commit and push. The product will:
- ✅ Disappear from the shop page
- ✅ Show "SOLD" if accessed directly
- ✅ Prevent adding to cart
- ✅ Keep the data for your records

### Featuring a product on the homepage

Set `"featured": true`. The homepage displays the first 3 featured products.

---

## Stripe

- **Keys**: Dashboard → Developers → API keys. Set `STRIPE_SECRET_KEY` on the
  Worker (see `CLOUDFLARE.md`).
- **Webhook**: Dashboard → Developers → Webhooks → endpoint
  `https://robynandgold.com/api/webhook`, events `checkout.session.completed`
  (marks items sold + sends the order confirmation) and
  `checkout.session.expired` (sends the abandoned-checkout recovery email).
  Put the signing secret in the Worker's `STRIPE_WEBHOOK_SECRET`.
- **Payment methods** (cards, Apple Pay, Google Pay, Klarna, …) are managed in
  Dashboard → Settings → Payment methods; the checkout offers whatever is
  enabled there.

### Test cards (test mode only)

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Card declined |
| `4000 0025 0000 3155` | Requires authentication |

- **Expiry:** any future date · **CVC:** any 3 digits · **ZIP:** any 5 digits

---

## Project Structure

```
robynandgold/
├── worker/
│   ├── index.js                    # Worker entry / router
│   ├── checkout.js                 # Stripe Checkout endpoint
│   ├── webhook.js                  # Stripe webhook (marks items sold)
│   └── admin-token.js              # Admin login for the publish page
├── incoming/                       # Staged raw videos (converted by CI)
├── scripts/
│   ├── build.js                    # Generates product pages + sitemap
│   └── optimize-media.sh           # One-off media optimizer
├── .github/workflows/
│   ├── convert-videos.yml          # Publish pipeline (convert, shrink, build)
│   └── deploy.yml                  # Manual failsafe deploy
├── src/
│   ├── index.html                  # Homepage
│   ├── css/styles.css              # All styles
│   ├── js/                         # Cart, products, Stripe integration
│   ├── data/products.json          # Product catalog ← SOURCE OF TRUTH
│   ├── pages/                      # Shop, cart, policies, admin, product pages
│   └── images/products/            # Product photos & converted videos
├── wrangler.toml                   # Cloudflare Worker config
├── CLOUDFLARE.md                   # Hosting & operations guide
└── README.md                       # This file
```

---

## Troubleshooting

### Products not displaying
- Check `/src/data/products.json` for syntax errors (missing commas, brackets)
- Verify image paths in products.json match actual files (case-sensitive)
- Open the browser console (F12) for JavaScript errors

### Publish fails with "Bad credentials"
The Worker's `GITHUB_TOKEN` secret is invalid, revoked, or the wrong type.
Generate a new **classic** token with the `repo` scope (fine-grained tokens
pass basic checks but fail the large-file API used for video uploads),
update the secret on the Worker, then log in to the admin page again.

### A new product isn't appearing on the live site
Give the pipeline 2–3 minutes (convert → build → deploy). Then check the
repo's Actions tab and the Worker's build list for a failed run.

### Cart not working
- localStorage must be enabled (not in some private-browsing modes)
- Check the console for JavaScript errors

---

## Support Resources

- **Stripe Documentation:** https://stripe.com/docs
- **Cloudflare Workers Documentation:** https://developers.cloudflare.com/workers/
- **Stripe Support:** https://support.stripe.com

---

## License

© 2026 Robyn & Gold. All rights reserved.
