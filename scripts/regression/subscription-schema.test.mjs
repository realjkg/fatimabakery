import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(
  "apps-script/SubscriptionWorkflowSchema.js",
  "utf8"
);

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

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

const expectedLegacy = [
  "Timestamp",
  "Name",
  "Phone",
  "Instagram",
  "Email",
  "Tier",
  "Price",
  "Start Date",
  "End Date",
  "Status",
  "Notes",
  "Source",
  "Sub ID"
];

const expectedWorkflow = [
  "Request ID",
  "Workflow Status",
  "Payment Method",
  "Payment Status",
  "Payment URL",
  "Customer Notice",
  "Owner Notice",
  "Retry Count",
  "Last Error",
  "Updated At"
];

test("Legacy subscription layout remains unchanged", () => {
  assert(
    JSON.stringify(
      Array.from(sandbox.LEGACY_SUBSCRIPTION_HEADERS_)
    ) === JSON.stringify(expectedLegacy),
    "The original 13 subscription columns changed."
  );
});

test("Workflow columns append after legacy columns", () => {
  const headers = Array.from(
    sandbox.subscriptionSheetHeaders_()
  );

  assert(
    headers.length === 23,
    `Expected 23 columns, received ${headers.length}.`
  );

  assert(
    JSON.stringify(headers.slice(0, 13)) ===
      JSON.stringify(expectedLegacy),
    "Workflow columns altered the legacy layout."
  );

  assert(
    JSON.stringify(headers.slice(13)) ===
      JSON.stringify(expectedWorkflow),
    "Workflow columns are incorrect."
  );
});

test("Sub ID remains column 13", () => {
  const map = sandbox.subscriptionColumnMap_();

  assert(
    map["Sub ID"] === 13,
    `Sub ID moved to column ${map["Sub ID"]}.`
  );
});

test("Request ID begins at column 14", () => {
  const map = sandbox.subscriptionColumnMap_();

  assert(
    map["Request ID"] === 14,
    `Request ID is column ${map["Request ID"]}.`
  );
});

test("Workflow status is column 15", () => {
  const map = sandbox.subscriptionColumnMap_();

  assert(
    map["Workflow Status"] === 15,
    `Workflow Status is column ${map["Workflow Status"]}.`
  );
});

test("All headers are unique", () => {
  const headers = Array.from(
    sandbox.subscriptionSheetHeaders_()
  );

  assert(
    new Set(headers).size === headers.length,
    "Duplicate subscription headers exist."
  );
});

test("Correct legacy headers validate", () => {
  assert(
    sandbox.validateSubscriptionHeaders_(
      expectedLegacy.concat(expectedWorkflow)
    ) === true,
    "Valid legacy headers were rejected."
  );
});

test("Changed legacy headers fail closed", () => {
  const headers = [...expectedLegacy];
  headers[12] = "Subscription Number";

  let error = null;

  try {
    sandbox.validateSubscriptionHeaders_(headers);
  } catch (caught) {
    error = caught;
  }

  assert(error, "Changed legacy layout was accepted.");
});

test("Workflow defaults begin pending", () => {
  const defaults =
    sandbox.subscriptionWorkflowDefaults_();

  assert(defaults.workflowStatus === "RECEIVED", defaults.workflowStatus);
  assert(defaults.paymentStatus === "PENDING", defaults.paymentStatus);
  assert(defaults.customerNotice === "PENDING", defaults.customerNotice);
  assert(defaults.ownerNotice === "PENDING", defaults.ownerNotice);
  assert(defaults.retryCount === 0, defaults.retryCount);
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
