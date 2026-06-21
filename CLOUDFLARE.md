# Cloudflare Pages migration

This repo is ready to host on **Cloudflare Pages** instead of Vercel. The static
site stays in `src/`; the three API endpoints have been ported from Vercel
functions (`api/`) to **Pages Functions** (`functions/api/`). Config that used to
live in `vercel.json` now lives in `wrangler.toml`.

Your live Vercel deploy is untouched — do all of this on the side and only flip
DNS once a test purchase works.

## What changed in the code
| Vercel | Cloudflare |
|---|---|
| `api/create-checkout-session.js` | `functions/api/create-checkout-session.js` |
| `api/webhook.js` | `functions/api/webhook.js` |
| `api/admin-token.js` | `functions/api/admin-token.js` |
| `vercel.json` | `wrangler.toml` |

Same URLs (`/api/create-checkout-session`, `/api/webhook`, `/api/admin-token`),
so no frontend changes were needed. Differences under the hood: env vars read
from the request context, Stripe uses its fetch HTTP client, and the webhook
verifies signatures with the async (Web Crypto) verifier. `nodejs_compat` is
enabled in `wrangler.toml` so the Stripe SDK, `node:crypto`, and `node:buffer`
work.

## Your steps (~30 min, mostly waiting on DNS)

### 1. Create the Pages project
1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**
2. Pick `robynandgold/website`, production branch **`main`**
3. Build settings:
   - Framework preset: **None**
   - Build command: *(blank)*
   - Build output directory: **`src`** (also set in `wrangler.toml`)

### 2. Add environment variables
Pages project → **Settings → Environment variables → Production**. Copy these
from your Vercel project (Settings → Environment Variables):

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`  ← you'll get a fresh value in step 4
- `STRIPE_CURRENCY` (e.g. `eur`)
- `SITE_URL` (set to your real domain, no trailing slash)
- `GITHUB_TOKEN`
- `ADMIN_PASSWORD`

Re-deploy after adding them (Deployments → Retry deployment) so they take effect.

### 3. Test on the *.pages.dev URL first
- Load the site, open a product, add to cart, hit checkout → you should reach
  Stripe Checkout. Use a Stripe **test** key + test card `4242 4242 4242 4242`.
- Log into `/pages/add-product.html` with `ADMIN_PASSWORD` to confirm
  admin-token works.

### 4. Point Stripe at the new domain
1. Stripe Dashboard → Developers → Webhooks → add/edit endpoint:
   `https://YOURDOMAIN/api/webhook`, event `checkout.session.completed`
2. Copy the new **Signing secret** into the `STRIPE_WEBHOOK_SECRET` env var, redeploy.

### 5. Go live
1. Pages → **Custom domains** → add your domain; Cloudflare walks you through DNS.
2. Do one **real** low-value purchase end-to-end: checkout → payment → the
   webhook should flip the item to sold (a "Mark products as sold" commit
   appears on `main`).
3. Once confirmed, you can remove the project from Vercel.

## Rollback
Nothing here deletes the Vercel setup. If anything misbehaves, point DNS back to
Vercel — the `api/` functions and `vercel.json` are still in the repo.

## Note on local dev
`npm run dev` still uses `vercel dev`. To test the Cloudflare functions locally
instead: `npx wrangler pages dev src` (after `npm install`).
