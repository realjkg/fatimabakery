/**
 * Fatima Bakery — Loaf Reserve production feature gate
 *
 * The orchestrated subscription path remains disabled unless the
 * Script Property SUBSCRIPTION_ORCHESTRATION_ENABLED equals "true".
 */

var SUBSCRIPTION_ORCHESTRATION_FLAG_ =
  "SUBSCRIPTION_ORCHESTRATION_ENABLED";


function parseSubscriptionOrchestrationFlag_(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "true";
}


function subscriptionOrchestrationEnabled_() {
  try {
    var properties =
      PropertiesService.getScriptProperties();

    return parseSubscriptionOrchestrationFlag_(
      properties.getProperty(
        SUBSCRIPTION_ORCHESTRATION_FLAG_
      )
    );
  } catch (error) {
    // Fail closed. The legacy subscription path remains active.
    return false;
  }
}


/**
 * Routes a subscription through explicitly supplied handlers.
 *
 * This function is not yet connected to handleSubscription().
 */
function routeSubscriptionWorkflow_(
  data,
  spreadsheet,
  handlers
) {
  handlers = handlers || {};

  if (typeof handlers.legacy !== "function") {
    throw new Error(
      "A legacy subscription handler is required."
    );
  }

  if (!subscriptionOrchestrationEnabled_()) {
    return handlers.legacy(data, spreadsheet);
  }

  if (typeof handlers.orchestrated !== "function") {
    throw new Error(
      "The orchestrated subscription handler is unavailable."
    );
  }

  return handlers.orchestrated(
    data,
    spreadsheet
  );
}
