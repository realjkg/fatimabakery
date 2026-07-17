/**
 * Fatima Bakery — Loaf Reserve workflow schema
 *
 * The first 13 columns are the existing production layout.
 * Workflow columns are appended after them.
 */

var LEGACY_SUBSCRIPTION_HEADERS_ = [
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

var SUBSCRIPTION_WORKFLOW_HEADERS_ = [
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

function subscriptionSheetHeaders_() {
  return LEGACY_SUBSCRIPTION_HEADERS_.concat(
    SUBSCRIPTION_WORKFLOW_HEADERS_
  );
}

function subscriptionColumnMap_() {
  var headers = subscriptionSheetHeaders_();
  var map = {};

  for (var i = 0; i < headers.length; i++) {
    map[headers[i]] = i + 1;
  }

  return map;
}

function validateSubscriptionHeaders_(headers) {
  headers = headers || [];

  for (
    var i = 0;
    i < LEGACY_SUBSCRIPTION_HEADERS_.length;
    i++
  ) {
    if (headers[i] !== LEGACY_SUBSCRIPTION_HEADERS_[i]) {
      throw new Error(
        "Subscriptions sheet legacy column mismatch at column " +
        (i + 1) +
        ": expected " +
        LEGACY_SUBSCRIPTION_HEADERS_[i] +
        "."
      );
    }
  }

  return true;
}

function subscriptionWorkflowDefaults_() {
  return {
    requestId: "",
    workflowStatus: "RECEIVED",
    paymentMethod: "",
    paymentStatus: "PENDING",
    paymentUrl: "",
    customerNotice: "PENDING",
    ownerNotice: "PENDING",
    retryCount: 0,
    lastError: "",
    updatedAt: ""
  };
}
