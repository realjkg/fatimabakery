import fs from "node:fs";
import vm from "node:vm";

const orchestratorSource = fs.readFileSync(
  "apps-script/SubscriptionOrchestrator.js",
  "utf8"
);

const codeSource = fs.readFileSync(
  "apps-script/Code.js",
  "utf8"
);

function extractFunction(source, name) {
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

function extractObjectAssignment(source, name) {
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
    extractObjectAssignment(codeSource, "SUBSCRIPTIONS"),
    extractFunction(codeSource, "normalizeSubscriptionTier"),
    extractFunction(codeSource, "normalizeSubscriptionKind_"),
    extractFunction(codeSource, "validateSubscriptionPlan_"),
    orchestratorSource
  ].join("\n\n"),
  sandbox
);

const tests = [];

function test(name, fn) {
  try {
    fn();
    tests.push({ name, status: "PASS" });
  } catch (error) {
    tests.push({
      name,
      status: "FAIL",
      detail: error.message
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function createHarness(options = {}) {
  const records = new Map();
  const transitions = [];
  const calls = {
    findExisting: 0,
    register: 0,
    createPayment: 0,
    notifyCustomer: 0,
    notifyOwner: 0
  };

  const adapters = {
    createRequestId() {
      return options.requestId || "REQ-6-WEEK-001";
    },

    validatePlan(data) {
      return sandbox.validateSubscriptionPlan_(data);
    },

    findExisting(requestId) {
      calls.findExisting++;
      return records.get(requestId) || null;
    },

    register(context) {
      calls.register++;

      if (options.failRegistration) {
        throw new Error("Mock registration unavailable.");
      }

      const record = {
        subscriptionId:
          options.subscriptionId || "FBS-MOCK-001",
        requestId: context.requestId,
        plan: {
          tier: context.plan.tier,
          kind: context.plan.kind,
          price: Number(context.plan.info.price)
        },
        payment: null
      };

      records.set(context.requestId, record);
      return record;
    },

    createPayment(context) {
      calls.createPayment++;

      if (options.failPayment) {
        throw new Error("Mock payment provider unavailable.");
      }

      const payment = {
        method: context.paymentMethod,
        status: "ready",
        reference: context.subscriptionId,
        paymentUrl:
          `https://payments.invalid/${context.paymentMethod}/` +
          context.subscriptionId
      };

      const existing = records.get(context.requestId);
      if (existing) existing.payment = payment;

      return payment;
    },

    notifyCustomer() {
      calls.notifyCustomer++;

      if (options.failCustomerNotification) {
        throw new Error("Mock customer email quota exceeded.");
      }

      return { status: "sent" };
    },

    notifyOwner() {
      calls.notifyOwner++;

      if (options.failOwnerNotification) {
        throw new Error("Mock owner notification unavailable.");
      }

      return { status: "sent" };
    },

    onTransition(event) {
      transitions.push(event);
    }
  };

  return {
    adapters,
    records,
    transitions,
    calls
  };
}

function sixWeekData(paymentMethod) {
  return {
    request_id: "REQ-6-WEEK-001",
    name: "Regression Subscriber",
    email: "regression+subscription@example.invalid",
    phone: "650-555-1212",
    subscription_tier: "6 weeks",
    subscription_kind: "fatima",
    payment_method: paymentMethod
  };
}

test("Six-week Square registration reaches READY_FOR_PAYMENT", () => {
  const harness = createHarness();

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("square"),
    harness.adapters
  );

  assert(result.status === "READY_FOR_PAYMENT", result.status);
  assert(result.plan.price === 60, "Expected $60.");
  assert(result.payment.method === "square", "Wrong method.");
  assert(result.stages.registration === "RECORDED", "Not recorded.");
  assert(result.stages.payment === "READY", "Payment not ready.");
  assert(result.stages.customerNotification === "SENT", "Customer not notified.");
  assert(result.stages.ownerNotification === "SENT", "Owner not notified.");
});

test("Six-week Venmo registration reaches READY_FOR_PAYMENT", () => {
  const harness = createHarness();

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("venmo"),
    harness.adapters
  );

  assert(result.status === "READY_FOR_PAYMENT", result.status);
  assert(result.plan.price === 60, "Expected $60.");
  assert(result.payment.method === "venmo", "Wrong method.");
});

test("Six-week Cash App registration reaches READY_FOR_PAYMENT", () => {
  const harness = createHarness();

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("Cash App"),
    harness.adapters
  );

  assert(result.status === "READY_FOR_PAYMENT", result.status);
  assert(result.plan.price === 60, "Expected $60.");
  assert(result.payment.method === "cashapp", "Wrong method.");
});

test("Payment failure preserves recorded subscription", () => {
  const harness = createHarness({ failPayment: true });

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("square"),
    harness.adapters
  );

  assert(
    result.status === "ACCEPTED_WITH_PENDING_ACTIONS",
    result.status
  );

  assert(
    result.stages.registration === "RECORDED",
    "Subscription was not preserved."
  );

  assert(
    result.stages.payment === "FAILED_RETRYABLE",
    "Payment failure was not retryable."
  );

  assert(
    harness.calls.notifyCustomer === 1,
    "Customer notification was not attempted."
  );

  assert(
    harness.calls.notifyOwner === 1,
    "Owner notification was not attempted."
  );
});

test("Customer email failure does not stop owner alert", () => {
  const harness = createHarness({
    failCustomerNotification: true
  });

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("square"),
    harness.adapters
  );

  assert(
    result.stages.customerNotification === "FAILED_RETRYABLE",
    "Customer failure was not captured."
  );

  assert(
    result.stages.ownerNotification === "SENT",
    "Owner alert should still be sent."
  );

  assert(
    harness.calls.notifyOwner === 1,
    "Owner alert was not attempted."
  );
});

test("Owner alert failure does not invalidate subscription", () => {
  const harness = createHarness({
    failOwnerNotification: true
  });

  const result = sandbox.runSubscriptionWorkflow_(
    sixWeekData("venmo"),
    harness.adapters
  );

  assert(
    result.stages.registration === "RECORDED",
    "Subscription registration was lost."
  );

  assert(
    result.stages.ownerNotification === "FAILED_RETRYABLE",
    "Owner failure was not captured."
  );

  assert(
    result.status === "ACCEPTED_WITH_PENDING_ACTIONS",
    result.status
  );
});

test("Duplicate request does not create another registration", () => {
  const harness = createHarness();

  const first = sandbox.runSubscriptionWorkflow_(
    sixWeekData("square"),
    harness.adapters
  );

  const second = sandbox.runSubscriptionWorkflow_(
    sixWeekData("square"),
    harness.adapters
  );

  assert(first.subscriptionId === second.subscriptionId, "IDs differ.");
  assert(second.duplicate === true, "Duplicate not identified.");
  assert(second.status === "DUPLICATE_ACCEPTED", second.status);
  assert(harness.calls.register === 1, "Duplicate row would be created.");
  assert(harness.calls.createPayment === 1, "Duplicate payment would be created.");
});

test("Invalid tier is rejected before registration", () => {
  const harness = createHarness();

  const data = sixWeekData("square");
  data.subscription_tier = "5 weeks";

  const result = sandbox.runSubscriptionWorkflow_(
    data,
    harness.adapters
  );

  assert(result.status === "REJECTED", result.status);
  assert(harness.calls.register === 0, "Invalid plan was recorded.");
  assert(harness.calls.createPayment === 0, "Payment was attempted.");
});

test("Missing payment method is rejected before registration", () => {
  const harness = createHarness();

  const data = sixWeekData("");
  delete data.payment_method;

  const result = sandbox.runSubscriptionWorkflow_(
    data,
    harness.adapters
  );

  assert(result.status === "REJECTED", result.status);
  assert(harness.calls.register === 0, "Missing method was recorded.");
});

test("Orchestrator contains no subscription capacity controls", () => {
  const forbidden =
    /\bBOULE_LIMIT\b|\bSPECIALTY_LIMIT\b|\bCOMBINED_LIMIT\b|\bENFORCE_CAPACITY_LIMITS\b|\bwaitlist\b|\bsold[\s_-]*out\b/i;

  assert(
    !forbidden.test(orchestratorSource),
    "Capacity or sold-out logic found in orchestrator."
  );
});

for (const result of tests) {
  console.log(
    `${result.status}: ${result.name}` +
    `${result.detail ? ` — ${result.detail}` : ""}`
  );
}

const failed = tests.filter(result => result.status === "FAIL");

console.log("");
console.log(`${tests.length - failed.length} passed, ${failed.length} failed.`);

process.exit(failed.length ? 1 : 0);
