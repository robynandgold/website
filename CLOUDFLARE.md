# Cloudflare Workers migration

This repo is hosted on **Cloudflare Workers (with Static Assets)** instead of
Vercel. One Worker serves the static site from `src/` and handles the three
`/api/*` endpoints. Config that used to live in `vercel.json` now lives in
`wrangler.toml`.

Your live Vercel deploy is untouched — Vercel only reads `api/` and
`vercel.json`, which are left in place for rollback.

## What's where
| Purpose | File |
|---|---|
| Worker entry / router | `worker/index.js` |
| Checkout endpoint | `worker/checkout.js` → `/api/create-checkout-session` |
| Stripe webhook | `worker/webhook.js` → `/api/webhook` |
| Admin login | `worker/admin-token.js` → `/api/admin-token` |
| Config (output + runtime) | `wrangler.toml` |

Same `/api/*` URLs as before, so no frontend changes were needed. Runtime
adaptations vs. the Vercel handlers: env from the Worker `env`, Stripe's fetch
HTTP client, async webhook verification via Web Crypto, `Response` objects.
`nodejs_compat` is enabled so the Stripe SDK, `node:crypto`, and `node:buffer`
work.

## Your steps

### 1. The Worker project (already created)
The "website" Worker in **Workers & Pages** builds from `main` with:
- **Build command:** *(blank)*
- **Deploy command:** `npx wrangler deploy`  ← the default; correct now that
  `wrangler.toml` exists.

Once this code is on `main`, **Retry deployment**. The build now finds a Worker
script (not just static assets), so the "variables" restriction goes away.

### 2. Add variables and secrets
Worker → **Settings → Variables and Secrets**. Add (mark the secret ones as
"Secret"):

- `STRIPE_SECRET_KEY` (secret)
- `STRIPE_WEBHOOK_SECRET` (secret — fresh value from step 4)
- `STRIPE_CURRENCY` (e.g. `eur`)
- `SITE_URL` (your real domain, no trailing slash)
- `GITHUB_TOKEN` (secret)
- `ADMIN_PASSWORD` (secret)

Redeploy after adding them.

### 3. Test on the *.workers.dev URL first
- Open the workers.dev URL, add a product to cart, hit checkout → you should
  reach Stripe Checkout. Use a Stripe **test** key + card `4242 4242 4242 4242`.
- Log into `/pages/add-product.html` with `ADMIN_PASSWORD` to confirm admin login.

### 4. Point Stripe at the new domain
1. Stripe Dashboard → Developers → Webhooks → endpoint
   `https://YOURDOMAIN/api/webhook`, event `checkout.session.completed`
2. Copy the new **Signing secret** into `STRIPE_WEBHOOK_SECRET`, redeploy.

### 5. Go live
1. Worker → **Settings → Domains & Routes** → add your custom domain (it's
   already in your Cloudflare account, so this is just a couple of taps).
2. Do one **real** low-value purchase end-to-end: checkout → payment → the
   webhook flips the item to sold (a "Mark products as sold" commit appears on
   `main`).
3. Once confirmed, you can remove the project from Vercel.

## Rollback
Nothing here deletes the Vercel setup. If anything misbehaves, point DNS back to
Vercel — the `api/` functions and `vercel.json` are still in the repo.

## Local dev
Test the Worker locally with `npx wrangler dev` (after `npm install`).
`npm run dev` still runs `vercel dev` if you prefer the old path.
