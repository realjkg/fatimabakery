import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const code = readFileSync(new URL('../apps-script/Code.js', import.meta.url), 'utf8');

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
  assert.match(code, /if \(rows\[i\]\[9\] !== "Active"\) continue/);
  assert.match(code, /subscriptionAllocationIdempotencyKey_\(membershipId, fulfillmentWeek\)/);
  assert.match(code, /sourceType: "SUBSCRIPTION"/);
  assert.match(code, /rejected_invalid_product_mapping/);
});
