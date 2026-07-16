import fs from "node:fs";
import vm from "node:vm";

const codeSource = fs.readFileSync(
  "apps-script/Code.js",
  "utf8"
);

const orchestratorSource = fs.readFileSync(
  "apps-script/SubscriptionOrchestrator.js",
  "utf8"
);

const adaptersSource = fs.readFileSync(
  "apps-script/SubscriptionSandboxAdapters.js",
  "utf8"
);

const scenarios = JSON.parse(
  fs.readFileSync(
    "scripts/regression/subscription-sandbox-scenarios.json",
    "utf8"
  )
);

function extractFunction(source, name) {
  const match = source.match(
    new RegExp(
      `\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`
    )
  );

  if (!match) {
    throw new Error(
      `Function not found: ${name}`
    );
  }

  const start = match.index;
  const brace = source.indexOf("{", start);
  let depth = 0;

  for (
    let index = brace;
    index < source.length;
    index++
  ) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;

    if (depth === 0) {
      return source.slice(start, index + 1);
    }
  }

  throw new Error(
    `Unclosed function: ${name}`
  );
}

function extractObjectAssignment(source, name) {
  const match = source.match(
    new RegExp(
      `\\bvar\\s+${name}\\s*=\\s*\\{`
    )
  );

  if (!match) {
    throw new Error(
      `Object not found: ${name}`
    );
  }

  const start = match.index;
  const brace = source.indexOf("{", start);
  let depth = 0;

  for (
    let index = brace;
    index < source.length;
    index++
  ) {
    if (source[index] === "{") depth++;
    if (source[index] === "}") depth--;

    if (depth === 0) {
      const semicolon =
        source.indexOf(";", index);

      return source.slice(
        start,
        semicolon + 1
      );
    }
  }

  throw new Error(
    `Unclosed object: ${name}`
  );
}

const sandbox = {};

vm.createContext(sandbox);

vm.runInContext(
  [
    extractObjectAssignment(
      codeSource,
      "SUBSCRIPTIONS"
    ),
    extractFunction(
      codeSource,
      "normalizeSubscriptionTier"
    ),
    extractFunction(codeSource, "normalizeSubscriptionKind_"),
    extractFunction(
      codeSource,
      "validateSubscriptionPlan_"
    ),
    orchestratorSource,
    adaptersSource
  ].join("\n\n"),
  sandbox
);

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({
      name,
      status: "PASS"
    });
  } catch (error) {
    results.push({
      name,
      status: "FAIL",
      detail: error.message
    });
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function count(object) {
  return Object.keys(object).length;
}

function payload(scenario) {
  return {
    request_id: "REQ-" + scenario.id,
    name: "Sandbox Subscriber",
    email:
      "regression+subscription@example.invalid",
    phone: "650-555-1212",
    subscription_tier: scenario.tier,
    subscription_kind: scenario.kind,
    payment_method: scenario.paymentMethod
  };
}

for (const scenario of scenarios) {
  test("E2E " + scenario.id, () => {
    const state =
      sandbox.createSubscriptionSandboxState_();

    const output =
      sandbox.runSubscriptionSandboxWorkflow_(
        payload(scenario),
        state,
        {}
      );

    const result = output.result;

    assert(
      result.status === "READY_FOR_PAYMENT",
      result.status
    );

    assert(
      result.stages.registration === "RECORDED",
      "Subscription was not recorded."
    );

    assert(
      result.stages.payment === "READY",
      "Payment instructions were not ready."
    );

    assert(
      result.stages.customerNotification === "SENT",
      "Customer message was not recorded."
    );

    assert(
      result.stages.ownerNotification === "SENT",
      "Owner message was not recorded."
    );

    assert(
      count(state.subscriptions) === 1,
      "Expected exactly one subscription."
    );

    assert(
      count(state.payments) === 1,
      "Expected exactly one payment record."
    );

    assert(
      state.customerMessages.length === 1,
      "Expected one customer message."
    );

    assert(
      state.ownerMessages.length === 1,
      "Expected one owner message."
    );

    assert(
      state.defects.length === 0,
      "Unexpected defect recorded."
    );

    assert(
      result.payment.paymentUrl.startsWith(
        "https://sandbox.invalid/pay/"
      ),
      "Payment URL escaped the sandbox."
    );

    if (
      scenario.expectedPrice !== undefined
    ) {
      assert(
        Number(result.plan.price) ===
          Number(scenario.expectedPrice),
        "Expected $" +
          scenario.expectedPrice +
          ", received $" +
          result.plan.price +
          "."
      );
    } else {
      assert(
        Number(result.plan.price) > 0,
        "Plan price must be positive."
      );
    }
  });
}

test(
  "Duplicate request creates no duplicate records",
  () => {
    const scenario = scenarios.find(
      item =>
        item.id === "classic-6-square"
    );

    const state =
      sandbox.createSubscriptionSandboxState_();

    const data = payload(scenario);

    const first =
      sandbox.runSubscriptionSandboxWorkflow_(
        data,
        state,
        {}
      );

    const second =
      sandbox.runSubscriptionSandboxWorkflow_(
        data,
        state,
        {}
      );

    assert(
      first.result.status ===
        "READY_FOR_PAYMENT",
      first.result.status
    );

    assert(
      second.result.status ===
        "DUPLICATE_ACCEPTED",
      second.result.status
    );

    assert(
      second.result.duplicate === true,
      "Duplicate flag missing."
    );

    assert(
      count(state.subscriptions) === 1,
      "Duplicate subscription created."
    );

    assert(
      count(state.payments) === 1,
      "Duplicate payment created."
    );

    assert(
      state.customerMessages.length === 1,
      "Duplicate customer message created."
    );

    assert(
      state.ownerMessages.length === 1,
      "Duplicate owner message created."
    );

    assert(
      state.requests[data.request_id]
        .duplicateCount === 1,
      "Duplicate count was not persisted."
    );
  }
);

test(
  "Payment failure preserves subscription",
  () => {
    const scenario = scenarios.find(
      item =>
        item.id === "classic-6-square"
    );

    const state =
      sandbox.createSubscriptionSandboxState_();

    const output =
      sandbox.runSubscriptionSandboxWorkflow_(
        payload(scenario),
        state,
        { failPayment: true }
      );

    assert(
      output.result.status ===
        "ACCEPTED_WITH_PENDING_ACTIONS",
      output.result.status
    );

    assert(
      output.result.stages.registration ===
        "RECORDED",
      "Registration was lost."
    );

    assert(
      output.result.stages.payment ===
        "FAILED_RETRYABLE",
      "Payment failure was not retryable."
    );

    assert(
      count(state.subscriptions) === 1,
      "Subscription was not persisted."
    );

    assert(
      count(state.payments) === 0,
      "Failed payment was recorded as ready."
    );

    assert(
      state.defects.some(
        defect =>
          defect.code ===
          "PAYMENT_INSTRUCTIONS_FAILED"
      ),
      "Payment defect was not recorded."
    );
  }
);

test(
  "Customer failure does not stop owner alert",
  () => {
    const scenario = scenarios.find(
      item =>
        item.id === "classic-6-venmo"
    );

    const state =
      sandbox.createSubscriptionSandboxState_();

    const output =
      sandbox.runSubscriptionSandboxWorkflow_(
        payload(scenario),
        state,
        {
          failCustomerNotification: true
        }
      );

    assert(
      output.result.stages
        .customerNotification ===
        "FAILED_RETRYABLE",
      "Customer failure was not captured."
    );

    assert(
      output.result.stages
        .ownerNotification === "SENT",
      "Owner notification was stopped."
    );

    assert(
      state.ownerMessages.length === 1,
      "Owner message is missing."
    );

    assert(
      state.defects.some(
        defect =>
          defect.code ===
          "CUSTOMER_NOTIFICATION_FAILED"
      ),
      "Customer defect was not recorded."
    );
  }
);

test(
  "Owner failure does not invalidate subscription",
  () => {
    const scenario = scenarios.find(
      item =>
        item.id === "classic-6-cashapp"
    );

    const state =
      sandbox.createSubscriptionSandboxState_();

    const output =
      sandbox.runSubscriptionSandboxWorkflow_(
        payload(scenario),
        state,
        {
          failOwnerNotification: true
        }
      );

    assert(
      output.result.stages.registration ===
        "RECORDED",
      "Registration was lost."
    );

    assert(
      output.result.stages
        .customerNotification === "SENT",
      "Customer notification was lost."
    );

    assert(
      output.result.stages
        .ownerNotification ===
        "FAILED_RETRYABLE",
      "Owner failure was not captured."
    );

    assert(
      state.defects.some(
        defect =>
          defect.code ===
          "OWNER_NOTIFICATION_FAILED"
      ),
      "Owner defect was not recorded."
    );
  }
);

test(
  "Registration failure stops downstream actions",
  () => {
    const scenario = scenarios.find(
      item =>
        item.id === "classic-6-square"
    );

    const state =
      sandbox.createSubscriptionSandboxState_();

    const output =
      sandbox.runSubscriptionSandboxWorkflow_(
        payload(scenario),
        state,
        {
          failRegistration: true
        }
      );

    assert(
      output.result.status ===
        "FAILED_NOT_RECORDED",
      output.result.status
    );

    assert(
      count(state.subscriptions) === 0,
      "Failed registration created a record."
    );

    assert(
      count(state.payments) === 0,
      "Payment ran after registration failure."
    );

    assert(
      state.customerMessages.length === 0,
      "Customer notification ran after failure."
    );

    assert(
      state.ownerMessages.length === 0,
      "Owner notification ran after failure."
    );

    assert(
      state.defects.some(
        defect =>
          defect.code ===
          "REGISTRATION_FAILED"
      ),
      "Registration defect was not recorded."
    );
  }
);

test(
  "Sandbox adapters contain no production services",
  () => {
    const forbidden =
      /SpreadsheetApp|MailApp|UrlFetchApp|PropertiesService|BOULE_LIMIT|SPECIALTY_LIMIT|COMBINED_LIMIT|ENFORCE_CAPACITY_LIMITS|waitlist|sold[\s_-]*out/i;

    assert(
      !forbidden.test(adaptersSource),
      "Production or capacity reference found."
    );
  }
);

for (const result of results) {
  console.log(
    result.status +
      ": " +
      result.name +
      (result.detail
        ? " — " + result.detail
        : "")
  );
}

const failed = results.filter(
  result => result.status === "FAIL"
);

console.log("");
console.log(
  results.length -
    failed.length +
    " passed, " +
    failed.length +
    " failed."
);

process.exit(
  failed.length ? 1 : 0
);
