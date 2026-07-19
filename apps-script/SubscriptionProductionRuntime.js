/**
 * Fatima Bakery — Loaf Reserve production runtime
 *
 * Connects the tested subscription workflow engine to:
 * - the Subscriptions sheet
 * - Square/Cash App/Venmo helpers
 * - customer and owner email helpers
 * - durable retry state
 */

function getSubscriptionsSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Subscriptions");

  if (!sheet) {
    throw new Error("Subscriptions sheet not found.");
  }

  ensureSubscriptionWorkflowColumns_(sheet);
  return sheet;
}


function ensureSubscriptionWorkflowColumns_(sheet) {
  var requiredHeaders = subscriptionSheetHeaders_();
  var lastColumn = Math.max(sheet.getLastColumn(), 1);
  var existing = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0];

  validateSubscriptionHeaders_(existing);

  if (lastColumn < requiredHeaders.length) {
    sheet
      .getRange(
        1,
        lastColumn + 1,
        1,
        requiredHeaders.length - lastColumn
      )
      .setValues([
        requiredHeaders.slice(lastColumn)
      ]);
  }

  return subscriptionColumnMap_();
}


function createSubscriptionRequestId_(data) {
  data = data || {};

  var supplied = String(
    data.request_id ||
    data.requestId ||
    data.client_request_id ||
    ""
  ).trim();

  if (supplied) return supplied;

  return "FBR-" +
    new Date().getTime() +
    "-" +
    Utilities.getUuid().slice(0, 8);
}


function findSubscriptionRowByColumn_(sheet, column, value) {
  value = String(value || "").trim();
  if (!value || sheet.getLastRow() <= 1) return null;

  var values = sheet
    .getRange(2, column, sheet.getLastRow() - 1, 1)
    .getDisplayValues();

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === value) {
      return i + 2;
    }
  }

  return null;
}


function subscriptionRecordFromRow_(sheet, row) {
  var map = subscriptionColumnMap_();
  var values = sheet
    .getRange(row, 1, 1, subscriptionSheetHeaders_().length)
    .getValues()[0];

  var tierText = String(values[map["Tier"] - 1] || "");
  var tierMatch = tierText.match(/(4|6|8)\s*weeks/i);
  var tier = tierMatch ? tierMatch[1] + " weeks" : "4 weeks";

  var loafLabel = tierText
    .replace(/·\s*(4|6|8)\s*weeks/i, "")
    .trim() || "Fatima Classic";

  var price = Number(
    String(values[map["Price"] - 1] || "")
      .replace(/[^0-9.]/g, "")
  ) || 0;

  return {
    row: row,
    requestId: String(values[map["Request ID"] - 1] || ""),
    subscriptionId: String(values[map["Sub ID"] - 1] || ""),

    data: {
      name: values[map["Name"] - 1] || "",
      phone: formatPhone_(values[map["Phone"] - 1] || ""),
      ig_handle: values[map["Instagram"] - 1] || "",
      email: values[map["Email"] - 1] || "",
      preferred_date: values[map["Start Date"] - 1] || "",
      notes: values[map["Notes"] - 1] || "",
      source: values[map["Source"] - 1] || ""
    },

    plan: {
      tier: tier,
      kind: loafLabel,
      price: price,
      description: "Reserved weekly loaf membership."
    },

    paymentMethod:
      String(values[map["Payment Method"] - 1] || "cashapp"),

    payment: {
      status:
        String(values[map["Payment Status"] - 1] || "")
          .toLowerCase() === "ready"
          ? "ready"
          : "pending",
      url: String(values[map["Payment URL"] - 1] || "")
    },

    stages: {
      payment:
        String(values[map["Payment Status"] - 1] || "PENDING"),
      customerNotification:
        String(values[map["Customer Notice"] - 1] || "PENDING"),
      ownerNotification:
        String(values[map["Owner Notice"] - 1] || "PENDING")
    }
  };
}


function updateSubscriptionWorkflowFields_(sheet, row, updates) {
  updates = updates || {};
  var map = subscriptionColumnMap_();

  Object.keys(updates).forEach(function(header) {
    if (!map[header]) return;

    sheet
      .getRange(row, map[header])
      .setValue(updates[header]);
  });

  sheet
    .getRange(row, map["Updated At"])
    .setValue(new Date());
}


function createSubscriptionProductionServices_() {
  return {
    createRequestId: function(data) {
      return createSubscriptionRequestId_(data);
    },

    validatePlan: function(data) {
      return validateSubscriptionPlan_(data);
    },

    findExisting: function(requestId) {
      var sheet = getSubscriptionsSheet_();
      var map = subscriptionColumnMap_();
      var row = findSubscriptionRowByColumn_(
        sheet,
        map["Request ID"],
        requestId
      );

      return row
        ? subscriptionRecordFromRow_(sheet, row)
        : null;
    },

    register: function(context) {
      var sheet = getSubscriptionsSheet_();
      var map = subscriptionColumnMap_();
      var data = context.data || {};
      var plan = context.plan;
      var tier = plan.tier;
      var subInfo = plan.info;
      var loafLabel =
        subscriptionLoafLabel_(plan, data);

      var subId = "FBS-" + new Date().getTime();

      data.phone = formatPhone_(
        data.phone || data.Phone || ""
      );

      var startDate = data.preferred_date || "";
      var endDate = "";

      if (startDate) {
        var weeks =
          parseInt(tier.split(" ")[0], 10) || 4;
        var sd = new Date(startDate);
        sd.setDate(sd.getDate() + weeks * 7);

        endDate = Utilities.formatDate(
          sd,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        );
      }

      var row = new Array(
        subscriptionSheetHeaders_().length
      ).fill("");

      row[map["Timestamp"] - 1] = new Date();
      row[map["Name"] - 1] = data.name || "";
      row[map["Phone"] - 1] = data.phone || "";
      row[map["Instagram"] - 1] =
        data.ig_handle || "";
      row[map["Email"] - 1] = data.email || "";
      row[map["Tier"] - 1] =
        loafLabel + " · " + tier;
      row[map["Price"] - 1] =
        "$" + Number(subInfo.price || 0).toFixed(2);
      row[map["Start Date"] - 1] = startDate;
      row[map["End Date"] - 1] = endDate;
      row[map["Status"] - 1] = "Pending Payment";
      row[map["Notes"] - 1] = data.notes || "";
      row[map["Source"] - 1] = data.source || "";
      row[map["Sub ID"] - 1] = subId;

      row[map["Request ID"] - 1] =
        context.requestId;
      row[map["Workflow Status"] - 1] =
        "REGISTERED";
      row[map["Payment Method"] - 1] =
        context.paymentMethod;
      row[map["Payment Status"] - 1] =
        "PENDING";
      row[map["Customer Notice"] - 1] =
        "PENDING";
      row[map["Owner Notice"] - 1] =
        "PENDING";
      row[map["Retry Count"] - 1] = 0;
      row[map["Updated At"] - 1] = new Date();

      sheet.appendRow(row);

      return {
        row: sheet.getLastRow(),
        subscriptionId: subId,
        loafLabel: loafLabel,
        startDate: startDate,
        endDate: endDate,
        data: data
      };
    },

    createPayment: function(context) {
      var data = context.data || {};
      var plan = context.plan;
      var price = Number(plan.info.price || 0);
      var subId = context.subscriptionId;
      var loafLabel =
        context.registration.loafLabel ||
        subscriptionLoafLabel_(plan, data);

      var totalFmt =
        "$" + price.toFixed(2);

      var payment = {
        status: "ready",
        method: context.paymentMethod,
        squareUrl: "",
        cashUrl: createCashAppLink(totalFmt),
        venmoUrl: createVenmoLink(totalFmt, subId),
        url: ""
      };

      if (context.paymentMethod === "square") {
        payment.squareUrl = createSquarePaymentLink(
          price * 100,
          subId,
          data.name,
          "Loaf Reserve — " +
            loafLabel +
            " · " +
            plan.tier
        );

        payment.url = payment.squareUrl;
      } else if (context.paymentMethod === "venmo") {
        payment.url = payment.venmoUrl;
      } else {
        payment.url = payment.cashUrl;
      }

      return payment;
    },

    notifyCustomer: function(context) {
      if (!context.data || !context.data.email) {
        return;
      }

      sendSubscriptionEmail(
        context.data,
        context.plan.tier,
        context.plan.info,
        context.payment &&
          context.payment.squareUrl || null,
        context.subscriptionId,
        context.registration.loafLabel ||
          context.plan.kind ||
          "Fatima Classic",
        context.payment &&
          context.payment.cashUrl || null,
        context.payment &&
          context.payment.venmoUrl || null
      );
    },

    notifyOwner: function(context) {
      sendOwnerSubscriptionAlert(
        context.data,
        context.plan.tier,
        context.plan.info,
        context.subscriptionId,
        context.payment &&
          context.payment.squareUrl || null,
        context.registration.loafLabel ||
          context.plan.kind ||
          "Fatima Classic",
        context.payment &&
          context.payment.cashUrl || null,
        context.payment &&
          context.payment.venmoUrl || null
      );
    },

    onTransition: function(event) {
      var sheet = getSubscriptionsSheet_();
      var map = subscriptionColumnMap_();

      var row = findSubscriptionRowByColumn_(
        sheet,
        map["Request ID"],
        event.requestId
      );

      if (!row) return;

      var updates = {};

      if (event.stage === "payment") {
        updates["Payment Status"] = event.state;
      }

      if (event.stage === "customerNotification") {
        updates["Customer Notice"] = event.state;
      }

      if (event.stage === "ownerNotification") {
        updates["Owner Notice"] = event.state;
      }

      updateSubscriptionWorkflowFields_(
        sheet,
        row,
        updates
      );
    }
  };
}


function createSubscriptionProductionRuntime_() {
  return createSubscriptionProductionAdapters_(
    createSubscriptionProductionServices_()
  );
}
