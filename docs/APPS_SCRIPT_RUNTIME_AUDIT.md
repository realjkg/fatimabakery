# Fatima Bakery Apps Script Runtime Audit

Audit scope: `apps-script/Code.js` as checked into this repository. This is a static runtime-path audit only; no deployed Apps Script project, spreadsheet, or Script Properties were inspected.

## Executive summary

The production Apps Script is a single-file backend that accepts the legacy website form posts and Square payment webhooks through `doPost(e)`. Active production state is spread across spreadsheet tabs (`Orders`, `Subscriptions`, `Line Items`, `Waitlist`, `Email Events`, analytics tabs) and Script Properties (`sqq_*`, email-failure keys, retry counters, config, review keys, address tokens). The safest cleanup strategy is therefore additive first: document live triggers/properties, add observability if needed in a separate deployment, then consolidate only after current production triggers and sheet headers are verified.

Most production order intake terminates before persistence by design when payload validation fails, fulfillment dates are invalid, cutoff has passed, specialty advance notice is insufficient, or server/client totals differ. Square confirmation is deliberately asynchronous: `doPost` fast-acks and queues `sqq_*`; the `processSquareQueue` trigger verifies the Square payment by API refetch and then marks an `FB-*` order confirmed or an `FBS-*` subscription active.

Major cleanup findings:

- The deployed terminology still contains legacy “Pilgrim Membership” / “Bread Share” language in routing, email subjects, payment descriptions, analytics headings, and renewal emails, even though user-facing copy is now Loaf Reserve.
- There are overlapping Square webhook paths: direct Apps Script webhook queueing, a disabled/optional Cloudflare Worker puller, and an unused `receiveSquareWebhook` legacy handler.
- Sheet/schema setup is duplicated across inline creation in handlers, `setupSheet`, `ensureOrderDeliveryColumns_`, `setupAnalyticsSheets`, and the individual analytics setup functions.
- Manual menu functions and trigger functions are tightly coupled to spreadsheet column indexes; cleanup must preserve column order and existing data.

## Production execution maps

### 1. One-time pickup orders

```text
Website order form
  -> doPost(e)
  -> logInbound(e) [if DEBUG_LOG]
  -> JSON.parse(e.postData.contents)
  -> SpreadsheetApp.getActiveSpreadsheet()
  -> normalizeOrderType(data) == "order"
  -> validateWorkerSignature_(data)
  -> handleOrder(data, ss)
       -> ensureOrderDeliveryColumns_(Orders)
       -> spam / empty / contact validation
       -> specialty advance notice validation
       -> pickup Friday validation
       -> Wednesday 6 PM cutoff validation
       -> server-side MENU total recalculation
       -> createSquarePaymentLink(...)
       -> createVenmoLink(...)
       -> createCashAppLink(...)
       -> Orders.appendRow(... status Awaiting Payment ...)
       -> logLineItems(... Awaiting Payment ...)
       -> optional logWaitlist(...)
       -> sendOrderReceivedEmail(...)
       -> sendOwnerNewOrderAlert(...)
  -> logOutcome(...)
  -> JSON success/error response
```

Persistence point: `Orders.appendRow` inside `handleOrder`. If that write fails, the code stores `failed_order_<orderId>` in Script Properties and still attempts emails, so the order may not be in the sheet but may exist in recovery state.

### 2. Delivery orders

Delivery orders use the same `doPost -> handleOrder` path as pickup, with delivery-specific validation and persistence fields:

```text
handleOrder(data, ss)
  -> isDelivery from fulfillment/preferred_time containing "delivery"
  -> normalizeDeliveryAddress_(data)
  -> require address1/city/state/zip
  -> require fulfillment date day-of-week == Thursday
  -> server total = item subtotal + $10 delivery fee
  -> if address_status == "Address Review Required": no Square/Venmo/Cash links, status "Address Review Required"
  -> append delivery address columns R-Z
  -> email customer/owner with delivery/address details
```

Address correction has a route (`address_correction`) through `doPost -> handleAddressCorrection`, but generated correction URLs are currently disabled for order emails. The token helpers remain in the file and should be treated as dormant until the end-to-end address correction UI is verified.

### 3. Loaf Reserve subscriptions

```text
Website subscription form
  -> doPost(e)
  -> logInbound(e) [if DEBUG_LOG]
  -> JSON.parse(...)
  -> normalizeOrderType(data) == "subscription"
       because order_type/type contains subscription/membership/pilgrim/bread share
       or tier/kind/loaf fields are present
  -> validateWorkerSignature_(data)
  -> handleSubscription(data, ss)
       -> create Subscriptions sheet/header if missing
       -> normalizeSubscriptionTier(data)
       -> derive loaf kind and label
       -> formatPhone_(...)
       -> require Friday pickup date
       -> enforce Wednesday cutoff
       -> append Subscriptions row with status "Pending Payment"
       -> createCashAppLink(...)
       -> createVenmoLink(...)
       -> createSquarePaymentLink(... FBS-* ...)
       -> sendSubscriptionEmail(...)
       -> sendOwnerSubscriptionAlert(...)
  -> logOutcome(...)
  -> JSON success with subId/emailStatus
```

Payment activation paths:

- Square: `processSquareQueue -> squareResolveOrderId -> updateSubscriptionStatus(FBS-*, "Active") -> sendSubscriptionActiveEmail`.
- Manual: spreadsheet menu `markSelectedSubscriptionActive -> updateSubscriptionStatus`.
- Renewal emails are sent by `subscriptionRenewalAgent`, but the renewal link IDs are synthetic `FBS-RENEW*` ids; those do not correspond to appended subscription rows unless a separate reconciliation process is used.

### 4. Square payment confirmation

Primary Apps Script webhook path:

```text
Square payment webhook
  -> doPost(e)
       -> fast pre-route if raw body has event_id and merchant_id
       -> handleSquareWebhook(e)
            -> JSON.parse(raw)
            -> if evt.type starts with "payment": set Script Property sqq_<event_id> = raw
            -> return {status:"square_received"} immediately

Time trigger every 2 minutes
  -> processSquareQueue()
       -> read all Script Properties with prefix sqq_
       -> parse each event
       -> if payment status COMPLETED/CAPTURED/APPROVED
            -> squareVerifyByRefetch(payment.id, event amount)
            -> squareResolveOrderId(verified payment)
            -> if FBS-* updateSubscriptionStatus(..., "Active")
            -> else markOrderPaid(FB-*, payment.id, amount)
       -> delete handled/poison/unverifiable sqq_* key
```

`markOrderPaid` updates the `Orders` row status to `Confirmed`, writes the Square payment breadcrumb to column AA, updates Line Items, sends customer and owner payment notifications, and creates a calendar event when configured. It avoids resending the customer confirmation if the row was already confirmed/ready/completed.

Optional Worker inbox path:

```text
installSquareWorkerPullTrigger() [manual]
  -> pullSquareEventsFromWorker() every 1 minute if installed
       -> require SQUARE_WORKER_PULL_ENABLED and URLs/token
       -> GET worker pull URL
       -> enqueue each event as sqq_<event_id>
       -> POST worker ack URL
       -> processSquareQueue()
```

This path overlaps the direct Apps Script Square webhook path and should only be retained if production has moved webhook signature validation to the Cloudflare Worker.

### 5. Email retries

There is no single generic email retry queue. The active mechanisms are partial and path-specific:

- `sendTrackedEmail` logs attempted/sent/failed email events to the `Email Events` sheet and rethrows on `MailApp.sendEmail` failure.
- `handleOrder` catches customer and owner email failures and stores `failed_customer_email_<orderId>` and `failed_owner_email_<orderId>` Script Properties.
- `handleSubscription` catches customer/owner subscription email failures via `recordSubscriptionEmailFailure_`, using `failed_subscription_<kind>_email_<subId>` keys.
- `orphanCheckerAgent` is the active scheduled payment-reminder resend for orders stuck in `Awaiting Payment` more than two hours, capped at three attempts via `orphan_attempts_<orderId>`.
- `resendSelectedSubscriptionNotice` / `resendSubscriptionNoticeFromRow_` is a manual recovery path for subscription notices.
- `listPaymentQueues` lists Square queue and some order email-failure keys, but does not include `failed_subscription_*` or `failed_order_*` keys.

### 6. Scheduled triggers

`installTriggers()` deletes and recreates these managed time triggers:

| Handler | Schedule | Role |
|---|---:|---|
| `unpaidOrderTimeoutAgent` | daily 6 AM | Cancels `Awaiting Payment` orders older than 24 hours. |
| `capacityGuardAgent` | Tuesday 9 AM | Emails owner if next Friday is near/full capacity. |
| `orphanCheckerAgent` | every 30 minutes | Resends payment reminders for older unpaid orders, max 3 attempts. |
| `subscriptionRenewalAgent` | Monday 9 AM | Sends renewal emails for active subscriptions ending within 7 days. |
| `fridayBakeSheetAgent` | Friday 6 AM | Emails owner prep/bake sheet for confirmed orders due that day. |
| `sendWeeklyDrop` | Tuesday 2 PM | Emails active waitlist with current availability. |
| `processSquareQueue` | every 2 minutes | Drains queued Square webhooks. |

Additional trigger helpers outside `installTriggers()`:

- `installSquareQueueTrigger()` installs only `processSquareQueue` every 2 minutes after deleting existing matching triggers.
- `ensureSquareQueueTrigger()` is legacy one-shot-ish/old behavior and is documented as no longer called from webhook flow.
- `scheduleReviewRequest()` creates one-off `sendPendingReviews` triggers 24 hours after an order is marked ready.
- `installSquareWorkerPullTrigger()` installs `pullSquareEventsFromWorker` every minute and is not managed by `installTriggers()`.

### 7. Manual recovery functions

Spreadsheet menu (`onOpen`) exposes:

- `markOrderReady` — sets selected order ready and notifies customer; schedules review request.
- `markOrderConfirmedVenmo` — manually confirms Venmo payment.
- `markSelectedSubscriptionActive` — manually activates selected subscription.
- `markOrderCancelled` — cancels selected order and triggers waitlist.
- `fridayBakeSheetAgent` — manual run of bake sheet.
- `notifyWaitlist` — manual waitlist notification.
- `sendWeeklyDrop` — manual/test weekly drop.
- `setupSheet` — setup/refresh sheets.
- `installTriggers` — install managed triggers.

Apps Script editor/manual-only helpers include:

- `testScriptProperties_v813`
- `listPaymentQueues`
- `retryPaymentQueueNow`
- `clearSquareQueueOnlyAfterReview`
- `installSquareQueueTrigger`
- `installSquareWorkerPullTrigger`
- `testSquareWorkerPull`
- `testSubscriptionEmail`
- `testSubscriptionActiveEmail`
- `resendSelectedSubscriptionNotice`

## Complete function classification

| Function | Classification | Notes |
|---|---|---|
| `scriptPropsSnapshot_` | active production path | Lazy Script Properties snapshot used by global config helpers. |
| `prop_` | active production path | Global config lookup helper. |
| `propAny_` | active production path | Global config alias/fallback helper. |
| `boolProp_` | active production path | Boolean config helper. |
| `numProp_` | active production path | Numeric config helper. |
| `sendTrackedEmail` | active production path | Central outbound email sender/logger. |
| `maskEmail_` | active production path | Email log privacy helper. |
| `maskEmails_` | active production path | Email log privacy helper. |
| `maskEmailLogValue_` | active production path | Email log privacy helper. |
| `logEmailEvent_` | active production path | Writes `Email Events`; swallowed errors. |
| `canonicalJson_` | active production path | Worker signature canonicalization. |
| `hmacHex_` | active production path | Worker signature HMAC helper. |
| `constantTimeEqual_` | active production path | Worker signature comparison helper. |
| `validateWorkerSignature_` | active production path | Required before signed order/subscription/address routes. |
| `neutralizeSheetValue_` | active production path | Sheet formula-injection guard for address/contact values. |
| `htmlEscape_` | active production path | HTML email escaping. |
| `normalizeDeliveryAddress_` | active production path | Delivery and owner email address normalization. |
| `fullDeliveryAddressText_` | active production path | Owner links/address display. |
| `correctionTokenUrl_` | likely unused | No call sites found; address correction email URL disabled. |
| `validateAddressUpdateToken_` | active production path | Used by `handleAddressCorrection`, though route may be dormant. |
| `handleAddressCorrection` | unknown | Route exists, but customer correction links are disabled in order email path. |
| `doPost` | trigger entrypoint | Web app POST entry for forms and Square webhooks. |
| `normalizeOrderType` | active production path | Routes contact/order/subscription/address/Square payloads. |
| `squareGetSignature` | likely unused | No call sites; returns sentinel only. |
| `squareVerifyByRefetch` | active production path | Square API verification for queued payments. |
| `handleSquareWebhook` | active production path | Fast ACK and queue writer for Square events. |
| `ensureSquareQueueTrigger` | duplicate or overlapping | Legacy trigger helper; no longer called from webhook. |
| `installSquareQueueTrigger` | manual recovery utility | Installs only Square queue trigger; overlaps `installTriggers`. |
| `processSquareQueue` | trigger entrypoint | Scheduled Square confirmation worker; can also be manual. |
| `squareResolveOrderId` | active production path | Maps verified Square payment to `FB-*`/`FBS-*`. |
| `markOrderPaid` | active production path | Confirms paid one-time orders. |
| `logInbound` | active production path | Debug logging for non-Square posts when enabled. |
| `logOutcome` | active production path | Debug outcome logging when enabled. |
| `doGet` | trigger entrypoint | Web app health/status GET. |
| `_alertSchemaDrift` | active production path | Owner alert before rejecting schema drift total mismatches. |
| `handleOrder` | active production path | One-time pickup/delivery order intake. |
| `handleSubscription` | active production path | Loaf Reserve subscription intake. |
| `normalizeSubscriptionTier` | active production path | Subscription tier parsing. |
| `sendSubscriptionEmail` | active production path | Subscription customer notice. |
| `sendOwnerSubscriptionAlert` | active production path | Subscription owner notice. |
| `sendSubscriptionActiveEmail` | active production path | Subscription activation notice. |
| `testSubscriptionEmail` | manual recovery utility | Manual email test. |
| `testSubscriptionActiveEmail` | manual recovery utility | Manual active-email test; no call sites. |
| `handleContact` | active production path | Contact form route. |
| `createSquarePaymentLink` | active production path | Payment link generator for orders, subscriptions, reminders, renewals. |
| `createVenmoLink` | active production path | Venmo payment URL generator. |
| `createCashAppLink` | active production path | Cash App URL generator. |
| `receiveSquareWebhook` | likely unused | No call sites; obsolete direct handler overlaps `handleSquareWebhook`. |
| `confirmOrder` | manual recovery utility | Manual status/email confirmation helper. |
| `confirmOrderVenmo` | likely unused | No call sites; overlaps `markOrderConfirmedVenmo`. |
| `refundOrder` | manual recovery utility | Manual refund/cancel helper. |
| `sendRefundEmail` | active production path | Called by refund flow. |
| `updateSubscriptionStatus` | active production path | Square/manual subscription activation/status updates. |
| `markSelectedSubscriptionActive` | manual recovery utility | Spreadsheet menu action. |
| `buildBaseEmailHTML` | active production path | Shared email template. |
| `buildInfoTable` | active production path | Shared email table builder. |
| `sendOrderReceivedEmail` | active production path | Customer order-received/payment-link email. |
| `sendPaymentConfirmedEmail` | active production path | Customer payment-confirmed email. |
| `sendOwnerPaymentAlert` | active production path | Owner payment alert. |
| `sendOwnerNewOrderAlert` | active production path | Owner new-order alert. |
| `sendPickupNotification` | active production path | Called by ready/manual flow. |
| `sendReviewRequest` | active production path | Called by scheduled review flow. |
| `sendCapacityEmail` | likely unused | No call sites; older capacity-blocking behavior. |
| `sendAdvanceNoticeEmail` | active production path | Sent before rejecting specialty orders without enough notice. |
| `markOrderReady` | manual recovery utility | Spreadsheet menu action. |
| `markOrderConfirmedVenmo` | manual recovery utility | Spreadsheet menu action. |
| `markOrderCancelled` | manual recovery utility | Spreadsheet menu action. |
| `unpaidOrderTimeoutAgent` | trigger entrypoint | Managed scheduled trigger. |
| `capacityGuardAgent` | trigger entrypoint | Managed scheduled trigger. |
| `orphanCheckerAgent` | trigger entrypoint | Managed scheduled trigger. |
| `waitlistAgent` | active production path | Called from cancellation/manual waitlist paths. |
| `notifyWaitlist` | manual recovery utility | Spreadsheet menu action. |
| `subscriptionRenewalAgent` | trigger entrypoint | Managed scheduled trigger. |
| `fridayBakeSheetAgent` | trigger entrypoint | Managed scheduled trigger and menu action. |
| `scheduleReviewRequest` | active production path | Creates one-off review triggers. |
| `sendPendingReviews` | trigger entrypoint | One-off review trigger handler. |
| `sendWeeklyDrop` | trigger entrypoint | Managed scheduled trigger and menu/test action. |
| `createCalendarEvent` | active production path | Called after payment confirmation/ready/manual confirmation. |
| `isReturningCustomer` | active production path | Used in order received email context. |
| `getDailyCount` | active production path | Capacity/weekly drop counters. |
| `logWaitlist` | active production path | Optional order waitlist logging. |
| `logLineItems` | active production path | Order persistence side table. |
| `updateLineItemStatus` | active production path | Keeps line-item statuses aligned. |
| `setupAnalyticsSheets` | duplicate or overlapping | Setup utility that fans out to analytics setup functions. |
| `setupRevenueSheet` | duplicate or overlapping | Analytics schema setup. |
| `setupItemSheet` | duplicate or overlapping | Analytics schema setup. |
| `setupCustomerSheet` | duplicate or overlapping | Analytics schema setup. |
| `onOpen` | trigger entrypoint | Spreadsheet UI-open simple trigger. |
| `installTriggers` | manual recovery utility | Deployment/setup utility for managed triggers. |
| `ensureOrderDeliveryColumns_` | duplicate or overlapping | Rewrites delivery/payment headers during live order handling; overlaps `setupSheet`. |
| `setupSheet` | manual recovery utility | One-time/refresh setup for primary and analytics sheets. |
| `setupCounterSheet` | duplicate or overlapping | Sheet setup called by `setupSheet`. |
| `_logManualHelperRun` | active production path | Guards internal functions when manually run. |
| `safeAlert` | active production path | UI alert/logger wrapper. |
| `dayOfWeek_` | active production path | Fulfillment day validation. |
| `isPastCutoff` | active production path | Cutoff validation. |
| `sendCutoffPassedEmail` | active production path | Customer notice before rejecting after cutoff. |
| `jsonResponse` | active production path | Shared web response helper. |
| `testScriptProperties_v813` | manual recovery utility | Config diagnostics. |
| `listPaymentQueues` | manual recovery utility | Queue diagnostics; incomplete key coverage. |
| `retryPaymentQueueNow` | manual recovery utility | Manually drains Square queue. |
| `clearSquareQueueOnlyAfterReview` | manual recovery utility | Destructive Square queue cleanup after review. |
| `pullSquareEventsFromWorker` | unknown | Active only if Worker pull properties enabled and trigger installed. |
| `installSquareWorkerPullTrigger` | manual recovery utility | Optional Worker trigger installer; outside managed trigger set. |
| `testSquareWorkerPull` | manual recovery utility | Manual Worker pull test. |
| `formatPhone_` | active production path | Subscription phone normalization. |
| `recordSubscriptionEmailFailure_` | active production path | Subscription email-failure queue writer. |
| `resendSelectedSubscriptionNotice` | manual recovery utility | Manual selected-row subscription resend. |
| `resendSubscriptionNoticeFromRow_` | manual recovery utility | Helper for selected-row resend. |

## Functions that can terminate order flow before persistence

For one-time orders, `handleOrder` can return before `Orders.appendRow` when:

- Honeypot `_gotcha` is present (`ignored`).
- No items and client total is `$0` (`ignored`).
- No items with client-like/nonzero payload (`error`).
- No contact information (`error`).
- No email and no phone (`error`).
- Specialty item violates advance notice (`advance_required`) after optionally sending `sendAdvanceNoticeEmail`.
- Delivery address is incomplete (`missing_address`).
- Delivery date is not Thursday (`invalid_date`).
- Pickup date is not Friday (`invalid_date`).
- Wednesday 6 PM cutoff has passed (`cutoff_passed`) after optionally sending `sendCutoffPassedEmail`.
- Server-calculated total differs from client total (`error`), with `_alertSchemaDrift` if server subtotal is zero for item-looking input.
- `createSquarePaymentLink`, `createVenmoLink`, or `createCashAppLink` can throw before the append because order payment links are generated outside a try/catch.

For delivery orders, the same list applies plus the delivery-specific address/day checks. If `address_status` is `Address Review Required`, the row is still persisted but payment links are omitted and status is set to `Address Review Required`.

For subscriptions, `handleSubscription` can return before `Subscriptions.appendRow` when:

- It is manually run without object data.
- Preferred/start date is not Friday.
- Cutoff has passed.
- Creating/finding the `Subscriptions` sheet or writing headers throws before the append.

`doPost` can also terminate before handler persistence if JSON parsing fails, `SpreadsheetApp.getActiveSpreadsheet()` fails, or `validateWorkerSignature_` throws. Contact routes bypass `validateWorkerSignature_`.

## External dependencies not isolated by local try/catch

These are calls to external Apps Script services or network APIs where failure can interrupt the current flow because the immediate caller does not isolate the dependency with a try/catch:

- `doPost`: `logInbound(e)` is called before the main try/catch. `logInbound` catches internally, but any unexpected failure outside its internal coverage would happen before parsing/routing.
- `doPost`: `SpreadsheetApp.getActiveSpreadsheet()` and `validateWorkerSignature_` are inside the broad outer try; failures return an error response before persistence.
- `handleOrder`: `ensureOrderDeliveryColumns_(sheet)` is not locally caught and can stop order intake before validation/persistence.
- `handleOrder`: `createSquarePaymentLink`, `createVenmoLink`, and `createCashAppLink` are not locally caught for one-time orders. A Square API/link failure can prevent sheet persistence.
- `handleOrder`: saving `failed_order_<orderId>` after append failure uses `PropertiesService.getScriptProperties().setProperty(...)` inside the catch without another nested catch; if Script Properties fails, the recovery record can be lost and the handler can error.
- `handleSubscription`: creating/inserting the `Subscriptions` sheet and `sheet.appendRow` are not wrapped, so sheet failures stop the subscription request before email failure recording.
- `handleSubscription`: `createCashAppLink` and `createVenmoLink` are not caught; `createSquarePaymentLink` is caught.
- `pullSquareEventsFromWorker`: both `UrlFetchApp.fetch` calls and JSON parsing are not wrapped; a Worker/network/json error can terminate the trigger execution.
- `orphanCheckerAgent`: `createSquarePaymentLink`, `createVenmoLink`, and `sendTrackedEmail` are not caught per order; one failed reminder can stop the trigger iteration.
- `subscriptionRenewalAgent`: the three Square renewal link creations and `sendTrackedEmail` are not caught per row; one failure can stop the agent.
- `fridayBakeSheetAgent`, `capacityGuardAgent`, `unpaidOrderTimeoutAgent`, `sendWeeklyDrop`, and manual status helpers generally call `sendTrackedEmail` without local isolation; failures can terminate that scheduled/manual run.
- `createCalendarEvent` is called without try/catch in `markOrderPaid` after payment emails; Calendar failures can still cause the function to throw after the order is already marked confirmed.

## Duplicate configuration or schema setup

- Orders schema exists in both `setupSheet` and runtime `ensureOrderDeliveryColumns_`. Runtime header writes are convenient for migration but risky long-term because any order post can mutate row 1.
- The `Subscriptions` sheet schema is created inline in `handleSubscription`, unlike `Orders`, which has a dedicated setup function.
- Analytics setup is split across `setupAnalyticsSheets`, `setupRevenueSheet`, `setupItemSheet`, and `setupCustomerSheet`, while `setupSheet` also calls analytics/counter setup.
- Trigger setup overlaps among `installTriggers`, `installSquareQueueTrigger`, `ensureSquareQueueTrigger`, `scheduleReviewRequest`, and `installSquareWorkerPullTrigger`.
- Square webhook intake overlaps direct Apps Script queueing and Worker pull queueing.
- Email failure keys are fragmented: order failures, subscription failures, payment queues, review keys, and orphan attempts use separate prefixes and inconsistent diagnostic coverage.

## Legacy terminology and obsolete handlers

Terminology still present in code and data-facing output:

- `Pilgrim Membership` appears in route detection compatibility, subscription payment descriptions, customer/owner subscription emails, active/renewal emails, and subject lines.
- `Bread Share` appears in route detection and analytics headings.
- `Pickup Window` column is also used for delivery window/fulfillment indicator.
- `receiveSquareWebhook` appears obsolete compared with `handleSquareWebhook` + `processSquareQueue`.
- `confirmOrderVenmo` appears obsolete/overlapped by `markOrderConfirmedVenmo`.
- `sendCapacityEmail` appears obsolete after capacity blocking was removed.
- `ensureSquareQueueTrigger` is explicitly documented as legacy and no longer called from the webhook path.

## File disposition recommendations

| File / area | Recommendation | Rationale |
|---|---|---|
| `apps-script/Code.js` | Retain now; later consolidate in place with small, deployed-safe edits. | It is the production backend and contains active web app, trigger, payment, email, and sheet logic. |
| `workers/square-webhook/src/index.js` | Retain until production Square webhook topology is verified. | It may be the intended durable inbox/signature-validation path, but Apps Script Worker pull is disabled by property by default. |
| `functions/api/order.js` | Retain as separate Cloudflare validation/recovery layer; do not assume it replaces Apps Script persistence. | It validates/signs payloads before Apps Script but does not write the Apps Script spreadsheet. |
| Legacy root HTML (`order/`, `contact/`, etc.) | Retain until Ratio/Next.js app replaces it; do not extend. | It is still described as the deployed Cloudflare Pages static site and posts to Apps Script. |
| `docs/AGENT_INSTRUCTIONS.md` and release docs | Retain and update only as operational docs change. | They contain legacy site deployment constraints and endpoint guidance. |

Within `apps-script/Code.js`, eventually remove or quarantine only after deployment evidence:

- Likely removable later: `receiveSquareWebhook`, `squareGetSignature`, `sendCapacityEmail`, `confirmOrderVenmo`, `correctionTokenUrl_` if address correction remains disabled.
- Consolidate rather than remove first: Square trigger helpers, setup/schema helpers, email retry diagnostics, Loaf Reserve/Pilgrim terminology compatibility.

## Recommended cleanup sequence preserving production deployment and spreadsheet data

1. **Inventory production before code changes.** In the live Apps Script editor, record deployed Web App URL, project triggers, Script Properties keys, linked spreadsheet ID, sheet tabs, and row-1 headers. Do not run `setupSheet` during this inventory.
2. **Snapshot spreadsheet data.** Export or duplicate the workbook, especially `Orders`, `Subscriptions`, `Line Items`, `Waitlist`, `Email Events`, and any analytics tabs.
3. **Confirm webhook topology.** Determine whether Square points directly to Apps Script or to the Cloudflare Worker. If Worker is production, verify `SQUARE_WORKER_PULL_*` properties and the pull trigger. If direct Apps Script is production, leave Worker pull disabled.
4. **Add non-mutating observability in a separate deployment.** Before cleanup, add/read-only diagnostics that report active trigger names, queue key counts by prefix, and sheet header hashes. Deploy as a new Apps Script version without changing handlers.
5. **Normalize documentation/terminology first.** Update operator docs to call the product “Loaf Reserve” while explicitly preserving backward-compatible inbound route strings (`pilgrim`, `membership`, `bread share`) until the front end and all historical payment descriptions are migrated.
6. **Consolidate email retry metadata.** Add diagnostics to include `failed_subscription_*` and `failed_order_*` keys before changing retry behavior. Only then introduce a unified retry/resend helper.
7. **Isolate pre-persistence external dependencies.** Wrap one-time order payment-link generation so Square link failures do not prevent `Orders.appendRow`; follow the subscription pattern for Square and add equivalent isolation for Venmo/Cash helpers if needed.
8. **Freeze sheet schemas.** Move inline `Subscriptions` header creation and runtime `ensureOrderDeliveryColumns_` mutation toward explicit migration/setup functions. Keep column order unchanged and append new columns only at the end.
9. **Choose one Square intake strategy.** After observing production for at least one payment cycle, keep either direct Apps Script queueing or Worker pull as the primary path. Leave the other disabled but not deleted until several successful payments and manual recovery drills pass.
10. **Retire obsolete handlers behind a compatibility window.** Mark `receiveSquareWebhook`, `sendCapacityEmail`, `confirmOrderVenmo`, `squareGetSignature`, and address-correction token helpers as deprecated first. Remove only after confirming no triggers, menu items, deployment URLs, or external docs reference them.
11. **Run a full dry-run checklist.** Test order submission, delivery submission, Loaf Reserve request, Square test/real low-dollar payment, manual Venmo confirmation, subscription activation, orphan reminder behavior, and bake-sheet generation against a copied spreadsheet before promoting changes.
12. **Promote in small versions.** Deploy one Apps Script version per cleanup category and preserve immediate rollback to the current production version.
