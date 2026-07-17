import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("apps-script/Code.js", "utf8");

function extractFunction(name) {
  const match = source.match(
    new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`)
  );

  if (!match) {
    throw new Error(`Missing function: ${name}`);
  }

  const start = match.index;
  const brace = source.indexOf("{", start);
  let depth = 0;

  for (let i = brace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;

    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }

  throw new Error(`Unclosed function: ${name}`);
}

function extractObject(name) {
  const match = source.match(
    new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\{`)
  );

  if (!match) {
    throw new Error(`Missing object: ${name}`);
  }

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

  throw new Error(`Unclosed object: ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);

vm.runInContext(
  [
    extractObject("SUBSCRIPTIONS"),
    extractFunction("normalizeSubscriptionTier"),
    extractFunction("normalizeSubscriptionKind_"),
    extractFunction("validateSubscriptionPlan_"),
    extractFunction("subscriptionLoafLabel_")
  ].join("\n\n"),
  sandbox
);

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, status: "PASS" });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error.message
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function plan(kind, tier = "6 weeks") {
  return sandbox.validateSubscriptionPlan_({
    subscription_kind: kind,
    subscription_tier: tier
  });
}

test("Classic labels as Fatima Classic", () => {
  const label = sandbox.subscriptionLoafLabel_(
    plan("classic"),
    {
      subscription_loaf: "Specialty",
      subscription_specialty: "Ignore this"
    }
  );

  assert(label === "Fatima Classic", label);
});

test("Specialty includes selected flavor", () => {
  const label = sandbox.subscriptionLoafLabel_(
    plan("specialty"),
    {
      subscription_specialty: "Rosemary Sea Salt"
    }
  );

  assert(
    label === "Specialty — Rosemary Sea Salt",
    label
  );
});

test("Specialty works without a flavor", () => {
  const label = sandbox.subscriptionLoafLabel_(
    plan("specialty"),
    {}
  );

  assert(label === "Specialty", label);
});

test("Baker's Choice remains distinct", () => {
  const label = sandbox.subscriptionLoafLabel_(
    plan("bakers_choice"),
    {
      subscription_loaf: "Fatima Classic"
    }
  );

  assert(label === "Baker's Choice", label);
});

test("Legacy Fatima input labels as Classic", () => {
  const label = sandbox.subscriptionLoafLabel_(
    plan("fatima"),
    {}
  );

  assert(label === "Fatima Classic", label);
});

test("Subscription copy uses Loaf Reserve", () => {
  assert(
    !source.includes("Pilgrim Membership"),
    "Obsolete Pilgrim Membership wording remains."
  );

  assert(
    source.includes("Loaf Reserve"),
    "Loaf Reserve wording is missing."
  );
});

for (const result of results) {
  console.log(
    `${result.status}: ${result.name}` +
    `${result.detail ? ` — ${result.detail}` : ""}`
  );
}

const failed = results.filter(
  result => result.status === "FAIL"
);

console.log("");
console.log(
  `${results.length - failed.length} passed, ` +
  `${failed.length} failed.`
);

process.exit(failed.length ? 1 : 0);
