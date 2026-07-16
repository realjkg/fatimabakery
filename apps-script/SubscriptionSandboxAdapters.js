/**
 * Fatima Bakery — Loaf Reserve sandbox adapters
 *
 * Simulates persistence, payment instructions, and notifications.
 * Does not call production services or restrict subscription volume.
 */

function createSubscriptionSandboxState_() {
  return {
    sequence: 0,
    requests: {},
    subscriptions: {},
    payments: {},
    customerMessages: [],
    ownerMessages: [],
    transitions: [],
    defects: []
  };
}

function sandboxClone_(value) {
  if (value === null || value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function sandboxFailNow_(options, key) {
  options = options || {};

  var timesKey = key + "Times";
  var remaining = Number(options[timesKey] || 0);

  if (remaining > 0) {
    options[timesKey] = remaining - 1;
    return true;
  }

  return options[key] === true;
}

function createSandboxSubscriptionPayment_(context) {
  var method = context.paymentMethod;
  var base = "https://sandbox.invalid/pay/";

  if (
    method !== "square" &&
    method !== "venmo" &&
    method !== "cashapp"
  ) {
    throw new Error(
      "Unsupported sandbox payment method: " + method
    );
  }

  return {
    method: method,
    status: "ready",
    reference: context.subscriptionId,
    amount: Number(context.plan.info.price),
    paymentUrl:
      base +
      method +
      "/" +
      encodeURIComponent(context.subscriptionId)
  };
}

function createSubscriptionSandboxAdapters_(state, options) {
  state = state || createSubscriptionSandboxState_();
  options = options || {};

  function getRecordByRequest_(requestId) {
    return state.requests[String(requestId || "")] || null;
  }

  function updateRecord_(requestId, updates) {
    var record = getRecordByRequest_(requestId);
    if (!record) return;

    Object.keys(updates || {}).forEach(function(key) {
      record[key] = updates[key];
    });

    state.requests[requestId] = record;
    state.subscriptions[record.subscriptionId] = record;
  }

  return {
    createRequestId: function() {
      state.sequence += 1;
      return "REQ-SBX-" + state.sequence;
    },

    validatePlan: function(data) {
      return validateSubscriptionPlan_(data);
    },

    findExisting: function(requestId) {
      return sandboxClone_(
        getRecordByRequest_(requestId)
      );
    },

    register: function(context) {
      if (
        sandboxFailNow_(
          options,
          "failRegistration"
        )
      ) {
        throw new Error(
          "Sandbox registration unavailable."
        );
      }

      state.sequence += 1;

      var subscriptionId =
        options.subscriptionId ||
        "FBS-SBX-" + state.sequence;

      var record = {
        requestId: context.requestId,
        subscriptionId: subscriptionId,
        status: "RECORDED",

        plan: {
          tier: context.plan.tier,
          kind: context.plan.kind,
          price: Number(context.plan.info.price),
          description: String(
            context.plan.info.desc || ""
          )
        },

        paymentMethod: context.paymentMethod,
        payment: null,
        stages: {},
        duplicateCount: 0,

        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.requests[context.requestId] = record;
      state.subscriptions[subscriptionId] = record;

      return sandboxClone_(record);
    },

    createPayment: function(context) {
      if (
        sandboxFailNow_(
          options,
          "failPayment"
        )
      ) {
        throw new Error(
          "Sandbox payment provider unavailable."
        );
      }

      var payment =
        createSandboxSubscriptionPayment_(context);

      state.payments[context.subscriptionId] =
        payment;

      updateRecord_(context.requestId, {
        payment: payment,
        updatedAt: new Date().toISOString()
      });

      return sandboxClone_(payment);
    },

    notifyCustomer: function(context) {
      if (
        sandboxFailNow_(
          options,
          "failCustomerNotification"
        )
      ) {
        throw new Error(
          "Sandbox customer notification unavailable."
        );
      }

      var message = {
        channel: "sandbox-email-sink",
        audience: "customer",
        requestId: context.requestId,
        subscriptionId: context.subscriptionId,
        plan: context.plan.tier,
        amount: Number(context.plan.info.price),
        paymentMethod: context.paymentMethod,
        paymentState: context.paymentState,
        paymentUrl:
          context.payment &&
          context.payment.paymentUrl ||
          ""
      };

      state.customerMessages.push(message);

      return sandboxClone_(message);
    },

    notifyOwner: function(context) {
      if (
        sandboxFailNow_(
          options,
          "failOwnerNotification"
        )
      ) {
        throw new Error(
          "Sandbox owner notification unavailable."
        );
      }

      var message = {
        channel: "sandbox-email-sink",
        audience: "owner",
        requestId: context.requestId,
        subscriptionId: context.subscriptionId,
        plan: context.plan.tier,
        amount: Number(context.plan.info.price),
        paymentMethod: context.paymentMethod,
        paymentState: context.paymentState,
        customerNotificationState:
          context.customerNotificationState
      };

      state.ownerMessages.push(message);

      return sandboxClone_(message);
    },

    onTransition: function(event) {
      state.transitions.push(
        sandboxClone_(event)
      );

      var record =
        getRecordByRequest_(event.requestId);

      if (!record) return;

      record.stages[event.stage] = event.state;
      record.updatedAt =
        new Date().toISOString();

      state.requests[event.requestId] = record;
      state.subscriptions[
        record.subscriptionId
      ] = record;
    }
  };
}

function persistSubscriptionSandboxResult_(state, result) {
  var record = state.requests[result.requestId];

  /*
   * Duplicate requests must not overwrite the original
   * successful workflow state.
   */
  if (record && result.duplicate) {
    record.duplicateCount =
      Number(record.duplicateCount || 0) + 1;

    record.lastDuplicateAt =
      new Date().toISOString();

    record.updatedAt =
      record.lastDuplicateAt;

    state.requests[result.requestId] = record;
    state.subscriptions[
      record.subscriptionId
    ] = record;
  } else if (record) {
    record.status = result.status;
    record.stages =
      sandboxClone_(result.stages);
    record.payment =
      sandboxClone_(result.payment);
    record.updatedAt =
      new Date().toISOString();

    state.requests[result.requestId] = record;
    state.subscriptions[
      record.subscriptionId
    ] = record;
  }

  for (
    var i = 0;
    i < result.errors.length;
    i++
  ) {
    state.defects.push({
      requestId: result.requestId,
      subscriptionId: result.subscriptionId,
      stage: result.errors[i].stage,
      code: result.errors[i].code,
      message: result.errors[i].message,
      createdAt: new Date().toISOString()
    });
  }
}

function runSubscriptionSandboxWorkflow_(
  data,
  state,
  options
) {
  state =
    state ||
    createSubscriptionSandboxState_();

  var adapters =
    createSubscriptionSandboxAdapters_(
      state,
      options
    );

  var result =
    runSubscriptionWorkflow_(
      data,
      adapters
    );

  persistSubscriptionSandboxResult_(
    state,
    result
  );

  return {
    result: sandboxClone_(result),
    state: state
  };
}
