import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  "apps-script/Code.js",
  "utf8"
);

function extractFunction(name) {
  const match = source.match(
    new RegExp(
      `\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`
    )
  );

  if (!match) {
    throw new Error(`Function not found: ${name}`);
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

function extractObjectAssignment(name) {
  const match = source.match(
    new RegExp(`\\bvar\\s+${name}\\s*=\\s*\\{`)
  );

  if (!match) {
    throw new Error(`Object not found: ${name}`);
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
    extractObjectAssignment("SUBSCRIPTIONS"),
    extractFunction("normalizeSubscriptionTier"),
    extractFunction("normalizeSubscriptionKind_"),
    extractFunction("validateSubscriptionPlan_")
  ].join("\n\n"),
  sandbox
);

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

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

function expectThrow(fn) {
  let error = null;

  try {
    fn();
  } catch (caught) {
    error = caught;
  }

  assert(error, "Expected an error.");
}

const expectedPrices = {
  specialty: {
    "4 weeks": 58,
    "6 weeks": 84,
    "8 weeks": 104
  },
  bakers_choice: {
    "4 weeks": 58,
    "6 weeks": 84,
    "8 weeks": 104
  }
};

for (const kind of [
  "classic",
  "specialty",
  "bakers_choice"
]) {
  for (const tier of [
    "4 weeks",
    "6 weeks",
    "8 weeks"
  ]) {
    test(`${kind} supports ${tier}`, () => {
      const plan =
        sandbox.validateSubscriptionPlan_({
          subscription_kind: kind,
          subscription_tier: tier
        });

      assert(plan.kind === kind, `Received ${plan.kind}.`);
      assert(plan.tier === tier, `Received ${plan.tier}.`);
      assert(
        Number(plan.info.price) > 0,
        "Price must be positive."
      );

      if (expectedPrices[kind]) {
        assert(
          Number(plan.info.price) ===
            expectedPrices[kind][tier],
          `Expected $${expectedPrices[kind][tier]}, ` +
          `received $${plan.info.price}.`
        );
      }

      if (kind === "classic" && tier === "6 weeks") {
        assert(
          Number(plan.info.price) === 60,
          "Classic six-week plan must be $60."
        );
      }
    });
  }
}

test("Legacy Fatima input normalizes to Classic", () => {
  const plan = sandbox.validateSubscriptionPlan_({
    subscription_kind: "fatima",
    subscription_tier: "6 weeks"
  });

  assert(plan.kind === "classic", plan.kind);
  assert(Number(plan.info.price) === 60, plan.info.price);
});

test("Baker's Choice punctuation normalizes", () => {
  const plan = sandbox.validateSubscriptionPlan_({
    subscription_kind: "Baker's Choice",
    subscription_tier: "4 weeks"
  });

  assert(plan.kind === "bakers_choice", plan.kind);
  assert(Number(plan.info.price) === 58, plan.info.price);
});

test("Missing kind is rejected", () => {
  expectThrow(() =>
    sandbox.validateSubscriptionPlan_({
      subscription_tier: "6 weeks"
    })
  );
});

test("Unknown kind is rejected", () => {
  expectThrow(() =>
    sandbox.validateSubscriptionPlan_({
      subscription_kind: "surprise me",
      subscription_tier: "6 weeks"
    })
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
