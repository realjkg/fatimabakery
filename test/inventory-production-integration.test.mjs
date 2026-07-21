import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');

function loadInventoryHarness(mode = 'ENFORCE') {
  const sandbox = {
    console,
    Date,
    Math,
    String,
    Number,
    RegExp,
    JSON,
    INVENTORY_ROLLOUT_MODE: mode,
    INVENTORY_KILL_SWITCH: false,
    INVENTORY_DRY_RUN: false,
    INVENTORY_PRODUCTION_SPREADSHEET_ID: '',
    BOULE_LIMIT: 12,
    SPECIALTY_LIMIT: 4,
    Logger: { log() {} },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Session: { getScriptTimeZone: () => 'Etc/UTC' },
    PropertiesService: { getScriptProperties: () => ({ getProperties: () => ({ SQUARE_ACCESS_TOKEN: 'test-token', SQUARE_LOCATION_ID: 'test-location', PUBLIC_APPS_SCRIPT_URL: 'https://example.test/script', SQUARE_WEBHOOK_NOTIFICATION_URL: 'https://example.test/webhook' }), getProperty: () => 'test-value' }) },
    SpreadsheetApp: {}
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  vm.runInContext(`INVENTORY_ROLLOUT_MODE = ${JSON.stringify(mode)}; INVENTORY_KILL_SWITCH = false; INVENTORY_DRY_RUN = false; INVENTORY_PRODUCTION_SPREADSHEET_ID = "test-spreadsheet";`, sandbox);
  return sandbox;
}

class SheetStub {
  constructor(name, rows = []) { this.name = name; this.rows = rows.map((r) => [...r]); }
  getDataRange() { return { getValues: () => this.rows.map((r) => [...r]) }; }
  appendRow(row) { this.rows.push([...row]); }
  getRange() { return { setValues: (values) => { this.rows[0] = [...values[0]]; return this; }, setBackground: () => this, setFontColor: () => this, setFontWeight: () => this }; }
  getName() { return this.name; }
}

class SpreadsheetStub {
  constructor(sheets = {}) { this.sheets = sheets; this.subscriptionReads = 0; }
  getId() { return 'test-spreadsheet'; }
  getSheetByName(name) {
    if (name === 'Subscriptions') this.subscriptionReads++;
    return this.sheets[name] || null;
  }
  insertSheet(name) { const sheet = new SheetStub(name, []); this.sheets[name] = sheet; return sheet; }
}

const subHeader = ['Timestamp','Name','Phone','Instagram','Email','Tier','Price','Start Date','End Date','Status','Notes','Source','Sub ID'];
const subRow = (overrides = {}) => {
  const row = ['', 'Synthetic Member', '', '', 'synthetic@example.test', 'Fatima Classic · 4 weeks', '$44', '2026-07-24', '2026-08-21', 'Active', '', 'test', 'FBS-SYNTH-001'];
  for (const [idx, value] of Object.entries(overrides)) row[Number(idx)] = value;
  return row;
};

function allocationSheet(rows) {
  return new SpreadsheetStub({ Subscriptions: new SheetStub('Subscriptions', [subHeader, ...rows]) });
}

test('OFF mode returns before reading the Subscriptions sheet', () => {
  const h = loadInventoryHarness('OFF');
  const ss = allocationSheet([subRow()]);
  h.SpreadsheetApp.getActiveSpreadsheet = () => ss;
  const result = h.allocateWeeklySubscriptionInventory('2026-07-24');
  assert.equal(result.status, 'off');
  assert.equal(result.allocated, 0);
  assert.equal(ss.subscriptionReads, 0);
});

test('one-time and subscription reservation source attribution is explicit', () => {
  const h = loadInventoryHarness('ENFORCE');
  const ss = new SpreadsheetStub({});
  h.evaluateProductionInventoryForOrder_(ss, { order: 'Fatima x1' }, { orderId: 'FB-1', idempotencyKey: 'order:FB-1', correlationId: 'corr-1', fulfillmentWeek: '2026-07-24', legacyResult: 'accepted' });
  let reservations = ss.sheets['Inventory Reservations'].rows;
  assert.equal(reservations[1][6], 'ONE_TIME');
  assert.equal(reservations[1][8], 'FB-1');

  const ss2 = allocationSheet([subRow()]);
  h.SpreadsheetApp.getActiveSpreadsheet = () => ss2;
  h.allocateWeeklySubscriptionInventory('2026-07-24');
  reservations = ss2.sheets['Inventory Reservations'].rows;
  assert.equal(reservations[1][6], 'SUBSCRIPTION');
  assert.equal(reservations[1][8], 'FBS-SYNTH-001');
});

test('membership-week eligibility includes status and exclusive end-date boundaries', () => {
  const h = loadInventoryHarness('ENFORCE');
  assert.equal(h.subscriptionMembershipEligibility_(subRow(), '2026-07-24').eligible, true);
  assert.equal(h.subscriptionMembershipEligibility_(subRow({9: 'Pending Payment'}), '2026-07-24').eligible, false);
  assert.equal(h.subscriptionMembershipEligibility_(subRow({9: 'Paused'}), '2026-07-24').eligible, false);
  assert.equal(h.subscriptionMembershipEligibility_(subRow({9: 'Cancelled'}), '2026-07-24').eligible, false);
  assert.equal(h.subscriptionMembershipEligibility_(subRow(), '2026-07-17').reason, 'before_start_date');
  assert.equal(h.subscriptionMembershipEligibility_(subRow(), '2026-08-21').reason, 'at_or_after_end_date');
  const eligibleWeeks = ['2026-07-24','2026-07-31','2026-08-07','2026-08-14','2026-08-21'].filter((week) => h.subscriptionMembershipEligibility_(subRow(), week).eligible);
  assert.deepEqual(eligibleWeeks, ['2026-07-24','2026-07-31','2026-08-07','2026-08-14']);
});

test('subscription product mapping handles Fatima and exact valid specialties only', () => {
  const h = loadInventoryHarness('ENFORCE');
  assert.equal(h.subscriptionProductForTier_('Fatima Classic · 4 weeks'), 'Fatima');
  assert.equal(h.subscriptionProductForTier_('Specialty — Lourdes · 4 weeks'), 'Lourdes');
  assert.equal(h.subscriptionProductForTier_('Specialty — Guadalupe · 6 weeks'), 'Guadalupe');
  assert.equal(h.subscriptionProductForTier_('Specialty — Unknown · 4 weeks'), '');
  assert.equal(h.subscriptionProductForTier_("Pilgrim's Honey Butter · 4 weeks"), '');
});

test('subscription allocation is idempotent and does not mutate Subscriptions rows', () => {
  const h = loadInventoryHarness('ENFORCE');
  const rows = [subRow(), subRow({5: 'Specialty — Lourdes · 4 weeks', 12: 'FBS-SYNTH-002'}), subRow({5: 'Specialty — Unknown · 4 weeks', 12: 'FBS-SYNTH-003'})];
  const before = JSON.stringify([subHeader, ...rows]);
  const ss = allocationSheet(rows);
  h.SpreadsheetApp.getActiveSpreadsheet = () => ss;
  assert.equal(h.allocateWeeklySubscriptionInventory('2026-07-24').allocated, 2);
  assert.equal(h.allocateWeeklySubscriptionInventory('2026-07-24').allocated, 0);
  const reservations = ss.sheets['Inventory Reservations'].rows.slice(1);
  assert.equal(reservations.length, 2);
  assert.deepEqual(reservations.map((r) => r[3]), ['Fatima', 'Lourdes']);
  assert.equal(JSON.stringify(ss.sheets.Subscriptions.rows), before);
});


test('inventory rollout defaults OFF and exposes kill switch, dry run, and production guard config', () => {
  assert.match(code, /INVENTORY_ROLLOUT_MODE = prop_\("INVENTORY_ROLLOUT_MODE", "OFF"\)/);
  assert.match(code, /INVENTORY_KILL_SWITCH = boolProp_\("INVENTORY_KILL_SWITCH", false\)/);
  assert.match(code, /INVENTORY_DRY_RUN = boolProp_\("INVENTORY_DRY_RUN", false\)/);
  assert.match(code, /INVENTORY_PRODUCTION_SPREADSHEET_ID = prop_\("INVENTORY_PRODUCTION_SPREADSHEET_ID", ""\)/);
  assert.match(code, /if \(INVENTORY_KILL_SWITCH\) return "OFF"/);
});

test('OFF mode bypasses inventory orchestration before mutation', () => {
  assert.match(code, /if \(mode === "OFF"\) return \{ mode: "OFF", accepted: true/);
});

test('SHADOW records mismatches and does not write reservations', () => {
  const shadowBlock = code.match(/if \(mode === "SHADOW"\) \{[\s\S]*?return \{ mode: mode, accepted: true/)?.[0] ?? '';
  assert.match(shadowBlock, /recordInventoryShadowMismatch_/);
  assert.doesNotMatch(shadowBlock, /Inventory Reservations|appendRow\(/);
});

test('ENFORCE gates payment and email workflow on inventory acceptance', () => {
  const decisionIndex = code.indexOf('evaluateProductionInventoryForOrder_');
  const paymentIndex = code.indexOf('// ── Payment links');
  const emailIndex = code.indexOf('sendOrderReceivedEmail', paymentIndex);
  assert.ok(decisionIndex > -1 && paymentIndex > decisionIndex);
  assert.ok(emailIndex > paymentIndex);
  assert.match(code.slice(decisionIndex, paymentIndex), /if \(inventoryDecision\.mode === "ENFORCE" && !inventoryDecision\.accepted\)/);
});

test('idempotency prevents duplicate and conflicting one-time submissions', () => {
  assert.match(code, /stableOrderIdempotencyKey_/);
  assert.match(code, /idempotency_conflict/);
  assert.match(code, /duplicate: true/);
});

test('atomic multiline policy evaluates availability before any reservation append', () => {
  const fn = code.match(/function evaluateProductionInventoryForOrder_[\s\S]*?function subscriptionAllocationIdempotencyKey_/)?.[0] ?? '';
  assert.ok(fn.indexOf('orchestrationResult = "rejected_insufficient_inventory"') < fn.indexOf('sh.appendRow'));
});

test('PII minimized structured shadow mismatch reporting fields are present', () => {
  assert.match(code, /Inventory Shadow Mismatches/);
  for (const field of ['Order or Membership ID','Fulfillment Week','Correlation ID','Mode','Source Type','Legacy Result','Orchestration Result','Mismatch Type']) {
    assert.match(code, new RegExp(field));
  }
});

test('subscription compatibility allocation is boundary-only and idempotent', () => {
  assert.match(code, /function allocateWeeklySubscriptionInventory/);
  assert.match(code, /subscriptionMembershipEligibility_\(rows\[i\], fulfillmentWeek\)/);
  assert.match(code, /subscriptionAllocationIdempotencyKey_\(membershipId, fulfillmentWeek\)/);
  assert.match(code, /sourceType: "SUBSCRIPTION"/);
  assert.match(code, /rejected_invalid_product_mapping/);
});
