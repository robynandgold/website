// Postage zones — the single source of truth for what delivery costs.
//
// Changing a rate here changes it everywhere: the cart's country selector and
// the FAQ table both read it through GET /api/shipping, the Stripe session is
// built from it, and the webhook cross-checks the paid rate against it after
// payment. Nothing else hard-codes an amount, so there is one number to edit.
//
// Stripe shows every rate offered to every customer — it does not match rates
// to the delivery address the shopper types. So the session is created with
// ONLY the rate for one country: the one the shopper picked in the cart, or
// failing that the one Cloudflare reports for their connection. The webhook
// flags an order whose paid rate is short of its actual delivery country
// (e.g. an Irish visitor sending a gift abroad) before it is posted.
//
// No imports: this file is loaded by the tests directly, which the Stripe SDK
// would otherwise prevent.
export const SHIPPING_ZONES = {
  ireland: { amount: 0, name: 'Delivery within Ireland', minDays: 2, maxDays: 5 },
  europe: { amount: 1500, name: 'Delivery to the UK and Europe', minDays: 5, maxDays: 10 },
  world: { amount: 3500, name: 'Delivery to the rest of the world', minDays: 7, maxDays: 14 },
};

// UK + Europe for the €15 tier (Ireland has its own, free, tier).
export const EUROPE_COUNTRIES = new Set([
  'GB', 'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE',
  'GR', 'HU', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'CH', 'NO', 'IS', 'LI', 'MC', 'SM', 'VA', 'AD', 'GG',
  'JE', 'IM', 'GI', 'FO', 'AX', 'AL', 'BA', 'MD', 'ME', 'MK', 'RS', 'UA', 'XK',
]);

// Everywhere Stripe will collect a delivery address for, and therefore
// everywhere the cart offers in its country list.
export const ALLOWED_COUNTRIES = [
  'AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AT', 'AU', 'AW', 'AX',
  'AZ', 'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ',
  'BR', 'BS', 'BT', 'BV', 'BW', 'BY', 'BZ', 'CA', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL',
  'CM', 'CN', 'CO', 'CR', 'CV', 'CW', 'CY', 'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC',
  'EE', 'EG', 'EH', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FK', 'FO', 'FR', 'GA', 'GB', 'GD', 'GE',
  'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT', 'GU', 'GW', 'GY',
  'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IS', 'IT', 'JE',
  'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB',
  'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG',
  'MK', 'ML', 'MM', 'MN', 'MO', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ', 'OM', 'PA', 'PE', 'PF',
  'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PY', 'QA', 'RE', 'RO', 'RS', 'RU',
  'RW', 'SA', 'SB', 'SC', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR',
  'SS', 'ST', 'SV', 'SX', 'SZ', 'TA', 'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM',
  'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ', 'UA', 'UG', 'US', 'UY', 'UZ', 'VA', 'VC', 'VE',
  'VG', 'VN', 'VU', 'WF', 'WS', 'XK', 'YE', 'YT', 'ZA', 'ZM', 'ZW', 'ZZ',
];

const ALLOWED = new Set(ALLOWED_COUNTRIES);

/** Which zone a two-letter country code falls into, or null if there isn't one. */
export function zoneForCountry(country) {
  if (!country) return null;
  if (country === 'IE') return 'ireland';
  return EUROPE_COUNTRIES.has(country) ? 'europe' : 'world';
}

/** A country code we are willing to quote for, or null. */
function validCountry(code) {
  if (typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  return ALLOWED.has(upper) ? upper : null;
}

/**
 * Where the order is going, as far as we can tell when the session is created.
 *
 * `stated` is what the shopper chose in the cart and is preferred — it is the
 * only one of the two that reflects where the parcel is actually going.
 * `detected` is Cloudflare's view of the connection, used when the cart could
 * not reach /api/shipping. Both are checked against the list of countries
 * Stripe will take an address for, so a junk value (or one of Cloudflare's
 * non-country codes like T1 for Tor) falls through to null rather than being
 * quoted as rest-of-world.
 */
export function resolveShippingCountry(stated, detected) {
  return validCountry(stated) || validCountry(detected);
}

/** One zone as a Stripe `shipping_options` entry. */
export function shippingOptionFor(zoneKey) {
  const z = SHIPPING_ZONES[zoneKey];
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: z.amount, currency: 'eur' },
      display_name: z.name,
      delivery_estimate: {
        minimum: { unit: 'business_day', value: z.minDays },
        maximum: { unit: 'business_day', value: z.maxDays },
      },
    },
  };
}

/**
 * The rates to offer for a destination. A known country gets its own single
 * rate. When the country can't be established at all, the paid tiers are
 * offered for the shopper to choose from — deliberately without the free Irish
 * one, which should only ever apply to an address we have actually been told
 * is in Ireland.
 */
export function shippingOptionsForCountry(country) {
  const zone = zoneForCountry(country);
  return zone
    ? [shippingOptionFor(zone)]
    : [shippingOptionFor('europe'), shippingOptionFor('world')];
}

/**
 * The zone table as the browser and the FAQ consume it: each country paired
 * with its zone, and the zones themselves with their amounts in cents.
 */
export function shippingTable() {
  return {
    zones: Object.fromEntries(
      Object.entries(SHIPPING_ZONES).map(([key, z]) => [
        key,
        { amount: z.amount, name: z.name, minDays: z.minDays, maxDays: z.maxDays },
      ])
    ),
    countries: ALLOWED_COUNTRIES.map((code) => [code, zoneForCountry(code)]),
  };
}
