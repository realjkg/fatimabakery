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

const retrySource = fs.readFileSync(
  "apps-script/SubscriptionRetry.js",
  "utf8"
);

const adaptersSource = fs.readFileSync(
  "apps-script/SubscriptionSandboxAdapters.js",
  "utf8"
);

function extractFunction(source, name) {
  const match = source.match(
    new RegExp(
      `\\bfunction\\s+${name}\\s*\\([^)]*\\)\\s*\\{`
    )
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

function extractObject(source, name) {
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
    extractObject(codeSource, "SUBSCRIPTIONS"),
    extractFunction(codeSource, "normalizeSubscriptionTier"),
    extractFunction(codeSource, "normalizeSubscriptionKind_"),
    extractFunction(codeSource, "validateSubscriptionPlan_"),
    orchestratorSource,
    retrySource,
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

function subscriptionData(requestId) {
  return {
    request_id: requestId,
    name: "Retry Subscriber",
    email: "retry@example.invalid",
    phone: "650-555-1212",
    subscription_tier: "6 weeks",
    subscription_kind: "classic",
    payment_method: "square"
  };
}

test("Payment recovery creates no duplicate subscription", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const data = subscriptionData("REQ-RETRY-PAYMENT");

  const first =
    sandbox.runSubscriptionSandboxWorkflow_(
      data,
      state,
      { failPayment: true }
    );

  assert(
    first.result.stages.payment === "FAILED_RETRYABLE",
    "Initial payment failure was not captured."
  );

  const subscriptionCount = count(state.subscriptions);
  const ownerCount = state.ownerMessages.length;

  const retry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      data.request_id,
      state,
      {}
    );

  assert(
    retry.result.status === "RETRY_COMPLETE",
    `Expected RETRY_COMPLETE, received ${retry.result.status}.`
  );

  assert(
    retry.result.stages.payment === "READY",
    "Payment did not recover."
  );

  assert(
    count(state.subscriptions) === subscriptionCount,
    "Retry created another subscription."
  );

  assert(
    count(state.payments) === 1,
    "Expected exactly one successful payment."
  );

  assert(
    state.ownerMessages.length === ownerCount,
    "Successful owner notice was duplicated."
  );
});

test("Repeated payment retry is idempotent", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const data = subscriptionData("REQ-RETRY-IDEMPOTENT");

  sandbox.runSubscriptionSandboxWorkflow_(
    data,
    state,
    { failPayment: true }
  );

  sandbox.retrySubscriptionSandboxWorkflow_(
    data.request_id,
    state,
    {}
  );

  const before = {
    subscriptions: count(state.subscriptions),
    payments: count(state.payments),
    customers: state.customerMessages.length,
    owners: state.ownerMessages.length
  };

  const secondRetry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      data.request_id,
      state,
      {}
    );

  assert(
    secondRetry.result.status === "RETRY_COMPLETE",
    secondRetry.result.status
  );

  assert(
    count(state.subscriptions) === before.subscriptions,
    "Repeated retry created another subscription."
  );

  assert(
    count(state.payments) === before.payments,
    "Repeated retry created another payment."
  );

  assert(
    state.customerMessages.length === before.customers,
    "Repeated retry duplicated the customer notice."
  );

  assert(
    state.ownerMessages.length === before.owners,
    "Repeated retry duplicated the owner notice."
  );
});

test("Customer notification can be retried independently", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const data = subscriptionData("REQ-RETRY-CUSTOMER");

  const first =
    sandbox.runSubscriptionSandboxWorkflow_(
      data,
      state,
      { failCustomerNotification: true }
    );

  assert(
    first.result.stages.customerNotification ===
      "FAILED_RETRYABLE",
    "Customer failure was not captured."
  );

  const retry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      data.request_id,
      state,
      {}
    );

  assert(
    retry.result.status === "RETRY_COMPLETE",
    retry.result.status
  );

  assert(
    count(state.subscriptions) === 1,
    "Customer retry created another subscription."
  );

  assert(
    count(state.payments) === 1,
    "Customer retry duplicated the payment."
  );

  assert(
    state.customerMessages.length === 1,
    "Customer notice was not retried exactly once."
  );

  assert(
    state.ownerMessages.length === 1,
    "Owner notice was duplicated."
  );
});

test("Owner notification can be retried independently", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const data = subscriptionData("REQ-RETRY-OWNER");

  const first =
    sandbox.runSubscriptionSandboxWorkflow_(
      data,
      state,
      { failOwnerNotification: true }
    );

  assert(
    first.result.stages.ownerNotification ===
      "FAILED_RETRYABLE",
    "Owner failure was not captured."
  );

  const retry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      data.request_id,
      state,
      {}
    );

  assert(
    retry.result.status === "RETRY_COMPLETE",
    retry.result.status
  );

  assert(
    count(state.subscriptions) === 1,
    "Owner retry created another subscription."
  );

  assert(
    count(state.payments) === 1,
    "Owner retry duplicated the payment."
  );

  assert(
    state.customerMessages.length === 1,
    "Customer notice was duplicated."
  );

  assert(
    state.ownerMessages.length === 1,
    "Owner notice was not retried exactly once."
  );
});

test("Retrying a successful workflow is a no-op", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const data = subscriptionData("REQ-RETRY-NOOP");

  sandbox.runSubscriptionSandboxWorkflow_(
    data,
    state,
    {}
  );

  const before = {
    subscriptions: count(state.subscriptions),
    payments: count(state.payments),
    customers: state.customerMessages.length,
    owners: state.ownerMessages.length
  };

  const retry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      data.request_id,
      state,
      {}
    );

  assert(
    retry.result.status === "RETRY_COMPLETE",
    retry.result.status
  );

  assert(
    count(state.subscriptions) === before.subscriptions,
    "No-op retry created another subscription."
  );

  assert(
    count(state.payments) === before.payments,
    "No-op retry created another payment."
  );

  assert(
    state.customerMessages.length === before.customers,
    "No-op retry duplicated the customer notice."
  );

  assert(
    state.ownerMessages.length === before.owners,
    "No-op retry duplicated the owner notice."
  );
});

test("Unknown request returns NOT_FOUND", () => {
  const state =
    sandbox.createSubscriptionSandboxState_();

  const retry =
    sandbox.retrySubscriptionSandboxWorkflow_(
      "REQ-DOES-NOT-EXIST",
      state,
      {}
    );

  assert(
    retry.result.status === "NOT_FOUND",
    retry.result.status
  );

  assert(
    count(state.subscriptions) === 0,
    "Unknown retry created a subscription."
  );

  assert(
    count(state.payments) === 0,
    "Unknown retry created a payment."
  );
});

test("Retry engine contains no production services", () => {
  const forbidden =
    /SpreadsheetApp|MailApp|UrlFetchApp|PropertiesService|BOULE_LIMIT|SPECIALTY_LIMIT|COMBINED_LIMIT|ENFORCE_CAPACITY_LIMITS|waitlist|sold[\s_-]*out/i;

  assert(
    !forbidden.test(retrySource),
    "Production or capacity reference found in retry engine."
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
