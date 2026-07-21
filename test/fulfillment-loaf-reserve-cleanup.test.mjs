import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');
const orderHtml = readFileSync(new URL('../order/index.html', import.meta.url), 'utf8');
const orderWorker = readFileSync(new URL('../functions/api/order.js', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/implementation-backlog.md', import.meta.url), 'utf8');

function load() {
  const sent = [];
  const events = [];
  const sandbox = {
    console, Date, Math, String, Number, RegExp, JSON, encodeURIComponent, isFinite,
    Logger: { log() {} },
    MailApp: { sendEmail(msg) { sent.push(msg); } },
    CONTACT_PHONE: '\(?512\)?[ -]299-1241', CONTACT_PHONE_SMS: '+15122991241', PICKUP_ADDRESS: 'Liberty Hill pickup', PICKUP_HOURS: 'Friday 9 AM–12 PM', DELIVERY_HOURS: 'Thursday 3–5 PM', DELIVERY_AREA: 'Delivery area', OWNER_EMAIL: 'owner@example.test', OWNER_EMAIL_BACKUP: '', INSTAGRAM_HANDLE: '@fatima', CALENDAR_ID: 'cal',
    buildInfoTable(rows) { return JSON.stringify(rows); },
    buildBaseEmailHTML(title, content) { return `${title}\n${content}`; },
    sendTrackedEmail(msg) { sent.push(msg); },
    CalendarApp: { getCalendarById: () => ({ createEvent: (...args) => events.push(args) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ SQUARE_ACCESS_TOKEN: 'test-token', SQUARE_LOCATION_ID: 'loc', PUBLIC_APPS_SCRIPT_URL: 'https://example.test/script' }), getProperty: (k, d) => d || 'test-value', setProperty() {} }) },
    Utilities: { formatDate: () => '2026-07-24', getUuid: () => 'uuid' },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    SpreadsheetApp: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.__sent = sent; sandbox.__events = events;
  return sandbox;
}

test('central delivery helper recognizes explicit fields and malformed values safely', () => {
  const h = load();
  assert.equal(h.isDeliveryOrder_({ fulfillment: 'DELIVERY' }), true);
  assert.equal(h.isDeliveryOrder_({ preferred_time: 'Delivery — Thursday 3–5 PM' }), true);
  assert.equal(h.isDeliveryOrder_({ delivery_fee: 10 }), true);
  assert.equal(h.isDeliveryOrder_({ delivery_fee: '$10.00' }), true);
  assert.doesNotThrow(() => h.isDeliveryOrder_({ fulfillment: null, preferred_time: {}, delivery_fee: 'nope' }));
  assert.equal(h.isDeliveryOrder_({ delivery_fee: 'nope' }), false);
});

test('Apps Script delivery service area rejects Austin and unlisted ZIPs without affecting pickup', () => {
  const h = load();
  assert.equal(h.deliveryServiceAreaDecision_({ fulfillment: 'pickup', delivery_city: 'Austin', delivery_zip: '78701' }).ok, true);
  assert.equal(h.deliveryServiceAreaDecision_({ fulfillment: 'delivery', delivery_city: 'Liberty Hill', delivery_zip: '78642' }).ok, true);
  assert.equal(h.deliveryServiceAreaDecision_({ fulfillment: 'delivery', delivery_city: 'Austin', delivery_zip: '78642' }).status, 'delivery_unavailable');
  assert.equal(h.deliveryServiceAreaDecision_({ fulfillment: 'delivery', delivery_city: 'Leander', delivery_zip: '78717' }).status, 'delivery_unavailable');
  assert.equal(h.deliveryServiceAreaDecision_({ fulfillment: 'delivery', delivery_city: 'Georgetown', delivery_zip: '78626' }).status, 'delivery_unavailable');
});

test('order received messaging separates pickup and delivery texting instructions', () => {
  const h = load();
  const base = { name: 'Test', email: 't@example.test', order: 'Fatima x1', total: '$12', preferred_date: '2026-07-24', preferred_time: 'Friday Pickup — 9 AM–12 PM' };
  h.sendOrderReceivedEmail({ ...base, fulfillment: 'pickup' }, 'FB-1', false, false, null, null, null);
  assert.match(h.__sent.at(-1).body, /On pickup day, please text us at \(512\) 299-1241 when you’re on your way/);
  h.sendOrderReceivedEmail({ ...base, fulfillment: 'delivery', preferred_date: '2026-07-23', preferred_time: 'Delivery — Thursday 3–5 PM', delivery_fee: '$10.00' }, 'FB-2', false, false, null, null, null);
  assert.match(h.__sent.at(-1).body, /On delivery day, we will text you when we’re on our way to confirm the delivery window/);
  assert.doesNotMatch(h.__sent.at(-1).body, /please text us.*when you’re on your way/);
});

test('ready notification supports pickup and delivery statuses and subjects', () => {
  const h = load();
  h.sendFulfillmentReadyNotification({ name: 'T', email: 't@example.test', orderId: 'FB-1', order: 'Fatima x1', fulfillment: 'pickup', preferred_time: 'Friday Pickup' });
  assert.equal(h.__sent.at(-1).subject, '🌿 Your order is ready for pickup — FB-1');
  assert.match(h.__sent.at(-1).body, /curbside pickup is ready|On pickup day/);
  h.sendFulfillmentReadyNotification({ name: 'T', email: 't@example.test', orderId: 'FB-2', order: 'Fatima x1', fulfillment: 'delivery', preferred_time: 'Delivery — Thursday 3–5 PM' });
  assert.equal(h.__sent.at(-1).subject, '🌿 Your order is scheduled for delivery — FB-2');
  assert.match(h.__sent.at(-1).body, /we will text you when we’re on our way/);
  assert.match(code, /var readyStatus = isDeliveryOrder_\(data\) \? "Ready for Delivery" : "Ready for Pickup"/);
});

test('payment idempotency and revenue formulas include Ready for Delivery', () => {
  assert.match(code, /current === "Paid"[\s\S]*current === "Ready for Delivery"[\s\S]*current === "Completed"/);
  assert.match(code, /!alreadyConfirmed && typeof updateLineItemStatus/);
  assert.match(code, /!alreadyConfirmed && CALENDAR_ID/);
  assert.match(code, /Ready for Delivery/);
  assert.match(code, /Confirmed revenue[\s\S]*Orders!Q2:Q2000="Ready for Delivery"/);
});

test('calendar events use delivery and pickup information through centralized helper', () => {
  const fn = code.match(/function createCalendarEvent[\s\S]*?function isReturningCustomer/)?.[0] ?? '';
  assert.match(fn, /isDeliveryOrder_\(data\)/);
  assert.match(fn, /var startHour = isDelivery \? 15 : 9/);
  assert.match(fn, /var endHour = isDelivery \? 17 : 12/);
  assert.match(fn, /location: isDelivery \? deliveryAddressText : PICKUP_ADDRESS/);
  assert.match(fn, /Address: /);
});

test('active order form advertises service-area ZIP enforcement without radius claims', () => {
  const orderSection = orderHtml.slice(orderHtml.indexOf('id="order-form"'), orderHtml.indexOf('</form>', orderHtml.indexOf('id="order-form"')));
  assert.match(orderSection, /Santa Rita Ranch service area near Liberty Hill, Leander, and Georgetown · Adds \$10/);
  assert.doesNotMatch(orderSection, /within 10 miles|8 miles|10-mile|8-mile/i);
  assert.match(orderHtml, /Delivery — Santa Rita Ranch service area near Liberty Hill, Leander, and Georgetown, Thursdays 3 PM to 5 PM/);
});

test('Loaf Reserve form keeps stable IDs, Friday pickup, and required loaf options', () => {
  assert.match(orderHtml, /id="loaf-reserve"/);
  assert.match(orderHtml, /id="loaf-reserve-form"/);
  assert.match(orderHtml, /id="loaf-reserve-status"/);
  assert.match(orderHtml, /name="order_type" value="Loaf Reserve Membership"/);
  assert.match(orderHtml, /Friday pickup only, 9 AM–12 PM in Liberty Hill/);
  assert.match(orderHtml, /value="Fatima Classic"/);
  assert.match(orderHtml, /value="Specialty"/);
  assert.match(orderHtml, /value="Baker's Choice"/);
  assert.match(orderHtml, /chosen && chosen\.value === 'Specialty'/);
  const loafSection = orderHtml.slice(orderHtml.indexOf('id="loaf-reserve"'), orderHtml.indexOf('</section>', orderHtml.indexOf('id="loaf-reserve"')));
  assert.doesNotMatch(loafSection, /weekly assignment|weekly approval|route selection|delivery address|weekly customer approval/i);
});

test('Loaf Reserve messaging is current, pickup-only, and does not claim auto-renewal', () => {
  assert.match(code, /Loaf Reserve Membership received/);
  assert.match(code, /New Loaf Reserve Membership/);
  assert.match(code, /Friday pickup window: 9 AM–12 PM/);
  assert.match(code, /final pickup is on/);
  assert.doesNotMatch(code + orderHtml, /auto-renew|automatically renews|last delivery/i);
});

test('obsolete aliases and verified dead functions are absent while protected product names remain', () => {
  for (const text of [code, orderHtml, orderWorker]) {
    for (const obsolete of ['Pilgrim'+' Membership', 'Pilgrim'+' Reserve', 'Pilgrim'+' Subscription', 'Pili'+'grim', 'Bread'+' Share']) assert.equal(text.includes(obsolete), false);
    for (const dead of ['receiveSquare'+'Webhook', 'squareGet'+'Signature', 'ensureSquareQueue'+'Trigger', 'confirmOrder'+'Venmo', 'sendCapacity'+'Email']) assert.equal(new RegExp('function\\s+' + dead + '\\b').test(text), false);
  }
  assert.match(orderWorker + orderHtml, /Pilgrim's Dough/);
  assert.match(orderWorker + orderHtml, /Pilgrim's Honey Butter/);
  assert.match(orderWorker + orderHtml, /Pilgrim's Crunch/);
  assert.match(readFileSync(new URL('../collection/index.html', import.meta.url), 'utf8'), /Pilgrimage Collection/);
});

test('address-correction route and token helpers are removed', () => {
  assert.doesNotMatch(code + orderWorker, /address_correction|correctionTokenUrl_|validateAddressUpdateToken_|handleAddressCorrection|ADDRESS_CORRECTION_URL/);
});

test('implementation backlog documents current sequence and keeps inventory off before SHADOW', () => {
  assert.match(docs, /Controlled inventory rollout integration completed/);
  assert.match(docs, /Pre-SHADOW subscription-allocation corrections completed/);
  assert.match(docs, /Fulfillment messaging and Loaf Reserve cleanup implemented in this PR/);
  assert.match(docs, /Deploy with inventory OFF/);
  assert.match(docs, /Owner approval before any SHADOW configuration/);
});
