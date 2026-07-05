# Cloudflare Workers hosting

This site runs on **Cloudflare Workers (with Static Assets)**. One Worker
serves the static site from `src/` and handles the three `/api/*` endpoints.
Hosting config lives in `wrangler.toml`.

## What's where
| Purpose | File |
|---|---|
| Worker entry / router | `worker/index.js` |
| Checkout endpoint | `worker/checkout.js` → `/api/create-checkout-session` |
| Stripe webhook | `worker/webhook.js` → `/api/webhook` |
| Admin login | `worker/admin-token.js` → `/api/admin-token` |
| Config (assets + runtime) | `wrangler.toml` |

Runtime notes: env comes from the Worker `env`, Stripe uses its fetch HTTP
client, webhook verification is async via Web Crypto, handlers return
`Response` objects. `nodejs_compat` is enabled so the Stripe SDK,
`node:crypto`, and `node:buffer` work.

## How deploys happen

- **Normally:** every push to `main` triggers Cloudflare Workers Builds
  (Worker → Settings → Build), which runs `npx wrangler deploy`.
- **Failsafe:** if Cloudflare's build queue is delayed or stuck
  (check cloudflarestatus.com), run the **"Deploy to Cloudflare (failsafe)"**
  workflow from the GitHub Actions tab — it deploys the latest `main`
  directly. Afterwards, cancel any stale queued Cloudflare builds so they
  can't later overwrite it with an older commit.

## Variables and secrets

Worker → **Settings → Variables and Secrets** (mark the secret ones as
"Secret"):

- `STRIPE_SECRET_KEY` (secret)
- `STRIPE_WEBHOOK_SECRET` (secret)
- `STRIPE_CURRENCY` (e.g. `eur`)
- `SITE_URL` (the live domain, no trailing slash)
- `GITHUB_TOKEN` (secret — fine-grained token scoped to this repo with
  "Contents: Read and write"; used by the sold-marking webhook and handed to
  the admin publish page after password login)
- `ADMIN_PASSWORD` (secret)

The GitHub Actions failsafe additionally needs two **repository secrets**
(GitHub → Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`.

## Publishing pipeline

The admin page (`/pages/add-product.html`) commits images to
`src/images/products/` and stages raw videos in `incoming/` (outside the
deployed assets, so oversized phone files can't break a deploy). The
`convert-videos` GitHub Action then transcodes videos to web-friendly mp4,
shrinks oversized photos, regenerates the product pages and sitemap, and
pushes — which deploys the finished state.

## Rollback

Previous Worker versions are kept by Cloudflare: Worker → Deployments →
roll back to an earlier version. Code-level rollback is plain git
(`git revert`) — every deploy corresponds to a commit on `main`.

## Local dev

Test the Worker locally with `npm run dev` (wrangler dev) after
`npm install`.
