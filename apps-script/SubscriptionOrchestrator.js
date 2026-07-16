/**
 * Fatima Bakery — Loaf Reserve workflow orchestrator
 *
 * This file contains the workflow engine only.
 * Production adapters will be connected in a later phase.
 *
 * It must not:
 * - restrict subscription volume
 * - write directly to spreadsheets
 * - call payment providers directly
 * - send email directly
 */

function normalizeSubscriptionPaymentMethod_(data) {
  data = data || {};

  var raw = String(
    data.payment_method ||
    data.paymentMethod ||
    data.payment ||
    ""
  ).toLowerCase().trim();

  raw = raw.replace(/[\s_-]+/g, "");

  if (raw === "square") return "square";
  if (raw === "venmo") return "venmo";

  if (
    raw === "cashapp" ||
    raw === "cash" ||
    raw === "$cashapp"
  ) {
    return "cashapp";
  }

  throw new Error(
    "Please choose Square, Venmo, or Cash App as the payment method."
  );
}


function subscriptionWorkflowResult_(requestId) {
  return {
    requestId: requestId || "",
    subscriptionId: "",
    status: "RECEIVED",
    duplicate: false,

    plan: null,
    payment: null,

    stages: {
      validation: "PENDING",
      registration: "PENDING",
      payment: "PENDING",
      customerNotification: "PENDING",
      ownerNotification: "PENDING"
    },

    errors: []
  };
}


function recordSubscriptionWorkflowError_(result, stage, code, error) {
  var message = error && error.message
    ? String(error.message)
    : String(error || "Unknown error");

  result.errors.push({
    stage: stage,
    code: code,
    message: message
  });
}


function transitionSubscriptionWorkflow_(result, stage, state, adapters) {
  result.stages[stage] = state;

  if (
    adapters &&
    typeof adapters.onTransition === "function"
  ) {
    adapters.onTransition({
      requestId: result.requestId,
      subscriptionId: result.subscriptionId,
      stage: stage,
      state: state
    });
  }
}


/**
 * Executes one durable Loaf Reserve registration workflow.
 *
 * The adapters object supplies external behavior so the workflow can
 * be regression-tested without production services.
 */
function runSubscriptionWorkflow_(data, adapters) {
  data = data || {};
  adapters = adapters || {};

  var requiredAdapters = [
    "validatePlan",
    "findExisting",
    "register",
    "createPayment",
    "notifyCustomer",
    "notifyOwner",
    "createRequestId"
  ];

  for (var i = 0; i < requiredAdapters.length; i++) {
    var adapterName = requiredAdapters[i];

    if (typeof adapters[adapterName] !== "function") {
      throw new Error(
        "Missing subscription workflow adapter: " + adapterName
      );
    }
  }

  var suppliedRequestId = String(
    data.request_id ||
    data.requestId ||
    data.client_request_id ||
    ""
  ).trim();

  var requestId = suppliedRequestId ||
    String(adapters.createRequestId(data) || "").trim();

  if (!requestId) {
    throw new Error(
      "The subscription workflow could not create a request ID."
    );
  }

  var result = subscriptionWorkflowResult_(requestId);

  /*
   * Idempotency must happen before validation and registration.
   * A repeated request must return the existing subscription rather
   * than create another spreadsheet row.
   */
  var existing = adapters.findExisting(requestId);

  if (existing) {
    result.subscriptionId = String(existing.subscriptionId || "");
    result.status = "DUPLICATE_ACCEPTED";
    result.duplicate = true;
    result.plan = existing.plan || null;
    result.payment = existing.payment || null;

    transitionSubscriptionWorkflow_(
      result,
      "validation",
      "PREVIOUSLY_VALIDATED",
      adapters
    );

    transitionSubscriptionWorkflow_(
      result,
      "registration",
      "PREVIOUSLY_RECORDED",
      adapters
    );

    transitionSubscriptionWorkflow_(
      result,
      "payment",
      existing.payment ? "PREVIOUSLY_READY" : "PENDING_RETRY",
      adapters
    );

    return result;
  }

  var plan;
  var paymentMethod;

  try {
    plan = adapters.validatePlan(data);
    paymentMethod = normalizeSubscriptionPaymentMethod_(data);

    result.plan = {
      tier: plan.tier,
      kind: plan.kind,
      price: Number(plan.info && plan.info.price),
      description: String(
        plan.info && plan.info.desc || ""
      ),
      paymentMethod: paymentMethod
    };

    transitionSubscriptionWorkflow_(
      result,
      "validation",
      "VALIDATED",
      adapters
    );
  } catch (validationError) {
    result.status = "REJECTED";
    transitionSubscriptionWorkflow_(
      result,
      "validation",
      "FAILED",
      adapters
    );

    recordSubscriptionWorkflowError_(
      result,
      "validation",
      "INVALID_SUBSCRIPTION",
      validationError
    );

    return result;
  }

  var registration;

  try {
    registration = adapters.register({
      requestId: requestId,
      data: data,
      plan: plan,
      paymentMethod: paymentMethod
    });

    if (!registration || !registration.subscriptionId) {
      throw new Error(
        "Subscription registration returned no subscription ID."
      );
    }

    result.subscriptionId = String(registration.subscriptionId);

    transitionSubscriptionWorkflow_(
      result,
      "registration",
      "RECORDED",
      adapters
    );
  } catch (registrationError) {
    result.status = "FAILED_NOT_RECORDED";

    transitionSubscriptionWorkflow_(
      result,
      "registration",
      "FAILED",
      adapters
    );

    recordSubscriptionWorkflowError_(
      result,
      "registration",
      "REGISTRATION_FAILED",
      registrationError
    );

    return result;
  }

  /*
   * Payment creation is independent from registration.
   * A payment-provider failure must never delete or invalidate the
   * recorded subscription.
   */
  try {
    result.payment = adapters.createPayment({
      requestId: requestId,
      subscriptionId: result.subscriptionId,
      registration: registration,
      plan: plan,
      paymentMethod: paymentMethod,
      data: data
    });

    if (
      !result.payment ||
      result.payment.status !== "ready"
    ) {
      throw new Error(
        "Payment instructions were not returned as ready."
      );
    }

    transitionSubscriptionWorkflow_(
      result,
      "payment",
      "READY",
      adapters
    );
  } catch (paymentError) {
    transitionSubscriptionWorkflow_(
      result,
      "payment",
      "FAILED_RETRYABLE",
      adapters
    );

    recordSubscriptionWorkflowError_(
      result,
      "payment",
      "PAYMENT_INSTRUCTIONS_FAILED",
      paymentError
    );
  }

  /*
   * Customer notification and owner notification are independent.
   * Failure of either must not prevent the other from being attempted.
   */
  try {
    adapters.notifyCustomer({
      requestId: requestId,
      subscriptionId: result.subscriptionId,
      registration: registration,
      plan: plan,
      paymentMethod: paymentMethod,
      payment: result.payment,
      paymentState: result.stages.payment,
      data: data
    });

    transitionSubscriptionWorkflow_(
      result,
      "customerNotification",
      "SENT",
      adapters
    );
  } catch (customerError) {
    transitionSubscriptionWorkflow_(
      result,
      "customerNotification",
      "FAILED_RETRYABLE",
      adapters
    );

    recordSubscriptionWorkflowError_(
      result,
      "customerNotification",
      "CUSTOMER_NOTIFICATION_FAILED",
      customerError
    );
  }

  try {
    adapters.notifyOwner({
      requestId: requestId,
      subscriptionId: result.subscriptionId,
      registration: registration,
      plan: plan,
      paymentMethod: paymentMethod,
      payment: result.payment,
      paymentState: result.stages.payment,
      customerNotificationState:
        result.stages.customerNotification,
      data: data
    });

    transitionSubscriptionWorkflow_(
      result,
      "ownerNotification",
      "SENT",
      adapters
    );
  } catch (ownerError) {
    transitionSubscriptionWorkflow_(
      result,
      "ownerNotification",
      "FAILED_RETRYABLE",
      adapters
    );

    recordSubscriptionWorkflowError_(
      result,
      "ownerNotification",
      "OWNER_NOTIFICATION_FAILED",
      ownerError
    );
  }

  if (result.errors.length === 0) {
    result.status = "READY_FOR_PAYMENT";
  } else {
    result.status = "ACCEPTED_WITH_PENDING_ACTIONS";
  }

  return result;
}
