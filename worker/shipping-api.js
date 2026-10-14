// GET /api/shipping — the postage table, plus where Cloudflare thinks the
// visitor is.
//
// The cart page uses this to show the real postage for a chosen country before
// the shopper commits to checkout, rather than letting Stripe reveal it after
// they have handed over an address. Keeping it an endpoint rather than a copy
// of the table in the page's JavaScript means there is still only one place a
// rate is written down.
import { shippingTable, resolveShippingCountry } from './shipping.js';

export async function handleShipping(request) {
  const table = shippingTable();

  return new Response(
    JSON.stringify({
      ...table,
      // Only the selector's starting point, and only when Cloudflare's code is
      // a country we actually quote for — it uses T1 for Tor and XX for
      // unknown. The shopper's own choice is what gets sent back to checkout.
      detected: resolveShippingCountry(request && request.cf && request.cf.country, null),
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        // The table changes when a rate is edited and deployed; the detected
        // country is per-visitor, so this must not be shared between them.
        'Cache-Control': 'private, max-age=300',
      },
    }
  );
}
