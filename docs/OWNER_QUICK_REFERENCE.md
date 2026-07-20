# Fatima Bakery Owner Quick Reference

Use this as the weekly operating checklist for the **current merged system**.

## Current operating mode

- OFF/SHADOW/ENFORCE mode is **not implemented** in the current Apps Script.
- Current production behavior: website orders and Loaf Reserve signups post to Apps Script, which writes to Sheets and sends emails/payment links.
- Emergency stop: hide or remove the public order link and contact technical support. Do not delete Sheet rows.

## Weekly inventory setup

1. Confirm public item names match the Apps Script `MENU` exactly.
2. Confirm prices match `MENU` and `SUBSCRIPTIONS`.
3. Confirm capacity settings: `BOULE_LIMIT`, `SPECIALTY_LIMIT`, `COMBINED_LIMIT`.
4. Confirm pickup/delivery settings: `PICKUP_ADDRESS`, `PICKUP_HOURS`, `DELIVERY_AREA`, `DELIVERY_HOURS`, `DELIVERY_FEE`.
5. If any setting requires Script Properties or code changes, contact a developer.

## Subscription allocation check

1. Open `Subscriptions`.
2. Filter or review `Status` = `Active`.
3. Confirm each active member’s current Friday is between `Start Date` and `End Date`.
4. Read the `Tier` cell for loaf choice and duration.
5. Manually include eligible members in bake totals.
6. Remember: current code does not create weekly subscription allocation rows.

## One-time order check

1. Open `Orders`.
2. Review new rows with `Status` = `Awaiting Payment`, `Confirmed`, `Paid`, `Ready for Pickup`, or `Completed`.
3. Open `Line Items` and compare item rows to order rows.
4. Watch for duplicate customer submissions.
5. Use supported statuses instead of deleting rows.

## Reconciliation check

1. Review `Orders`, `Line Items`, `Subscriptions`, `Email Log`, and `Debug Log`.
2. For payment queues, a developer or trained owner can run `listPaymentQueues` in Apps Script.
3. Do not run unsupported recovery or deletion steps.
4. Current code has no reconciliation findings tab, dry-run recovery, or deterministic recovery workflow.

## Payment and email check

1. Square confirmations are queued as `sqq_` Script Property keys and processed by `processSquareQueue`.
2. One-time orders use `FB-*` order IDs.
3. Loaf Reserve subscriptions use `FBS-*` subscription IDs.
4. Check `Email Log` for sent/failed messages.
5. Preserve failure keys such as `failed_order_<orderId>`, `failed_customer_email_<orderId>`, `failed_owner_email_<orderId>`, `failed_subscription_square_link_<subId>`, and `failed_subscription_<kind>_email_<subId>`.

## Baking totals

1. Start with non-cancelled one-time orders in `Orders` and `Line Items`.
2. Add active Loaf Reserve members manually, because weekly allocation is not implemented.
3. Compare total demand against `BOULE_LIMIT`, `SPECIALTY_LIMIT`, and `COMBINED_LIMIT`.
4. Run `🧁 Run Friday Bake Sheet now` if you need the current bake-sheet email.

## Pickup and delivery verification

1. Pickup: Friday, 9 AM to 12 PM.
2. Delivery: Thursday, 3 PM to 5 PM.
3. Cutoff: Wednesday at 6 PM Central by default.
4. Specialty advance notice: controlled by `SPECIALTY_ADVANCE`, default 2 days.
5. Verify delivery address fields before baking or driving.

## Editorial approval and manual publication

1. AI-generated copy is a draft only.
2. Verify prices, dates, pickup/delivery details, and availability manually.
3. Current code has no owner-facing editorial proposal approval tabs or menu.
4. Developer-facing exports exist through `exportApprovedProposal` for newsletter, Hotplate drop, and website content, but they do not send, publish, call Hotplate, or mutate the website.
5. Current `sendWeeklyDrop` sends directly to active rows in `Fatima Bakery — Email List`; it is not an export-only approval step.

## Emergency OFF-mode procedure

1. Current code has no OFF-mode switch.
2. Hide/remove the public order link or announce orders are paused.
3. Preserve all `Orders`, `Line Items`, and `Subscriptions` rows.
4. Capture `FB-*` order IDs, `FBS-*` subscription IDs, customer emails, timestamps, and payment references.
5. Review `Email Log`, `Debug Log`, and payment queue keys.
6. Contact technical support before deleting, deploying, clearing properties, or changing schema.

## Developer escalation criteria

Contact technical support for:

1. Code deployment or rollback.
2. Script Property changes without an owner UI.
3. Product, price, subscription tier, or capacity changes.
4. New tabs, new headers, or schema repair.
5. State repair not supported by existing menu actions.
6. Subscription allocation, pause/cancel/skip behavior, or billing logic.
7. Payment webhook/Square issues.
8. Reconciliation recovery.
9. Owner-facing editorial approval UI/persistence, newsletter export operation, Hotplate publication integration, or website publication integration.
