# Fatima Bakery Business Owner Operating Guide

This guide explains how to operate the **current merged Apps Script and Google Sheets system** in plain language.

> **Important current-state note:** the current implementation handles one-time website orders, Loaf Reserve signup/payment activation, payment confirmation, emails, waitlist/newsletter drops, basic capacity reporting, and bake-sheet emails. It does **not** currently include a first-class weekly inventory tab, subscription allocation ledger, OFF/SHADOW/ENFORCE feature mode, reconciliation recovery tool, Google Sheets editorial proposal tabs or owner UI for approvals. A developer-facing editorial approval/export library exists for newsletter, Hotplate-drop, and website-content export objects, but it does not publish or send automatically. Items without owner UI are documented below as **developer assistance required**.

## 1. What the system does

1. **Products are maintained in Apps Script code, not in a Google Sheet tab.** The product list and prices live in the `MENU` object in `apps-script/Code.js`. Owner changes to products or prices require developer assistance unless a developer adds an owner-editable product tab later.
2. **Weekly inventory is currently controlled by capacity settings, not by a weekly inventory tab.** The current limits are `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT` Script Properties, with code defaults if the properties are not set.
3. **Loaf Reserve memberships are recorded when a customer submits the subscription form.** The system writes the request to the `Subscriptions` tab with status `Pending Payment`, sends payment options, and later marks the subscription `Active` after Square payment or owner action.
4. **Weekly Loaf Reserve allocation before one-time orders is not implemented in the current code.** Active subscriptions are stored and renewal reminders are sent, but there is no current weekly generation function that creates weekly subscription orders or reserves capacity before one-time orders.
5. **Website orders are received through the Apps Script web app.** Incoming website posts route through `doPost`, then `handleOrder` for one-time orders or `handleSubscription` for Loaf Reserve signups.
6. **Inventory is not reserved by a ledger.** One-time orders are appended to `Orders` and item rows are appended to `Line Items`. Capacity reports count non-cancelled order rows, but `handleOrder` currently does not block orders for capacity.
7. **Payment links and confirmation messages are handled by Apps Script.** The system creates Square, Venmo, and Cash App links when possible, sends order/subscription emails, queues Square webhook events, and marks paid orders or subscriptions after Square confirmation.
8. **Editorial approval/export exists as a developer-facing library, not as a Sheet menu or owner UI.** `lib/editorial-approval-export.mjs` can summarize proposals, record approve/reject/revision decisions, and render newsletter, Hotplate-drop, and website-content export objects. It does not send emails, call Hotplate, mutate the website, or create Google Sheet tabs. The current Apps Script `sendWeeklyDrop` still sends directly to the email list.
9. **Manual steps remain important.** The owner still reviews Sheet rows, confirms non-Square payments, marks orders ready/cancelled, checks capacity reports, handles exceptions, and asks a developer for product, capacity-property, deployment, schema, or unsupported recovery changes.

## 2. System of record

Google Sheets is the operating record for the implemented order and subscription flows. The authoritative tabs currently created or used by the Apps Script are:

| Area | Current authoritative place | Exact current tab name | Notes |
| --- | --- | --- | --- |
| Products | Apps Script code | Not a Sheet tab | `MENU` in `apps-script/Code.js`; developer-only to change safely. |
| Product prices | Apps Script code | Not a Sheet tab | `MENU` prices and `SUBSCRIPTIONS` prices. |
| Weekly inventory/capacity | Script Properties and order-derived counts | No weekly inventory tab | Uses `BOULE_LIMIT`, `SPECIALTY_LIMIT`, `COMBINED_LIMIT`; current counts derive from `Orders` and `Line Items`. |
| One-time orders | Google Sheet | `Orders` by default, or the `SHEET_NAME` Script Property value | Header row is created by `setupSheet`. |
| One-time order line items | Google Sheet | `Line Items` | Created by `logLineItems`. |
| Subscription memberships | Google Sheet | `Subscriptions` | Created by `handleSubscription`. |
| Generated weekly subscription orders | Not implemented | No current tab | Developer assistance required. |
| Reservations or allocations | Not implemented as a ledger | No current tab | One-time orders are rows; subscription allocations are not generated. |
| Audit events | Partial email/debug logs | `Email Log`, `Debug Log` | Email events are logged; inbound debug rows are redacted. There is no full audit-event ledger. |
| Reconciliation findings | Not implemented | No current tab | Developer assistance required. |
| Editorial proposals | Developer-facing JS objects | No current tab | Validated by `lib/editorial-approval-export.mjs` and schemas/tests; no owner Sheet UI. |
| Approval history | Developer-facing in-memory `EditorialApprovalStore` events | No current tab | Approval events are append-only in the library/test flow; persistence requires developer integration. |
| Waitlist/newsletter audience | Google Sheet | `Waitlist`, `Fatima Bakery — Email List` | `sendWeeklyDrop` sends to rows with `Status` of `Active` in the email-list tab. |
| Analytics | Google Sheet formulas | `Revenue`, `Item Performance`, `Customer Insights`, `Daily Counter` | Created/refreshed by `setupSheet` and analytics helpers. |
| Contact messages | Google Sheet | `Contact Messages` | Created by `handleContact`. |

## 3. Weekly setup checklist

Run this before promoting the weekly menu or accepting a busy order period.

1. **Confirm this week’s products.**
   - Review the website order form and compare it to the current code-defined `MENU` items: `Fatima`, `Lourdes`, `Guadalupe`, `Santiago`, `Kibeho`, `Pilgrim's Dough`, `Mt. Carmel Bowl (ind)`, `Mt. Carmel Bowl (duo)`, `Pilgrim's Honey Butter`, and `Pilgrim's Crunch`.
   - If any item name, price, or availability is wrong, contact a developer. Do not rename items only on the website without updating Apps Script, because total verification can reject orders.
2. **Confirm available loaf quantities.**
   - Current capacity comes from `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT` Script Properties or code defaults.
   - If the owner has no safe UI for these properties, contact a developer to adjust them.
3. **Confirm subscription-eligible products.**
   - Current Loaf Reserve signup supports `fatima` and `specialty` kinds through the `SUBSCRIPTIONS` object.
   - There is no current weekly mapping tab. Product mapping changes require developer help.
4. **Review membership states.**
   - Open `Subscriptions`.
   - Review the `Status` column for `Pending Payment` and `Active`.
   - The current code does not implement `Paused`, `Cancelled`, `Failed`, or `Skipped` behavior for weekly allocation because weekly allocation is not implemented.
5. **Confirm subscription product mappings.**
   - Current mapping is embedded in form payload fields and `handleSubscription` logic.
   - If an active member’s selected loaf text looks wrong in the `Tier` column, contact technical support before promising fulfillment.
6. **Confirm prices.**
   - One-time item prices are in `MENU`.
   - Subscription prices are in `SUBSCRIPTIONS`: Fatima 4/6/8 weeks and specialty 4/6/8 weeks.
7. **Confirm order cutoff.**
   - Current cutoff is controlled by `CUTOFF_DOW`, `CUTOFF_HOUR`, and `CUTOFF_TZ`.
   - Defaults are Wednesday (`3`) at 6 PM (`18`) in `America/Chicago`.
8. **Confirm pickup and delivery dates.**
   - One-time pickup must be Friday.
   - One-time delivery must be Thursday.
   - Loaf Reserve pickup must be Friday, 9 AM to 12 PM.
9. **Check Friday Loaf Reserve fulfillment rules.**
   - Current code validates subscription start dates as Fridays.
   - Current code does not generate weekly Friday allocations; verify memberships manually until that feature exists.
10. **Check inventory totals.**
    - Use `Daily Counter`, `Line Items`, and `Orders` for order-derived totals.
    - Remember: current totals do not include generated subscription allocations because those allocations do not exist.
11. **Check the current integration mode.**
    - OFF/SHADOW/ENFORCE mode is not implemented in the current code. If rollout controls are needed, contact a developer.
12. **Test the order form before promotion.**
    - Submit a small test order through the public order form.
    - Confirm a new `Orders` row, matching `Line Items` rows, a customer email, an owner email, and an `Email Log` entry.

## 4. Subscription workflow

### Current implemented flow

1. A customer submits a Loaf Reserve form.
2. `doPost` routes the request to `handleSubscription`.
3. `handleSubscription` creates or uses the `Subscriptions` tab.
4. The system writes a row with `Status` = `Pending Payment`.
5. The system creates payment links when possible and sends the customer and owner subscription notices.
6. Square webhook processing later uses `processSquareQueue`, `squareResolveOrderId`, and `updateSubscriptionStatus` to mark an `FBS-*` subscription `Active`.
7. The owner can also use the Sheet menu item `🌿 Mark selected subscription Active`, which runs `markSelectedSubscriptionActive`.
8. `subscriptionRenewalAgent` sends renewal reminders for `Active` subscriptions ending within seven days.

### What is not implemented yet

1. There is no weekly function that selects active memberships and creates weekly demand.
2. There is no current function that prevents duplicate weekly subscription allocations because weekly allocation rows are not created.
3. There is no current function that allocates subscription inventory before one-time orders.
4. There is no current code path for `Paused`, `Cancelled`, `Failed`, or `Skipped` memberships in weekly allocation.
5. There is no subscription product-mapping tab or reconciliation function for missing mappings.

### How to verify each eligible member manually today

1. Open `Subscriptions`.
2. Filter `Status` to `Active`.
3. Check each member’s `Start Date` and `End Date`.
4. Confirm the current Friday is inside the member’s active date range.
5. Review the `Tier` cell to understand the loaf choice and subscription duration.
6. Manually include eligible members in bake planning, because the current code does not create weekly allocation rows.
7. Do not run any invented weekly allocation function. If a developer later adds one, use the exact function and reconciliation instructions supplied with that implementation.

## 5. Order-day workflow

When a one-time customer submits an order:

1. `doPost` receives the request.
2. `handleOrder` validates that the order has items and contact information.
3. The system rejects obvious bot submissions and malformed orders.
4. The system validates fulfillment rules:
   - delivery is Thursday only, 3 PM to 5 PM;
   - pickup is Friday only, 9 AM to 12 PM;
   - orders close Wednesday at 6 PM before fulfillment;
   - specialty loaves require the configured advance notice.
5. The system recalculates the total from `MENU` and rejects mismatched totals.
6. The system writes a row to `Orders` and item rows to `Line Items`.
7. The system sends the customer an order-received email and sends the owner an alert.
8. Square payment confirmation is asynchronous. Square webhook events are queued as Script Properties with `sqq_` keys and processed by `processSquareQueue`.
9. When payment is verified, `markOrderPaid` updates the order status and sends payment-confirmed messages.

### OFF, SHADOW, and ENFORCE

These controls are **not present in the current merged Apps Script**.

- **OFF** usually means the integration is not enforcing a new inventory system.
- **SHADOW** usually means the new system checks what would happen but does not block customers.
- **ENFORCE** usually means the new system can accept or reject orders.

Because these modes are not implemented, there is no owner-safe current setting to choose. After a future rollout approval, the normal mode should be whatever the developer documents for production, usually `ENFORCE` only after successful `SHADOW` comparison. Today, use the current production flow and contact a developer for any mode-control changes.

## 6. Inventory management

Current inventory is capacity-based, not ledger-based.

- **Total weekly quantity:** currently represented by capacity settings: `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT`.
- **Subscription-allocated quantity:** not calculated by current code.
- **Remaining available quantity:** calculated in reports from capacity minus non-cancelled one-time orders; `sendWeeklyDrop` computes Friday availability this way.
- **Held quantity:** not implemented as a reservation state.
- **Confirmed quantity:** orders with statuses such as `Confirmed`, `Paid`, `Ready for Pickup`, or `Completed` count as fulfilled/confirmed for reports.
- **Released quantity:** not implemented as a separate ledger state. Cancelled rows are excluded from many counts.
- **Expired reservations:** not implemented because held reservations are not implemented.

Subscription and one-time demand should share the same bakery capacity in the business process, but the current code does not automatically subtract weekly subscription allocations from one-time availability. Until that is implemented, manually account for active Loaf Reserve members before promoting remaining one-time availability.

Do not manually alter formula totals in `Revenue`, `Item Performance`, `Customer Insights`, or `Daily Counter`. To correct an inventory error safely:

1. Preserve the original row; do not delete it.
2. If an order is not valid, change its `Status` to `Cancelled` or `Cancelled — Unpaid` using existing supported status values.
3. If line items are wrong, contact technical support before editing `Line Items`, because reports depend on those rows.
4. Add a clear note in the order’s `Notes` cell if a manual correction was made.

## 7. Reconciliation

A dedicated reconciliation scan, dry-run recovery, deterministic recovery, severity model, and findings tab are **not implemented in the current code**.

### Current owner checks available today

1. **Read-only scan by inspection:** open `Orders`, `Line Items`, `Subscriptions`, `Email Log`, `Debug Log`, and Script Properties if you have access.
2. **Expired holds:** not applicable; held reservations are not implemented.
3. **Duplicate one-time submissions:** sort or filter `Orders` by `Email`, `Pickup Date`, `Order Items`, and timestamp. Do not delete duplicates; contact the customer if needed and cancel the duplicate row.
4. **Duplicate weekly subscription generation:** not applicable; weekly generated subscription rows are not implemented.
5. **Missing subscription product mappings:** inspect the `Tier` column in `Subscriptions`. If the loaf choice is unclear, contact technical support.
6. **Partial failures:** check Script Properties for keys such as `failed_order_<orderId>`, `failed_customer_email_<orderId>`, `failed_owner_email_<orderId>`, `failed_subscription_square_link_<subId>`, and `failed_subscription_<kind>_email_<subId>`.
7. **Capacity comparison:** compare active subscription commitments manually plus non-cancelled `Orders`/`Line Items` quantities against `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT`.
8. **Payment queues:** use the Apps Script function `listPaymentQueues` to list Square queue and some failure keys. Use `retryPaymentQueueNow` only if you understand that it processes queued payment events.
9. **Dry-run recovery:** not implemented. Do not invent recovery edits.
10. **Approving deterministic recovery:** not implemented. Developer assistance required.
11. **Escalate ambiguous findings:** if a row, payment, or email state cannot be explained from the Sheets and logs, contact technical support before changing statuses.

### Severity levels for owner triage

These are operating labels, not implemented code labels:

1. **Critical:** possible oversell, paid order missing from `Orders`, active member missed for baking, or payment confirmed but status not updated.
2. **High:** email/payment link failed, duplicate customer submission, or capacity report does not match rows.
3. **Medium:** unclear notes, missing optional contact data, or stale waitlist/email-list status.
4. **Low:** formatting issues, typos in non-critical notes, or analytics refresh needed.

## 8. Editorial content workflow

The current repository has a developer-facing AI proposal approval/export workflow in `lib/editorial-approval-export.mjs`, but no owner-facing Google Sheet menu or tab for it. Use this safe manual process unless a developer is running the library for you.

1. Treat AI text as a draft only.
2. Before using any AI-generated weekly copy, manually verify:
   - product names against `MENU` and the website;
   - prices against `MENU` and `SUBSCRIPTIONS`;
   - pickup date and pickup hours;
   - delivery date, delivery hours, area, and fee;
   - current remaining capacity after active Loaf Reserve commitments;
   - any allergen, dietary, or production claims.
3. To approve copy manually, save the reviewed copy outside the production data tabs or paste it only into the channel where you intend to publish.
4. To reject or request revision, keep the draft out of customer-facing channels and ask for corrections.
5. **Newsletter export:** developer-facing export is available through `exportApprovedProposal` with `ExportChannel.NEWSLETTER`. The current Apps Script `sendWeeklyDrop` is separate and sends directly to the `Fatima Bakery — Email List`; it is not an export-only approval workflow.
6. **Hotplate export:** developer-facing export is available through `exportApprovedProposal` with `ExportChannel.HOTPLATE_DROP`. It does not call the Hotplate API.
7. **Website export:** developer-facing export is available through `exportApprovedProposal` with `ExportChannel.WEBSITE_CONTENT`. It does not mutate the website.
8. Exports do not publish automatically. The owner or developer must manually paste or publish approved content in the chosen channel.

## 9. Safety controls

1. **Feature mode:** OFF/SHADOW/ENFORCE is not implemented in the current code.
2. **Protected production spreadsheet ID:** the code can read `SPREADSHEET_ID` or `SHEET_ID`, but most current functions use the active spreadsheet. Do not publish real spreadsheet IDs in documentation or source code.
3. **Idempotency in plain language:** idempotency means “the same request should not create duplicate work if it is received twice.” Current protections include Square queue keys and renewal-sent keys, but one-time order submissions can still create duplicate order rows if a customer submits twice.
4. **Weekly subscription idempotency:** not implemented because weekly subscription generation is not implemented.
5. **Dry-run mode:** not implemented for reconciliation or allocation.
6. **Content hashes:** implemented in the developer-facing editorial library as `proposalContentHash`. In plain language, a content hash is a fingerprint of exact approved text so later exports can prove they used the same text.
7. **Kill switch:** there is no single implemented owner kill switch. The practical emergency stop is to remove or hide the public order form and contact a developer.
8. **Script Properties:** never place Script Property values in source code, documentation, screenshots, tickets, or chat. Use placeholders such as `<SQUARE_ACCESS_TOKEN>` or `<SPREADSHEET_ID>`.

## 10. Troubleshooting

### Order received but payment email not sent

- **What you see:** an `Orders` row exists, but the customer says no email arrived, or `Email Log` has a failed customer email.
- **Safest first action:** verify the customer email address in `Orders`; check `Email Log`; look for `failed_customer_email_<orderId>` in Script Properties.
- **Do not change:** do not delete the order row or recreate the order.
- **Contact support when:** you need to resend from failure metadata or diagnose MailApp/Square link errors.

### Customer submitted twice

- **What you see:** two similar `Orders` rows with close timestamps, same customer, and same items.
- **Safest first action:** contact the customer if payment status is unclear; mark the true duplicate `Cancelled` if unpaid.
- **Do not change:** do not delete either row.
- **Contact support when:** both have payment references, Square confirms both, or line-item totals no longer match.

### Weekly subscription generation was run twice

- **What you see:** this should not occur in current code because no weekly generation function exists.
- **Safest first action:** verify that no developer-added function was run outside the merged code.
- **Do not change:** do not delete subscription rows.
- **Contact support when:** you see duplicate generated weekly rows in any new tab.

### Active member did not receive a weekly allocation

- **What you see:** an `Active` member in `Subscriptions` is not included in bake planning.
- **Safest first action:** manually include the member if their current Friday is between `Start Date` and `End Date` and payment/status are valid.
- **Do not change:** do not invent generated allocation rows.
- **Contact support when:** dates, payment status, or loaf choice are unclear.

### Paused or cancelled member received an allocation

- **What you see:** current code should not generate allocations. If this happens, it is outside the current merged implementation.
- **Safest first action:** preserve the row and note the issue.
- **Do not change:** do not delete rows.
- **Contact support when:** any automated allocation appears for non-active members.

### Subscription product mapping is missing

- **What you see:** the `Tier` cell does not clearly show the selected loaf or plan.
- **Safest first action:** contact the member to confirm their loaf preference for the week.
- **Do not change:** do not rewrite historical subscription details without preserving the original meaning in notes.
- **Contact support when:** the website form and Apps Script payload disagree.

### Product appears sold out unexpectedly

- **What you see:** weekly drop or reports show no remaining capacity.
- **Safest first action:** review non-cancelled `Orders` and `Line Items` for the Friday and compare against `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT`.
- **Do not change:** do not edit formula cells or capacity properties casually.
- **Contact support when:** totals cannot be explained from visible rows.

### Inventory count does not match orders

- **What you see:** `Daily Counter`, weekly drop, and visible orders disagree.
- **Safest first action:** check cancelled statuses and line-item rows for the same pickup date.
- **Do not change:** do not clear analytics tabs unless you are intentionally running `setupSheet` to refresh formulas.
- **Contact support when:** `Line Items` is missing rows for an order or has extra rows.

### Subscription plus one-time totals exceed capacity

- **What you see:** active subscription commitments plus orders are more than planned loaves.
- **Safest first action:** stop promoting more orders and decide whether to bake more or contact affected customers/members.
- **Do not change:** do not lower or hide paid demand by deleting rows.
- **Contact support when:** you need a permanent allocation or capacity-control change.

### Reservation is stuck as held

- **What you see:** not applicable in current code because held reservations are not implemented.
- **Safest first action:** if you see a new held state from future code, do not edit it manually.
- **Do not change:** do not delete ledger rows.
- **Contact support when:** any held reservation blocks real availability.

### Reconciliation reports a partial write

- **What you see:** current reconciliation reports are not implemented; partial writes may appear as `failed_order_<orderId>` or email failure keys.
- **Safest first action:** preserve the Script Property key and related customer/order information.
- **Do not change:** do not delete the failure key until support confirms recovery.
- **Contact support when:** any order/payment/email write only partly completed.

### Proposal cannot be approved

- **What you see:** no owner UI exists, or a developer reports that `recordDecision` rejected the proposal.
- **Safest first action:** keep the proposal unpublished.
- **Do not change:** do not paste unverified AI copy into customer channels.
- **Contact support when:** the proposal is missing required fields, has the wrong schema version, or needs developer-run approval/export.

### Approved proposal cannot be exported

- **What you see:** a developer-facing export rejects the proposal because it is not approved, its content hash changed, or the requested channel is unsupported.
- **Safest first action:** stop and verify the exact approved proposal text.
- **Do not change:** do not create ad-hoc production tabs or publish changed text as if it were approved.
- **Contact support when:** approved content cannot be rendered for newsletter, Hotplate drop, or website content.

### Incorrect pickup or delivery information appears in an export

- **What you see:** no current export tool exists; weekly drop emails may show wrong pickup/delivery settings if Script Properties are wrong.
- **Safest first action:** verify `PICKUP_ADDRESS`, `PICKUP_HOURS`, `DELIVERY_AREA`, `DELIVERY_HOURS`, and `DELIVERY_FEE` with technical support.
- **Do not change:** do not expose property values publicly if they are sensitive.
- **Contact support when:** public text and Script Properties do not match.

### SHADOW reports an order mismatch

- **What you see:** SHADOW mode is not implemented.
- **Safest first action:** if a future shadow report exists, preserve the correlation/order ID and do not change rows until reviewed.
- **Do not change:** do not switch to ENFORCE after unexplained mismatches.
- **Contact support when:** any mismatch appears.

### SHADOW reports a subscription mismatch

- **What you see:** SHADOW mode is not implemented.
- **Safest first action:** preserve the membership/subscription ID and report details.
- **Do not change:** do not run weekly generation repeatedly.
- **Contact support when:** any mismatch appears.

### ENFORCE rejects an otherwise valid order

- **What you see:** ENFORCE mode is not implemented. Current valid-looking orders may still be rejected for total mismatch, cutoff, wrong date, missing address, or specialty advance notice.
- **Safest first action:** capture the customer’s exact item names, total, date, fulfillment method, and any returned message.
- **Do not change:** do not bypass by editing the Apps Script code.
- **Contact support when:** the website item names/prices differ from `MENU` or the rejection looks wrong.

### Emergency return to OFF mode

- **What you see:** no current OFF mode exists.
- **Safest first action:** remove/hide the public order form or mark orders closed on the website; preserve incoming emails/messages manually.
- **Do not change:** do not delete Sheet rows, Script Properties, or deployment history.
- **Contact support when:** public ordering must be stopped or redirected.

## 11. Rollback and emergency procedure

> **Production-sensitive:** do not delete data, deploy code, or clear Script Properties during an emergency unless a developer instructs you to do so.

1. **Stop new public orders.** Hide the order link or update the website/social posts to say orders are temporarily paused.
2. **If a future OFF mode exists, switch to `OFF` using the documented owner UI or developer-supported Script Property.** Current code has no OFF-mode switch.
3. **Preserve incoming one-time orders.** Keep all `Orders` and `Line Items` rows, including duplicates and cancelled rows.
4. **Preserve subscription records.** Keep all `Subscriptions` rows and do not rewrite membership history.
5. **Avoid manual deletion.** Use statuses and notes, not row deletion.
6. **Capture identifiers.** Save the `Order ID` (`FB-*`), `Sub ID` (`FBS-*`), customer email, timestamp, and any Square payment ID/reference.
7. **Run available checks.** Review `Email Log`, `Debug Log`, `Orders`, `Line Items`, `Subscriptions`, and payment queue keys with `listPaymentQueues` if appropriate.
8. **Inform customers or members when necessary.** If payment, pickup, delivery, or fulfillment is uncertain, send a clear human message that you are reviewing the order and will confirm shortly.
9. **Contact technical support for recovery.** Unsupported repairs, code changes, Script Property changes, or deployment rollback are developer-only.

## 12. Owner versus developer responsibilities

### Routine owner actions supported today

1. Review `Orders`, `Line Items`, and `Subscriptions`.
2. Mark a selected order ready using `✅ Mark order Ready → notify customer`.
3. Mark Venmo-paid orders confirmed using `💳 Mark Confirmed (Venmo payment received)`.
4. Mark a selected subscription active using `🌿 Mark selected subscription Active`.
5. Mark an order cancelled using `❌ Mark order Cancelled + trigger waitlist`.
6. Run `🧁 Run Friday Bake Sheet now`.
7. Run `📋 Notify waitlist (manual)`.
8. Run `📧 Send weekly drop now (test)` only when you intend to send a real/test weekly drop to active email-list rows.
9. Review `Email Log` and visible Sheet statuses.

### Developer-only actions

1. Code deployment or rollback.
2. Script Property changes when no owner UI exists.
3. Product, price, menu, subscription-tier, or capacity logic changes.
4. Schema changes, including new tabs or headers.
5. Creating a weekly inventory tab or allocation ledger.
6. State repair not supported by existing menu functions.
7. Subscription allocation, idempotency, billing, pause/cancel/skip logic, or reconciliation changes.
8. Owner-facing editorial approval UI/persistence, newsletter export operation, Hotplate publication integration, or website publication integration.
9. Payment webhook, Square, Cloudflare, Apps Script deployment, or secret configuration changes.

## 13. Quick-reference checklist

### Before opening orders

1. Verify website item names match `MENU` exactly.
2. Verify prices match `MENU` and `SUBSCRIPTIONS`.
3. Verify pickup is Friday and delivery is Thursday.
4. Verify order cutoff is Wednesday 6 PM Central.
5. Manually account for active Loaf Reserve demand.
6. Submit a test order and confirm Sheet/email behavior.

### Before weekly subscription generation

1. Current generation is not implemented; do not run an invented function.
2. Review `Subscriptions` for `Active` members.
3. Check each active member’s `Start Date`, `End Date`, and `Tier`.
4. Contact support for unclear membership/product mapping.

### After subscription allocation

1. Current allocation rows are not implemented.
2. Manually add eligible active members to bake planning.
3. Subtract those loaves from one-time capacity before promoting availability.

### While one-time orders are open

1. Watch owner alert emails.
2. Review new `Orders` rows.
3. Check `Email Log` for failures.
4. Watch for duplicate submissions.
5. Stop promotion if capacity is tight.

### After cutoff

1. Review all non-cancelled orders for the fulfillment dates.
2. Confirm payment statuses.
3. Cancel only true duplicates or invalid unpaid rows; do not delete.
4. Review active Loaf Reserve commitments manually.

### Before baking

1. Run `🧁 Run Friday Bake Sheet now` if needed.
2. Compare the bake sheet to `Orders`, `Line Items`, and active `Subscriptions`.
3. Resolve unclear orders before mixing/baking.

### Before pickup or delivery

1. Use `✅ Mark order Ready → notify customer` when an order is ready.
2. Verify delivery addresses and delivery windows.
3. Keep phone/email handy for customer exceptions.

### Before publishing content

1. Verify product names, prices, dates, times, availability, and fulfillment details.
2. Do not rely on AI copy without owner review.
3. Remember current exports are developer-facing objects only and do not publish to Hotplate or the website.
4. Use `sendWeeklyDrop` only when you intentionally want to send to active email-list rows.
