// Cloudflare Worker entry — serves the static site (src/, via the ASSETS
// binding) and handles the /api/* endpoints.
import { handleCheckout } from './checkout.js';
import { handleWebhook } from './webhook.js';
import { handleAdminToken } from './admin-token.js';
import { handleVipLink } from './vip.js';
import { handleInsights } from './insights.js';
import { handleView } from './views.js';
import { handleCosts } from './costs.js';
import { handleAbandoned } from './abandoned.js';
import { handlePromos } from './promos.js';
import { handleShipping } from './shipping-api.js';

const methodNotAllowed = () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

const routes = {
  '/api/create-checkout-session': handleCheckout,
  '/api/webhook': handleWebhook,
  '/api/admin-token': handleAdminToken,
  '/api/vip-link': handleVipLink,
  '/api/insights': handleInsights,
  '/api/view': handleView,
  '/api/costs': handleCosts,
  '/api/abandoned': handleAbandoned,
  '/api/promos': handlePromos,
};

// Endpoints that only read, and are therefore fetched with GET.
const readRoutes = {
  '/api/shipping': handleShipping,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    const reader = readRoutes[pathname];
    if (reader) {
      if (request.method !== 'GET') return methodNotAllowed();
      return reader(request, env);
    }

    const handler = routes[pathname];
    if (handler) {
      if (request.method !== 'POST') return methodNotAllowed();
      return handler(request, env);
    }

    // Not an API route — serve the static site from src/.
    return env.ASSETS.fetch(request);
  },
};
