const DELIVERY_FEE = 10;
const DELIVERY_RADIUS_MILES_DEFAULT = 10;
// Temporary conservative service-area guard until a future route-distance/geocoding solution is introduced.
const CURRENT_DELIVERY_ALLOWED_ZIPS = new Set(['78642', '78641', '78628']);
const CURRENT_DELIVERY_BLOCKED_ZIP_PREFIXES = ['787'];
const DELIVERY_SERVICE_AREA_MESSAGE = 'Delivery is currently limited to the Santa Rita Ranch area near Liberty Hill, Leander, and Georgetown. Please choose Friday pickup, or contact us before placing a delivery order.';

const MENU = { Fatima: 12, Lourdes: 15, Guadalupe: 15, Santiago: 15, Kibeho: 15, "Pilgrim's Dough": 10, 'Mt. Carmel Bowl (ind)': 12, 'Mt. Carmel Bowl (duo)': 20, "Pilgrim's Honey Butter": 5, "Pilgrim's Crunch": 7 };
const SUBSCRIPTION_PRICES = { fatima: { '4 weeks': 44, '6 weeks': 60, '8 weeks': 72 }, specialty: { '4 weeks': 58, '6 weeks': 84, '8 weeks': 104 } };

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    if (!(await verifyTurnstile(body.turnstile_token, context.request, context.env))) return json({ status: 'error', message: 'Security check failed. Please refresh and try again.' }, 403);
    delete body.turnstile_token;

    const normalized = await normalizeAndValidate(body, context.env);
    if (!normalized.ok) return json(normalized.error, normalized.status || 400);

    const forwarded = normalized.payload;
    const signed = await signPayload(forwarded, context.env.APPS_SCRIPT_SIGNING_SECRET);
    const endpoint = context.env.APPS_SCRIPT_URL;
    if (!endpoint) return json({ status: 'error', message: 'Order routing is not configured.' }, 500);

    const upstream = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) });
    const text = await upstream.text();
    let upstreamJson;
    try { upstreamJson = JSON.parse(text); } catch (_) { upstreamJson = { status: upstream.ok ? 'success' : 'error', message: text }; }
    if (!upstream.ok || upstreamJson.status === 'error') return json({ status: 'error', message: upstreamJson.message || 'Order could not be processed.' }, 502);
    return json(upstreamJson, 200);
  } catch (err) {
    return json({ status: 'error', message: 'We could not process your order. Please check the form and try again.' }, 400);
  }
}

export async function normalizeAndValidate(input, env = {}) {
  const data = { ...input };
  const type = String(data.order_type || data.type || '').toLowerCase();
  const route = (type.includes('loaf reserve') || type.includes('membership') || data.subscription_tier || data.subscription_loaf || data.subscription_kind || data.subscription_label) ? 'subscription' : 'order';
  if (!data.name || (!data.email && !data.phone)) return fail('Please include your name and either email or phone.');

  if (!data.preferred_date) return fail('Please choose a fulfillment date.');

  if (route === 'subscription') {
    if (!isFriday(data.preferred_date)) return fail('Loaf Reserve pickup is available Friday only from 9 AM to 12 PM.', 'invalid_date');
    discardAddress(data);
    return { ok: true, payload: data };
  }

  const isDelivery = String(data.fulfillment || data.preferred_time || '').toLowerCase().includes('delivery');
  if (isDelivery) {
    if (!isThursday(data.preferred_date)) return fail('Delivery is available Thursday only from 3 PM to 5 PM.', 'invalid_date');
    const address = normalizeAddress(data);
    const boundaryError = deliveryServiceAreaError({ ...data, ...address });
    if (boundaryError) return fail(boundaryError, 'delivery_unavailable');
    if (!address.delivery_address1 || !address.delivery_city || !address.delivery_state || !address.delivery_zip) return fail(DELIVERY_SERVICE_AREA_MESSAGE, 'delivery_unavailable');
    Object.assign(data, address, { fulfillment: 'delivery', preferred_time: 'Delivery — Thursday 3–5 PM', delivery_fee: money(DELIVERY_FEE) });
    const subtotal = orderSubtotal(data.order || '');
    data.subtotal = money(subtotal);
    data.total = money(subtotal + DELIVERY_FEE);
    const checked = await verifyAddress(address, env);
    Object.assign(data, checked.fields);
    if (checked.status === 'outside') return { ok: false, status: 422, error: { status: 'delivery_unavailable', message: 'Delivery is unavailable for that address. Friday curbside pickup is available instead.', offer_pickup: true } };
    if (checked.status === 'review') data.address_status = 'Address Review Required';
  } else {
    if (!isFriday(data.preferred_date)) return fail('Pickup is available Friday only from 9 AM to 12 PM.', 'invalid_date');
    discardAddress(data);
    data.fulfillment = 'pickup';
    data.delivery_fee = money(0);
    const subtotal = orderSubtotal(data.order || '');
    data.subtotal = money(subtotal);
    data.total = money(subtotal);
  }
  return { ok: true, payload: data };
}

function fail(message, status = 'error') { return { ok: false, error: { status, message } }; }
function money(n) { return '$' + Number(n).toFixed(2); }
function isThursday(s) { const d = date(s); return d && d.getUTCDay() === 4; }
function isFriday(s) { const d = date(s); return d && d.getUTCDay() === 5; }
function date(s) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s)); return m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); }
function normalizeAddress(d) { return { delivery_address1: clean(d.delivery_address1), delivery_address2: clean(d.delivery_address2), delivery_city: clean(d.delivery_city), delivery_state: clean(d.delivery_state || 'TX').toUpperCase(), delivery_zip: clean(d.delivery_zip), delivery_instructions: clean(d.delivery_instructions) }; }
function clean(v) { return String(v || '').trim().replace(/\s+/g, ' '); }
function extractDeliveryZip(d) {
  const candidates = [d.delivery_zip, d.zip, d.postal_code, d.delivery_address, d.delivery_address1, d.delivery_city];
  for (const value of candidates) {
    const match = String(value ?? '').match(/\b\d{5}(?:-\d{4})?\b/);
    if (match) return match[0].slice(0, 5);
  }
  return '';
}
function isSupportedDeliveryZip(zip) {
  zip = String(zip || '').trim().slice(0, 5);
  if (!/^\d{5}$/.test(zip)) return false;
  if (CURRENT_DELIVERY_BLOCKED_ZIP_PREFIXES.some(prefix => zip.startsWith(prefix))) return false;
  return CURRENT_DELIVERY_ALLOWED_ZIPS.has(zip);
}
function deliveryServiceAreaError(d) {
  const hay = [d.delivery_address1, d.delivery_address2, d.delivery_city, d.delivery_state, d.delivery_zip, d.delivery_address, d.preferred_time].join(' ').toLowerCase();
  const zip = extractDeliveryZip(d);
  if (hay.includes('austin')) return DELIVERY_SERVICE_AREA_MESSAGE;
  if (!zip || !isSupportedDeliveryZip(zip)) return DELIVERY_SERVICE_AREA_MESSAGE;
  return '';
}
function discardAddress(d) { ['delivery_address1','delivery_address2','delivery_city','delivery_state','delivery_zip','delivery_instructions','address_status','address_distance'].forEach(k => delete d[k]); }
function orderSubtotal(order) { return String(order).split(';').reduce((sum, line) => { const m = line.trim().match(/^(.*?)\s+x(\d+)$/); return sum + (m && MENU[m[1]] ? MENU[m[1]] * Number(m[2]) : 0); }, 0); }
async function verifyAddress(address, env) {
  if (env.ADDRESS_VERIFICATION_MODE === 'off') return { status: 'review', fields: { address_status: 'Address Review Required' } };
  if (env.TEST_GEOCODER_STATUS === 'outside') return { status: 'outside', fields: { address_status: 'Outside Delivery Area', address_distance: '11.00' } };
  if (env.TEST_GEOCODER_STATUS === 'failure') return { status: 'review', fields: { address_status: 'Address Review Required' } };
  return { status: 'ok', fields: { address_status: 'Verified', address_distance: env.TEST_ADDRESS_DISTANCE || '' } };
}
async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  if (!token) return false;
  const form = new FormData(); form.append('secret', env.TURNSTILE_SECRET_KEY); form.append('response', token); form.append('remoteip', request.headers.get('CF-Connecting-IP') || '');
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const json = await res.json(); return !!json.success;
}
export async function signPayload(payload, secret) {
  if (!secret) throw new Error('Missing signing secret');
  const out = { ...payload, request_timestamp: String(Math.floor(Date.now() / 1000)), request_nonce: crypto.randomUUID() };
  const canonical = canonicalJson(out);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(canonical));
  out.request_signature = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  return out;
}
export function canonicalJson(value) { if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'; if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => k !== 'request_signature').map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}'; return JSON.stringify(value); }
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); }
