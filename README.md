# Robyn & Gold - Antique Jewellery

An elegant ecommerce site for antique rings and jewellery, featuring a minimalist "old money" aesthetic with parchment backgrounds, gold accents, and refined typography.

**Live Site:** https://robynandgold.com

## Architecture

- **Platform**: Vercel
- **Backend**: Serverless functions (`@vercel/node`)
- **Frontend**: Static HTML/CSS/JavaScript (`@vercel/static`)
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
SITE_URL=http://localhost:3000
```

**For Production (Vercel):**

Set environment variables in Vercel Dashboard:
1. Go to your project in Vercel
2. Settings → Environment Variables
3. Add these three variables:
   - `STRIPE_SECRET_KEY` = `sk_live_your_live_stripe_secret_key`
   - `STRIPE_CURRENCY` = `eur`
   - `SITE_URL` = `https://yourdomain.com`

**Important:** 
- Never commit `.env` to git (it's in `.gitignore`)
- Use `sk_test_` keys for testing, `sk_live_` for production
- Get your keys from https://dashboard.stripe.com/apikeys

### 3. Run Locally

```bash
npm run dev
```

This starts Vercel dev server at `http://localhost:3000`

### 4. Deploy to Vercel

```bash
vercel --prod
```

---

## Managing Products

### Product Data Structure

All products are stored in **`/src/data/products.json`**. This is the **single source of truth** for your inventory.

### How to Add a New Product

1. **Add product images** to `/src/images/products/`
   - Use descriptive filenames (e.g., `victorian-ruby-ring-1.jpg`)
   - Include 3-5 images per product for best presentation
   - Recommended: 1000x1000px, under 500KB per image

2. **Edit `/src/data/products.json`**
   - Copy an existing product object as a template
   - Update all fields:

```json
{
  "id": "unique-product-id",
  "name": "Victorian Ruby Ring",
  "slug": "victorian-ruby-ring",
  "era": "Victorian, c.1880",
  "description": "A charming Victorian cluster ring centered with a Burmese ruby surrounded by old cut diamonds...",
  "metal": "18ct Yellow Gold",
  "stones": "Burmese Ruby (0.65ct), Old Cut Diamonds (0.50ct total)",
  "size": "UK M / US 6.25",
  "price": 3200,
  "currency": "EUR",
  "featured": false,
  "period": "Victorian",
  "style": "Cluster",
  "images": [
    "/images/products/victorian-ruby-ring-1.jpg",
    "/images/products/victorian-ruby-ring-2.jpg",
    "/images/products/victorian-ruby-ring-3.jpg"
  ]
}
```

3. **Save the file** - Changes appear immediately (no build step needed for static files)

### How to Update Price or Description

1. Open `/src/data/products.json`
2. Find the product by `id`, `slug`, or `name`
3. Edit the `price`, `description`, or any other field
4. Save the file and deploy

### How to Feature a Product on Homepage

Set `"featured": true` in the product object. The homepage displays the first 3 featured products.

### How to Change Product Images

1. Upload new images to `/src/images/products/`
2. Update the `images` array in the product object with new paths
3. Keep 3-5 images per product for the gallery

---

## Stripe Integration Setup

### Get Your API Keys

1. **Create Stripe Account:**
   - Go to https://stripe.com
   - Sign up for a new account

2. **Get Test Keys (for development):**
   - Dashboard → Developers → API keys
   - Copy **Publishable key** (starts with `pk_test_`)
   - Copy **Secret key** (starts with `sk_test_`)

3. **Get Live Keys (for production):**
   - Activate your account (verify business details)
   - Switch to "Live mode" in dashboard
   - Copy **Publishable key** (starts with `pk_live_`)
   - Copy **Secret key** (starts with `sk_live_`)

### Add Keys to Vercel

1. Go to https://vercel.com/dashboard
2. Select your `robynandgold` project
3. Go to **Settings** → **Environment Variables**
4. Add these variables:

| Name | Value | Environment |
|------|-------|-------------|
| `STRIPE_PUBLISHABLE_KEY` | `pk_live_xxxxx` | Production, Preview, Development |
| `STRIPE_SECRET_KEY` | `sk_live_xxxxx` | Production, Preview, Development |
| `SITE_URL` | `https://robynandgold.com` | Production |

5. Click **Save**
6. Redeploy your site

### Test Stripe Payment

Use these test cards (test mode only):

| Card Number | Scenario |
|-------------|----------|
| `4242 4242 4242 4242` | Successful payment |
| `4000 0000 0000 0002` | Card declined |
| `4000 0025 0000 3155` | Requires authentication |

- **Expiry:** Any future date
- **CVC:** Any 3 digits
- **ZIP:** Any 5 digits

---

## Deploying to Vercel

### First-Time Deployment

1. **Install Vercel CLI:**
```bash
npm install -g vercel
```

2. **Login:**
```bash
vercel login
```

3. **Deploy:**
```bash
cd c:\Git\test\robynandgold
vercel --prod
```

4. **Follow prompts:**
   - Set up and deploy? **Y**
   - Scope: Select your account
   - Link to existing project? **N**
   - Project name: `robynandgold`
   - Directory: `./` (leave default)

### Connect Custom Domain (robynandgold.com)

1. **In Vercel Dashboard:**
   - Go to Project Settings → Domains
   - Click "Add Domain"
   - Enter `robynandgold.com`
   - Click "Add"

2. **Update DNS Records at Your Domain Registrar:**

Add these records where you purchased robynandgold.com:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | `76.76.21.21` | 3600 |
| CNAME | www | `cname.vercel-dns.com` | 3600 |

**Popular Registrars:**
- **GoDaddy:** DNS Management → Add Record
- **Namecheap:** Advanced DNS → Add New Record
- **Google Domains:** DNS → Custom Records

3. **Wait for DNS Propagation:**
   - Usually takes 5-30 minutes
   - Can take up to 48 hours
   - Check status: https://www.whatsmydns.net

4. **Verify SSL Certificate:**
   - Vercel automatically provisions SSL
   - Your site will be available at `https://robynandgold.com`

### Automatic Deployments

Connect GitHub for automatic deploys:

1. Push code to GitHub
2. In Vercel: **Settings** → **Git**
3. Click **Connect Git Repository**
4. Select repository
5. Every push to `main` branch auto-deploys

---

## Project Structure

```
robynandgold/
├── api/
│   └── create-checkout-session.js  # Stripe serverless function
├── src/
│   ├── index.html                  # Homepage
│   ├── css/
│   │   └── styles.css              # All styles
│   ├── js/
│   │   ├── main.js                 # Core functionality
│   │   ├── products.js             # Product database ← EDIT THIS
│   │   ├── cart.js                 # Shopping cart
│   │   └── stripe-integration.js   # Stripe checkout
│   ├── pages/
│   │   ├── shop.html               # Product listing
│   │   ├── product-detail.html     # Single product view
│   │   ├── cart.html               # Shopping cart
│   │   └── success.html            # Order confirmation
│   └── images/
│       ├── products/               # ← ADD YOUR IMAGES HERE
│       ├── favicon.png
│       └── logo.png
├── .env                            # API keys (local only)
├── .env.example                    # Template
├── .gitignore                      # Git exclusions
├── package.json                    # Dependencies
├── vercel.json                     # Vercel config
└── README.md                       # This file
```

---

## Customization Guide

### Update Site Colors

Edit `src/css/styles.css`:

```css
:root {
    --primary-color: #8b7355;      /* Main brand color */
    --secondary-color: #d4af37;    /* Gold accent */
    --text-color: #333;            /* Body text */
    --bg-color: #faf9f6;           /* Background */
}
```

### Change Currency

The site uses GBP (£). To change to USD ($):

1. **In products.js:** Update prices to USD values
2. **In all HTML/JS files:** Replace `£` with `$`
3. **In api/create-checkout-session.js:** Change `currency: 'gbp'` to `currency: 'usd'`

### Add Contact Information

Edit footer in all HTML files:

```html
<footer>
    <p>Email: hello@robynandgold.com | Phone: +44 123 456 7890</p>
    <p>&copy; 2025 Robyn and Gold. All rights reserved.</p>
</footer>
```

---

## Maintenance & Updates

### Adding New Products
1. Add image to `src/images/products/`
2. Add product object to `src/js/products.js`
3. Commit and push (auto-deploys if connected to Git)

### Updating Prices
1. Edit prices in `src/js/products.js`
2. Deploy: `vercel --prod`

### Monitoring Orders
- Check Stripe Dashboard for payments
- View customer details and order history
- Enable email notifications in Stripe settings

---

## Security Checklist

✅ **Never commit `.env` file**
✅ **Use environment variables for all keys**
✅ **Keep Stripe secret key server-side only**
✅ **Enable Stripe webhook signing (optional)**
✅ **Use HTTPS (automatic with Vercel)**
✅ **Keep dependencies updated:** `npm audit`

---

---

## Troubleshooting

### "You did not provide an API key" Error

**Problem:** Stripe checkout fails with authentication error.

**Solution:**
1. Check that `STRIPE_SECRET_KEY` is set in your environment:
   - **Local:** Create `.env` file from `.env.example`
   - **Vercel:** Go to Settings → Environment Variables
   
2. Verify you're using the **Secret Key** (starts with `sk_test_` or `sk_live_`), NOT the Publishable Key
   
3. Restart Vercel dev server after adding environment variables:
   ```bash
   vercel dev
   ```

4. For production, redeploy after adding environment variables:
   ```bash
   vercel --prod
   ```

### Products Not Displaying

**Problem:** Shop page is empty or products don't load.

**Solution:**
- Check `/src/data/products.json` for syntax errors (missing commas, brackets)
- Verify image paths in products.json match actual files
- Open browser console (F12) to see JavaScript errors
- Clear browser cache and hard reload (Ctrl+Shift+R)

### Cart Not Working

**Problem:** Items don't stay in cart or cart count shows 0.

**Solution:**
- Check that browser localStorage is enabled (disable private/incognito mode)
- Clear browser cache and cookies
- Open console and check for JavaScript errors
- Verify `cart.js` is loaded on the page

### Images Not Loading

**Problem:** Product images show as broken.

**Solution:**
- Verify images exist in `/src/images/products/`
- Check file paths in `products.json` are correct (e.g., `/images/products/ring-1.jpg`)
- Ensure image filenames match exactly (case-sensitive)
- Check image file formats are supported (JPG, PNG, WebP)

### Domain/DNS Issues

**Problem:** Custom domain not working.

**Solution:**
- Verify DNS records at your registrar match Vercel's requirements
- Wait 24-48 hours for DNS propagation
- Check DNS status: https://www.whatsmydns.net
- Ensure SSL certificate is active in Vercel dashboard

---

## Support Resources

- **Stripe Documentation:** https://stripe.com/docs
- **Vercel Documentation:** https://vercel.com/docs  
- **Stripe Support:** https://support.stripe.com

---

## License

© 2025 Robyn & Gold. All rights reserved.
