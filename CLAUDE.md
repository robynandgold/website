# Working on robynandgold.com

Static HTML/CSS/vanilla-JS shop served by one Cloudflare Worker. No framework,
no bundler, no test suite. The only generated files are the product pages and
the sitemap. `src/data/products.json` is the single source of truth for the
catalogue — every change to it is a commit.

Read `ARCHITECTURE.md` for how the system fits together, `README.md` for
day-to-day catalogue management, `CLOUDFLARE.md` for hosting operations. This
file covers only how to *work on* the repo.

## Branching & PRs

- **Never commit to `main`.** Work on a `claude/<topic>-<suffix>` branch and
  open a PR.
- If the PR for the working branch is already merged, don't stack new commits
  on it. Restart from the latest main, keeping the branch name:
  `git fetch origin main && git checkout -B <branch> origin/main`, then
  force-with-lease on push. Any PR opened after that is a new PR.
- Push with `git push -u origin <branch>`. Retry network failures with backoff.
- There is **no PR template** in this repo.
- Merges are **squash** merges.
- Only open a PR when asked. Pushing a branch can auto-create one — check with
  `list_pull_requests` before creating, or the API returns a 422.
- Merging is what deploys to the live shop. Confirm before merging unless
  already told to.

## Build

```bash
node scripts/build.js     # or: npm run build
```

Regenerates every `src/pages/product/<slug>.html` and `src/sitemap.xml` from
`products.json`. Run it after changing `scripts/build.js` or `products.json`,
and commit the output — the generated pages are tracked.

Expect noise in the diff: `priceValidUntil` is stamped as today + 1 year, so
all 57 product pages change on any run. That's normal, and the
`convert-videos` Action does the same after each publish.

Nothing else builds. CSS and page HTML are edited directly.

## Deploy

- Every push to `main` triggers **Cloudflare Workers Builds**
  (`npx wrangler deploy`). Live in ~2–3 minutes.
- Failsafe: the **Deploy to Cloudflare (failsafe)** Action, run by hand, for
  when Cloudflare's build queue is stuck.
- `convert-videos.yml` only fires on pushes touching `incoming/**`,
  `src/images/products/**` or `src/data/products.json` — it transcodes video,
  shrinks photos, reruns the build, and pushes an auto-build commit.
- Rollback: Cloudflare keeps prior Worker versions; code rollback is
  `git revert`.

## Cloudflare configuration — the one rule that bites

**Bindings belong in `wrangler.toml`, never only in the dashboard.** Every
deploy pushes that whole file, so a dashboard-added binding is silently
stripped at the next publish.

This has already happened once: the D1 views database was bound in the
dashboard on 13 Aug 2026 and wiped ~7 minutes later by the next auto-build.
The admin "Most viewed" tab kept showing its Umami baseline, so nothing looked
broken for six days. `[[d1_databases]]` is now in `wrangler.toml` (`DB` →
`robynandgold-views`).

**Secrets are the opposite** — `STRIPE_SECRET_KEY`, `GITHUB_TOKEN`,
`ADMIN_PASSWORD`, `RESEND_API_KEY`, `VIP_SECRET` etc. live in the dashboard
only, survive deploys, and must never be committed. Database IDs are not
secrets and are fine in config.

## Site-wide edits

The pages are hand-written and repetitive. A change to the header or footer
must be applied in **all** of these, or pages will disagree:

- `src/index.html`
- `src/pages/*.html` (shop, keepsake-collection, archive, about, care, cart,
  contact, faq, returns, terms, success, add-product)
- the template inside `scripts/build.js` — then rebuild for the product pages

Nav hrefs are relative and differ per file (`shop.html` vs `pages/shop.html` vs
`../shop.html`) — match the neighbouring links rather than pasting one form
everywhere. `add-product.html` intentionally carries a shorter nav.

The single `.nav-left` element is the desktop menu row *and* the mobile
hamburger panel, so one link addition covers both. The desktop header is
stacked (brand above a centred link row, cart absolute right) specifically so
the logo stays centred as links are added.

## products.json

Fields: `id`, `name`, `slug`, `description`, `size`, `price`, `currency`,
`featured`, `category`, `available`, `createdAt`, `images`, `videos`, plus
optional `soldAt`, `dropAt`, `keepsake`.

- `available: false` → sold. Page stays live showing SOLD, appears in Archive.
- `featured: true` → homepage, capped at 3 (enforced in the admin page).
- `dropAt` → ISO UTC instant; hidden everywhere until it passes.
- `keepsake: true` → also listed on the Keepsake collection page; the piece
  still appears in the shop. The page shows a "coming soon" dictionary card
  while no live keepsake exists and swaps itself for the grid when one does,
  so launching it needs no code change.

Writes come from three places — the admin page, the Stripe webhook (marking
sold), and hand edits. Keep the shape identical across all three.

## Local preview

```bash
npm start                 # npx serve src -l 3000
npx wrangler dev          # only when working on worker/ endpoints
```

Chromium for screenshots is at `/opt/pw-browsers` with Playwright installed
globally (`/opt/node22/lib/node_modules/playwright`) — never run
`playwright install`.

The dev sandbox **cannot reach robynandgold.com** (network policy returns 403
via the proxy), so a deploy can't be verified from here. Check the Cloudflare
dashboard or ask, rather than claiming a deploy is live.

## Gotchas

- Client-side JS is duplicated between pages by design (each page has its own
  inline loader with a `ProductsAPI` fallback). Follow the local pattern rather
  than centralising.
- `src/js/products.js` has no trailing newline; leave it alone.
- `src/pages/product-detail.html` is not a page — it's a `noindex` redirect
  shim forwarding old `product-detail.html?slug=…` links to the generated
  pages. It has no header or footer, so skip it on site-wide edits, and don't
  delete it: bookmarked and shared links still land there.
- Payment Links sold in DMs bypass the webhook: no auto-sold, no confirmation
  email. Untick availability by hand after one.
- Carts don't reserve stock; checkout sessions expire after 35 minutes.
