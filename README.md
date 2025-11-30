# Robyn and Gold - Antique Jewellery Shop

A complete e-commerce website for Robyn and Gold antique jewellery with Stripe payment integration.

**Live Site:** https://robynandgold.com

## Features

- 🎨 Elegant, responsive design optimized for antique jewellery
- 🛍️ Product catalog with filtering by era and category
- 🛒 Full shopping cart functionality
- 💳 Secure Stripe payment integration
- 📱 Mobile-friendly responsive layout
- 🔒 SSL security (automatic with Vercel)
- ⚡ Fast loading with optimized images

## Quick Start

1. **Clone and Install:**
```bash
cd c:\Git\test\robynandgold
npm install
```

2. **Add Your Stripe Keys:**
Create `.env` file (copy from `.env.example`):
```
STRIPE_PUBLISHABLE_KEY=pk_live_your_key_here
STRIPE_SECRET_KEY=sk_live_your_key_here
SITE_URL=https://robynandgold.com
```

3. **Test Locally:**
```bash
npm start
```
Open http://localhost:3000

4. **Deploy to Vercel:**
```bash
vercel --prod
```

---

## Adding Products

### Step 1: Add Product Images

1. Place high-quality images in `src/images/products/`
2. Recommended specs:
   - **Format:** JPG or PNG
   - **Size:** 1000x1000px (square)
   - **File size:** Under 500KB (compress at tinypng.com)
   - **Naming:** Use descriptive names (e.g., `victorian-diamond-ring-1890.jpg`)

### Step 2: Update Product Database

Edit `src/js/products.js`:

```javascript
{
    id: 1,
    name: 'Victorian Diamond Ring',
    description: 'Exquisite Victorian-era diamond ring featuring...',
    price: 2500.00,  // Price in GBP
    image: 'images/products/victorian-diamond-ring.jpg',
    category: 'rings',  // rings, necklaces, bracelets, earrings, brooches
    condition: 'Excellent',  // Excellent, Very Good, Good
    era: 'Victorian',  // Victorian, Edwardian, Art Deco, Georgian, Retro
    metal: '18ct Gold',
    stone: 'Diamond',
    year: '1890'
}
```

### Easy Product Management

Just add entries to the `products` array in `products.js`. The website will automatically:
- Display products on the shop page
- Create individual product detail pages
- Enable "Add to Cart" functionality
- Calculate pricing and checkout

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

## Troubleshooting

### Products Not Displaying
- Check `products.js` for syntax errors
- Verify image paths are correct
- Open browser console for errors (F12)

### Stripe Checkout Not Working
- Verify API keys in Vercel environment variables
- Check browser console for errors
- Ensure you're using correct key type (test vs live)

### Domain Not Working
- Verify DNS records are correct
- Check DNS propagation status
- Wait up to 48 hours for DNS to propagate
- Ensure SSL certificate is active in Vercel

### Cart Not Persisting
- Check browser localStorage is enabled
- Clear browser cache and cookies
- Test in incognito mode

---

## Support Resources

- **Stripe Documentation:** https://stripe.com/docs
- **Vercel Documentation:** https://vercel.com/docs
- **GitHub Issues:** Create issue in repository
- **Stripe Support:** https://support.stripe.com

---

## Performance Tips

1. **Optimize Images:**
   - Use tinypng.com or squoosh.app
   - Target: under 500KB per image
   - Use WebP format for better compression

2. **Enable Caching:**
   - Vercel automatically caches static assets
   - Images cached for 1 year

3. **Monitor Performance:**
   - Use Google PageSpeed Insights
   - Target score: 90+ for mobile and desktop

---

## License

MIT License - Feel free to customize for your business

---

## Changelog

### v1.0.0 (2025-11-29)
- Initial release
- Stripe payment integration
- Responsive design
- Product catalog
- Shopping cart
- Vercel deployment ready

---

**Built with ❤️ for Robyn and Gold**

For questions or support, refer to the troubleshooting section above.
