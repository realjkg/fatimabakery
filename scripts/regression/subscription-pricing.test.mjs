import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("apps-script/Code.js", "utf8");

function extractFunction(name) {
  const match = source.match(
    new RegExp(`\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`)
  );

  if (!match) throw new Error(`Missing function: ${name}`);

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

  if (!match) throw new Error(`Missing object: ${name}`);

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
    extractFunction("validateSubscriptionPlan_")
  ].join("\n\n"),
  sandbox
);

const matrix = {
  classic: {
    "4 weeks": 44,
    "6 weeks": 60,
    "8 weeks": 72
  },
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

let failed = 0;
let passed = 0;

for (const [kind, tiers] of Object.entries(matrix)) {
  for (const [tier, expectedPrice] of Object.entries(tiers)) {
    try {
      const plan = sandbox.validateSubscriptionPlan_({
        subscription_kind: kind,
        subscription_tier: tier
      });

      if (plan.kind !== kind) {
        throw new Error(`Expected kind ${kind}, received ${plan.kind}.`);
      }

      if (Number(plan.info.price) !== expectedPrice) {
        throw new Error(
          `Expected $${expectedPrice}, received $${plan.info.price}.`
        );
      }

      console.log(`PASS: ${kind} / ${tier} = $${expectedPrice}`);
      passed++;
    } catch (error) {
      console.log(`FAIL: ${kind} / ${tier} — ${error.message}`);
      failed++;
    }
  }
}

console.log("");
console.log(`${passed} passed, ${failed} failed.`);

process.exit(failed ? 1 : 0);
