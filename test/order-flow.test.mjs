import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAndValidate, canonicalJson } from '../functions/api/order.js';

const base = { name: 'Test', email: 't@example.com', order: 'Fatima x1', preferred_date: '2026-07-23' };

test('valid Thursday delivery with complete address succeeds and adds exactly $10', async () => {
  const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: '1 Main', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: '78642' }, { TEST_ADDRESS_DISTANCE: '4.25' });
  assert.equal(res.ok, true); assert.equal(res.payload.delivery_fee, '$10.00'); assert.equal(res.payload.total, '$22.00'); assert.equal(res.payload.address_status, 'Verified');
});

test('delivery without ZIP fails before forwarding', async () => { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: '1 Main', delivery_city: 'Liberty Hill', delivery_state: 'TX' }); assert.equal(res.ok, false); assert.equal(res.error.status, 'delivery_unavailable'); });
test('Friday delivery fails', async () => { const res = await normalizeAndValidate({ ...base, preferred_date: '2026-07-24', fulfillment: 'delivery', delivery_address1: '1 Main', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: '78642' }); assert.equal(res.ok, false); assert.equal(res.error.status, 'invalid_date'); });
test('Friday pickup succeeds without address and discards supplied address', async () => { const res = await normalizeAndValidate({ ...base, preferred_date: '2026-07-24', fulfillment: 'pickup', delivery_address1: '=bad' }); assert.equal(res.ok, true); assert.equal(res.payload.delivery_fee, '$0.00'); assert.equal(res.payload.delivery_address1, undefined); });
test('Loaf Reserve remains Friday-only', async () => { const bad = await normalizeAndValidate({ order_type: 'Loaf Reserve Membership', subscription_tier: '4 weeks', name: 'T', email: 'e', preferred_date: '2026-07-23' }); assert.equal(bad.ok, false); const good = await normalizeAndValidate({ order_type: 'Loaf Reserve Membership', subscription_tier: '4 weeks', name: 'T', email: 'e', preferred_date: '2026-07-24', delivery_address1: 'discard' }); assert.equal(good.ok, true); assert.equal(good.payload.delivery_address1, undefined); });
test('Austin delivery address text is rejected by service-area guard', async () => { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: '1 Main', delivery_city: 'Austin', delivery_state: 'TX', delivery_zip: '78642' }); assert.equal(res.ok, false); assert.equal(res.error.status, 'delivery_unavailable'); });
test('geocoder failure produces Address Review Required and no confirmed status', async () => { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: '1 Main', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: '78642' }, { TEST_GEOCODER_STATUS: 'failure' }); assert.equal(res.ok, true); assert.equal(res.payload.address_status, 'Address Review Required'); });
test('worker canonical signatures omit request_signature', () => { assert.equal(canonicalJson({ b: 2, request_signature: 'x', a: 1 }), '{"a":1,"b":2}'); });

test('delivery to 78737 is rejected by service-area guard', async () => { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: 'Synthetic', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: '78737' }); assert.equal(res.ok, false); assert.equal(res.error.status, 'delivery_unavailable'); });
test('delivery to any 787xx ZIP is rejected by service-area guard', async () => { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: 'Synthetic', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: '78750' }); assert.equal(res.ok, false); assert.equal(res.error.status, 'delivery_unavailable'); });
test('supported delivery ZIPs are accepted by service-area guard', async () => { for (const zip of ['78642', '78641', '78628']) { const res = await normalizeAndValidate({ ...base, fulfillment: 'delivery', delivery_address1: 'Synthetic', delivery_city: 'Liberty Hill', delivery_state: 'TX', delivery_zip: zip }); assert.equal(res.ok, true, zip); } });
