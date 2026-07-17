import fs from "node:fs";
import vm from "node:vm";

const gateSource = fs.readFileSync(
  "apps-script/SubscriptionProductionGate.js",
  "utf8"
);

const adaptersSource = fs.readFileSync(
  "apps-script/SubscriptionProductionAdapters.js",
  "utf8"
);

const sandbox = {
  PropertiesService: {
    getScriptProperties() {
      return {
        getProperty() {
          return "";
        }
      };
    }
  }
};

vm.createContext(sandbox);

vm.runInContext(
  gateSource + "\n\n" + adaptersSource,
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

function expectThrow(fn, text) {
  let error = null;

  try {
    fn();
  } catch (caught) {
    error = caught;
  }

  assert(error, "Expected an error.");

  if (text) {
    assert(
      String(error.message).includes(text),
      `Expected "${text}", received "${error.message}".`
    );
  }
}

function setFlag(value) {
  sandbox.PropertiesService = {
    getScriptProperties() {
      return {
        getProperty(name) {
          assert(
            name ===
              "SUBSCRIPTION_ORCHESTRATION_ENABLED",
            `Unexpected property name: ${name}`
          );

          return value;
        }
      };
    }
  };
}

function createServices(calls) {
  return {
    createRequestId(data) {
      calls.push("createRequestId");
      return data.request_id || "REQ-PROD-001";
    },

    validatePlan(data) {
      calls.push("validatePlan");

      return {
        tier: data.subscription_tier,
        kind: data.subscription_kind,
        info: {
          price: 60,
          desc: "Fatima Classic Loaf Reserve"
        }
      };
    },

    findExisting(requestId) {
      calls.push("findExisting");
      return null;
    },

    register(context) {
      calls.push("register");

      return {
        subscriptionId: "FBS-PROD-001",
        requestId: context.requestId
      };
    },

    createPayment(context) {
      calls.push("createPayment");

      return {
        method: context.paymentMethod,
        status: "ready",
        paymentUrl:
          "https://payments.invalid/test"
      };
    },

    notifyCustomer() {
      calls.push("notifyCustomer");
      return { status: "sent" };
    },

    notifyOwner() {
      calls.push("notifyOwner");
      return { status: "sent" };
    },

    onTransition() {
      calls.push("onTransition");
    }
  };
}

test("Empty feature flag remains disabled", () => {
  setFlag("");

  assert(
    sandbox.subscriptionOrchestrationEnabled_() ===
      false,
    "Empty flag unexpectedly enabled orchestration."
  );
});

test("Only true enables orchestration", () => {
  setFlag(" true ");

  assert(
    sandbox.subscriptionOrchestrationEnabled_() ===
      true,
    "The true flag did not enable orchestration."
  );
});

test("Numeric one does not enable orchestration", () => {
  setFlag("1");

  assert(
    sandbox.subscriptionOrchestrationEnabled_() ===
      false,
    "Numeric one unexpectedly enabled orchestration."
  );
});

test("Property-service failure defaults to disabled", () => {
  sandbox.PropertiesService = {
    getScriptProperties() {
      throw new Error("Mock property failure.");
    }
  };

  assert(
    sandbox.subscriptionOrchestrationEnabled_() ===
      false,
    "Property failure did not fail closed."
  );
});

test("Disabled gate routes to legacy handler", () => {
  setFlag("false");

  let legacyCalls = 0;
  let orchestratedCalls = 0;

  const result =
    sandbox.routeSubscriptionWorkflow_(
      { request_id: "REQ-LEGACY" },
      { mockSpreadsheet: true },
      {
        legacy(data, spreadsheet) {
          legacyCalls++;

          assert(
            spreadsheet.mockSpreadsheet === true,
            "Spreadsheet context was lost."
          );

          return "legacy-result";
        },

        orchestrated() {
          orchestratedCalls++;
          return "orchestrated-result";
        }
      }
    );

  assert(result === "legacy-result", result);
  assert(legacyCalls === 1, "Legacy handler was not called.");
  assert(
    orchestratedCalls === 0,
    "Orchestrated handler ran while disabled."
  );
});

test("Enabled gate routes to orchestrated handler", () => {
  setFlag("true");

  let legacyCalls = 0;
  let orchestratedCalls = 0;

  const result =
    sandbox.routeSubscriptionWorkflow_(
      { request_id: "REQ-ORCHESTRATED" },
      { mockSpreadsheet: true },
      {
        legacy() {
          legacyCalls++;
          return "legacy-result";
        },

        orchestrated(data, spreadsheet) {
          orchestratedCalls++;

          assert(
            data.request_id === "REQ-ORCHESTRATED",
            "Subscription data was lost."
          );

          assert(
            spreadsheet.mockSpreadsheet === true,
            "Spreadsheet context was lost."
          );

          return "orchestrated-result";
        }
      }
    );

  assert(result === "orchestrated-result", result);
  assert(
    orchestratedCalls === 1,
    "Orchestrated handler was not called."
  );
  assert(
    legacyCalls === 0,
    "Legacy handler ran while enabled."
  );
});

test("Adapter contract rejects missing services", () => {
  expectThrow(
    () =>
      sandbox.createSubscriptionProductionAdapters_(
        {}
      ),
    "Missing production subscription service"
  );
});

test("Production adapters delegate every service", () => {
  const calls = [];
  const services = createServices(calls);

  const adapters =
    sandbox.createSubscriptionProductionAdapters_(
      services
    );

  adapters.createRequestId({
    request_id: "REQ-PROD-TEST"
  });

  adapters.validatePlan({
    subscription_tier: "6 weeks",
    subscription_kind: "classic"
  });

  adapters.findExisting("REQ-PROD-TEST");

  adapters.register({
    requestId: "REQ-PROD-TEST"
  });

  adapters.createPayment({
    paymentMethod: "square"
  });

  adapters.notifyCustomer({});
  adapters.notifyOwner({});
  adapters.onTransition({});

  const expected = [
    "createRequestId",
    "validatePlan",
    "findExisting",
    "register",
    "createPayment",
    "notifyCustomer",
    "notifyOwner",
    "onTransition"
  ];

  assert(
    JSON.stringify(calls) ===
      JSON.stringify(expected),
    `Unexpected adapter calls: ${calls.join(", ")}`
  );
});

test("Production adapter contract contains no infrastructure calls", () => {
  const forbidden =
    /SpreadsheetApp|MailApp|UrlFetchApp|PropertiesService|BOULE_LIMIT|SPECIALTY_LIMIT|COMBINED_LIMIT|waitlist|sold[\s_-]*out/i;

  assert(
    !forbidden.test(adaptersSource),
    "Infrastructure or capacity code exists in adapter contract."
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
