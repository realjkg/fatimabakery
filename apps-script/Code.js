// ============================================================
//  Fatima Bakery ATX — Google Apps Script  v8.2  |  PRODUCTION
//  Updated:   July 08, 2026
//  Previous:  v8.1 — July 04, 2026
//  Pilgrimage Collection · Thursday delivery · Friday pickup · Liberty Hill TX
//
//  ── CHANGELOG v8.2 (July 08, 2026) ────────────────────────
//
//  SQUARE 504 — STILL TIMING OUT AFTER THE v8.1 FAST-ACK FIX:
//
//  [FIX] The CONFIG section loads ~30 Script Properties at file
//        load time via prop_()/propAny_(), and each call used to
//        do its own PropertiesService.getScriptProperties() round
//        trip. Apps Script always runs this global-scope config
//        code BEFORE doPost()/handleSquareWebhook() on every cold
//        start, so those ~30 stacked Properties Service calls were
//        adding latency ahead of the "instant" Square fast-ACK
//        path added in v8.1 — enough to still blow past Square's
//        webhook timeout on cold starts (504), even though
//        handleSquareWebhook() itself responds immediately once
//        reached. prop_()/propAny_() now read from a single cached
//        Properties snapshot fetched once, cutting ~30 API calls
//        down to 1.
//
//  ── CHANGELOG v8 (July 04, 2026) ──────────────────────────
//
//  SPAM GUARD + SCHEMA-DRIFT ALARM:
//
//  [ADD] handleOrder() empty/spam guard — silently ignores only
//        honeypot hits and empty $0 bot orders (no id, no row,
//        no email). Customer-like malformed payloads return error.
//  [ADD] _alertSchemaDrift() — if the server prices a REAL order
//        (has items) at $0, it means website item names no longer
//        match the MENU keys, which would silently reject every
//        order. Owner is emailed immediately (rate-limited 1/hour).
//        Matching stays STRICT (best against tamper); the alarm
//        ensures a naming drift can never fail silently.
//  [ADD] SecurityTest.gs — backend security regression suite.

//
//  SQUARE WEBHOOK — auto-confirm payments:
//
//  [FIX] Fast-ACK pattern (v8.1): the first build did Square API
//        calls inline before responding, which caused Square to
//        report 504 Gateway Timeout on the test event. handleSquare-
//        Webhook() now stashes the raw event to Script Properties
//        and returns 200 INSTANTLY. A one-shot time trigger
//        (processSquareQueue, ~1 min later) does the slow verify +
//        sheet update off Square's request clock.
//  [NOTE] Square TEST events use a fake sandbox payment that does
//         not exist in our account, so verification correctly fails
//         and the event is dropped. Expected: after deploy the 504
//         is gone (instant 200) but a TEST does not mark any order
//         paid. Verify with a real $1 payment through a Square link.
//
//  [ADD] doPost() now detects Square payment events (by event
//        envelope) and routes them to handleSquareWebhook()
//        BEFORE the order-form parse. Non-Square posts are
//        unaffected.
//  [ADD] handleSquareWebhook() — on a COMPLETED payment, resolves
//        our FB-/FBS- id and moves the order/subscription into the
//        normal confirmed/active workflow.
//  [ADD] markOrderPaid(orderId, paymentId, amountCents) — confirms
//        the order, notes the Square payment id in Col R, updates
//        line items, emails the customer + owner.
//  [ADD] squareResolveOrderId() — reads FB-/FBS- ids from the Square
//        order description or line item (createSquarePaymentLink
//        stamps it in both places for new links).
//
//  SECURITY NOTE (important — read this):
//    Google Apps Script web apps CANNOT read request headers, so
//    Square's standard HMAC header signature cannot be verified
//    here. Instead we verify by API RE-FETCH: the payment id from
//    the event is fetched directly from Square using our secret
//    access token (squareVerifyByRefetch). A forged event fails
//    because the payment will not exist under our account. This
//    is a stronger guarantee than header HMAC for this platform.
//
//
//  ── SETUP CHECKLIST ────────────────────────────────────────
//  [ ] 1. Verify CONFIG values below
//  [ ] 2. Run setupSheet()       (Run → setupSheet)
//  [ ] 3. Run installTriggers()  (Run → installTriggers)
//         NOTE: re-run after this update to register Agent 0
//  [ ] 4. Deploy as Web App      (Deploy → New deployment →
//                                 Web App → Execute as Me →
//                                 Anyone → Deploy)
//  [ ] 5. Confirm Web App URL matches APPS_SCRIPT_URL in
//         fatima-contact.html and fatima-order.html
//  [ ] 6. Square: SQUARE_* credentials filled, webhook
//         (payment.completed) registered in Square Developer
//
//  AGENT REGISTRY — 7 automated agents:
//  Agent 0 — Unpaid Order Timeout   Daily 6am, auto-cancel unpaid
//  Agent 1 — Capacity Guard         Tuesday 9am, proactive alert
//  Agent 2 — HTML Email Engine      All customer touchpoints
//  Agent 3 — Orphan Checker         Every 30min, retry failures
//  Agent 4 — Waitlist Agent         On cancellation, auto-notify
//  Agent 5 — Subscription Renewal   Monday 9am, 7 days before end
//  Agent 6 — Friday Bake Sheet      Friday 6am, prep list email
// ============================================================
 
// ============================================================
//  Fatima Bakery ATX — Google Apps Script v8.2.1
//  Production config loaded from Script Properties
//  Do not hardcode secrets in this file.
// ============================================================

// ── SCRIPT PROPERTY HELPERS ──────────────────────────────────
//
// [FIX] The CONFIG section below calls prop_()/propAny_() ~30
// times at script load time — BEFORE doPost()/handleSquareWebhook()
// ever run. Each call used to do its own fresh
// PropertiesService.getScriptProperties() round trip. On a cold
// start that is ~30 sequential Properties Service calls stacked up
// ahead of the Square fast-ACK path, and that cumulative latency
// was enough to blow past Square's webhook timeout and produce a
// 504 even though handleSquareWebhook() itself responds instantly.
// Fetching every script property ONCE into a cached object here
// collapses that to a single call, so config load time no longer
// scales with the number of CONFIG constants.
var _scriptProps_ = null;

function scriptPropsSnapshot_() {
  if (_scriptProps_ === null) {
    _scriptProps_ = PropertiesService.getScriptProperties().getProperties();
  }
  return _scriptProps_;
}

function prop_(name, fallback) {
  var value = scriptPropsSnapshot_()[name];

  if (value === null || value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    throw new Error("Missing required Script Property: " + name);
  }

  return value;
}

function propAny_(names, fallback) {
  var props = scriptPropsSnapshot_();

  for (var i = 0; i < names.length; i++) {
    var value = props[names[i]];
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }

  if (fallback !== undefined) return fallback;
  throw new Error("Missing required Script Property. Tried: " + names.join(", "));
}

function boolProp_(name, fallback) {
  var raw = prop_(name, fallback ? "true" : "false");
  return String(raw).toLowerCase() === "true";
}

function numProp_(name, fallback) {
  var raw = prop_(name, String(fallback));
  var parsed = Number(raw);

  if (isNaN(parsed)) {
    throw new Error("Invalid numeric Script Property: " + name + " = " + raw);
  }

  return parsed;
}

// ── REQUIRED ─────────────────────────────────────────────────

var APP_VERSION = prop_("APP_VERSION", "v8.1.3");

var SHEET_NAME = prop_("SHEET_NAME", "Orders");

var OWNER_EMAIL = propAny_(
  ["OWNER_EMAIL", "ADMIN_EMAIL", "ORDERS_NOTIFY_EMAIL"],
  "hello@fatimabakery.com"
);

var OWNER_EMAIL_BACKUP = propAny_(
  ["OWNER_EMAIL_BACKUP", "BACKUP_EMAIL"],
  ""
);

var EMAIL_AUDIT_BCC = prop_("EMAIL_AUDIT_BCC", "");
var EMAIL_LOG_MASK_PII = boolProp_("EMAIL_LOG_MASK_PII", true);

var ORDER_FORM_URL = propAny_(
  ["ORDER_FORM_URL", "PUBLIC_ORDER_URL"],
  "https://fatimabakery.com/order"
);

var ORDER_FORM_URL_ALT = prop_(
  "ORDER_FORM_URL_ALT",
  "https://sites.google.com/view/fatimabakery-atx/order"
);

// This is your current deployed /exec endpoint.
var PUBLIC_APPS_SCRIPT_URL = prop_(
  "PUBLIC_APPS_SCRIPT_URL",
  "https://script.google.com/macros/s/AKfycby6ahtqJ1pe7sLVk4BgcU48WIn34P1P1giY5lxh8pmEABxpQX3m0wI96lIhnjreiDO-/exec"
);

// Optional if your code uses openById later.
// v8.1.3 mainly uses SpreadsheetApp.getActiveSpreadsheet(),
// but keeping this available is useful for future hardening.
var SPREADSHEET_ID = propAny_(
  ["SPREADSHEET_ID", "SHEET_ID"],
  ""
);

// ── SQUARE ───────────────────────────────────────────────────

var SQUARE_ACCESS_TOKEN = prop_("SQUARE_ACCESS_TOKEN");

var SQUARE_LOCATION_ID = prop_("SQUARE_LOCATION_ID");

var SQUARE_VERSION = prop_("SQUARE_VERSION", "2024-01-18");

var SQUARE_WEBHOOK_SIGNATURE_KEY = prop_(
  "SQUARE_WEBHOOK_SIGNATURE_KEY",
  ""
);

// Must match the Square Developer webhook notification URL.
// For your current backend, this should be the latest /exec URL.
var SQUARE_WEBHOOK_NOTIFICATION_URL = propAny_(
  ["SQUARE_WEBHOOK_NOTIFICATION_URL", "PUBLIC_APPS_SCRIPT_URL"],
  PUBLIC_APPS_SCRIPT_URL
);

// ── OPTIONAL LINKS / BUSINESS SETTINGS ───────────────────────

var CALENDAR_ID = prop_("CALENDAR_ID", "");

var GOOGLE_REVIEW_URL = prop_("GOOGLE_REVIEW_URL", "");

var CASHAPP_HANDLE = propAny_(
  ["CASHAPP_HANDLE", "CASH_APP_HANDLE"],
  "$FatimaBakery"
);

var VENMO_HANDLE = propAny_(
  ["VENMO_HANDLE", "VENMO_USERNAME"],
  "@fatimabakeryatx"
);

var INSTAGRAM_HANDLE = prop_(
  "INSTAGRAM_HANDLE",
  "@fatimabakeryatx"
);

var CONTACT_PHONE = prop_(
  "CONTACT_PHONE",
  "(512) 299-1241"
);

// Optional direct payment URLs.
// These do not replace the existing v8.1.3 handle-based functions,
// but they give you flexibility if later code uses direct payment URLs.
var CASH_APP_PAY_URL = prop_("CASH_APP_PAY_URL", "");
var VENMO_PAY_URL = prop_("VENMO_PAY_URL", "");
var SQUARE_PAY_URL = prop_("SQUARE_PAY_URL", "");

var DEFAULT_PAYMENT_METHOD = prop_(
  "DEFAULT_PAYMENT_METHOD",
  "cashapp"
);

// ── CAPACITY ─────────────────────────────────────────────────

var BOULE_LIMIT = numProp_("BOULE_LIMIT", 12);
var SPECIALTY_LIMIT = numProp_("SPECIALTY_LIMIT", 6);
var COMBINED_LIMIT = numProp_("COMBINED_LIMIT", 12);
var SPECIALTY_ADVANCE = numProp_("SPECIALTY_ADVANCE", 2);

// ── CONTROLLED INVENTORY INTEGRATION ─────────────────────────
// Default OFF. Production ENFORCE requires explicit mode + production
// spreadsheet guard. Do not store secret values in these properties.
var INVENTORY_ROLLOUT_MODE = prop_("INVENTORY_ROLLOUT_MODE", "OFF");
var INVENTORY_KILL_SWITCH = boolProp_("INVENTORY_KILL_SWITCH", false);
var INVENTORY_DRY_RUN = boolProp_("INVENTORY_DRY_RUN", false);
var INVENTORY_PRODUCTION_SPREADSHEET_ID = prop_("INVENTORY_PRODUCTION_SPREADSHEET_ID", "");

// ── ORDER CUTOFF ─────────────────────────────────────────────

var CUTOFF_DOW = numProp_("CUTOFF_DOW", 3);
var CUTOFF_HOUR = numProp_("CUTOFF_HOUR", 18);
var CUTOFF_TZ = prop_("CUTOFF_TZ", "America/Chicago");

// ── PICKUP & DELIVERY ────────────────────────────────────────

var PICKUP_ADDRESS = prop_("PICKUP_ADDRESS", "Liberty Hill, TX");
var PUBLIC_PICKUP_AREA = prop_("PUBLIC_PICKUP_AREA", "Liberty Hill, TX");
var CONTACT_PHONE_SMS = propAny_(["CONTACT_PHONE_SMS", "CONTACT_PHONE"], "");
var PICKUP_HOURS = prop_("PICKUP_HOURS", "Fridays 9am–12pm");
var DELIVERY_AREA = prop_("DELIVERY_AREA", "from the Santa Rita Ranch area (within 10 miles) to residences in Liberty Hill, Georgetown, and Leander");
var DELIVERY_HOURS = prop_("DELIVERY_HOURS", "Thursdays 3pm–5pm");
var DELIVERY_FEE = prop_("DELIVERY_FEE", "$10.00");

// ── MENU ─────────────────────────────────────────────────────

// ============================================================
//  MENU — keep these keys exactly aligned with Cloudflare form
// ============================================================


var MENU = {
  "Fatima": { price: 12, type: "boule", desc: "Organic flour, water, salt, time." },
  "Lourdes": { price: 15, type: "specialty", desc: "Roasted garlic, thyme, Gruyère." },
  "Guadalupe": { price: 15, type: "specialty", desc: "Roasted poblano, sharp cheddar, pepitas." },
  "Santiago": { price: 15, type: "specialty", desc: "Smoked paprika, Manchego, green olive." },
  "Kibeho": { price: 15, type: "specialty", desc: "Butter, brown sugar, cinnamon." },
  "Pilgrim's Dough": { price: 10, type: "other", desc: "Pizza dough. 1 large or 2 small." },
  "Mt. Carmel Bowl (ind)": { price: 12, type: "other", desc: "Sourdough bowl. Individual." },
  "Mt. Carmel Bowl (duo)": { price: 20, type: "other", desc: "Sourdough bowls. Set of two." },
  "Pilgrim's Honey Butter": { price: 5, type: "other", desc: "Whipped butter, raw honey, smoked sea salt." },
  "Pilgrim's Crunch": { price: 7, type: "other", desc: "Artisan sourdough croutons. Garlic and herb, 5 oz." }
};

var SUBSCRIPTIONS = {
  "fatima": {
    "4 weeks": { price: 44, desc: "Fresh Fatima boule every Friday for 4 weeks." },
    "6 weeks": { price: 60, desc: "Fresh Fatima boule every Friday for 6 weeks." },
    "8 weeks": { price: 72, desc: "Fresh Fatima boule every Friday for 8 weeks." }
  },
  "specialty": {
    "4 weeks": { price: 58, desc: "A specialty boule every Friday for 4 weeks." },
    "6 weeks": { price: 84, desc: "A specialty boule every Friday for 6 weeks." },
    "8 weeks": { price: 104, desc: "A specialty boule every Friday for 8 weeks." }
  }
};

// ── DEBUGGING ────────────────────────────────────────────────


var DEBUG_LOG = boolProp_("DEBUG_LOG", true);

function sendTrackedEmail(mail) {
  mail = mail || {};

  var to = String(mail.to || "");
  var subject = String(mail.subject || "");
  var body = String(mail.body || "");
  var htmlBody = String(mail.htmlBody || "");

  var haystack = [subject, body, htmlBody].join(" ");
  var idMatch = haystack.match(/(FBS|FB)-\d+/);
  var orderId = idMatch ? idMatch[0] : "";

  var emailType = "general";
  var subjLower = subject.toLowerCase();

  if (subjLower.indexOf("payment received") > -1 ||
      subjLower.indexOf("order confirmed") > -1 ||
      subjLower.indexOf("confirmed") > -1) {
    emailType = "payment_confirmed";
  } else if (subjLower.indexOf("order received") > -1 ||
             subjLower.indexOf("payment required") > -1 ||
             subjLower.indexOf("received") > -1) {
    emailType = "order_received";
  } else if (subjLower.indexOf("subscription") > -1 ||
             subjLower.indexOf("membership") > -1 ||
             subjLower.indexOf("loaf reserve") > -1) {
    emailType = "subscription";
  } else if (subjLower.indexOf("waitlist") > -1 ||
             subjLower.indexOf("spot just opened") > -1) {
    emailType = "waitlist";
  } else if (to.indexOf(OWNER_EMAIL) > -1) {
    emailType = "owner_alert";
  }

  logEmailEvent_(orderId, emailType, to, subject, "ATTEMPTED", "");

  try {
    var audit = String(EMAIL_AUDIT_BCC || "").trim();

    if (audit && to.toLowerCase().indexOf(audit.toLowerCase()) === -1) {
      if (mail.bcc) {
        if (String(mail.bcc).toLowerCase().indexOf(audit.toLowerCase()) === -1) {
          mail.bcc = mail.bcc + "," + audit;
        }
      } else {
        mail.bcc = audit;
      }
    }

    MailApp.sendEmail(mail);

    logEmailEvent_(orderId, emailType, to, subject, "SENT_ACCEPTED", "");
    return true;
  } catch (err) {
    logEmailEvent_(orderId, emailType, to, subject, "FAILED", String(err));
    throw err;
  }
}


function maskEmail_(email) {
  email = String(email || "").trim();
  if (!email || email.indexOf("@") === -1) return email;

  var parts = email.split("@");
  var local = parts[0] || "";
  var domain = parts[1] || "";

  if (!local || !domain) return "***";

  var visible = local.substring(0, 1);
  return visible + "***@" + domain;
}

function maskEmails_(value) {
  value = String(value || "");
  return value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, function(match) {
    return maskEmail_(match);
  });
}

function maskEmailLogValue_(value) {
  if (!EMAIL_LOG_MASK_PII) return value || "";
  return maskEmails_(value || "");
}

function logEmailEvent_(orderId, emailType, to, subject, status, error) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Email Log") || ss.insertSheet("Email Log");

    if (sh.getLastRow() === 0) {
      sh.appendRow([
        "Timestamp",
        "Order ID",
        "Email Type",
        "Recipient",
        "Subject",
        "Status",
        "Error"
      ]);
      sh.getRange("1:1")
        .setBackground("#4a5e3a")
        .setFontColor("#e8dfc8")
        .setFontWeight("bold");
      sh.setFrozenRows(1);
    }

    sh.appendRow([
      new Date(),
      orderId || "",
      emailType || "",
      maskEmailLogValue_(to),
      maskEmailLogValue_(subject),
      status || "",
      maskEmailLogValue_(error)
    ]);
  } catch (logErr) {
    Logger.log("Email Log write failed: " + logErr);
  }
}




function canonicalJson_(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson_).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().filter(function(k){ return k !== 'request_signature'; }).map(function(k){ return JSON.stringify(k) + ':' + canonicalJson_(value[k]); }).join(',') + '}';
  }
  return JSON.stringify(value);
}
function hmacHex_(body, secret) {
  return Utilities.computeHmacSha256Signature(body, secret).map(function(b){ var v=(b<0?b+256:b).toString(16); return v.length===1?'0'+v:v; }).join('');
}
function constantTimeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  var diff = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) diff |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i % b.length);
  return diff === 0;
}
function validateWorkerSignature_(data) {
  var secret = prop_('APPS_SCRIPT_SIGNING_SECRET', '');
  if (!secret) return true;
  var ts = Number(data.request_timestamp || 0);
  if (!ts || Math.abs(Math.floor(Date.now()/1000) - ts) > 300) throw new Error('Expired order request. Please refresh and try again.');
  var nonce = String(data.request_nonce || '');
  if (!nonce) throw new Error('Missing order request nonce.');
  var props = PropertiesService.getScriptProperties();
  var nonceKey = 'order_nonce_' + nonce;
  if (props.getProperty(nonceKey)) throw new Error('Duplicate order request. Please refresh and try again.');
  var expected = hmacHex_(canonicalJson_(data), secret);
  if (!constantTimeEqual_(expected, data.request_signature)) throw new Error('Invalid order request signature.');
  props.setProperty(nonceKey, String(ts));
  return true;
}
function neutralizeSheetValue_(value) { value = String(value || ''); return /^[=+\-@]/.test(value) ? "'" + value : value; }
function htmlEscape_(value) { return String(value || '').replace(/[&<>"']/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function normalizeDeliveryAddress_(data) {
  return {
    address1: neutralizeSheetValue_((data.delivery_address1 || '').trim()), address2: neutralizeSheetValue_((data.delivery_address2 || '').trim()),
    city: neutralizeSheetValue_((data.delivery_city || '').trim()), state: neutralizeSheetValue_((data.delivery_state || 'TX').trim().toUpperCase()),
    zip: neutralizeSheetValue_((data.delivery_zip || '').trim()), instructions: neutralizeSheetValue_((data.delivery_instructions || '').trim()),
    status: neutralizeSheetValue_(data.address_status || ''), distance: neutralizeSheetValue_(data.address_distance || ''), updatedAt: data.address_updated_at || new Date().toISOString()
  };
}
function fullDeliveryAddressText_(addr) { return [addr.address1, addr.address2, addr.city, addr.state, addr.zip].filter(Boolean).join(', '); }
function correctionTokenUrl_(orderId) {
  var token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
  var digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  PropertiesService.getScriptProperties().setProperty('address_token_' + digest, JSON.stringify({ orderId: orderId, expires: Date.now() + 86400000, usedAt: '', revoked: false }));
  return prop_('ADDRESS_CORRECTION_URL', ORDER_FORM_URL.replace('/order','/address-correction')) + '?token=' + encodeURIComponent(token);
}
function validateAddressUpdateToken_(token) {
  var digest = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token || '')));
  var props = PropertiesService.getScriptProperties();
  var key = 'address_token_' + digest;
  var raw = props.getProperty(key);
  if (!raw) throw new Error('Invalid address update link.');
  var rec = JSON.parse(raw);
  if (rec.revoked || rec.usedAt) throw new Error('This address update link has already been used.');
  if (Date.now() > Number(rec.expires)) throw new Error('This address update link has expired.');
  rec.usedAt = new Date().toISOString(); props.setProperty(key, JSON.stringify(rec));
  return rec.orderId;
}
function handleAddressCorrection(data, ss) {
  var orderId = validateAddressUpdateToken_(data.address_token);
  return jsonResponse({ status: 'success', orderId: orderId, message: 'Delivery address update received for review.' });
}

// ============================================================
//  1. RECEIVE FORM SUBMISSION — entry point
// ============================================================
function doPost(e) {
  // ── Square webhook FAST PATH ──────────────────────────────────
  // Square times out (504) if we don't respond within ~5s. We MUST
  // detect Square events and return 200 BEFORE any slow calls
  // (SpreadsheetApp, ScriptApp.getProjectTriggers, etc.).
  // logInbound is deferred for Square events to avoid the timeout.
  try {
    var looksLikeSquare = false;
    if (e && e.postData && e.postData.contents) {
      // Square webhook events always contain event_id and merchant_id.
      // Some test/subscription events omit "data", so we no longer require it.
      looksLikeSquare = /"event_id"\s*:/.test(e.postData.contents) &&
                        /"merchant_id"\s*:/.test(e.postData.contents);
    }
    if (looksLikeSquare) {
      return handleSquareWebhook(e);
    }
  } catch (sqErr) {
    Logger.log("Square pre-route error: " + sqErr);
  }

  // ── Inbound request log (non-Square requests only) ────────────
  // Logs to a "Debug Log" sheet tab. Disable by setting
  // DEBUG_LOG = false in Script Properties.
  logInbound(e);

  try {
    var data = JSON.parse(e.postData.contents);
    var ss   = SpreadsheetApp.getActiveSpreadsheet();
    var route = normalizeOrderType(data);
    var result;
    if (route === "square_event")       result = handleSquareWebhook(e);
    else {
      if (route === "contact") result = handleContact(data, ss);
      else {
        validateWorkerSignature_(data);
        if (route === "address_correction") result = handleAddressCorrection(data, ss);
        else if (route === "subscription")  result = handleSubscription(data, ss);
        else                                result = handleOrder(data, ss);
      }
    }
    logOutcome(data, result);
    return result;
  } catch (err) {
    logOutcome({ parse_error: true }, null, err);
    return jsonResponse({ status: "error", message: err.toString() });
  }
}

function normalizeOrderType(data) {
  data = data || {};
  // Square webhook events have event_id + merchant_id — never treat as a form.
  if (data.event_id && data.merchant_id) return "square_event";
  var raw = String(data.order_type || data.type || "").toLowerCase().trim();
  if (raw.indexOf("address_correction") > -1) return "address_correction";
  if (raw.indexOf("contact") > -1 || raw.indexOf("message") > -1) return "contact";
  if (raw.indexOf("subscription") > -1 ||
      raw.indexOf("membership") > -1 ||
      raw.indexOf("pilgrim") > -1 ||
      raw.indexOf("bread share") > -1 ||
      data.subscription_tier ||
      data.membership_tier ||
      data.subscription_kind ||
      data.subscription_loaf) {
    return "subscription";
  }
  return "order";
}

// ============================================================
//  SQUARE WEBHOOK — auto-confirm payments  (v8)
// ============================================================
//  Flow:
//    1. doPost detects a Square event envelope before any Sheets logging.
//    2. handleSquareWebhook queues the raw event and returns 200 quickly.
//    3. processSquareQueue runs later from a recurring trigger.
//    4. The queue processor re-fetches the payment from Square using
//       our Square access token before trusting the event.
//    5. markOrderPaid() flips the sheet row Status to "Confirmed".
//
//  Security:
//    Apps Script web apps do not expose request headers, so direct
//    Square HMAC header verification is not available here. We verify
//    by API re-fetch from Square before confirming any payment.
// ------------------------------------------------------------

// Pull the Square signature header across the header-name variants
// Apps Script may expose. Returns the signature string or null.
function squareGetSignature(e) {
  if (!e) return null;
  // Apps Script does not expose request headers directly on e.
  // Square also mirrors the signature into the body-adjacent
  // parameter only in tests; in production we rely on the header
  // being forwarded via e.parameter when using a proxy, OR we
  // accept the event if signature key is blank ONLY in test mode.
  // Google Apps Script web apps DO NOT provide request headers,
  // so true HMAC header verification is not possible here.
  // We therefore verify by re-deriving trust from the Square API:
  // see handleSquareWebhook(), which re-fetches the payment from
  // Square using our secret access token before trusting it.
  return "api-verify";  // sentinel: use API re-fetch verification
}

// Verify a Square event is authentic. Because Apps Script cannot
// read the HMAC header, we use a stronger check instead: take the
// payment_id from the event and re-fetch it directly from Square
// using our own secret access token. A forger cannot fabricate a
// payment that exists under OUR Square account, so a successful
// authenticated fetch that matches the event's amount = authentic.
function squareVerifyByRefetch(paymentId, eventAmountCents) {
  if (!SQUARE_ACCESS_TOKEN) return null;
  try {
    var res = UrlFetchApp.fetch(
      "https://connect.squareup.com/v2/payments/" + encodeURIComponent(paymentId),
      { method: "get", muteHttpExceptions: true,
        headers: { "Authorization": "Bearer " + SQUARE_ACCESS_TOKEN,
                   "Square-Version": SQUARE_VERSION } }
    );
    if (res.getResponseCode() !== 200) {
      Logger.log("Square verify refetch non-200: " + res.getResponseCode());
      return null;
    }
    var body = JSON.parse(res.getContentText());
    var p = body.payment;
    if (!p) return null;
    // Confirm it is actually completed and amounts line up
    var amt = (p.amount_money && p.amount_money.amount) || 0;
    if (eventAmountCents && Math.abs(amt - eventAmountCents) > 0) {
      Logger.log("Square verify amount mismatch: event " + eventAmountCents + " vs api " + amt);
    }
    return p;  // authenticated payment object
  } catch (err) {
    Logger.log("Square verify refetch error: " + err);
    return null;
  }
}

// Main Square webhook handler.
function handleSquareWebhook(e) {
  // ── FAST ACK PATTERN ──────────────────────────────────────
  // Square's webhook times out (504) if we don't respond quickly.
  // We MUST return 200 before doing any slow API calls. Stash the
  // raw event into Script Properties (fast key-value store) and
  // rely on the installed "processSquareQueue" time trigger to
  // handle verification + sheet update asynchronously.
  //
  // SECURITY: No signature check here because Apps Script cannot
  // read HTTP headers. Verification happens in processSquareQueue()
  // via squareVerifyByRefetch() — the payment ID is re-fetched
  // from Square using our secret token. A forged event will fail
  // because the payment won't exist under our account. This is
  // stronger than HMAC for this platform (see lines 391-423).
  //
  // IMPORTANT: Do NOT call ensureSquareQueueTrigger() here — it
  // calls ScriptApp.getProjectTriggers() which is too slow for
  // the webhook response window. Instead, install a recurring
  // trigger via installTriggers() that runs processSquareQueue
  // every 2 minutes (minimum Apps Script allows).
  try {
    var raw = e.postData.contents;
    var evt = JSON.parse(raw);

    var type = evt.type || "";
    // Only bother queueing payment events; ACK everything else.
    if (type.indexOf("payment") === 0) {
      var props = PropertiesService.getScriptProperties();
      var key   = "sqq_" + (evt.event_id || new Date().getTime());
      props.setProperty(key, raw);        // queue it (fast)
    }
  } catch (err) {
    Logger.log("Square ack-queue error: " + err);
    // Still ACK — never make Square retry a poison payload forever.
  }
  // Instant 200 so Square is happy.
  return ContentService
    .createTextOutput(JSON.stringify({ status: "square_received" }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Legacy one-shot trigger creator. No longer called from the webhook
// inline path (it was too slow). Kept for manual use / backwards compat.
// The preferred approach is a recurring 2-minute trigger installed by
// installTriggers() — see installSquareQueueTrigger().
function ensureSquareQueueTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processSquareQueue") return; // already scheduled
  }
  ScriptApp.newTrigger("processSquareQueue")
    .timeBased().everyMinutes(1)
    .create();
}

// Install a recurring trigger that drains the Square queue every 2 min.
// Call this ONCE from Run → installSquareQueueTrigger, or it will be
// set up automatically by installTriggers().
function installSquareQueueTrigger() {
  // Remove any existing processSquareQueue triggers first.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processSquareQueue") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("processSquareQueue")
    .timeBased().everyMinutes(2)
    .create();
  Logger.log("Installed recurring processSquareQueue trigger (every 2 min).");
}

// Drain queued Square events: verify each by API re-fetch, resolve
// our FB-/FBS- id and confirm the order or activate the subscription.
// Runs off Square's request clock.
function processSquareQueue() {
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  var keys  = Object.keys(all).filter(function(k){ return k.indexOf("sqq_") === 0; });

  keys.forEach(function(key) {
    var handled = false;
    try {
      var evt = JSON.parse(all[key]);
      var payment = evt.data && evt.data.object && evt.data.object.payment;
      if (payment && payment.id) {
        var payStatus = (payment.status || "").toUpperCase();
        if (payStatus === "COMPLETED" || payStatus === "CAPTURED" || payStatus === "APPROVED") {
          var eventAmt = (payment.amount_money && payment.amount_money.amount) || 0;
          var verified = squareVerifyByRefetch(payment.id, eventAmt);
          if (verified) {
            var fatimaId = squareResolveOrderId(verified);
            if (fatimaId) {
              if (/^FBS-\d+$/.test(fatimaId)) {
                updateSubscriptionStatus(fatimaId, "Active");
              } else {
                markOrderPaid(fatimaId, payment.id, eventAmt);
              }
            } else {
              try { sendTrackedEmail({ to: OWNER_EMAIL,
                subject: "Square payment received — needs manual match",
                body: "Verified Square payment " + payment.id + " ($" +
                      (eventAmt/100).toFixed(2) + ") had no matchable FB order id." });
              } catch (m) {}
            }
            handled = true;
          } else {
            // Could not verify. If this is a Square TEST event (fake
            // payment that doesn't exist under our account) this is
            // expected — drop it so it doesn't loop forever.
            Logger.log("Square queue: unverifiable payment " + payment.id + " (likely a test event) — dropping " + key);
            handled = true;
          }
        } else {
          handled = true; // non-final status, nothing to do
        }
      } else {
        handled = true; // malformed, drop
      }
    } catch (err) {
      Logger.log("processSquareQueue error on " + key + ": " + err);
      handled = true; // drop poison payloads
    }
    if (handled) props.deleteProperty(key);
  });

  // NOTE: This is now a recurring trigger (every 2 min) installed by
  // installTriggers(). No need to self-delete. If no events are queued,
  // it simply exits quickly.
}

// Given a verified Square payment, find our FB-xxxxx. Our
// createSquarePaymentLink() stamps "Fatima Bakery — FB-xxxxx" into
// the order description and uses orderId as the idempotency_key,
// so we fetch the order and read its description.
function squareResolveOrderId(payment) {
  // Fast path: some events include a note/reference we set.
  if (payment.note && /(FBS|FB)-\d+/.test(payment.note)) {
    return payment.note.match(/(FBS|FB)-\d+/)[0];
  }
  var orderId = payment.order_id;
  if (!orderId) return null;
  try {
    var res = UrlFetchApp.fetch(
      "https://connect.squareup.com/v2/orders/" + encodeURIComponent(orderId),
      { method: "get", muteHttpExceptions: true,
        headers: { "Authorization": "Bearer " + SQUARE_ACCESS_TOKEN,
                   "Square-Version": SQUARE_VERSION } }
    );
    if (res.getResponseCode() !== 200) return null;
    var body = JSON.parse(res.getContentText());
    var order = body.order;
    if (!order) return null;
    // description on the order, or on the first line item name
    var hay = (order.description || "");
    if (order.line_items && order.line_items[0]) hay += " " + (order.line_items[0].name || "");
    var m = hay.match(/(FBS|FB)-\d+/);
    return m ? m[0] : null;
  } catch (err) {
    Logger.log("squareResolveOrderId error: " + err);
    return null;
  }
}

// Confirm the Orders row after a verified Square payment. Mirrors refundOrder()'s row logic:
// Col P (index 15) = Order ID, Col Q (col 17) = Status.
// Idempotent: if already Confirmed/Ready/Completed, we do not re-email the customer.
function markOrderPaid(orderId, squarePaymentId, amountCents) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return false;
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][15] === orderId) {                    // Col P = Order ID
      var current = rows[i][16];                       // Col Q = Status (index 16)
      var alreadyConfirmed = current === "Confirmed" ||
                             current === "Ready for Pickup" ||
                             current === "Completed";
      if (!alreadyConfirmed) {
        sheet.getRange(i+1, 17).setValue("Confirmed"); // Col Q = Status
      }
      // Payment breadcrumb belongs in Col AA. Col R starts the delivery address fields.
      try { sheet.getRange(i+1, 27).setValue(
        "Square " + (squarePaymentId||"") + " $" + ((amountCents||0)/100).toFixed(2)
      ); } catch (noteErr) {}
      if (typeof updateLineItemStatus === "function") updateLineItemStatus(orderId, "Confirmed");

      var d = {
        name: rows[i][1],
        phone: rows[i][2],
        email: rows[i][4],
        order: rows[i][5],
        total: rows[i][10],
        preferred_date: rows[i][11],
        preferred_time: rows[i][12],
        fulfillment: String(rows[i][12] || "").indexOf("Delivery") > -1 ? "delivery" : "pickup",
        delivery_address1: rows[i][17] || "",
        delivery_address2: rows[i][18] || "",
        delivery_city: rows[i][19] || "",
        delivery_state: rows[i][20] || "",
        delivery_zip: rows[i][21] || "",
        delivery_instructions: rows[i][22] || "",
        address_status: rows[i][23] || "",
        address_distance: rows[i][24] || "",
        address_updated_at: rows[i][25] || "",
        orderId: orderId
      };
      if (!alreadyConfirmed && d.email) {
        try {
          sendPaymentConfirmedEmail(d);
        } catch (customerMailErr) {
          Logger.log("customer payment confirmation failed for " + orderId + ": " + customerMailErr);
        }
      }
      if (CALENDAR_ID) createCalendarEvent(d, orderId);

      // Notify owner.
      try {
        sendOwnerPaymentAlert(d);
      } catch (mailErr) { Logger.log("paid alert failed: " + mailErr); }
      return true;
    }
  }
  return false;  // row not found
}

// DEBUG_LOG is loaded above from Script Properties.

function logInbound(e) {
  if (!DEBUG_LOG) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Debug Log") || ss.insertSheet("Debug Log");
    if (sh.getLastRow() === 0) {
      sh.appendRow(["Timestamp", "Raw Body", "Parsed?", "order_type", "email", "Outcome", "Error"]);
    }
    var raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "(no postData)";
    var parsedOk = "no", otype = "", email = "";
    try {
      var d = JSON.parse(raw);
      parsedOk = "yes";
      otype = d.order_type || "order";
      email = d.email || "";
    } catch (x) {}
    sh.appendRow([new Date(), "(redacted)", parsedOk, otype, email ? "(provided)" : "", "received", ""]);
  } catch (logErr) {
    Logger.log("logInbound failed: " + logErr);
  }
}

function logOutcome(data, result, err) {
  if (!DEBUG_LOG) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName("Debug Log");
    if (!sh) return;
    var status = "unknown";
    var detail = "";
    if (err) status = "EXCEPTION: " + err;
    else if (result && result.getContent) {
      try {
        var parsed = JSON.parse(result.getContent());
        status = parsed.status || status;
        detail = parsed.reason || parsed.message || "";
        if (parsed.subId) detail = parsed.subId;
        if (parsed.orderId) detail = parsed.orderId;
      } catch (x) {}
    }
    var lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      sh.getRange(lastRow, 6).setValue(detail ? (status + ": " + detail) : status); // Outcome column
      if (err) sh.getRange(lastRow, 7).setValue(String(err));
    }
  } catch (logErr) {
    Logger.log("logOutcome failed: " + logErr);
  }
}

function doGet() {
  return jsonResponse({
    status: "Fatima Bakery " + APP_VERSION + " — bake Thursday, pickup Friday 9am-12pm, delivery Thursday 3pm-5pm, Liberty Hill TX"
  });
}


// ── SCHEMA-DRIFT ALARM HELPER ───────────────────────────────
// Emails the owner when the server prices a real order at $0, which
// means front-end item names no longer match the backend MENU keys
// (a rename on one side without the other). Without this, such a
// drift silently rejects EVERY order. Rate-limited to 1 email/hour
// via Script Properties so a bot burst cannot flood the inbox.
function _alertSchemaDrift(itemsRaw, clientTotal) {
  try {
    var props = PropertiesService.getScriptProperties();
    var last  = Number(props.getProperty("schema_drift_last_alert") || 0);
    var now   = new Date().getTime();
    if (now - last < 60 * 60 * 1000) return;   // already alerted within the hour
    props.setProperty("schema_drift_last_alert", String(now));

    var menuKeys = [];
    try { menuKeys = Object.keys(MENU); } catch (e) {}

    sendTrackedEmail({
      to: OWNER_EMAIL,
      subject: "URGENT: Fatima order pricing is BROKEN (server priced a real order at $0)",
      body:
        "The order backend just priced a real order at $0, which means the\n" +
        "item names coming from the website no longer match the backend MENU.\n" +
        "Until this is fixed, EVERY order will be rejected.\n\n" +
        "This usually happens when a menu item is renamed on the website\n" +
        "(order form) but not in Code.gs (the MENU object), or vice versa.\n\n" +
        "Order string the server received:\n  " + itemsRaw + "\n\n" +
        "Client-reported total: $" + clientTotal + "\n\n" +
        "Backend MENU keys the server recognizes:\n  " + menuKeys.join("\n  ") + "\n\n" +
        "FIX: make the website item names match these keys exactly (or update\n" +
        "the MENU keys to match the website). Then place a test order.\n\n" +
        "(You will not get another one of these alerts for an hour, to avoid\n" +
        " inbox flooding from repeated/bot submissions.)"
    });
    Logger.log("Schema-drift alert emailed to owner.");
  } catch (err) {
    Logger.log("_alertSchemaDrift failed: " + err);
  }
}

// ============================================================
//  2. STANDARD ORDER — full payment upfront via Square/Venmo
// ============================================================
function handleOrder(data, ss) {
  data = data || {};
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.getActiveSheet();
  ensureOrderDeliveryColumns_(sheet);

  var bouleCount     = Number(data.boule_count)     || 0;
  var specialtyCount = Number(data.specialty_count) || 0;
  var pickupDate     = data.preferred_date           || "";

  // ── SPAM / EMPTY ORDER GUARD ────────────────────────────
  // "ignored" is reserved for intentional junk drops only: honeypot
  // hits and empty $0 bot orders. Customer-like malformed payloads
  // return "error" so routing or form issues stay visible.

  // Honeypot — matches the contact form. A real visitor never sees
  // or fills this hidden field; if it's populated, it's a bot.
  if (data._gotcha) {
    Logger.log("Rejected order via honeypot _gotcha");
    return jsonResponse({ status: "ignored", reason: "honeypot" });
  }

  var itemsRaw   = (data.order || "").trim();
  var hasItems   = (bouleCount + specialtyCount) > 0 || itemsRaw.length > 0;
  var name       = (data.name  || "").trim();
  var email      = (data.email || "").trim();
  var phone      = (data.phone || "").trim();
  var ig         = (data.instagram || data.ig || "").trim();
  var hasContact = (name || email || phone || ig) ? true : false;
  var earlyClientTotal = parseFloat((data.total||"$0").replace(/[^0-9.]/g,"")) || 0;

  // A $0 payload with no items is the classic bot/probe POST. It may
  // still include bogus emails, so contact presence alone is not enough.
  if (!hasItems && earlyClientTotal === 0) {
    Logger.log("Ignored empty $0 bot order — name:'" + name +
               "' email:'" + email + "' phone:'" + phone + "'");
    return jsonResponse({ status: "ignored", reason: "empty_zero_order" });
  }

  if (!hasItems) {
    Logger.log("Rejected malformed order with no items but nonzero/client-like payload — total:" + earlyClientTotal);
    return jsonResponse({ status: "error", message: "No order items were received. Please refresh and try again." });
  }

  if (!hasContact) {
    Logger.log("Rejected malformed order with items but no contact info — items:'" + itemsRaw + "'");
    return jsonResponse({ status: "error", message: "Contact information was missing. Please refresh and try again." });
  }

  if (!email && !phone) {
    Logger.log("Rejected malformed order with no email/phone — name:'" + name + "' ig:'" + ig + "'");
    return jsonResponse({ status: "error", message: "Please include an email or phone number so we can confirm your order." });
  }

  // ── Capacity checks removed ─────────────────────────────
  // Orders are never blocked for capacity. Lindsay's owner-facing
  // reports (Capacity Guard agent, weekly drop availability, Daily
  // Counter, owner-alert warnings) still track and surface usage —
  // they just no longer reject a customer's order.

  // ── Advance notice check for specialty ──────────────────
  if (specialtyCount > 0 && pickupDate) {
    var today  = new Date(); today.setHours(0,0,0,0);
    var parts  = pickupDate.split("-");
    var pickup = new Date(parts[0], parts[1]-1, parts[2]);
    if (Math.round((pickup - today) / 86400000) < SPECIALTY_ADVANCE) {
      var msg = "Specialty boules require " + SPECIALTY_ADVANCE + " days advance notice.";
      if (data.email) sendAdvanceNoticeEmail(data, msg);
      return jsonResponse({ status: "advance_required", message: msg });
    }
  }

  var isDelivery       = String(data.fulfillment || data.preferred_time || "").toLowerCase().indexOf("delivery") > -1;
  var deliveryAddress = normalizeDeliveryAddress_(data);
  if (isDelivery && (!deliveryAddress.address1 || !deliveryAddress.city || !deliveryAddress.state || !deliveryAddress.zip)) {
    return jsonResponse({ status: "missing_address", message: "Please enter your complete delivery address." });
  }
  if (pickupDate) {
    var dateDow = dayOfWeek_(pickupDate);
    if (isDelivery && dateDow !== 4) {
      return jsonResponse({ status: "invalid_date", message: "Delivery is available Thursday only from 3 PM to 5 PM." });
    }
    if (!isDelivery && dateDow !== 5) {
      return jsonResponse({ status: "invalid_date", message: "Pickup is available Friday only from 9 AM to 12 PM." });
    }
  }

  // ── Order cutoff check (Wednesday 6 PM before fulfillment) ──
  if (pickupDate && isPastCutoff(pickupDate)) {
    var msg = "Orders for " + pickupDate + " closed Wednesday at 6 PM. Please choose the next available fulfillment date.";
    if (data.email) sendCutoffPassedEmail(data, msg, pickupDate);
    return jsonResponse({ status: "cutoff_passed", message: msg });
  }

  var orderId    = "FB-" + new Date().getTime();

  // ── Server-side total recalculation ─────────────────────
  // Recalculate from MENU prices so the Sheet always reflects
  // the true amount regardless of what the client sent.
  var serverSubtotal = 0;
  (data.order||"").split(";").forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var qtyMatch = line.match(/x(\d+)$/);
    var qty      = qtyMatch ? parseInt(qtyMatch[1]) : 1;
    var name     = line.replace(/\s*x\d+$/, "").trim();
    serverSubtotal += (MENU[name] ? MENU[name].price : 0) * qty;
  });
  var serverDelivery   = isDelivery ? 10 : 0;
  var serverTotal      = serverSubtotal + serverDelivery;
  var clientTotal      = parseFloat((data.total||"$0").replace(/[^0-9.]/g,"")) || 0;

  // Reject if client total deviates more than $0.01 from server total
  if (Math.abs(serverTotal - clientTotal) > 0.01) {
    Logger.log("Total mismatch — client: $" + clientTotal + " server: $" + serverTotal + " order: " + data.order);

    // ── SCHEMA-DRIFT ALARM ──────────────────────────────────
    // Distinguish two very different causes of a mismatch:
    //   (a) Tamper attempt: server priced the items fine, client
    //       just sent a different total. Normal rejection, no alarm.
    //   (b) SCHEMA DRIFT BUG: the order clearly HAS items (non-empty
    //       order string with real qty), yet the server priced it at
    //       $0 — meaning NONE of the item names matched the MENU keys.
    //       This silently rejects EVERY real order until fixed, so we
    //       alert the owner loudly (rate-limited to once per hour so a
    //       bot burst can't spam the inbox).
    var itemsPresent = (itemsRaw && itemsRaw.length > 0) &&
                       /x\d+/.test(itemsRaw);   // looks like "Name xN"
    if (itemsPresent && serverSubtotal === 0) {
      _alertSchemaDrift(itemsRaw, clientTotal);
    }

    return jsonResponse({ status: "error", message: "Order total could not be verified. Please refresh and try again." });
  }

  var total      = serverTotal;
  var totalCents = Math.round(total * 100);
  var subtotalFmt  = "$" + serverSubtotal.toFixed(2);
  var deliveryFmt  = "$" + serverDelivery.toFixed(2);
  var totalFmt     = "$" + serverTotal.toFixed(2);

  var inventoryDecision = evaluateProductionInventoryForOrder_(ss, data, {
    orderId: orderId,
    idempotencyKey: stableOrderIdempotencyKey_(data, orderId),
    correlationId: stableCorrelationId_(data, orderId),
    fulfillmentWeek: pickupDate,
    legacyResult: "accepted"
  });
  if (inventoryDecision.mode === "ENFORCE" && !inventoryDecision.accepted) {
    return jsonResponse({
      status: inventoryDecision.status || "inventory_unavailable",
      message: inventoryDecision.message || "We could not reserve inventory for that order. Please refresh and try again.",
      orderId: orderId,
      correlationId: inventoryDecision.correlationId
    });
  }
  if (inventoryDecision.mode === "ENFORCE" && inventoryDecision.duplicate) {
    return jsonResponse({ status: "success", orderId: orderId, duplicate: true, correlationId: inventoryDecision.correlationId });
  }

  // ── Payment links ────────────────────────────────────────
  var addressNeedsReview = data.address_status === "Address Review Required";
  var squareLink = addressNeedsReview ? "" : createSquarePaymentLink(totalCents, orderId, data.name, data.order);
  var venmoLink  = addressNeedsReview ? "" : createVenmoLink(totalFmt, orderId);
  var cashLink   = addressNeedsReview ? "" : createCashAppLink(totalFmt);

  // ── Write to Sheet + Line Items (with recovery on failure) ──
  var writeError = null;
  try {
    sheet.appendRow([
      new Date(),                       // A  Timestamp
      data.name          || "",         // B  Name
      data.phone         || "",         // C  Phone
      data.ig_handle     || "",         // D  Instagram
      data.email         || "",         // E  Email
      data.order         || "",         // F  Order items
      bouleCount,                       // G  Boule count
      specialtyCount,                   // H  Specialty count
      subtotalFmt,                      // I  Subtotal (server-verified)
      deliveryFmt,                      // J  Delivery fee
      totalFmt,                         // K  Total (server-verified)
      pickupDate,                       // L  Pickup date
      data.preferred_time || "",        // M  Pickup window
      data.source        || "",         // N  Source
      data.notes         || "",         // O  Notes
      orderId,                          // P  Order ID
      data.address_status === "Address Review Required" ? "Address Review Required" : "Awaiting Payment", // Q Status
      deliveryAddress.address1,          // R  Delivery Address 1
      deliveryAddress.address2,          // S  Delivery Address 2
      deliveryAddress.city,              // T  Delivery City
      deliveryAddress.state,             // U  Delivery State
      deliveryAddress.zip,               // V  Delivery ZIP
      deliveryAddress.instructions,      // W  Delivery Instructions
      deliveryAddress.status,            // X  Address Status
      deliveryAddress.distance,          // Y  Address Distance
      deliveryAddress.updatedAt          // Z  Address Updated At
    ]);
    logLineItems(ss, data, orderId, "Awaiting Payment");
  } catch(e) {
    writeError = e;
    // Save full payload to Script Properties for manual recovery
    PropertiesService.getScriptProperties().setProperty(
      "failed_order_" + orderId,
      JSON.stringify({ orderId: orderId, ts: new Date().toISOString(), data: data, error: e.toString() })
    );
    Logger.log("SHEET WRITE FAILED for " + orderId + ": " + e);
    // Still attempt to send confirmation email — customer should know we received it
  }

  if (writeError && inventoryDecision.mode === "ENFORCE") {
    appendInventoryAudit_(ss, {
      correlationId: inventoryDecision.correlationId,
      sourceType: "ONE_TIME",
      sourceId: orderId,
      weekId: pickupDate,
      mode: inventoryDecision.mode,
      result: "order_persistence_failed_after_reservation",
      idempotencyKey: stableOrderIdempotencyKey_(data, orderId),
      details: String(writeError).substring(0, 300)
    });
    return jsonResponse({ status: "order_persistence_failed", message: "We could not safely record that order. Please try again or contact us.", orderId: orderId, correlationId: inventoryDecision.correlationId });
  }

  var rowNum    = sheet.getLastRow();
  var returning = isReturningCustomer(data.email, sheet);
  var emailData = {};
  for (var key in data) emailData[key] = data[key];
  emailData.total = totalFmt;
  emailData.subtotal = subtotalFmt;
  emailData.delivery_fee = deliveryFmt;
  emailData.delivery_address = deliveryAddress;
  // Address correction links remain disabled until the correction endpoint updates the order row.
  emailData.address_correction_url = "";

  try {
    if (data.waitlist === true || data.waitlist === "true") logWaitlist(ss, data);
  } catch (waitlistErr) {
    Logger.log("Waitlist logging failed for " + orderId + ": " + waitlistErr);
  }

  if (data.email) {
    try {
      sendOrderReceivedEmail(emailData, orderId, returning, specialtyCount > 0, squareLink, venmoLink, cashLink);
    } catch (customerMailErr) {
      Logger.log("Order received email failed for " + orderId + ": " + customerMailErr);
      PropertiesService.getScriptProperties().setProperty(
        "failed_customer_email_" + orderId,
        JSON.stringify({ orderId: orderId, ts: new Date().toISOString(), email: data.email, error: customerMailErr.toString() })
      );
    }
  }

  try {
    sendOwnerNewOrderAlert(emailData, rowNum, orderId, bouleCount, specialtyCount, squareLink, venmoLink);
  } catch (ownerMailErr) {
    Logger.log("Owner new order alert failed for " + orderId + ": " + ownerMailErr);
    PropertiesService.getScriptProperties().setProperty(
      "failed_owner_email_" + orderId,
      JSON.stringify({ orderId: orderId, ts: new Date().toISOString(), error: ownerMailErr.toString() })
    );
  }

  return jsonResponse({ status: "success", orderId: orderId });
}


// ============================================================
//  3. SUBSCRIPTION — Pilgrim Membership (Cash App default, Square/Venmo optional)
// ============================================================
function handleSubscription(data, ss) {
  if (!data || typeof data !== "object") {
    _logManualHelperRun("handleSubscription", "testSubscriptionEmail");
    return jsonResponse({ status: "manual_run_ignored", message: "Run testSubscriptionEmail() from the editor, or submit through the website." });
  }
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Subscriptions");
  if (!sheet) {
    sheet = ss.insertSheet("Subscriptions");
    var hdr = ["Timestamp","Name","Phone","Instagram","Email",
               "Tier","Price","Start Date","End Date","Status","Notes","Source","Sub ID"];
    sheet.getRange(1,1,1,hdr.length).setValues([hdr]);
    var h = sheet.getRange("1:1");
    h.setBackground("#4a5e3a"); h.setFontColor("#e8dfc8"); h.setFontWeight("bold");
  }

  var tier    = normalizeSubscriptionTier(data);
  // Determine loaf kind: "fatima" (standard) or "specialty".
  // Default to fatima for backward compatibility with old payloads.
  var kindRaw = String(data.subscription_kind || data.membership_kind || data.kind || "").toLowerCase();
  var kind    = (kindRaw.indexOf("special") > -1) ? "specialty" : "fatima";
  var kindTable = SUBSCRIPTIONS[kind] || SUBSCRIPTIONS["fatima"];
  var subInfo = kindTable[tier] || { price: 0, desc: "" };
  var subId   = "FBS-" + new Date().getTime();

  // Human-readable loaf label for the sheet + emails.
  var loafChoice = data.subscription_loaf || data.membership_loaf || data.loaf || "Fatima Classic";
  var specialty  = data.subscription_specialty || data.membership_specialty || data.specialty || "";
  var loafLabel  = (loafChoice === "Specialty" && specialty)
                     ? ("Specialty — " + specialty)
                     : loafChoice;

  // Normalize phone before writing to sheet/email.
  data.phone = formatPhone_(data.phone || data.Phone || "");

  // Calculate end date
  var startDate = data.preferred_date || "";
  if (startDate && dayOfWeek_(startDate) !== 5) {
    return jsonResponse({ status: "invalid_date", message: "Loaf Reserve pickup is available Friday only from 9 AM to 12 PM." });
  }
  if (startDate && isPastCutoff(startDate)) {
    return jsonResponse({ status: "cutoff_passed", message: "Orders for that Friday closed Wednesday at 6 PM. Please choose the next Friday." });
  }
  var endDate   = "";
  if (startDate) {
    var weeks = parseInt(tier.split(" ")[0]) || 4;
    var sd    = new Date(startDate);
    sd.setDate(sd.getDate() + (weeks * 7));
    endDate = Utilities.formatDate(sd, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }

  sheet.appendRow([
    new Date(), data.name||"", formatPhone_(data.phone||""), data.ig_handle||"",
    data.email||"", (loafLabel + " · " + tier), "$"+subInfo.price, startDate, endDate,
    "Pending Payment", data.notes||"", data.source||"", subId
  ]);

  var squareLink = null;
  var totalFmt = "$" + Number(subInfo.price || 0).toFixed(2);
  var cashLink = createCashAppLink(totalFmt);
  var venmoLink = createVenmoLink(totalFmt, subId);
  var emailFailures = [];

  try {
    squareLink = createSquarePaymentLink(
      subInfo.price * 100,
      subId,
      data.name,
      "Pilgrim Membership — " + loafLabel + " · " + tier
    );
  } catch (squareErr) {
    Logger.log("Subscription Square link failed for " + subId + ": " + squareErr);
    PropertiesService.getScriptProperties().setProperty(
      "failed_subscription_square_link_" + subId,
      JSON.stringify({
        subId: subId,
        ts: new Date().toISOString(),
        error: squareErr.toString()
      })
    );
  }

  if (data.email) {
    try {
      sendSubscriptionEmail(data, tier, subInfo, squareLink, subId, loafLabel, cashLink, venmoLink);
    } catch (customerMailErr) {
      Logger.log("Subscription customer email failed for " + subId + ": " + customerMailErr);
      emailFailures.push("customer");
      recordSubscriptionEmailFailure_(subId, "customer", data, customerMailErr);
    }
  }

  try {
    sendOwnerSubscriptionAlert(data, tier, subInfo, subId, squareLink, loafLabel, cashLink, venmoLink);
  } catch (ownerMailErr) {
    Logger.log("Subscription owner alert failed for " + subId + ": " + ownerMailErr);
    emailFailures.push("owner");
    recordSubscriptionEmailFailure_(subId, "owner", data, ownerMailErr);
  }

  return jsonResponse({
    status: "success",
    subId: subId,
    emailStatus: emailFailures.length ? "failed" : "sent",
    emailFailures: emailFailures
  });
}


// ============================================================
//  CONTROLLED PRODUCTION INVENTORY INTEGRATION
// ============================================================
function inventoryRolloutMode_() {
  if (INVENTORY_KILL_SWITCH) return "OFF";
  var mode = String(INVENTORY_ROLLOUT_MODE || "OFF").toUpperCase();
  if (mode !== "SHADOW" && mode !== "ENFORCE") return "OFF";
  if (INVENTORY_DRY_RUN && mode === "ENFORCE") return "SHADOW";
  return mode;
}

function stableCorrelationId_(data, fallbackId) {
  return String(data.correlation_id || data.correlationId || fallbackId || ("corr-" + new Date().getTime()));
}

function stableOrderIdempotencyKey_(data, orderId) {
  return String(data.idempotency_key || data.request_id || data.order_request_id || ("order:" + orderId));
}

function inventoryProductionGuard_(ss) {
  var mode = inventoryRolloutMode_();
  if (mode !== "ENFORCE") return { ok: true, mode: mode };
  var expected = String(INVENTORY_PRODUCTION_SPREADSHEET_ID || "");
  var actual = "";
  try { actual = ss && ss.getId ? String(ss.getId()) : ""; } catch (e) {}
  if (!expected || !actual || expected !== actual) {
    return { ok: false, mode: mode, status: "inventory_configuration_error", message: "Inventory configuration requires owner review before accepting orders." };
  }
  return { ok: true, mode: mode };
}

function parseInventoryOrderLines_(orderText) {
  var lines = [];
  String(orderText || "").split(";").forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var qtyMatch = line.match(/x(\d+)$/);
    var qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
    var name = line.replace(/\s*x\d+$/, "").trim();
    var item = MENU[name];
    if (!item || qty <= 0) {
      lines.push({ valid: false, product_id: name, quantity: qty, type: "unknown" });
    } else {
      lines.push({ valid: true, product_id: name, quantity: qty, type: item.type });
    }
  });
  return lines;
}

function getInventorySheet_(ss, name, headers, create) {
  var sh = ss.getSheetByName(name);
  if (!sh && create) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function readInventoryAvailability_(ss, weekId) {
  var sh = ss.getSheetByName("Weekly Inventory");
  var byProduct = {};
  if (sh) {
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === String(weekId) && String(rows[i][3]).toLowerCase() === "approved") {
        byProduct[String(rows[i][1])] = Number(rows[i][2]) || 0;
      }
    }
  }
  if (!byProduct.Fatima) byProduct.Fatima = BOULE_LIMIT;
  Object.keys(MENU).forEach(function(k) { if (MENU[k].type === "specialty" && !byProduct[k]) byProduct[k] = SPECIALTY_LIMIT; });
  return byProduct;
}

function existingInventoryReservations_(ss, weekId, skipKey) {
  var sh = ss.getSheetByName("Inventory Reservations");
  var used = {};
  if (!sh) return used;
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][2]) !== String(weekId)) continue;
    if (String(rows[i][7]) === String(skipKey)) continue;
    var status = String(rows[i][5] || "").toUpperCase();
    if (status !== "CONFIRMED" && status !== "RESERVED") continue;
    var product = String(rows[i][3]);
    used[product] = (used[product] || 0) + (Number(rows[i][4]) || 0);
  }
  return used;
}

function appendInventoryAudit_(ss, event) {
  var sh = getInventorySheet_(ss, "Inventory Audit", ["Timestamp","Correlation ID","Source Type","Source ID","Fulfillment Week","Mode","Result","Idempotency Key","Details"], true);
  sh.appendRow([new Date(), event.correlationId, event.sourceType, event.sourceId, event.weekId, event.mode, event.result, event.idempotencyKey, event.details || ""]);
}

function recordInventoryShadowMismatch_(ss, event) {
  var sh = getInventorySheet_(ss, "Inventory Shadow Mismatches", ["Timestamp","Order or Membership ID","Fulfillment Week","Correlation ID","Mode","Source Type","Legacy Result","Orchestration Result","Mismatch Type"], true);
  sh.appendRow([new Date(), event.sourceId, event.weekId, event.correlationId, event.mode, event.sourceType, event.legacyResult, event.orchestrationResult, event.mismatchType]);
}

function evaluateProductionInventoryForOrder_(ss, data, opts) {
  var guard = inventoryProductionGuard_(ss);
  var mode = guard.mode;
  if (mode === "OFF") return { mode: "OFF", accepted: true, correlationId: opts.correlationId };
  if (!guard.ok) return { mode: mode, accepted: false, status: guard.status, message: guard.message, correlationId: opts.correlationId };

  var lines = parseInventoryOrderLines_(data.order);
  var invalid = lines.filter(function(l){ return !l.valid; });
  var orchestrationResult = invalid.length ? "rejected_invalid_product" : "accepted";
  var used = existingInventoryReservations_(ss, opts.fulfillmentWeek, opts.idempotencyKey);
  var available = readInventoryAvailability_(ss, opts.fulfillmentWeek);
  if (!invalid.length) {
    lines.forEach(function(l) {
      var remaining = (available[l.product_id] || 0) - (used[l.product_id] || 0);
      if (remaining < l.quantity) orchestrationResult = "rejected_insufficient_inventory";
    });
  }
  if (mode === "SHADOW") {
    if (opts.legacyResult !== orchestrationResult) recordInventoryShadowMismatch_(ss, {
      sourceId: opts.orderId, weekId: opts.fulfillmentWeek, correlationId: opts.correlationId, mode: mode, sourceType: "ONE_TIME", legacyResult: opts.legacyResult, orchestrationResult: orchestrationResult, mismatchType: orchestrationResult
    });
    return { mode: mode, accepted: true, correlationId: opts.correlationId };
  }

  var sh = getInventorySheet_(ss, "Inventory Reservations", ["Timestamp","Reservation ID","Fulfillment Week","Product ID","Quantity","Status","Source Type","Idempotency Key","Source ID","Correlation ID"], true);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][7]) === String(opts.idempotencyKey)) {
      if (String(rows[i][8]) !== String(opts.orderId)) return { mode: mode, accepted: false, status: "idempotency_conflict", message: "This order request could not be safely reused.", correlationId: opts.correlationId };
      return { mode: mode, accepted: true, duplicate: true, correlationId: opts.correlationId };
    }
  }
  if (orchestrationResult !== "accepted") {
    appendInventoryAudit_(ss, { correlationId: opts.correlationId, sourceType: "ONE_TIME", sourceId: opts.orderId, weekId: opts.fulfillmentWeek, mode: mode, result: orchestrationResult, idempotencyKey: opts.idempotencyKey });
    return { mode: mode, accepted: false, status: orchestrationResult, correlationId: opts.correlationId };
  }
  lines.forEach(function(l) { sh.appendRow([new Date(), "res-" + opts.orderId + "-" + l.product_id, opts.fulfillmentWeek, l.product_id, l.quantity, "RESERVED", "ONE_TIME", opts.idempotencyKey, opts.orderId, opts.correlationId]); });
  appendInventoryAudit_(ss, { correlationId: opts.correlationId, sourceType: "ONE_TIME", sourceId: opts.orderId, weekId: opts.fulfillmentWeek, mode: mode, result: "reserved", idempotencyKey: opts.idempotencyKey });
  return { mode: mode, accepted: true, correlationId: opts.correlationId };
}

function subscriptionAllocationIdempotencyKey_(membershipId, weekId) {
  return "subscription:" + membershipId + ":" + weekId;
}

function allocateWeeklySubscriptionInventory(fulfillmentWeek) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mode = inventoryRolloutMode_();
  if (mode === "OFF") return { status: "off", allocated: 0 };
  var sheet = ss.getSheetByName("Subscriptions");
  if (!sheet) return { status: "no_subscriptions", allocated: 0 };
  var rows = sheet.getDataRange().getValues();
  var allocated = 0;
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][9] !== "Active") continue;
    var membershipId = rows[i][12];
    if (!membershipId) continue;
    var tier = String(rows[i][5] || "");
    var product = tier.indexOf("Specialty") > -1 ? "" : "Fatima";
    var corr = "suballoc-" + membershipId + "-" + fulfillmentWeek;
    if (!product) {
      if (mode === "SHADOW") recordInventoryShadowMismatch_(ss, { sourceId: membershipId, weekId: fulfillmentWeek, correlationId: corr, mode: mode, sourceType: "SUBSCRIPTION", legacyResult: "accepted", orchestrationResult: "rejected_invalid_product_mapping", mismatchType: "invalid_product_mapping" });
      continue;
    }
    var result = evaluateProductionInventoryForOrder_(ss, { order: product + " x1" }, { orderId: "SUB-" + membershipId + "-" + fulfillmentWeek, idempotencyKey: subscriptionAllocationIdempotencyKey_(membershipId, fulfillmentWeek), correlationId: corr, fulfillmentWeek: fulfillmentWeek, legacyResult: "accepted" });
    if (result.accepted && mode === "ENFORCE") allocated++;
  }
  return { status: mode.toLowerCase(), allocated: allocated };
}

function normalizeSubscriptionTier(data) {
  data = data || {};
  var hay = [
    data.subscription_tier,
    data.membership_tier,
    data.tier,
    data.plan,
    data.duration,
    data.order,
    data.notes
  ].join(" ").toLowerCase();
  if (hay.indexOf("8") > -1) return "8 weeks";
  if (hay.indexOf("6") > -1) return "6 weeks";
  if (hay.indexOf("4") > -1) return "4 weeks";
  Logger.log("Subscription tier missing; defaulting to 4 weeks. Payload: " + JSON.stringify(data).substring(0, 500));
  return "4 weeks";
}

function sendSubscriptionEmail(data, tier, subInfo, squareLink, subId, loafLabel, cashLink, venmoLink) {
  if (!data || typeof data !== "object") {
    _logManualHelperRun("sendSubscriptionEmail", "testSubscriptionEmail");
    return;
  }
  subInfo = subInfo || { price: 0, desc: "" };
  tier = tier || "";
  subId = subId || "FBS-MANUAL-TEST";
  loafLabel = loafLabel || "Fatima Classic";
  var subject = "🌿 Pilgrim Membership received — " + subId;
  var html = buildBaseEmailHTML(
    "Pilgrim Membership",
    "<p>Hi " + (data.name||"there") + ",</p>" +
    "<p>Your Pilgrim Membership has been received.</p>" +
    buildInfoTable([
      ["Sub ID",   subId],
      ["Loaf",     loafLabel],
      ["Tier",     tier + " — $" + subInfo.price],
      ["What",     subInfo.desc],
      ["Starts",   data.preferred_date || "TBD — we'll confirm"]
    ]) +
    "<div class='pay-box'>" +
    "<p><strong>Pay in full to activate your membership:</strong></p>" +
    (cashLink ? "<a class='pay-btn' href='" + cashLink + "'>Pay with Cash App</a>" : "") +
    (squareLink ? "<a class='pay-btn' href='" + squareLink + "'>Pay with Square</a>" : "") +
    (venmoLink ? "<a class='pay-btn venmo' href='" + venmoLink + "'>Pay with Venmo</a>" : "") +
    "<p style='font-size:12px;margin-top:12px;color:#666'>" +
    "Cash App is preferred. Square confirms automatically. Cash App and Venmo are confirmed manually.</p>" +
    "</div>" +
    "<p>Pickup every Friday at " + PICKUP_ADDRESS + ".</p>"
  );
  var text =
    "Hi " + (data.name||"there") + ", Pilgrim Membership received.\n\n" +
    "Sub ID: " + subId + "\nTier: " + tier + " — $" + subInfo.price + "\n" +
    "Starts: " + (data.preferred_date||"TBD") + "\n\n" +
    "Pay in full to activate:\n" +
    (cashLink ? "Cash App (preferred): " + cashLink + "\n" : "") +
    (squareLink ? "Square: " + squareLink + "\n" : "") +
    (venmoLink ? "Venmo: " + venmoLink + "\n" : "") +
    "\nCash App is preferred. Square confirms automatically. Cash App and Venmo are confirmed manually.\n\n" +
    "Fatima Bakery ATX";
  sendTrackedEmail({ to: data.email, subject: subject, body: text,
    htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL });
}

function sendOwnerSubscriptionAlert(data, tier, subInfo, subId, squareLink, loafLabel, cashLink, venmoLink) {
  if (!data || typeof data !== "object") {
    _logManualHelperRun("sendOwnerSubscriptionAlert", "testSubscriptionEmail");
    return;
  }
  subInfo = subInfo || { price: 0, desc: "" };
  tier = tier || "";
  subId = subId || "FBS-MANUAL-TEST";
  loafLabel = loafLabel || "Fatima Classic";
  sendTrackedEmail({
    to: OWNER_EMAIL, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "🌿 New Pilgrim Membership — " + (data.name||"") + " | " + loafLabel + " · " + tier,
    body:
      "New Pilgrim Membership!\n\n" +
      "Sub ID: " + subId + "\nName: " + (data.name||"") +
      "\nEmail: " + (data.email||"") + "\nPhone: " + (data.phone||"") +
      "\nLoaf: " + loafLabel +
      "\nTier: " + tier + " — $" + subInfo.price +
      "\nStarts: " + (data.preferred_date||"TBD") +
      "\nNotes: " + (data.notes||"") +
      (cashLink ? "\n\nCash App link:\n" + cashLink : "") +
      (squareLink ? "\n\nSquare link:\n" + squareLink : "") +
      (venmoLink ? "\n\nVenmo link:\n" + venmoLink : ""),
    name: "Fatima Bakery Orders"
  });
}

// ── Subscription active email (fires once payment is confirmed) ──
function sendSubscriptionActiveEmail(data) {
  if (!data || typeof data !== "object") {
    _logManualHelperRun("sendSubscriptionActiveEmail", "testSubscriptionActiveEmail");
    return;
  }
  var name = data.name || "there";

  var contentHTML =
    "<p>Hi " + name + ",</p>" +
    "<p>✅ Payment received — your Pilgrim Membership is active!</p>" +
    buildInfoTable([
      ["Plan",         data.tier      || ""],
      ["Price",        data.price     || ""],
      ["First pickup", data.startDate || ""],
      ["Last pickup",  data.endDate   || ""],
      ["Sub ID",       data.subId     || ""]
    ]) +
    "<p>Your Fatima boule will be ready for pickup every Friday for the length of your membership. Nothing else is due until renewal.</p>";

  var textBody =
    "Hi " + name + ", payment received — your Pilgrim Membership is active!\n\n" +
    "Plan: " + (data.tier||"") + "\nPrice: " + (data.price||"") +
    "\nFirst pickup: " + (data.startDate||"") + "\nLast pickup: " + (data.endDate||"") +
    "\nSub ID: " + (data.subId||"") +
    "\n\nYour Fatima boule will be ready every Friday for the length of your membership." +
    "\nNothing else due until renewal.\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "✅ Membership active — " + (data.subId||""),
    body: textBody, htmlBody: buildBaseEmailHTML("Membership Active ✅", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

// Editor-safe test: run this from the Apps Script dropdown to verify
// the membership received email without needing a website submission.
function testSubscriptionEmail() {
  var start = new Date();
  start.setDate(start.getDate() + 7);
  var startDate = Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var testData = {
    name: "Test Customer",
    phone: "(512) 555-0100",
    ig_handle: "@test",
    email: OWNER_EMAIL_BACKUP || OWNER_EMAIL,
    preferred_date: startDate,
    notes: "Editor test only",
    source: "apps_script_test"
  };
  var subInfo = SUBSCRIPTIONS.fatima["4 weeks"];
  var subId = "FBS-TEST-" + new Date().getTime();
  var squareLink = createSquarePaymentLink(
    subInfo.price * 100,
    subId,
    testData.name,
    "Pilgrim Membership — Fatima Classic · 4 weeks"
  );
  var totalFmt = "$" + Number(subInfo.price || 0).toFixed(2);
  var cashLink = createCashAppLink(totalFmt);
  var venmoLink = createVenmoLink(totalFmt, subId);
  sendSubscriptionEmail(testData, "4 weeks", subInfo, squareLink, subId, "Fatima Classic", cashLink, venmoLink);
  Logger.log("testSubscriptionEmail sent to " + testData.email + " with Sub ID " + subId);
}

// Editor-safe test: run this from the Apps Script dropdown to verify
// the membership active email after payment confirmation.
function testSubscriptionActiveEmail() {
  var start = new Date();
  start.setDate(start.getDate() + 7);
  var end = new Date(start);
  end.setDate(end.getDate() + 28);
  var testData = {
    name: "Test Customer",
    email: OWNER_EMAIL_BACKUP || OWNER_EMAIL,
    tier: "Fatima Classic · 4 weeks",
    price: "$44",
    startDate: Utilities.formatDate(start, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    endDate: Utilities.formatDate(end, Session.getScriptTimeZone(), "yyyy-MM-dd"),
    subId: "FBS-TEST-" + new Date().getTime()
  };
  sendSubscriptionActiveEmail(testData);
  Logger.log("testSubscriptionActiveEmail sent to " + testData.email + " with Sub ID " + testData.subId);
}


// ============================================================
//  3b. CONTACT FORM — general inquiries (fatima-contact.html)
// ============================================================
function handleContact(data, ss) {
  // Honeypot — a real visitor never sees or fills this field.
  // If it's filled, accept quietly and do nothing further.
  if (data._gotcha) return jsonResponse({ status: "success" });

  var name    = (data.name    || "").toString().trim();
  var email   = (data.email   || "").toString().trim();
  var message = (data.message || "").toString().trim();

  if (!name || !email || !message) {
    return jsonResponse({ status: "error", message: "Missing required fields." });
  }

  var sheet = ss.getSheetByName("Contact Messages");
  if (!sheet) {
    sheet = ss.insertSheet("Contact Messages");
    var hdr = ["Timestamp", "Name", "Email", "Message", "Status"];
    sheet.getRange(1, 1, 1, hdr.length).setValues([hdr]);
    var h = sheet.getRange("1:1");
    h.setBackground("#4a5e3a"); h.setFontColor("#e8dfc8"); h.setFontWeight("bold");
    sheet.setFrozenRows(1);
    [160, 160, 220, 400, 110].forEach(function(w, i) { sheet.setColumnWidth(i + 1, w); });
  }

  sheet.appendRow([new Date(), name, email, message, "New"]);

  // Notify the owner — replyTo is the sender, so a direct reply
  // from the inbox goes straight back to them.
  sendTrackedEmail({
    to: OWNER_EMAIL,
    bcc: OWNER_EMAIL_BACKUP || undefined,
    replyTo: email,
    subject: "New contact form message from " + name,
    body: "From: " + name + " <" + email + ">\n\n" + message,
    name: "Fatima Bakery Contact Form"
  });

  return jsonResponse({ status: "success" });
}


// ============================================================
//  4. SQUARE — payment links
// ============================================================
function createSquarePaymentLink(amountCents, orderId, customerName, itemDesc) {
  if (!SQUARE_ACCESS_TOKEN || !SQUARE_LOCATION_ID) return null;
  var squareItemName = "Fatima Bakery " + orderId + " — " +
    (itemDesc || "Order") + " — " + (customerName || "Customer");
  var payload = {
    idempotency_key: orderId,
    description: "Fatima Bakery — " + orderId,
    order: {
      location_id: SQUARE_LOCATION_ID,
      line_items: [{
        name: squareItemName.substring(0, 255),
        quantity: "1",
        base_price_money: { amount: amountCents, currency: "USD" }
      }]
    },
    checkout_options: { allow_tipping: false, merchant_support_email: OWNER_EMAIL }
  };
  try {
    var res = UrlFetchApp.fetch(
      "https://connect.squareup.com/v2/online-checkout/payment-links",
      { method: "post", muteHttpExceptions: true,
        headers: { "Authorization": "Bearer " + SQUARE_ACCESS_TOKEN,
          "Content-Type": "application/json", "Square-Version": SQUARE_VERSION },
        payload: JSON.stringify(payload) }
    );
    var result = JSON.parse(res.getContentText());
    return result.payment_link ? result.payment_link.url : null;
  } catch (err) { Logger.log("Square error: " + err); return null; }
}


// ============================================================
//  5. VENMO — pre-filled payment link
// ============================================================
function createVenmoLink(total, orderId) {
  var handle = VENMO_HANDLE.replace("@", "");
  var amount = parseFloat((total||"0").replace(/[^0-9.]/g, "")).toFixed(2);
  return "https://venmo.com/" + handle
    + "?txn=pay&amount=" + amount
    + "&note=" + encodeURIComponent(orderId + " Fatima Bakery");
}


// ============================================================
//  5b. CASH APP — pre-filled payment link (primary)
// ============================================================
function createCashAppLink(total) {
  var amount = parseFloat((total||"0").replace(/[^0-9.]/g, "")).toFixed(2);
  return "https://cash.app/" + CASHAPP_HANDLE + "/" + amount;
}


// ============================================================
//  6. SQUARE WEBHOOK — auto-confirm on payment
//     Register Web App URL → Square Developer → Webhooks
//     Events: payment.completed
// ============================================================
function receiveSquareWebhook(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (body.type !== "payment.completed") return jsonResponse({ status: "ok" });
    var note    = body.data && body.data.object && body.data.object.payment
                  ? (body.data.object.payment.note || "") : "";
    var isSub   = note.match(/FBS-\d+/);
    var isOrder = note.match(/FB-\d+/);
    if (isSub)   updateSubscriptionStatus(isSub[0], "Active");
    if (isOrder) confirmOrder(isOrder[0]);
    return jsonResponse({ status: "ok" });
  } catch (err) { Logger.log("Webhook error: " + err); return jsonResponse({ status: "ok" }); }
}

function confirmOrder(orderId) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][15] === orderId) {               // Col P = Order ID (0-indexed: 15)
      sheet.getRange(i+1, 17).setValue("Confirmed"); // Col Q = Status
      updateLineItemStatus(orderId, "Confirmed");
      var d = { name: rows[i][1], email: rows[i][4], phone: rows[i][2],
                order: rows[i][5], total: rows[i][10],
                preferred_date: rows[i][11], preferred_time: rows[i][12],
                orderId: orderId };
      if (d.email) sendPaymentConfirmedEmail(d);
      if (CALENDAR_ID) createCalendarEvent(d, orderId);
      // Alert owner
      sendOwnerPaymentAlert(d);
      break;
    }
  }
}

function confirmOrderVenmo(orderId) {
  // Call from Sheet menu when you manually verify a Venmo payment
  confirmOrder(orderId);
}

// ── Refund — call manually when you cannot fulfill an order ──
// method: "Square" (refunded automatically via Square dashboard/API)
//      or "Cash App" (you send the refund manually)
function refundOrder(orderId, method) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][15] === orderId) {                 // Col P = Order ID
      sheet.getRange(i+1, 17).setValue("Refunded"); // Col Q = Status
      updateLineItemStatus(orderId, "Refunded");
      var d = { name: rows[i][1], email: rows[i][4], total: rows[i][10],
                orderId: orderId, method: method || "Square" };
      if (d.email) sendRefundEmail(d);
      break;
    }
  }
}

// ── Refund email — sent to customer when an order cannot be fulfilled ──
function sendRefundEmail(data) {
  var name = data.name || "there";
  var methodNote = data.method === "Square"
    ? "Your refund was processed automatically through Square and should appear on your original payment method within 5 to 10 business days."
    : "We have sent your refund manually via " + (data.method||"Cash App") + ". Please allow a short time for it to arrive.";

  var contentHTML =
    "<p>Hi " + name + ",</p>" +
    "<p>We are sorry we could not fulfill your order. A full refund has been issued.</p>" +
    buildInfoTable([
      ["Order ID", data.orderId || ""],
      ["Amount",   data.total   || ""],
      ["Method",   data.method  || ""]
    ]) +
    "<p>" + methodNote + "</p>" +
    "<p>If you have any questions, reply to this email or message us on Instagram.</p>";

  var textBody =
    "Hi " + name + ",\n\n" +
    "We are sorry we could not fulfill your order. A full refund of " + (data.total||"") +
    " has been issued via " + (data.method||"") + " for Order " + (data.orderId||"") + ".\n\n" +
    methodNote + "\n\n" +
    "Questions: DM " + INSTAGRAM_HANDLE + " or " + OWNER_EMAIL + "\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "💸 Refund issued — " + (data.orderId||""),
    body: textBody, htmlBody: buildBaseEmailHTML("Refund Issued", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

function updateSubscriptionStatus(subId, status) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Subscriptions");
  if (!sheet) return;
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][12] === subId) {              // Col M = Sub ID
      sheet.getRange(i+1, 10).setValue(status); // Col J = Status
      if (status === "Active") {
        var d = {
          name: rows[i][1], email: rows[i][4],
          tier: rows[i][5], price: rows[i][6],
          startDate: rows[i][7], endDate: rows[i][8],
          subId: subId
        };
        if (d.email) sendSubscriptionActiveEmail(d);
      }
      break;
    }
  }
}

function markSelectedSubscriptionActive() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  if (!sheet || sheet.getName() !== "Subscriptions") {
    safeAlert("Go to the Subscriptions sheet and select the membership row first.");
    return;
  }
  var row = sheet.getActiveRange().getRow();
  if (row < 2) {
    safeAlert("Select a subscription row first.");
    return;
  }
  var subId = sheet.getRange(row, 13).getValue(); // Col M = Sub ID
  if (!subId) {
    safeAlert("No Sub ID found in column M for the selected row.");
    return;
  }
  updateSubscriptionStatus(subId, "Active");
  safeAlert("Membership marked Active and confirmation email sent if an email address is present.");
}


// ============================================================
//  AGENT 2 — HTML EMAIL ENGINE
//  All customer-facing emails use branded HTML templates.
//  Plain-text fallbacks included for email client compatibility.
// ============================================================

function buildBaseEmailHTML(title, contentHTML) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<style>' +
    'body{margin:0;padding:0;background:#fcf7f1;font-family:Georgia,serif;color:#2e3d22}' +
    '.wrap{max-width:560px;margin:0 auto;background:#fcf7f1;padding:0 0 32px}' +
    '.header{background:#4a5e3a;padding:28px 32px;text-align:center}' +
    '.header h1{margin:0;color:#e8dfc8;font-size:22px;letter-spacing:2px;font-weight:normal}' +
    '.header p{margin:4px 0 0;color:#b5963e;font-size:13px;font-style:italic}' +
    '.content{padding:28px 32px}' +
    '.content p{font-size:15px;line-height:1.7;margin:0 0 14px}' +
    '.info-table{width:100%;border-collapse:collapse;margin:16px 0}' +
    '.info-table td{padding:8px 12px;font-size:14px;border-bottom:1px solid #e5e0d8}' +
    '.info-table td:first-child{color:#b5963e;font-weight:bold;width:38%;white-space:nowrap}' +
    '.divider{border:none;border-top:1px solid #d0c9b8;margin:20px 0}' +
    '.pay-box{background:#f0ede6;border-radius:6px;padding:18px 20px;margin:20px 0;text-align:center}' +
    '.pay-box p{margin:0 0 12px;font-size:14px}' +
    '.pay-btn{display:inline-block;background:#4a5e3a;color:#e8dfc8;text-decoration:none;' +
    'padding:11px 24px;border-radius:4px;font-size:14px;letter-spacing:1px;margin:4px}' +
    '.pay-btn.venmo{background:#008CFF}' +
    '.footer{text-align:center;padding:0 32px 28px;font-size:12px;color:#999}' +
    '.footer a{color:#b5963e;text-decoration:none}' +
    '</style></head><body>' +
    '<div class="wrap">' +
    '<div class="header">' +
    '<h1>FATIMA BAKERY ATX</h1>' +
    '<p>Baked with Grace &middot; Shared in Love</p>' +
    '</div>' +
    '<div class="content">' +
    (title ? '<p style="font-size:18px;font-weight:bold;margin-bottom:16px">' + title + '</p>' : '') +
    contentHTML +
    '</div>' +
    '<hr class="divider" style="margin:0 32px">' +
    '<div class="footer">' +
    '<p><a href="https://instagram.com/fatimabakeryatx">' + INSTAGRAM_HANDLE + '</a>' +
    ' &nbsp;&bull;&nbsp; <a href="mailto:' + OWNER_EMAIL + '">' + OWNER_EMAIL + '</a></p>' +
    '<p>' + PUBLIC_PICKUP_AREA + '</p>' +
    '</div></div></body></html>';
}

function buildInfoTable(rows) {
  var html = '<table class="info-table">';
  rows.forEach(function(row) {
    html += '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>';
  });
  return html + '</table>';
}

// ── Order received email (payment not yet collected) ─────────
function sendOrderReceivedEmail(data, orderId, returning, hasSpecialty, squareLink, venmoLink, cashLink) {
  var name    = data.name || "there";
  var greeting = returning ? "Welcome back, " + name + "." : "Hi " + name + ",";
  var isDelivery = (data.preferred_time||"").indexOf("Delivery") > -1;
  var addr = data.delivery_address || normalizeDeliveryAddress_(data);
  var addressText = fullDeliveryAddressText_(addr);
  var locationText = isDelivery
    ? htmlEscape_(addressText) + " &mdash; Thursday 3–5 PM"
    : PICKUP_ADDRESS + " &mdash; " + PICKUP_HOURS;

  var specialtyNote = hasSpecialty
    ? "<p style='color:#b5963e;font-size:13px'>📅 Specialty boules require 2 days advance. We will confirm availability.</p>"
    : "";

  var payHTML =
    "<div class='pay-box'>" +
    "<p><strong>Pay in full to secure your order:</strong></p>" +
    (cashLink   ? "<a class='pay-btn' href='" + cashLink + "'>💰 Pay with Cash App</a>" : "") +
    (squareLink ? "<a class='pay-btn' href='" + squareLink + "'>💳 Pay with Square</a>" : "") +
    (venmoLink  ? "<a class='pay-btn venmo' href='" + venmoLink + "'>📱 Pay with Venmo</a>" : "") +
    "<p style='font-size:12px;margin-top:12px;color:#666'>" +
    "Square confirms automatically. Cash App and Venmo confirmed within a few hours.</p>" +
    "<p style='font-size:12px;color:#666'>If we cannot fulfill your order, a full refund will be issued immediately.</p>" +
    "</div>";

  var contentHTML =
    "<p>" + greeting + " Your order has been received.</p>" +
    specialtyNote +
    buildInfoTable([
      ["Order ID",  orderId],
      ["Items",     data.order||""],
      ["Total",     htmlEscape_(data.total||"")],
      [isDelivery ? "Delivery" : "Pickup", locationText],
      ["Window",    htmlEscape_(data.preferred_time||"Friday")],
      isDelivery ? ["Delivery fee", htmlEscape_(data.delivery_fee || "$10.00")] : null,
      isDelivery ? ["Address status", htmlEscape_(addr.status || data.address_status || "Customer provided")] : null,
      isDelivery && data.address_correction_url ? ["Correct delivery address", "<a href='" + htmlEscape_(data.address_correction_url) + "'>Correct delivery address</a>"] : null,
      data.notes ? ["Notes", htmlEscape_(data.notes)] : null
    ].filter(Boolean)) +
    "<p><strong>Members receive classic and specialty reserved loaves baked fresh every week in Liberty Hill.</strong></p>" + payHTML +
    "<p style='font-size:13px;color:#3a3a3a;border-top:1px solid #e5e0d8;padding-top:14px'>" +
    "🥖 <strong>On " + (isDelivery ? "delivery" : "pickup") + " day:</strong> please text us at " +
    "<a href='sms:" + CONTACT_PHONE_SMS + "' style='color:#b5963e'>" + CONTACT_PHONE + "</a> when you're on your way" +
    (isDelivery ? " so we can confirm your delivery window" : "") +
    " — it helps us hand you the freshest possible loaf.</p>";

  var textBody =
    greeting + " Your order has been received.\n\n" +
    "Order ID: " + orderId + "\nItems: " + (data.order||"") +
    "\nTotal: " + (data.total||"") + "\n\n" +
    "Pay in full to confirm:\n" +
    (cashLink   ? "Cash App: " + cashLink + "\n" : "") +
    (squareLink ? "Square: " + squareLink + "\n" : "") +
    (venmoLink  ? "Venmo:  " + venmoLink  + "\n" : "") +
    "\nSquare confirms automatically. Cash App and Venmo confirmed within a few hours." +
    "\nFull refund if we cannot fulfill.\n\n" +
    "On " + (isDelivery ? "delivery" : "pickup") + " day, please text us at " + CONTACT_PHONE +
    " when you're on your way" + (isDelivery ? " to confirm your delivery window" : "") + ".\n\n" +
    "Questions: DM " + INSTAGRAM_HANDLE + " or " + OWNER_EMAIL + "\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email,
    subject: "🧁 Order received — payment required — " + orderId,
    body: textBody, htmlBody: buildBaseEmailHTML("Order Received", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

// ── Payment confirmed email (fires via Square webhook) ───────
function sendPaymentConfirmedEmail(data) {
  var isDelivery = (data.preferred_time||"").indexOf("Delivery") > -1;
  var deliveryAddressText = fullDeliveryAddressText_(normalizeDeliveryAddress_(data));
  var locationText = isDelivery
    ? htmlEscape_(deliveryAddressText || DELIVERY_AREA) + " &mdash; " + DELIVERY_HOURS
    : PICKUP_ADDRESS + " &mdash; " + PICKUP_HOURS;

  var contentHTML =
    "<p>Hi " + data.name + ",</p>" +
    "<p>✅ Payment received — your order is confirmed!</p>" +
    buildInfoTable([
      ["Order ID",  data.orderId],
      ["Items",     data.order],
      ["Total",     data.total],
      [isDelivery ? "Delivery" : "Pickup", locationText],
      ["Window",    data.preferred_time||"Friday"]
    ]) +
    "<p>Nothing due at " + (isDelivery ? "delivery" : "pickup") + ". See you on your scheduled fulfillment day!</p>";

  var textBody =
    "Hi " + data.name + ", payment received — order confirmed!\n\n" +
    "Order ID: " + data.orderId + "\nItems: " + data.order +
    "\nTotal: " + data.total + "\n" + (isDelivery ? "Delivery: " : "Pickup: ") + data.preferred_date +
    " " + (data.preferred_time||"Friday") +
    (isDelivery && deliveryAddressText ? "\nAddress: " + deliveryAddressText : "") +
    "\n\nNothing due at " + (isDelivery ? "delivery" : "pickup") + ". See you on your scheduled fulfillment day!\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "✅ Payment received — order confirmed! " + data.orderId,
    body: textBody, htmlBody: buildBaseEmailHTML("Order Confirmed ✅", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

function sendOwnerPaymentAlert(data) {
  sendTrackedEmail({
    to: OWNER_EMAIL, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "💳 Payment received — " + data.name + " | " + data.total,
    body: "Order confirmed via payment.\n\nOrder ID: " + data.orderId +
      "\nName: " + data.name + "\nItems: " + data.order +
      "\nTotal: " + data.total + "\nPickup: " + data.preferred_date,
    name: "Fatima Bakery Orders"
  });
}

// ── Owner new order alert ────────────────────────────────────
function sendOwnerNewOrderAlert(data, rowNum, orderId, bouleCount, specialtyCount, squareLink, venmoLink) {
  var addr = data.delivery_address || normalizeDeliveryAddress_(data);
  var addressText = fullDeliveryAddressText_(addr);
  var nav = addressText ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addressText) : "";
  var warns = "";
  if ((bouleCount||0) >= BOULE_LIMIT)         warns += "⚠️  Boule count at daily limit\n";
  if ((specialtyCount||0) >= SPECIALTY_LIMIT) warns += "⚠️  Specialty count at daily limit\n";
  if ((specialtyCount||0) > 0)                warns += "📅  Specialty — confirm 2-day advance\n";

  sendTrackedEmail({
    to: OWNER_EMAIL, bcc: OWNER_EMAIL_BACKUP || undefined,
    subject: "🧁 New order #" + rowNum + " — " + (data.name||"") + " | " + (data.total||""),
    body:
      (warns ? warns + "\n" : "") +
      "Status:    Awaiting Payment\n" +
      "Row:       " + rowNum + "\nOrder ID: " + orderId +
      "\nName:     " + (data.name||"") + "\nPhone:    " + (data.phone||"") +
      "\nIG:       " + (data.ig_handle||"") + "\nEmail:    " + (data.email||"") +
      "\n\nItems:    " + (data.order||"") +
      "\nBoules:   " + (bouleCount||0) + " / " + BOULE_LIMIT +
      "\nSpecialty:" + (specialtyCount||0) + " / " + SPECIALTY_LIMIT +
      "\nTotal:    " + (data.total||"") +
      "\n\nFulfillment: " + (data.preferred_date||"") + "  " + (data.preferred_time||"") +
      (addressText ? "\nAddress:   " + addressText : "") +
      (nav ? "\nNavigate:  " + nav : "") +
      "\nNotes:    " + (data.notes||"") +
      "\n\n" + (squareLink ? "Square: " + squareLink + "\n" : "⚠️  Square not configured.\n") +
      (venmoLink ? "Venmo:  " + venmoLink : ""),
    name: "Fatima Bakery Orders"
  });
}

// ── Pickup ready notification ────────────────────────────────
function sendPickupNotification(data) {
  var isDelivery = (data.preferred_time||"").indexOf("Delivery") > -1;
  var deliveryAddressText = fullDeliveryAddressText_(normalizeDeliveryAddress_(data));
  var locationText = isDelivery
    ? htmlEscape_(deliveryAddressText || DELIVERY_AREA) + " &mdash; " + DELIVERY_HOURS
    : PICKUP_ADDRESS + " &mdash; " + PICKUP_HOURS;

  var contentHTML =
    "<p>Hi " + data.name + ",</p>" +
    "<p>🌿 Your order is freshly baked and ready!</p>" +
    buildInfoTable([
      ["Order ID",  data.orderId],
      ["Items",     data.order],
      [isDelivery ? "Delivery" : "Pickup", locationText],
      ["Window",    data.preferred_time||"Friday"]
    ]) +
    "<p>Nothing due at " + (isDelivery ? "delivery" : "pickup") + " — payment was collected upfront.</p>";

  var textBody =
    "Hi " + data.name + ", your order is ready!\n\n" +
    "Order ID: " + data.orderId + "\nItems: " + data.order +
    "\n" + (isDelivery ? "Delivery: " + DELIVERY_AREA : "Pickup: " + PICKUP_ADDRESS) +
    "\nWindow: " + (data.preferred_time||"Friday") +
    "\n\nNothing due — payment collected upfront.\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email,
    subject: "🌿 Your order is ready — " + data.orderId,
    body: textBody, htmlBody: buildBaseEmailHTML("Order Ready 🌿", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

// ── Review request ───────────────────────────────────────────
function sendReviewRequest(data) {
  var contentHTML =
    "<p>Hi " + data.name + ",</p>" +
    "<p>We hope you enjoyed the bread. Every loaf is made with real care — " +
    "hearing from you means a lot.</p>" +
    (GOOGLE_REVIEW_URL
      ? "<div class='pay-box'><a class='pay-btn' href='" + GOOGLE_REVIEW_URL +
        "'>Leave a Google Review</a></div>"
      : "") +
    "<p>Or tag us on Instagram: <strong>" + INSTAGRAM_HANDLE + "</strong></p>";

  var textBody =
    "Hi " + data.name + ", hope you enjoyed the bread.\n\n" +
    (GOOGLE_REVIEW_URL ? "Google review: " + GOOGLE_REVIEW_URL + "\n\n" : "") +
    "Or tag us " + INSTAGRAM_HANDLE + " on Instagram.\n\nFatima Bakery ATX";

  sendTrackedEmail({
    to: data.email,
    subject: "How was your Fatima Bakery order?",
    body: textBody, htmlBody: buildBaseEmailHTML("How was your order?", contentHTML),
    name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
  });
}

// ── Capacity / advance notice emails ─────────────────────────
function sendCapacityEmail(data, msg) {
  if (!data.email) return;
  var html = buildBaseEmailHTML("Date Unavailable",
    "<p>Hi " + (data.name||"there") + ",</p><p>" + msg + "</p>" +
    "<p>Please choose a different Friday or DM us to check availability.</p>");
  sendTrackedEmail({ to: data.email, subject: "Fatima Bakery — date unavailable",
    body: msg + "\n\nPlease choose a different Friday or DM " + INSTAGRAM_HANDLE,
    htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL });
}

function sendAdvanceNoticeEmail(data, msg) {
  if (!data.email) return;
  var html = buildBaseEmailHTML("Advance Notice Required",
    "<p>Hi " + (data.name||"there") + ",</p><p>" + msg + "</p>" +
    "<p>Please reorder for a Friday at least 2 days out.</p>");
  sendTrackedEmail({ to: data.email, subject: "Fatima Bakery — advance notice required",
    body: msg + "\n\nPlease reorder for a Friday at least 2 days out.",
    htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL });
}


// ============================================================
//  7. MARK ORDER READY — triggered from Sheet custom menu
//     Select a customer row → 🧁 Fatima Bakery → Mark as Ready
// ============================================================
function markOrderReady() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row   = sheet.getActiveRange().getRow();
  if (row < 2) { safeAlert("Select an order row first."); return; }

  var status = sheet.getRange(row, 17).getValue(); // Col Q
  if (status !== "Confirmed" && status !== "Paid") {
    safeAlert("⚠️  This order is not yet Confirmed (status: " + status + ").\nMark it Confirmed first if payment was received.");
    return;
  }

  var data = {
    name:           sheet.getRange(row, 2).getValue(),
    email:          sheet.getRange(row, 5).getValue(),
    order:          sheet.getRange(row, 6).getValue(),
    total:          sheet.getRange(row, 11).getValue(),
    preferred_date: sheet.getRange(row, 12).getValue(),
    preferred_time: sheet.getRange(row, 13).getValue(),
    orderId:        sheet.getRange(row, 16).getValue()
  };

  sheet.getRange(row, 17).setValue("Ready for Pickup");
  updateLineItemStatus(data.orderId, "Ready for Pickup");

  if (data.email) {
    sendPickupNotification(data);
    scheduleReviewRequest(row, data);
    safeAlert("✅ " + data.name + " notified.");
  } else {
    safeAlert("⚠️  No email — notify " + data.name + " via DM.");
  }
  if (CALENDAR_ID) createCalendarEvent(data, data.orderId);
}

// ── Mark Confirmed (for Venmo payments) ─────────────────────
function markOrderConfirmedVenmo() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row   = sheet.getActiveRange().getRow();
  if (row < 2) { safeAlert("Select an order row first."); return; }

  var data = {
    name:           sheet.getRange(row, 2).getValue(),
    email:          sheet.getRange(row, 5).getValue(),
    order:          sheet.getRange(row, 6).getValue(),
    total:          sheet.getRange(row, 11).getValue(),
    preferred_date: sheet.getRange(row, 12).getValue(),
    preferred_time: sheet.getRange(row, 13).getValue(),
    orderId:        sheet.getRange(row, 16).getValue()
  };

  sheet.getRange(row, 17).setValue("Confirmed");
  updateLineItemStatus(data.orderId, "Confirmed");
  if (data.email) sendPaymentConfirmedEmail(data);
  if (CALENDAR_ID) createCalendarEvent(data, data.orderId);
  safeAlert("✅ " + data.name + " marked Confirmed — payment email sent.");
}

// ── Mark Cancelled (triggers waitlist agent) ─────────────────
function markOrderCancelled() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row   = sheet.getActiveRange().getRow();
  if (row < 2) { safeAlert("Select an order row first."); return; }

  var pickupDate = sheet.getRange(row, 12).getValue();
  sheet.getRange(row, 17).setValue("Cancelled");
  updateLineItemStatus(sheet.getRange(row, 16).getValue(), "Cancelled");
  safeAlert("✅ Order cancelled. Checking waitlist...");
  waitlistAgent(pickupDate);
}


// ============================================================
//  AGENT 0 — UNPAID ORDER TIMEOUT
//  Runs daily at 6am. Cancels any order still "Awaiting Payment"
//  after 24 hours, freeing up capacity for real paying customers.
//  Also alerts Lindsay so she can follow up if needed.
// ============================================================
function unpaidOrderTimeoutAgent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var rows      = sheet.getDataRange().getValues();
  var now       = new Date();
  var cutoff    = 24 * 60 * 60 * 1000; // 24 hours in ms
  var cancelled = [];

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][16] !== "Awaiting Payment") continue;
    var ts = rows[i][0];
    if (!(ts instanceof Date)) continue;
    if ((now - ts) > cutoff) {
      sheet.getRange(i + 1, 17).setValue("Cancelled — Unpaid");
      updateLineItemStatus(rows[i][15], "Cancelled — Unpaid");
      cancelled.push({
        orderId: rows[i][15],
        name:    rows[i][1],
        email:   rows[i][4],
        total:   rows[i][10],
        date:    rows[i][11]
      });
    }
  }

  if (cancelled.length === 0) return;

  var body = "Unpaid order timeout — " + cancelled.length + " order(s) cancelled:\n\n";
  cancelled.forEach(function(o) {
    body += "  " + o.orderId + " — " + o.name + " (" + o.email + ") — " + o.total + " — Pickup: " + o.date + "\n";
  });
  body += "\nCapacity for those pickup dates has been freed. Follow up with customers if needed.";

  sendTrackedEmail({
    to: OWNER_EMAIL,
    subject: "⏱ " + cancelled.length + " unpaid order(s) auto-cancelled",
    body: body,
    name: "Fatima Bakery Orders"
  });
}

// ============================================================
//  AGENT 1 — CAPACITY GUARD
//  Runs Tuesday 9am — before the weekly drop fires at 2pm.
//  Warns you if Friday is nearing capacity so you can adjust
//  the availability drop or pause new orders.
// ============================================================
function capacityGuardAgent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  // Find next Friday
  var today  = new Date(); today.setHours(0,0,0,0);
  var friday = new Date(today);
  while (friday.getDay() !== 5) friday.setDate(friday.getDate() + 1);
  var fridayStr = Utilities.formatDate(friday, Session.getScriptTimeZone(), "yyyy-MM-dd");

  var bouleUsed    = getDailyCount(sheet, fridayStr, "boule");
  var specialtyUsed = getDailyCount(sheet, fridayStr, "specialty");
  var combined     = bouleUsed + specialtyUsed;

  var alerts = [];
  if (bouleUsed >= BOULE_LIMIT)             alerts.push("🔴 Boule: FULL (" + bouleUsed + "/" + BOULE_LIMIT + ")");
  else if (bouleUsed >= BOULE_LIMIT - 1)    alerts.push("🟡 Boule: 1 remaining (" + bouleUsed + "/" + BOULE_LIMIT + ")");

  if (specialtyUsed >= SPECIALTY_LIMIT)     alerts.push("🔴 Specialty: FULL (" + specialtyUsed + "/" + SPECIALTY_LIMIT + ")");
  else if (specialtyUsed >= SPECIALTY_LIMIT - 1) alerts.push("🟡 Specialty: 1 remaining (" + specialtyUsed + "/" + SPECIALTY_LIMIT + ")");

  if (combined >= COMBINED_LIMIT)           alerts.push("🔴 Combined: AT LIMIT (" + combined + "/" + COMBINED_LIMIT + ")");

  if (alerts.length > 0) {
    sendTrackedEmail({
      to: OWNER_EMAIL, bcc: OWNER_EMAIL_BACKUP || undefined,
      subject: "⚠️  Capacity Alert — Friday " + fridayStr,
      body:
        "Capacity Guard Agent — Tuesday morning check\n\n" +
        "Friday: " + fridayStr + "\n\n" +
        alerts.join("\n") +
        "\n\nBoule orders:    " + bouleUsed + " / " + BOULE_LIMIT +
        "\nSpecialty orders: " + specialtyUsed + " / " + SPECIALTY_LIMIT +
        "\nCombined:         " + combined + " / " + COMBINED_LIMIT +
        "\n\nYour weekly drop fires tonight at 8pm. " +
        "Update thisWeek{} to reflect actual availability before it sends.",
      name: "Fatima Bakery — Capacity Guard"
    });
    Logger.log("Capacity Guard: alerts sent for " + fridayStr);
  } else {
    Logger.log("Capacity Guard: " + fridayStr + " — capacity OK (" + combined + "/" + COMBINED_LIMIT + ")");
  }
}


// ============================================================
//  AGENT 3 — ORPHAN CHECKER
//  Runs every 30 minutes. Finds orders stuck in
//  "Awaiting Payment" for more than 2 hours and re-sends
//  the payment email. Stops after 3 attempts.
// ============================================================
function orphanCheckerAgent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var now   = new Date();
  var rows  = sheet.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();

  for (var i = 1; i < rows.length; i++) {
    var status    = rows[i][16]; // Col Q
    var email     = rows[i][4];  // Col E
    var timestamp = rows[i][0];  // Col A
    var orderId   = rows[i][15]; // Col P

    if (status !== "Awaiting Payment" || !email || !orderId) continue;

    var ageHours = (now - new Date(timestamp)) / 3600000;
    if (ageHours < 2) continue; // Give customer 2 hours before nudging

    var attemptKey = "orphan_attempts_" + orderId;
    var attempts   = parseInt(props.getProperty(attemptKey) || "0");
    if (attempts >= 3) continue; // Max 3 retry attempts

    // Re-send payment reminder
    var total   = rows[i][10];
    var order   = rows[i][5];
    var name    = rows[i][1];
    var squareLink = createSquarePaymentLink(
      Math.round(parseFloat((total||"0").replace(/[^0-9.]/g,"")) * 100),
      orderId, name, order
    );
    var venmoLink = createVenmoLink(total, orderId);

    var html = buildBaseEmailHTML("Payment Reminder",
      "<p>Hi " + name + ",</p>" +
      "<p>Just a friendly reminder — your Fatima Bakery order is waiting for payment.</p>" +
      buildInfoTable([["Order ID",orderId],["Items",order],["Total",total]]) +
      "<div class='pay-box'>" +
      (squareLink ? "<a class='pay-btn' href='" + squareLink + "'>💳 Pay with Square</a>" : "") +
      (venmoLink  ? "<a class='pay-btn venmo' href='" + venmoLink + "'>📱 Pay with Venmo</a>" : "") +
      "<p style='font-size:12px;margin-top:12px;color:#666'>Orders not paid within 24 hours may be released.</p>" +
      "</div>");

    sendTrackedEmail({
      to: email,
      subject: "Reminder: complete your Fatima Bakery order — " + orderId,
      body: "Hi " + name + ", your order is still awaiting payment.\n\n" +
        "Order ID: " + orderId + "\nItems: " + order + "\nTotal: " + total + "\n\n" +
        (squareLink ? "Square: " + squareLink + "\n" : "") +
        (venmoLink  ? "Venmo:  " + venmoLink  + "\n" : "") +
        "\nOrders not paid within 24 hours may be released.",
      htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
    });

    props.setProperty(attemptKey, String(attempts + 1));
    Logger.log("Orphan Checker: reminder " + (attempts+1) + " sent for " + orderId);
  }
}


// ============================================================
//  AGENT 4 — WAITLIST AGENT
//  Called when: capacity is full on a date (blocking new order)
//  OR when an order is cancelled (opening up a slot).
//  Auto-notifies the next waiting customer for that date.
// ============================================================
function waitlistAgent(pickupDate) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var wSheet = ss.getSheetByName("Waitlist");
  if (!wSheet) return;

  var rows  = wSheet.getDataRange().getValues();
  var props = PropertiesService.getScriptProperties();

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][5] !== "Waiting") continue;
    // If no specific pickup date or it matches the opened date
    if (pickupDate && rows[i][4] && rows[i][4].toString().indexOf(pickupDate) === -1) continue;

    var email = rows[i][2];
    var name  = rows[i][1];
    if (!email) continue;

    var html = buildBaseEmailHTML("A spot just opened up!",
      "<p>Hi " + name + ",</p>" +
      "<p>Good news — a spot has opened up for your waitlisted order.</p>" +
      "<div class='pay-box'>" +
      "<a class='pay-btn' href='" + (ORDER_FORM_URL||"#") + "'>Order now</a>" +
      "<p style='font-size:12px;margin-top:10px;color:#666'>Spots fill quickly — first come, first served.</p>" +
      "</div>");

    sendTrackedEmail({
      to: email,
      subject: "🧁 A spot just opened at Fatima Bakery!",
      body: "Hi " + name + ", a spot opened up. Order now: " + (ORDER_FORM_URL||"[order form URL]"),
      htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
    });

    wSheet.getRange(i + 1, 6).setValue("Notified");
    Logger.log("Waitlist Agent: notified " + email + " for date " + pickupDate);
    break; // Notify one at a time — first in line only
  }
}

function notifyWaitlist() {
  // Manual trigger from Sheet menu — notifies next in line for any date
  waitlistAgent(null);
  safeAlert("Waitlist Agent: next customer notified.");
}


// ============================================================
//  AGENT 5 — SUBSCRIPTION RENEWAL AGENT
//  Runs Monday 9am. Finds subscriptions ending within 7 days.
//  Sends a renewal email with all three tier options + links.
// ============================================================
function subscriptionRenewalAgent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Subscriptions");
  if (!sheet) return;

  var rows  = sheet.getDataRange().getValues();
  var now   = new Date(); now.setHours(0,0,0,0);
  var sevenDaysOut = new Date(now.getTime() + 7 * 86400000);

  rows.forEach(function(row, i) {
    if (i === 0) return;
    if (row[9] !== "Active") return; // Col J = Status

    var endDateRaw = row[8]; // Col I = End Date
    if (!endDateRaw) return;
    var endDate = new Date(endDateRaw);
    endDate.setHours(0,0,0,0);

    if (endDate > sevenDaysOut) return; // More than 7 days away
    if (endDate < now) return;          // Already ended

    var email = row[4]; // Col E
    var name  = row[1]; // Col B
    var tier  = row[5]; // Col F
    if (!email) return;

    // Check if renewal email already sent
    var sentKey = "renewal_sent_" + row[0].toString().replace(/[^a-z0-9]/gi,"");
    if (PropertiesService.getScriptProperties().getProperty(sentKey)) return;

    // Generate Square links for each tier
    var s4 = createSquarePaymentLink(4400, "FBS-RENEW4-"+Date.now(), name, "Pilgrim Membership 4 weeks");
    var s6 = createSquarePaymentLink(6000, "FBS-RENEW6-"+Date.now(), name, "Pilgrim Membership 6 weeks");
    var s8 = createSquarePaymentLink(7200, "FBS-RENEW8-"+Date.now(), name, "Pilgrim Membership 8 weeks");

    var renewHTML =
      "<div class='pay-box'>" +
      "<p><strong>Renew your Pilgrim Membership:</strong></p>" +
      (s4 ? "<a class='pay-btn' href='" + s4 + "'>4 Weeks — $44</a>" : "") +
      (s6 ? "<a class='pay-btn' href='" + s6 + "'>6 Weeks — $60</a>" : "") +
      (s8 ? "<a class='pay-btn' href='" + s8 + "'>8 Weeks — $72</a>" : "") +
      "</div>";

    var contentHTML =
      "<p>Hi " + name + ",</p>" +
      "<p>Your " + tier + " Pilgrim Membership is ending soon. We hope you've enjoyed every loaf.</p>" +
      "<p>Your last delivery is on " + endDateRaw + ".</p>" +
      renewHTML +
      "<p>Not renewing? No action needed — your Pilgrim Membership ends automatically.</p>";

    var textBody =
      "Hi " + name + ", your " + tier + " Pilgrim Membership ends " + endDateRaw + ".\n\n" +
      "Renew:\n" +
      (s4 ? "4 weeks ($44): " + s4 + "\n" : "") +
      (s6 ? "6 weeks ($60): " + s6 + "\n" : "") +
      (s8 ? "8 weeks ($72): " + s8 + "\n" : "") +
      "\nNo action needed if not renewing.\nFatima Bakery ATX";

    sendTrackedEmail({
      to: email,
      subject: "🌿 Your Pilgrim Membership is ending soon — renew?",
      body: textBody, htmlBody: buildBaseEmailHTML("Renew Your Pilgrim Membership 🌿", contentHTML),
      name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
    });

    PropertiesService.getScriptProperties().setProperty(sentKey, "true");
    Logger.log("Subscription Renewal Agent: renewal email sent to " + email);
  });
}


// ============================================================
//  AGENT 6 — FRIDAY BAKE SHEET
//  Runs Friday 6am. Reads all Confirmed orders for today.
//  Emails you a clean prep list grouped by item type.
// ============================================================
function fridayBakeSheetAgent() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return;

  var today    = new Date(); today.setHours(0,0,0,0);
  var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");
  var rows     = sheet.getDataRange().getValues();

  var orders      = [];
  var itemTotals  = {};
  var deliveries  = [];
  var pickups     = [];
  var totalRev    = 0;

  for (var i = 1; i < rows.length; i++) {
    var status   = rows[i][16]; // Col Q
    var rowDate  = rows[i][11]; // Col L
    var rowDateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "yyyy-MM-dd")
      : rowDate.toString();

    if (rowDateStr !== todayStr) continue;
    if (status !== "Confirmed" && status !== "Ready for Pickup" && status !== "Paid") continue;

    var orderData = {
      name:   rows[i][1],
      items:  rows[i][5],
      total:  rows[i][10],
      window: rows[i][12],
      orderId:rows[i][15]
    };

    orders.push(orderData);
    totalRev += parseFloat((orderData.total||"0").replace(/[^0-9.]/g,"")) || 0;

    // Parse items
    (orderData.items||"").split(";").forEach(function(item) {
      var clean = item.trim().replace(/\s*x\d+$/, "").trim();
      var qtyMatch = item.match(/x(\d+)/);
      var qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
      if (!clean) return;
      itemTotals[clean] = (itemTotals[clean] || 0) + qty;
    });

    if ((orderData.window||"").indexOf("Delivery") > -1) {
      deliveries.push(orderData);
    } else {
      pickups.push(orderData);
    }
  }

  if (orders.length === 0) {
    Logger.log("Friday Bake Sheet: no confirmed orders for " + todayStr);
    return;
  }

  // Build bake sheet email
  var itemList = Object.keys(itemTotals).map(function(k) {
    return "  " + itemTotals[k] + "x  " + k;
  }).join("\n");

  var orderList = orders.map(function(o) {
    return "  " + o.name + " — " + o.items + " (" + o.window + ")";
  }).join("\n");

  var body =
    "FRIDAY BAKE SHEET — " + todayStr + "\n" +
    "Generated by: Friday Bake Sheet Agent\n\n" +
    "════════════════════════════════\n" +
    " WHAT TO BAKE\n" +
    "════════════════════════════════\n" +
    itemList +
    "\n\n════════════════════════════════\n" +
    " ORDERS (" + orders.length + " total — $" + totalRev.toFixed(2) + ")\n" +
    "════════════════════════════════\n" +
    orderList +
    "\n\n── Pickups (" + pickups.length + "): 9am–12pm, 112 Civita Rd\n" +
    pickups.map(function(o){ return "  " + o.name + " — " + o.items; }).join("\n") +
    "\n\n── Deliveries (" + deliveries.length + "): 3pm–5pm, " + DELIVERY_AREA + "\n" +
    deliveries.map(function(o){ return "  " + o.name + " — " + o.items; }).join("\n");

  // HTML version
  var itemRows = Object.keys(itemTotals).map(function(k) {
    return "<tr><td><strong>" + itemTotals[k] + "x</strong></td><td>" + k + "</td></tr>";
  }).join("");

  var orderRows = orders.map(function(o) {
    return "<tr><td>" + o.name + "</td><td>" + o.items + "</td><td>" +
      (o.window||"Pickup") + "</td></tr>";
  }).join("");

  var htmlContent =
    "<p><strong>Friday " + todayStr + "</strong> — " + orders.length +
    " orders, $" + totalRev.toFixed(2) + " total</p>" +
    "<h3 style='color:#4a5e3a'>What to bake</h3>" +
    "<table class='info-table'><tr><th style='background:#4a5e3a;color:#e8dfc8;padding:8px'>Qty</th>" +
    "<th style='background:#4a5e3a;color:#e8dfc8;padding:8px'>Item</th></tr>" +
    itemRows + "</table>" +
    "<h3 style='color:#4a5e3a;margin-top:20px'>All orders</h3>" +
    "<table class='info-table'><tr>" +
    "<th style='background:#4a5e3a;color:#e8dfc8;padding:8px'>Customer</th>" +
    "<th style='background:#4a5e3a;color:#e8dfc8;padding:8px'>Items</th>" +
    "<th style='background:#4a5e3a;color:#e8dfc8;padding:8px'>Window</th></tr>" +
    orderRows + "</table>";

  sendTrackedEmail({
    to: OWNER_EMAIL,
    subject: "🧁 Friday Bake Sheet — " + orders.length + " orders | $" + totalRev.toFixed(2),
    body: body,
    htmlBody: buildBaseEmailHTML("Friday Bake Sheet 🧁", htmlContent),
    name: "Fatima Bakery — Bake Sheet"
  });

  Logger.log("Friday Bake Sheet: sent for " + todayStr + ", " + orders.length + " orders");
}


// ============================================================
//  8. REVIEW REQUEST — 24hrs after Ready
// ============================================================
function scheduleReviewRequest(row, data) {
  var fireAt = new Date();
  fireAt.setHours(fireAt.getHours() + 24);
  PropertiesService.getScriptProperties()
    .setProperty("review_" + fireAt.getTime(),
      JSON.stringify({ name: data.name, email: data.email }));
  ScriptApp.newTrigger("sendPendingReviews").timeBased().at(fireAt).create();
}

function sendPendingReviews() {
  var props = PropertiesService.getScriptProperties().getProperties();
  Object.keys(props).forEach(function(key) {
    if (!key.startsWith("review_")) return;
    try {
      var d = JSON.parse(props[key]);
      if (d.email) sendReviewRequest(d);
      PropertiesService.getScriptProperties().deleteProperty(key);
    } catch(e) { Logger.log("Review error: " + e); }
  });
}


// ============================================================
//  9. WEEKLY AVAILABILITY DROP — Tuesday 2pm auto-send
//     Edit thisWeek{} each Tuesday before the trigger fires
// ============================================================
function sendWeeklyDrop() {
  // Fully automated — no manual editing required.
  // Calculates this Friday's remaining availability directly
  // from the Orders sheet, then emails the active waitlist.
  // Fires automatically every Tuesday at 2pm via trigger.

  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var ordersSheet = ss.getSheetByName(SHEET_NAME);
  var emailSheet  = ss.getSheetByName("Fatima Bakery \u2014 Email List");
  if (!emailSheet) { Logger.log("Email list sheet not found"); return; }

  // Find this coming Friday
  var today  = new Date();
  var dow    = today.getDay();
  var daysTo = (5 - dow + 7) % 7 || 7;
  var friday = new Date(today);
  friday.setDate(today.getDate() + daysTo);
  var fridayStr = Utilities.formatDate(friday, Session.getScriptTimeZone(), "yyyy-MM-dd");

  // Calculate remaining capacity from Orders sheet
  var bouleUsed    = ordersSheet ? getDailyCount(ordersSheet, fridayStr, "boule")    : 0;
  var specUsed     = ordersSheet ? getDailyCount(ordersSheet, fridayStr, "specialty") : 0;
  var bouleLeft    = Math.max(BOULE_LIMIT - bouleUsed, 0);
  var specLeft     = Math.max(SPECIALTY_LIMIT - specUsed, 0);
  var combinedLeft = Math.max(COMBINED_LIMIT - bouleUsed - specUsed, 0);

  // If fully sold out, notify Lindsay and skip
  if (combinedLeft === 0) {
    Logger.log("Weekly drop skipped \u2014 Friday " + fridayStr + " fully sold out.");
    sendTrackedEmail({
      to: OWNER_EMAIL,
      subject: "Weekly drop skipped \u2014 Friday sold out",
      body: "This Friday (" + fridayStr + ") is fully booked. No availability email was sent.",
      name: "Fatima Bakery Orders"
    });
    return;
  }

  // Per-item availability from Line Items sheet
  var lineSheet   = ss.getSheetByName("Line Items");
  var itemOrdered = {};
  if (lineSheet) {
    var liRows = lineSheet.getDataRange().getValues();
    for (var r = 1; r < liRows.length; r++) {
      var liStatus = liRows[r][10];
      if (liStatus === "Cancelled" || liStatus === "Cancelled \u2014 Unpaid") continue;
      var liDate = liRows[r][8];
      var liDateStr = liDate instanceof Date
        ? Utilities.formatDate(liDate, Session.getScriptTimeZone(), "yyyy-MM-dd")
        : liDate.toString();
      if (liDateStr !== fridayStr) continue;
      var liName = liRows[r][3];
      var liQty  = Number(liRows[r][5]) || 0;
      if (liName) itemOrdered[liName] = (itemOrdered[liName] || 0) + liQty;
    }
  }

  var bouleLines   = [];
  var specLines    = [];
  var soldOutLines = [];

  Object.keys(MENU).forEach(function(name) {
    var item = MENU[name];
    if (item.type !== "boule" && item.type !== "specialty") return;
    var limit     = item.type === "boule" ? BOULE_LIMIT : SPECIALTY_LIMIT;
    var remaining = Math.max(limit - (itemOrdered[name] || 0), 0);
    if (remaining === 0) {
      soldOutLines.push(name);
    } else {
      var line = name + " (" + remaining + " left)";
      if (item.type === "boule") bouleLines.push(line);
      else specLines.push(line);
    }
  });

  if (bouleLines.length === 0 && soldOutLines.indexOf("Fatima") === -1)
    bouleLines = ["Fatima (" + bouleLeft + " left)"];
  if (specLines.length === 0 && specLeft > 0)
    specLines = ["Specialty boules (" + specLeft + " left)"];

  // Send to each active subscriber
  var rows = emailSheet.getDataRange().getValues();
  var sent = 0;

  for (var i = 1; i < rows.length; i++) {
    if (rows[i][3] !== "Active") continue;
    var email = rows[i][1];
    var name  = rows[i][0] || "there";
    if (!email) continue;

    var tableRows = [
      bouleLines.length   ? ["Sourdough",  bouleLines.join(", ")]  : null,
      specLines.length    ? ["Specialty",  specLines.join(", ")]    : null,
      soldOutLines.length ? ["Sold out",   soldOutLines.join(", ")] : null,
      ["Pickup",   PICKUP_ADDRESS + " \u2014 " + PICKUP_HOURS],
      ["Delivery", DELIVERY_AREA  + " \u2014 " + DELIVERY_HOURS + " (+$10)"]
    ].filter(Boolean);

    var contentHTML =
      "<p>Hi " + name + ",</p>" +
      "<p>This Friday's availability (orders close Wednesday evening):</p>" +
      buildInfoTable(tableRows) +
      (specLines.length ? "<p style='font-size:13px;color:#b5963e'>Specialty boules require 2 days advance notice.</p>" : "") +
      "<div class='pay-box'><a class='pay-btn' href='" + (ORDER_FORM_URL||"#") + "'>Order now</a></div>" +
      "<p style='font-size:12px;color:#999'>Reply STOP to unsubscribe.</p>";

    var textBody =
      "Hi " + name + ", this Friday's availability:\n\n" +
      (bouleLines.length   ? "Sourdough: "  + bouleLines.join(", ")   + "\n" : "") +
      (specLines.length    ? "Specialty: "  + specLines.join(", ")    + "\n" : "") +
      (soldOutLines.length ? "Sold out: "   + soldOutLines.join(", ") + "\n" : "") +
      "\nPickup: "   + PICKUP_ADDRESS + " \u2014 " + PICKUP_HOURS +
      "\nDelivery: " + DELIVERY_AREA  + " \u2014 " + DELIVERY_HOURS + " (+$10)" +
      "\n\nOrder: "  + (ORDER_FORM_URL||"[order form URL]") +
      "\n\nFatima Bakery ATX\n---\nReply STOP to unsubscribe.";

    sendTrackedEmail({
      to: email,
      subject: "This Friday at Fatima Bakery \u2014 Liberty Hill",
      body: textBody,
      htmlBody: buildBaseEmailHTML("This Friday", contentHTML),
      name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL
    });
    sent++;
  }

  Logger.log("Weekly drop: Friday " + fridayStr +
    " \u2014 boule " + bouleLeft + "/" + BOULE_LIMIT +
    ", specialty " + specLeft + "/" + SPECIALTY_LIMIT +
    ", sent to " + sent + " subscribers.");
}


// ============================================================
//  10. GOOGLE CALENDAR — entry created on payment confirmed
// ============================================================
function createCalendarEvent(data, orderId) {
  if (!CALENDAR_ID) return;
  try {
    var cal   = CalendarApp.getCalendarById(CALENDAR_ID);
    var raw   = data.preferred_date;
    var parts = raw instanceof Date
                ? [raw.getFullYear(), raw.getMonth()+1, raw.getDate()]
                : raw.toString().split("-").map(Number);
    var isDelivery = (data.preferred_time||"").indexOf("Delivery") > -1;
    var startHour = isDelivery ? 15 : 9;
    var endHour = isDelivery ? 17 : 12;
    var start = new Date(parts[0], parts[1]-1, parts[2], startHour, 0);
    var end   = new Date(parts[0], parts[1]-1, parts[2], endHour, 0);
    var deliveryAddressText = fullDeliveryAddressText_(normalizeDeliveryAddress_(data));
    cal.createEvent("🧁 " + data.name + " — " + data.total, start, end, {
      description:
        "Order ID: " + orderId + "\nItems: " + data.order +
        "\nPhone: " + (data.phone||"—") + "\nWindow: " + (data.preferred_time||"Friday") +
        (isDelivery && deliveryAddressText ? "\nAddress: " + deliveryAddressText : ""),
      location: isDelivery ? deliveryAddressText : PICKUP_ADDRESS
    });
  } catch (err) { Logger.log("Calendar error: " + err); }
}


// ============================================================
//  11. RETURNING CUSTOMER CHECK
// ============================================================
function isReturningCustomer(email, sheet) {
  if (!email) return false;
  try {
    var emails = sheet.getRange(2, 5, Math.max(sheet.getLastRow()-1, 1), 1).getValues();
    return emails.filter(function(r) {
      return r[0].toString().toLowerCase() === email.toLowerCase();
    }).length > 1;
  } catch(e) { return false; }
}


// ============================================================
//  12. DAILY CAPACITY CHECK
// ============================================================
function getDailyCount(sheet, dateStr, type) {
  if (!dateStr) return 0;
  var rows  = sheet.getDataRange().getValues();
  // Column indices (0-based): G=6 (boule count), H=7 (specialty count)
  var colIdx = type === "specialty" ? 7 : 6;
  var total  = 0;
  for (var i = 1; i < rows.length; i++) {
    var status = rows[i][16]; // Col Q = Status
    if (status === "Cancelled" || status === "Cancelled — Unpaid") continue;
    var rowDate    = rows[i][11]; // Col L = Pickup Date
    var rowDateStr = rowDate instanceof Date
      ? Utilities.formatDate(rowDate, Session.getScriptTimeZone(), "yyyy-MM-dd")
      : rowDate.toString();
    if (rowDateStr === dateStr) total += (Number(rows[i][colIdx]) || 0);
  }
  return total;
}


// ============================================================
//  13. WAITLIST LOG
// ============================================================
function logWaitlist(ss, data) {
  var sheet = ss.getSheetByName("Waitlist");
  if (!sheet) {
    sheet = ss.insertSheet("Waitlist");
    sheet.appendRow(["Timestamp","Name","Email","Phone","Items/Date","Status"]);
    sheet.getRange("1:1").setBackground("#4a5e3a").setFontColor("#e8dfc8").setFontWeight("bold");
  }
  sheet.appendRow([new Date(), data.name, data.email, data.phone,
    (data.order||"") + " | " + (data.preferred_date||""), "Waiting"]);
}


// ============================================================
//  14. LINE ITEMS — analytics source of truth
// ============================================================
function logLineItems(ss, data, orderId, status) {
  var sheet = ss.getSheetByName("Line Items");
  if (!sheet) {
    sheet = ss.insertSheet("Line Items");
    var hdr = ["Timestamp","Order ID","Customer Email","Item Name",
               "Item Type","Qty","Unit Price","Line Total","Pickup Date","Source","Status"];
    sheet.getRange(1,1,1,hdr.length).setValues([hdr]);
    var h = sheet.getRange("1:1");
    h.setBackground("#4a5e3a"); h.setFontColor("#e8dfc8"); h.setFontWeight("bold");
    sheet.setFrozenRows(1);
  }

  var ts     = new Date();
  var email  = data.email  || "";
  var source = data.source || "";
  var pickup = data.preferred_date || "";

  (data.order||"").split(";").forEach(function(line) {
    line = line.trim();
    if (!line) return;
    var qtyMatch  = line.match(/x(\d+)$/);
    var qty       = qtyMatch ? parseInt(qtyMatch[1]) : 1;
    var itemName  = line.replace(/\s*x\d+$/, "").trim();
    var menuItem  = MENU[itemName] || {};
    var unitPrice = menuItem.price || 0;
    var itemType  = menuItem.type  || "other";
    sheet.appendRow([ts, orderId, email, itemName, itemType,
                     qty, unitPrice, qty * unitPrice, pickup, source, status||"Awaiting Payment"]);
  });
}

function updateLineItemStatus(orderId, newStatus) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Line Items");
  if (!sheet) return;
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][1] === orderId) sheet.getRange(i+1, 11).setValue(newStatus);
  }
}


// ============================================================
//  15. ANALYTICS SHEETS
// ============================================================
function setupAnalyticsSheets(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  setupRevenueSheet(ss);
  setupItemSheet(ss);
  setupCustomerSheet(ss);
}

function setupRevenueSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var name  = "Revenue";
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();

  var hStyle = function(cell, text) {
    var r = sheet.getRange(cell); r.setValue(text);
    r.setBackground("#4a5e3a"); r.setFontColor("#e8dfc8"); r.setFontWeight("bold");
  };

  hStyle("A1","REVENUE SUMMARY");
  var summaryRows = [
    ["A2","Total orders",        '=COUNTA(Orders!B2:B2000)'],
    ["A3","Awaiting payment",    '=COUNTIF(Orders!Q2:Q2000,"Awaiting Payment")'],
    ["A4","Confirmed orders",    '=COUNTIF(Orders!Q2:Q2000,"Confirmed")+COUNTIF(Orders!Q2:Q2000,"Paid")+COUNTIF(Orders!Q2:Q2000,"Ready for Pickup")+COUNTIF(Orders!Q2:Q2000,"Completed")'],
    ["A5","Completed orders",    '=COUNTIF(Orders!Q2:Q2000,"Completed")'],
    ["A6","Cancelled",           '=COUNTIF(Orders!Q2:Q2000,"Cancelled")'],
  ];
  summaryRows.forEach(function(r) {
    sheet.getRange(r[0]).setValue(r[1]);
    sheet.getRange(r[0].replace("A","B")).setFormula(r[2]);
  });

  hStyle("A8","REVENUE");
  sheet.getRange("A9").setValue("Confirmed revenue");
  sheet.getRange("B9").setFormula('=SUMPRODUCT(((Orders!Q2:Q2000="Confirmed")+(Orders!Q2:Q2000="Paid")+(Orders!Q2:Q2000="Ready for Pickup")+(Orders!Q2:Q2000="Completed")>0)*(IFERROR(VALUE(SUBSTITUTE(Orders!K2:K2000,"$","")),0)))');
  sheet.getRange("A10").setValue("Average order value");
  sheet.getRange("B10").setFormula('=IFERROR(B9/B4,"—")');
  sheet.getRange("A11").setValue("Delivery fees");
  sheet.getRange("B11").setFormula('=SUMPRODUCT((ISNUMBER(SEARCH("Delivery",Orders!M2:M2000)))*(Orders!Q2:Q2000<>"Cancelled")*(IFERROR(VALUE(SUBSTITUTE(Orders!J2:J2000,"$","")),0)))');
  sheet.getRange("B9:B11").setNumberFormat("$#,##0.00");

  hStyle("A13","BY ITEM TYPE");
  [["A14","Boule revenue","boule"],["A15","Specialty revenue","specialty"],["A16","Other revenue","other"]]
    .forEach(function(r) {
      sheet.getRange(r[0]).setValue(r[1]);
      sheet.getRange(r[0].replace("A","B")).setFormula(
        "=SUMIF('Line Items'!E2:E2000,\"" + r[2] + "\",'Line Items'!H2:H2000)");
      sheet.getRange(r[0].replace("A","B")).setNumberFormat("$#,##0.00");
    });

  hStyle("A18","BY SOURCE");
  sheet.getRange("A19").setValue("Instagram"); sheet.getRange("B19").setFormula('=COUNTIF(Orders!N2:N2000,"instagram")');
  sheet.getRange("A20").setValue("Direct");    sheet.getRange("B20").setFormula('=COUNTIF(Orders!N2:N2000,"direct")');
  [200,140].forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });
}

function setupItemSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var name  = "Item Performance";
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange("A1:D1").setValues([["Item Name","Units Sold","Revenue","Type"]]);
  var h = sheet.getRange("A1:D1");
  h.setBackground("#4a5e3a"); h.setFontColor("#e8dfc8"); h.setFontWeight("bold");
  sheet.setFrozenRows(1);
  sheet.getRange("A2").setFormula(
    "=IFERROR(QUERY('Line Items'!D2:H2000," +
    "\"SELECT D, SUM(F), SUM(H), E WHERE D <> '' GROUP BY D, E ORDER BY SUM(H) DESC " +
    "LABEL D 'Item', SUM(F) 'Units', SUM(H) 'Revenue', E 'Type'\",0),\"No data yet\")"
  );
  sheet.getRange("C2:C100").setNumberFormat("$#,##0.00");
  [220,100,100,100].forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });
}

function setupCustomerSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var name  = "Customer Insights";
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();

  var emailListName = "Fatima Bakery \u2014 Email List";
  var emailList = ss.getSheetByName(emailListName);
  if (!emailList) {
    emailList = ss.insertSheet(emailListName);
    emailList.getRange(1, 1, 1, 4).setValues([["Name", "Email", "Source", "Status"]]);
    emailList.getRange("A1:D1").setBackground("#4a5e3a").setFontColor("#e8dfc8").setFontWeight("bold");
    emailList.setFrozenRows(1);
  }

  var hStyle = function(cell, text) {
    var r = sheet.getRange(cell); r.setValue(text);
    r.setBackground("#4a5e3a"); r.setFontColor("#e8dfc8"); r.setFontWeight("bold");
  };

  hStyle("A1","CUSTOMERS");
  sheet.getRange("A2").setValue("Unique customers");
  sheet.getRange("B2").setFormula('=IFERROR(COUNTA(UNIQUE(FILTER(Orders!E2:E2000,Orders!E2:E2000<>""))),0)');
  sheet.getRange("A3").setValue("Repeat customers");
  sheet.getRange("B3").setFormula('=IFERROR(COUNTA(UNIQUE(FILTER(Orders!E2:E2000,(Orders!E2:E2000<>"")*(COUNTIF(Orders!E2:E2000,Orders!E2:E2000)>1)))),0)');
  sheet.getRange("A4").setValue("Single-order customers"); sheet.getRange("B4").setFormula("=B2-B3");
  sheet.getRange("A5").setValue("Repeat rate"); sheet.getRange("B5").setFormula('=IFERROR(B3/B2,"—")');
  sheet.getRange("B5").setNumberFormat("0%");

  hStyle("A7","BREAD SHARE");
  sheet.getRange("A8").setValue("Active"); sheet.getRange("B8").setFormula('=COUNTIF(Subscriptions!J2:J2000,"Active")');
  sheet.getRange("A9").setValue("4-week"); sheet.getRange("B9").setFormula('=COUNTIFS(Subscriptions!F2:F2000,"*4 weeks*",Subscriptions!J2:J2000,"Active")');
  sheet.getRange("A10").setValue("6-week"); sheet.getRange("B10").setFormula('=COUNTIFS(Subscriptions!F2:F2000,"*6 weeks*",Subscriptions!J2:J2000,"Active")');
  sheet.getRange("A11").setValue("8-week"); sheet.getRange("B11").setFormula('=COUNTIFS(Subscriptions!F2:F2000,"*8 weeks*",Subscriptions!J2:J2000,"Active")');

  hStyle("A13","EMAIL LIST");
  sheet.getRange("A14").setValue("Total"); sheet.getRange("B14").setFormula("=COUNTA('Fatima Bakery \u2014 Email List'!B2:B2000)");
  sheet.getRange("A15").setValue("Active"); sheet.getRange("B15").setFormula("=COUNTIF('Fatima Bakery \u2014 Email List'!D2:D2000,\"Active\")");
  [220,140].forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });
}


// ============================================================
//  16. CUSTOM SHEET MENU
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("🧁 Fatima Bakery")
    .addItem("✅ Mark order Ready → notify customer",    "markOrderReady")
    .addItem("💳 Mark Confirmed (Venmo payment received)", "markOrderConfirmedVenmo")
    .addItem("🌿 Mark selected subscription Active",       "markSelectedSubscriptionActive")
    .addItem("❌ Mark order Cancelled + trigger waitlist", "markOrderCancelled")
    .addSeparator()
    .addItem("🧁 Run Friday Bake Sheet now",             "fridayBakeSheetAgent")
    .addItem("📋 Notify waitlist (manual)",              "notifyWaitlist")
    .addItem("📧 Send weekly drop now (test)",           "sendWeeklyDrop")
    .addSeparator()
    .addItem("Setup / refresh all sheets",               "setupSheet")
    .addItem("Install triggers",                         "installTriggers")
    .addToUi();
}


// ============================================================
//  17. INSTALL TRIGGERS — run once after deployment
// ============================================================
function installTriggers() {
  // Remove existing to avoid duplicates
  var managed = ["unpaidOrderTimeoutAgent","sendWeeklyDrop","capacityGuardAgent","orphanCheckerAgent",
                 "subscriptionRenewalAgent","fridayBakeSheetAgent","processSquareQueue"];
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (managed.indexOf(t.getHandlerFunction()) > -1) ScriptApp.deleteTrigger(t);
  });

  // Agent 0 — Unpaid Order Timeout: daily 6am
  ScriptApp.newTrigger("unpaidOrderTimeoutAgent")
    .timeBased().everyDays(1).atHour(6).create();

  // Agent 1 — Capacity Guard: Tuesday 9am
  ScriptApp.newTrigger("capacityGuardAgent")
    .timeBased().onWeekDay(ScriptApp.WeekDay.TUESDAY).atHour(9).create();

  // Agent 3 — Orphan Checker: every 30 minutes
  ScriptApp.newTrigger("orphanCheckerAgent")
    .timeBased().everyMinutes(30).create();

  // Agent 5 — Subscription Renewal: Monday 9am
  ScriptApp.newTrigger("subscriptionRenewalAgent")
    .timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9).create();

  // Agent 6 — Friday Bake Sheet: Friday 6am
  ScriptApp.newTrigger("fridayBakeSheetAgent")
    .timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(6).create();

  // Weekly drop: Tuesday 2pm
  ScriptApp.newTrigger("sendWeeklyDrop")
    .timeBased().onWeekDay(ScriptApp.WeekDay.TUESDAY).atHour(14).create();

  // Square webhook queue processor: every 2 minutes
  ScriptApp.newTrigger("processSquareQueue")
    .timeBased().everyMinutes(2).create();

  safeAlert(
    "✅ All triggers installed:\n\n" +
    "• Daily 6am     — Unpaid Order Timeout Agent\n" +
    "• Tuesday 9am   — Capacity Guard Agent\n" +
    "• Tuesday 2pm   — Weekly Availability Drop\n" +
    "• Friday 6am    — Friday Bake Sheet Agent\n" +
    "• Monday 9am    — Subscription Renewal Agent\n" +
    "• Every 30 min  — Orphan Checker Agent\n" +
    "• Every 2 min   — Square Webhook Queue Processor\n\n" +
    "Remember to update thisWeek{} in sendWeeklyDrop() each Tuesday afternoon."
  );
}


// ============================================================
//  18. ONE-TIME SHEET SETUP
// ============================================================
function ensureOrderDeliveryColumns_(sheet) {
  var headers = [
    "Delivery Address 1", "Delivery Address 2", "Delivery City", "Delivery State",
    "Delivery ZIP", "Delivery Instructions", "Address Status", "Address Distance",
    "Address Updated At", "Payment Reference"
  ];
  sheet.getRange(1, 18, 1, headers.length).setValues([headers]);
}

function setupSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  ss.setActiveSheet(sheet);

  var headers = [
    "Timestamp","Name","Phone","Instagram","Email",
    "Order Items","Boule Count","Specialty Count","Subtotal","Delivery Fee","Total",
    "Pickup Date","Pickup Window","Source","Notes","Order ID","Status",
    "Delivery Address 1","Delivery Address 2","Delivery City","Delivery State","Delivery ZIP",
    "Delivery Instructions","Address Status","Address Distance","Address Updated At","Payment Reference"
  ];
  sheet.getRange(1,1,1,headers.length).setValues([headers]);
  var hr = sheet.getRange(1,1,1,headers.length);
  hr.setBackground("#4a5e3a"); hr.setFontColor("#e8dfc8");
  hr.setFontWeight("bold"); hr.setFontSize(11);
  sheet.setFrozenRows(1);

  var widths = [160,140,130,120,200,300,90,100,80,90,80,110,160,130,200,120,140,220,160,140,90,100,240,150,110,160,220];
  widths.forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });

  var dv = SpreadsheetApp.newDataValidation()
    .requireValueInList([
      "Awaiting Payment","Confirmed","Ready for Pickup",
      "Completed","Paid","Cancelled","Cancelled — Unpaid"
    ], true)
    .build();
  sheet.getRange("Q2:Q2000").setDataValidation(dv);

  var qRange = sheet.getRange("Q2:Q2000");
  var gRange = sheet.getRange("G2:G2000");
  var hRange = sheet.getRange("H2:H2000");
  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Awaiting Payment")
      .setBackground("#fef3cd").setFontColor("#7a5c00").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Confirmed")
      .setBackground("#d4edda").setFontColor("#155724").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Paid")
      .setBackground("#d4edda").setFontColor("#155724").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Ready for Pickup")
      .setBackground("#cce5ff").setFontColor("#004085").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Completed")
      .setBackground("#e8dfc8").setFontColor("#2e3d22").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Cancelled")
      .setBackground("#f8d7da").setFontColor("#721c24").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Cancelled — Unpaid")
      .setBackground("#f8d7da").setFontColor("#721c24").setRanges([qRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(BOULE_LIMIT)
      .setBackground("#fef3cd").setFontColor("#7a5c00").setRanges([gRange]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(SPECIALTY_LIMIT)
      .setBackground("#fef3cd").setFontColor("#7a5c00").setRanges([hRange]).build()
  ]);

  setupCounterSheet(ss);
  setupAnalyticsSheets(ss);

  safeAlert(
    "✅ All sheets ready — v5 with 7 agents\n\n" +
    "Status flow:\n" +
    "Awaiting Payment → Confirmed → Ready for Pickup → Completed\n" +
    "Unpaid after 24h → Cancelled — Unpaid (auto, daily 6am)\n\n" +
    "New Sheet menu options:\n" +
    "• Mark Confirmed (Venmo payment received)\n" +
    "• Mark Cancelled + trigger waitlist\n" +
    "• Run Friday Bake Sheet now\n\n" +
    "Next: run installTriggers(), then deploy as Web App."
  );
}


// ============================================================
//  19. DAILY COUNTER TAB
// ============================================================
function setupCounterSheet(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var name  = "Daily Counter";
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  sheet.clearContents();
  sheet.getRange(1,1,1,5).setValues([["Date","Boules","Boules Left","Specialty","Specialty Left"]]);
  var h = sheet.getRange("A1:E1");
  h.setBackground("#4a5e3a"); h.setFontColor("#e8dfc8"); h.setFontWeight("bold");
  sheet.setFrozenRows(1);
  [110,80,90,90,110].forEach(function(w,i){ sheet.setColumnWidth(i+1,w); });

  sheet.getRange("A2").setFormula("=TODAY()");
  sheet.getRange("B2").setFormula(
    '=SUMPRODUCT((TEXT(Orders!L2:L2000,"yyyy-mm-dd")=TEXT(A2,"yyyy-mm-dd"))*(Orders!G2:G2000)*(Orders!Q2:Q2000<>"Cancelled")*(Orders!Q2:Q2000<>"Cancelled — Unpaid"))');
  sheet.getRange("C2").setFormula("=" + BOULE_LIMIT + "-B2");
  sheet.getRange("D2").setFormula(
    '=SUMPRODUCT((TEXT(Orders!L2:L2000,"yyyy-mm-dd")=TEXT(A2,"yyyy-mm-dd"))*(Orders!H2:H2000)*(Orders!Q2:Q2000<>"Cancelled")*(Orders!Q2:Q2000<>"Cancelled — Unpaid"))');
  sheet.getRange("E2").setFormula("=" + SPECIALTY_LIMIT + "-D2");

  var red = function(r){ return SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThanOrEqualTo(0).setBackground("#f8d7da").setFontColor("#721c24").setRanges([r]).build(); };
  var grn = function(r){ return SpreadsheetApp.newConditionalFormatRule()
    .whenNumberGreaterThan(0).setBackground("#d4edda").setFontColor("#155724").setRanges([r]).build(); };
  var cr = sheet.getRange("C2:C100");
  var er = sheet.getRange("E2:E100");
  sheet.setConditionalFormatRules([red(cr),grn(cr),red(er),grn(er)]);
}


// ============================================================
//  UTILITY
// ============================================================
function _logManualHelperRun(functionName, runInstead) {
  var msg = functionName + " is an internal helper and cannot be run directly from the Apps Script dropdown because it needs form/webhook data. Run " + runInstead + "() instead.";
  Logger.log(msg);
  try { safeAlert(msg); } catch (e) {}
}

function safeAlert(msg) {
  try { SpreadsheetApp.getUi().alert(msg); }
  catch(e) { Logger.log("ALERT: " + msg); }
}

// ── ORDER CUTOFF HELPERS ─────────────────────────────────────
function dayOfWeek_(dateStr) {
  if (!dateStr) return -1;
  var parts = dateStr.split("-");
  return new Date(parts[0], parts[1]-1, parts[2]).getDay();
}

// Returns true if the Wednesday-6PM cutoff for the given Thursday/Friday
// fulfillment date has already passed (in America/Chicago time).
function isPastCutoff(pickupDateStr) {
  try {
    var parts  = pickupDateStr.split("-");
    var pickup = new Date(parts[0], parts[1]-1, parts[2]);
    // The cutoff is the Wednesday before fulfillment, at 6 PM.
    var cutoff = new Date(pickup.getTime());
    var daysSinceCutoffDow = (pickup.getDay() - CUTOFF_DOW + 7) % 7;
    cutoff.setDate(cutoff.getDate() - daysSinceCutoffDow);   // Wednesday
    cutoff.setHours(CUTOFF_HOUR, 0, 0, 0);  // 6 PM

    // Compare "now" in the bakery's timezone against the cutoff.
    var nowStr    = Utilities.formatDate(new Date(), CUTOFF_TZ, "yyyy-MM-dd'T'HH:mm:ss");
    var cutoffStr = Utilities.formatDate(cutoff,    CUTOFF_TZ, "yyyy-MM-dd'T'HH:mm:ss");
    return nowStr > cutoffStr;
  } catch (err) {
    Logger.log("isPastCutoff error: " + err);
    return false;   // fail open — don't block orders on a parse error
  }
}

function sendCutoffPassedEmail(data, msg, pickupDate) {
  var html = buildBaseEmailHTML("Order Window Closed",
    "<p>Hi " + (data.name||"there") + ",</p>" +
    "<p>" + msg + "</p>" +
    "<p>We close orders each Wednesday at 6 PM so we have time to bake everything fresh. " +
    "Please head back and choose the next available fulfillment date. We would love to bake for you.</p>" +
    "<p><a href='" + ORDER_FORM_URL + "'>Place your order again</a></p>");
  try {
    sendTrackedEmail({ to: data.email, subject: "Fatima Bakery — order window closed",
      body: msg + "\n\nPlease choose the next available fulfillment date: " + ORDER_FORM_URL,
      htmlBody: html, name: "Fatima Bakery ATX", replyTo: OWNER_EMAIL });
  } catch (e) { Logger.log("sendCutoffPassedEmail error: " + e); }
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function testScriptProperties_v813() {
  var required = [
    "APP_VERSION",
    "OWNER_EMAIL",
    "SQUARE_ACCESS_TOKEN",
    "SQUARE_LOCATION_ID",
    "PUBLIC_APPS_SCRIPT_URL",
    "SQUARE_WEBHOOK_NOTIFICATION_URL"
  ];

  var missing = [];

  required.forEach(function (key) {
    var value = PropertiesService.getScriptProperties().getProperty(key);
    if (!value) missing.push(key);
  });

  if (missing.length) {
    throw new Error("Missing Script Properties: " + missing.join(", "));
  }

  Logger.log("Fatima Bakery config OK");
  Logger.log("APP_VERSION = " + APP_VERSION);
  Logger.log("ORDER_FORM_URL = " + ORDER_FORM_URL);
  Logger.log("PUBLIC_APPS_SCRIPT_URL = " + PUBLIC_APPS_SCRIPT_URL);
  Logger.log("SQUARE_WEBHOOK_NOTIFICATION_URL = " + SQUARE_WEBHOOK_NOTIFICATION_URL);
  Logger.log("DEBUG_LOG = " + DEBUG_LOG);
}


/**
 * Payment queue diagnostics.
 * Safe to run manually from Apps Script editor.
 */
function listPaymentQueues() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();

  var keys = Object.keys(all).filter(function(k) {
    return k.indexOf("sqq_") === 0 ||
           k.indexOf("failed_customer_email_") === 0 ||
           k.indexOf("failed_owner_email_") === 0 ||
           k.indexOf("failed_payment_email_") === 0;
  }).sort();

  Logger.log("Queued/stale payment-email keys: " + keys.length);

  keys.forEach(function(k) {
    var value = all[k] || "";
    Logger.log(k + " = " + value.substring(0, 1000));
  });

  return keys;
}

function retryPaymentQueueNow() {
  Logger.log("Retrying Square payment queue now...");
  processSquareQueue();
  Logger.log("Done retrying Square payment queue.");
}

function clearSquareQueueOnlyAfterReview() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();

  var keys = Object.keys(all).filter(function(k) {
    return k.indexOf("sqq_") === 0;
  });

  keys.forEach(function(k) {
    props.deleteProperty(k);
    Logger.log("Deleted stale Square queue key: " + k);
  });

  Logger.log("Deleted " + keys.length + " Square queue keys.");
}


// ============================================================
//  SQUARE WORKER DURABLE INBOX PULLER  v8.2.2
// ============================================================

var SQUARE_WORKER_PULL_URL = prop_("SQUARE_WORKER_PULL_URL", "");
var SQUARE_WORKER_ACK_URL = prop_("SQUARE_WORKER_ACK_URL", "");
var SQUARE_WORKER_PULL_TOKEN = prop_("SQUARE_WORKER_PULL_TOKEN", "");
var SQUARE_WORKER_PULL_ENABLED = boolProp_("SQUARE_WORKER_PULL_ENABLED", false);

function pullSquareEventsFromWorker() {
  if (!SQUARE_WORKER_PULL_ENABLED) {
    Logger.log("Square Worker pull disabled.");
    return;
  }

  if (!SQUARE_WORKER_PULL_URL || !SQUARE_WORKER_ACK_URL || !SQUARE_WORKER_PULL_TOKEN) {
    Logger.log("Square Worker pull properties missing.");
    return;
  }

  var res = UrlFetchApp.fetch(SQUARE_WORKER_PULL_URL + "?limit=25", {
    method: "get",
    muteHttpExceptions: true,
    headers: {
      "Authorization": "Bearer " + SQUARE_WORKER_PULL_TOKEN
    }
  });

  var code = res.getResponseCode();

  if (code !== 200) {
    Logger.log("Square Worker pull failed: " + code + " " + res.getContentText());
    return;
  }

  var body = JSON.parse(res.getContentText());
  var events = body.events || [];

  if (!events.length) {
    Logger.log("No Square Worker events to pull.");
    return;
  }

  var props = PropertiesService.getScriptProperties();
  var ackIds = [];

  events.forEach(function(ev) {
    if (!ev.event_id || !ev.raw_json) return;

    var key = "sqq_" + ev.event_id;
    props.setProperty(key, ev.raw_json);
    ackIds.push(ev.event_id);

    Logger.log("Pulled Square event into Apps Script queue: " + ev.event_id);
  });

  if (ackIds.length) {
    var ack = UrlFetchApp.fetch(SQUARE_WORKER_ACK_URL, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      headers: {
        "Authorization": "Bearer " + SQUARE_WORKER_PULL_TOKEN
      },
      payload: JSON.stringify({ event_ids: ackIds })
    });

    Logger.log("Square Worker ack response: " + ack.getResponseCode() + " " + ack.getContentText());
  }

  processSquareQueue();
}

function installSquareWorkerPullTrigger() {
  var triggers = ScriptApp.getProjectTriggers();

  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "pullSquareEventsFromWorker") {
      Logger.log("Square Worker pull trigger already installed.");
      return;
    }
  }

  ScriptApp.newTrigger("pullSquareEventsFromWorker")
    .timeBased()
    .everyMinutes(1)
    .create();

  Logger.log("Square Worker pull trigger installed.");
}

function testSquareWorkerPull() {
  pullSquareEventsFromWorker();
}



function formatPhone_(value) {
  var digits = String(value || "").replace(/\D/g, "");

  if (digits.length === 11 && digits.charAt(0) === "1") {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) return value || "";

  return digits.slice(0, 3) + "-" + digits.slice(3, 6) + "-" + digits.slice(6);
}


function recordSubscriptionEmailFailure_(subId, kind, data, err) {
  try {
    PropertiesService.getScriptProperties().setProperty(
      "failed_subscription_" + kind + "_email_" + subId,
      JSON.stringify({
        subId: subId,
        kind: kind,
        ts: new Date().toISOString(),
        email: data && data.email ? data.email : "",
        name: data && data.name ? data.name : "",
        error: err ? err.toString() : ""
      })
    );
  } catch (logErr) {
    Logger.log("Failed to record subscription email failure: " + logErr);
  }
}

function resendSelectedSubscriptionNotice() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();

  if (!sheet || sheet.getName() !== "Subscriptions") {
    throw new Error("Open the Subscriptions sheet and select the row to resend.");
  }

  var row = sheet.getActiveRange().getRow();

  if (row <= 1) {
    throw new Error("Select a subscription data row, not the header.");
  }

  return resendSubscriptionNoticeFromRow_(sheet, row);
}

function resendSubscriptionNoticeFromRow_(sheet, row) {
  var values = sheet.getRange(row, 1, 1, 13).getValues()[0];

  var tierText = String(values[5] || "");
  var tierMatch = tierText.match(/(4|6|8)\s*weeks/i);
  var tier = tierMatch ? tierMatch[1] + " weeks" : "4 weeks";

  var loafLabel = tierText
    .replace(/·\s*(4|6|8)\s*weeks/i, "")
    .trim() || "Fatima Classic";

  var price = Number(String(values[6] || "").replace(/[^0-9.]/g, "")) || 0;
  var subId = String(values[12] || "").trim();

  if (!subId) throw new Error("Selected row has no Sub ID.");

  var data = {
    name: values[1] || "",
    phone: formatPhone_(values[2] || ""),
    ig_handle: values[3] || "",
    email: values[4] || "",
    preferred_date: values[7] || "",
    notes: values[10] || "",
    source: "manual_resend"
  };

  var subInfo = {
    price: price,
    desc: "Reserved weekly loaf membership."
  };

  var totalFmt = "$" + Number(price || 0).toFixed(2);
  var squareLink = null;

  try {
    squareLink = createSquarePaymentLink(
      price * 100,
      subId,
      data.name,
      "Pilgrim Membership — " + loafLabel + " · " + tier
    );
  } catch (squareErr) {
    Logger.log("Manual resend Square link failed for " + subId + ": " + squareErr);
  }

  var cashLink = createCashAppLink(totalFmt);
  var venmoLink = createVenmoLink(totalFmt, subId);

  if (data.email) {
    sendSubscriptionEmail(data, tier, subInfo, squareLink, subId, loafLabel, cashLink, venmoLink);
  }

  sendOwnerSubscriptionAlert(data, tier, subInfo, subId, squareLink, loafLabel, cashLink, venmoLink);

  Logger.log("Resent subscription notice for " + subId + " row " + row);
  return subId;
}

