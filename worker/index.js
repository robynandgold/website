// Cloudflare Worker entry — serves the static site (src/, via the ASSETS
// binding) and handles the three /api/* endpoints.
import { handleCheckout } from './checkout.js';
import { handleWebhook } from './webhook.js';
import { handleAdminToken } from './admin-token.js';

const methodNotAllowed = () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });

const routes = {
  '/api/create-checkout-session': handleCheckout,
  '/api/webhook': handleWebhook,
  '/api/admin-token': handleAdminToken,
};

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    const handler = routes[pathname];
    if (handler) {
      if (request.method !== 'POST') return methodNotAllowed();
      return handler(request, env);
    }

    // Not an API route — serve the static site from src/.
    return env.ASSETS.fetch(request);
  },
};
