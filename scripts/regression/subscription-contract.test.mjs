import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("apps-script/Code.js", "utf8");

function extractFunction(name) {
  const match = source.match(
    new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`)
  );

  if (!match) throw new Error(`Function not found: ${name}`);

  const start = match.index;
  const brace = source.indexOf("{", start);
  let depth = 0;

  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;

    if (depth === 0) return source.slice(start, i + 1);
  }

  throw new Error(`Unclosed function: ${name}`);
}

function extractObjectAssignment(name) {
  const marker = new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\{`);
  const match = source.match(marker);

  if (!match) throw new Error(`Object assignment not found: ${name}`);

  const start = match.index;
  const brace = source.indexOf("{", start);
  let depth = 0;

  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;

    if (depth === 0) {
      const semicolon = source.indexOf(";", i);
      return source.slice(start, semicolon + 1);
    }
  }

  throw new Error(`Unclosed object assignment: ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);

vm.runInContext(
  [
    extractObjectAssignment("SUBSCRIPTIONS"),
    extractFunction("normalizeSubscriptionTier"),
    extractFunction("normalizeSubscriptionKind_"),
    extractFunction("validateSubscriptionPlan_")
  ].join("\n\n"),
  sandbox
);

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: "PASS" });
  } catch (error) {
    tests.push({ name, status: "FAIL", detail: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectThrow(fn, expectedText) {
  let thrown = null;

  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert(thrown, "Expected function to throw.");

  if (expectedText) {
    assert(
      String(thrown.message).includes(expectedText),
      `Expected error containing "${expectedText}", received "${thrown.message}".`
    );
  }
}

test("Explicit six-week tier normalizes correctly", () => {
  assert(
    sandbox.normalizeSubscriptionTier({ subscription_tier: "6 weeks" }) === "6 weeks",
    "6 weeks did not normalize correctly."
  );
});

test("Numeric six-week tier normalizes correctly", () => {
  assert(
    sandbox.normalizeSubscriptionTier({ tier: "6" }) === "6 weeks",
    "Numeric tier 6 did not normalize correctly."
  );
});

test("Six-week Classic Loaf Reserve is exactly $60", () => {
  const plan = sandbox.validateSubscriptionPlan_({
    subscription_tier: "6 weeks",
    subscription_kind: "fatima"
  });

  assert(plan.tier === "6 weeks", "Wrong tier returned.");
  assert(plan.kind === "classic", "Wrong subscription kind returned.");
  assert(Number(plan.info.price) === 60, `Expected $60, received $${plan.info.price}.`);
});

test("Specialty plan remains separate from Classic plan", () => {
  const plan = sandbox.validateSubscriptionPlan_({
    subscription_tier: "6 weeks",
    subscription_kind: "specialty"
  });

  assert(plan.kind === "specialty", "Specialty plan was misclassified.");
  assert(Number(plan.info.price) > 0, "Specialty plan has no valid price.");
});

test("Missing tier is rejected", () => {
  expectThrow(
    () => sandbox.normalizeSubscriptionTier({}),
    "Please choose a valid Loaf Reserve plan"
  );
});

test("Invalid tier is rejected", () => {
  expectThrow(
    () => sandbox.normalizeSubscriptionTier({ tier: "5 weeks" }),
    "Please choose a valid Loaf Reserve plan"
  );
});

test("Notes cannot choose a tier", () => {
  expectThrow(
    () => sandbox.normalizeSubscriptionTier({
      notes: "Please sign me up for six weeks"
    }),
    "Please choose a valid Loaf Reserve plan"
  );
});

test("Order text cannot choose a tier", () => {
  expectThrow(
    () => sandbox.normalizeSubscriptionTier({
      order: "6 week membership"
    }),
    "Please choose a valid Loaf Reserve plan"
  );
});

test("Subscription handler contains no capacity restriction", () => {
  const handler = extractFunction("handleSubscription");

  const forbidden =
    /\bBOULE_LIMIT\b|\bSPECIALTY_LIMIT\b|\bCOMBINED_LIMIT\b|\bENFORCE_CAPACITY_LIMITS\b|\bwaitlist\b|\bsold[\s_-]*out\b/i;

  assert(
    !forbidden.test(handler),
    "Capacity, waitlist, or sold-out logic exists in handleSubscription()."
  );
});

for (const result of tests) {
  console.log(
    `${result.status}: ${result.name}${result.detail ? ` — ${result.detail}` : ""}`
  );
}

const failed = tests.filter(test => test.status === "FAIL");

console.log("");
console.log(`${tests.length - failed.length} passed, ${failed.length} failed.`);

process.exit(failed.length ? 1 : 0);
