/**
 * Fatima Bakery — Loaf Reserve production adapter contract
 *
 * The actual Sheets, payment, and email bindings will be supplied
 * in the next phase after the current production helpers are mapped.
 */

function requiredSubscriptionProductionServices_() {
  return [
    "createRequestId",
    "validatePlan",
    "findExisting",
    "register",
    "createPayment",
    "notifyCustomer",
    "notifyOwner"
  ];
}


function validateSubscriptionProductionServices_(services) {
  services = services || {};

  var required =
    requiredSubscriptionProductionServices_();

  for (var i = 0; i < required.length; i++) {
    var name = required[i];

    if (typeof services[name] !== "function") {
      throw new Error(
        "Missing production subscription service: " +
        name
      );
    }
  }

  return services;
}


function createSubscriptionProductionAdapters_(services) {
  services =
    validateSubscriptionProductionServices_(
      services
    );

  return {
    createRequestId: function(data) {
      return services.createRequestId(data);
    },

    validatePlan: function(data) {
      return services.validatePlan(data);
    },

    findExisting: function(requestId) {
      return services.findExisting(requestId);
    },

    register: function(context) {
      return services.register(context);
    },

    createPayment: function(context) {
      return services.createPayment(context);
    },

    notifyCustomer: function(context) {
      return services.notifyCustomer(context);
    },

    notifyOwner: function(context) {
      return services.notifyOwner(context);
    },

    onTransition: function(event) {
      if (
        typeof services.onTransition === "function"
      ) {
        return services.onTransition(event);
      }

      return null;
    }
  };
}
