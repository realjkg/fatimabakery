/**
 * Fatima Bakery — Loaf Reserve retry engine
 *
 * Replays only incomplete workflow stages.
 * It does not access production services directly.
 */

function subscriptionRetryPlan_(existing) {
  existing = existing || {};
  var storedPlan = existing.plan || {};

  return {
    tier: storedPlan.tier,
    kind: storedPlan.kind,

    info: {
      price: Number(storedPlan.price || 0),
      desc: String(
        storedPlan.description ||
        storedPlan.desc ||
        ""
      )
    }
  };
}


function retrySubscriptionWorkflow_(requestId, adapters) {
  requestId = String(requestId || "").trim();
  adapters = adapters || {};

  if (!requestId) {
    throw new Error(
      "A subscription request ID is required for retry."
    );
  }

  var requiredAdapters = [
    "findExisting",
    "createPayment",
    "notifyCustomer",
    "notifyOwner"
  ];

  for (var i = 0; i < requiredAdapters.length; i++) {
    var adapterName = requiredAdapters[i];

    if (typeof adapters[adapterName] !== "function") {
      throw new Error(
        "Missing subscription retry adapter: " +
        adapterName
      );
    }
  }

  var result = subscriptionWorkflowResult_(requestId);
  var existing = adapters.findExisting(requestId);

  if (!existing) {
    result.status = "NOT_FOUND";

    recordSubscriptionWorkflowError_(
      result,
      "registration",
      "SUBSCRIPTION_NOT_FOUND",
      new Error(
        "No subscription exists for request ID " +
        requestId +
        "."
      )
    );

    return result;
  }

  result.subscriptionId = String(
    existing.subscriptionId || ""
  );

  if (!result.subscriptionId) {
    result.status = "NOT_RECORDED";

    recordSubscriptionWorkflowError_(
      result,
      "registration",
      "SUBSCRIPTION_NOT_RECORDED",
      new Error(
        "The subscription has no persisted subscription ID."
      )
    );

    return result;
  }

  var plan = subscriptionRetryPlan_(existing);
  var paymentMethod = String(
    existing.paymentMethod ||
    existing.payment &&
      existing.payment.method ||
    ""
  );

  var originalData = existing.data || {};

  result.plan = {
    tier: plan.tier,
    kind: plan.kind,
    price: Number(plan.info.price),
    description: String(plan.info.desc || ""),
    paymentMethod: paymentMethod
  };

  result.payment = existing.payment || null;

  result.stages.validation = "PREVIOUSLY_VALIDATED";
  result.stages.registration = "PREVIOUSLY_RECORDED";

  result.stages.payment =
    result.payment &&
    result.payment.status === "ready"
      ? "READY"
      : existing.stages &&
          existing.stages.payment ||
        "PENDING_RETRY";

  result.stages.customerNotification =
    existing.stages &&
    existing.stages.customerNotification ||
    "PENDING_RETRY";

  result.stages.ownerNotification =
    existing.stages &&
    existing.stages.ownerNotification ||
    "PENDING_RETRY";

  var registration = existing;
  var paymentBecameReady = false;

  /*
   * Retry payment only when no ready payment exists.
   */
  if (
    !result.payment ||
    result.payment.status !== "ready"
  ) {
    try {
      result.payment = adapters.createPayment({
        requestId: requestId,
        subscriptionId: result.subscriptionId,
        registration: registration,
        plan: plan,
        paymentMethod: paymentMethod,
        data: originalData
      });

      if (
        !result.payment ||
        result.payment.status !== "ready"
      ) {
        throw new Error(
          "Payment instructions were not returned as ready."
        );
      }

      paymentBecameReady = true;

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
  }

  /*
   * Retry customer notification when:
   * - it previously failed, or
   * - a payment link has just been recovered.
   *
   * The payment recovery case ensures the customer receives the
   * newly available payment URL without creating another subscription.
   */
  var shouldNotifyCustomer =
    result.stages.payment === "READY" &&
    (
      paymentBecameReady ||
      result.stages.customerNotification !== "SENT"
    );

  if (shouldNotifyCustomer) {
    try {
      adapters.notifyCustomer({
        requestId: requestId,
        subscriptionId: result.subscriptionId,
        registration: registration,
        plan: plan,
        paymentMethod: paymentMethod,
        payment: result.payment,
        paymentState: result.stages.payment,
        data: originalData,
        retry: true
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
  }

  /*
   * Retry owner notification only when it did not previously succeed.
   */
  if (result.stages.ownerNotification !== "SENT") {
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
        data: originalData,
        retry: true
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
  }

  var pending =
    result.stages.payment !== "READY" ||
    result.stages.customerNotification !== "SENT" ||
    result.stages.ownerNotification !== "SENT";

  result.status = pending
    ? "RETRY_PENDING"
    : "RETRY_COMPLETE";

  return result;
}
