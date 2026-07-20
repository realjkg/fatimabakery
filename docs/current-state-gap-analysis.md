# Current-State Gap Analysis

Date: 2026-07-20

## Audit scope and source status

This audit reviewed the repository implementation against `AGENTS.md` plus the requested governance/design documents. The requested files `docs/inventory-channel-orchestration.md`, `docs/data-model.md`, and `docs/ai-content-governance.md` are not present in the current repository, so those comparisons are classified as `unknown` and should be resolved by adding or restoring those source-of-truth documents before major implementation work.

Runtime code was not changed.

## Classification legend

- `preserve` — current behavior appears production-relevant and should be retained while migrating.
- `refactor` — behavior is useful but should move, consolidate, or be made safer.
- `add` — expected governance/model/orchestration capability is missing.
- `retire` — behavior appears legacy, duplicate, or obsolete.
- `unknown` — cannot be verified from repository state alone.

## Executive summary

| Area | Classification | Finding |
| --- | --- | --- |
| Repository strategy | `preserve` | `AGENTS.md` states the current root HTML site is legacy and the target stack is Next.js + TypeScript App Router under the Ratio naming convention. |
| Requested source docs | `unknown` | The three requested source-of-truth docs are absent, leaving no canonical inventory orchestration, data model, or AI governance baseline in this repository. |
| Order page | `refactor` | `order/index.html` is a large legacy static form that posts directly to Apps Script with `no-cors`; it should not be extended except for explicitly requested safety/content fixes. |
| Apps Script backend | `preserve` | `apps-script/Code.js` is the active production backend for orders, subscriptions, payments, emails, sheets, agents, and Square queue processing. |
| Cloudflare `/api/order` | `unknown` | `functions/api/order.js` contains stronger edge validation/signing, but validation scripts require the legacy order page not to use `/api/order`, so production use is unclear or disabled. |
| Google Sheets schema | `refactor` | Expected tabs and headers are embedded in Apps Script setup/runtime helpers instead of in a canonical data-model document. |
| Email and newsletter logic | `refactor` | Central send/logging exists, but newsletter sending and transactional retry mechanisms are fragmented. |
| Inventory functions | `refactor` | Capacity is computed from Orders/Line Items counts; there is no dedicated inventory ledger/channel orchestration layer visible in repo. |
| Square webhook topology | `unknown` | Apps Script direct queueing and Cloudflare Worker durable queue both exist; the production topology cannot be proven from repo alone. |
| GitHub Actions | `refactor` | Workflows validate the legacy site and generate maintenance reports; they do not validate a Ratio Next.js app or Apps Script behavior. |
| Deployment scripts | `refactor` | Scripts focus on static legacy checks and hard-coded Apps Script endpoint assumptions. |
| Hotplate references | `preserve` | No Hotplate references were found in the repository scan. |

## Baseline documents requested

### `docs/inventory-channel-orchestration.md` — `unknown`

No file by this name exists in `docs/`. Without it, the repo has no reviewed definition of inventory channels, capacity reservations, Square/payment reconciliation ownership, or migration target for multi-channel stock.

### `docs/data-model.md` — `unknown`

No file by this name exists in `docs/`. Current schema is therefore inferred from Apps Script sheet creation code and existing audit docs rather than a canonical model.

### `docs/ai-content-governance.md` — `unknown`

No file by this name exists in `docs/`. There is a human approval policy, but no AI-specific content governance document covering generation boundaries, review requirements, allowed automation, brand/faith claims, PII handling, or publish/send approvals.

### `AGENTS.md` — `preserve`

`AGENTS.md` is clear that the legacy static root must not be extended, new work should target Next.js + TypeScript App Router, and the canonical app/package namespace is Ratio.

## Implementation observations

### Order submission flow

| Classification | Finding |
| --- | --- |
| `preserve` | The legacy order page exposes Thursday delivery and Friday pickup/reserve constraints, client-side order totals, and customer-facing payment expectations. |
| `preserve` | Apps Script revalidates dates, cutoff, order totals, and spam/empty submissions server-side before writing an order. |
| `refactor` | The static form posts directly to a hard-coded Apps Script URL using `mode: 'no-cors'`, so the browser cannot reliably read structured server responses. |
| `unknown` | The Cloudflare `/api/order` path validates Turnstile, signs payloads, and normalizes delivery/pickup rules, but the validation script explicitly fails if the page points at `/api/order`; production intent is unclear. |
| `refactor` | Payment-link creation can happen before row persistence for one-time orders, so external payment service failures can prevent durable order capture. |

### Apps Script source files

| Classification | Finding |
| --- | --- |
| `preserve` | `apps-script/Code.js` is the production-critical monolith and should remain stable until live deployment, triggers, Script Properties, and Sheet headers are inventoried. |
| `refactor` | One file contains configuration, routing, schema setup, email engine, Square processing, subscriptions, analytics, inventory/capacity agents, waitlist, and menu actions. |
| `refactor` | Runtime schema mutation exists via `ensureOrderDeliveryColumns_`, which can rewrite header cells during order handling. |
| `retire` | Existing audit notes identify likely obsolete helpers such as old direct Square handlers, duplicate queue trigger helpers, and older capacity email paths, but they should only be retired after live trigger/deployment checks. |

### Google Sheets tab names and columns documented or inferred

| Tab | Classification | Expected columns/source |
| --- | --- | --- |
| `Orders` | `preserve` | Timestamp, Name, Phone, Instagram, Email, Order Items, Boule Count, Specialty Count, Subtotal, Delivery Fee, Total, Pickup Date, Pickup Window, Source, Notes, Order ID, Status, Delivery Address 1, Delivery Address 2, Delivery City, Delivery State, Delivery ZIP, Delivery Instructions, Address Status, Address Distance, Address Updated At, Payment Reference. |
| `Subscriptions` | `preserve` | Timestamp, Name, Phone, Instagram, Email, Tier, Price, Start Date, End Date, Status, Notes, Source, Sub ID. |
| `Line Items` | `preserve` | Timestamp, Order ID, Customer Email, Item Name, Item Type, Qty, Unit Price, Line Total, Pickup Date, Source, Status. |
| `Waitlist` | `preserve` | Timestamp, Name, Email, Phone, Items/Date, Status. |
| `Fatima Bakery — Email List` | `preserve` | Name, Email, Source, Status. |
| `Email Log` / `Email Events` | `refactor` | Code and existing docs disagree on the tab name; normalize before depending on logs. |
| `Debug Log` | `preserve` | Timestamp, Raw Body, Parsed?, order_type, email, Outcome, Error. |
| `Revenue`, `Item Performance`, `Customer Insights`, `Daily Counter` | `refactor` | Analytics/calculated tabs are generated from setup helpers and should be described in `docs/data-model.md`. |
| Square event persistence | `unknown` | Apps Script uses Script Properties queue keys while Worker uses D1 `square_events`; production source of truth is unclear. |

### Email and newsletter logic

| Classification | Finding |
| --- | --- |
| `preserve` | `sendTrackedEmail` centralizes outbound MailApp sending and writes attempted/sent/failed events. |
| `preserve` | Transactional email paths exist for order received, payment confirmed, owner alerts, subscription received/active/renewal, waitlist, cutoffs, refunds, and bake sheets. |
| `refactor` | Retry metadata is fragmented across multiple Script Property prefixes and manual resend helpers. |
| `refactor` | `sendWeeklyDrop` sends a newsletter-style availability drop directly from Apps Script using the email list sheet, but AI/human approval governance for newsletter content is not defined in repo. |
| `add` | Add explicit unsubscribe/status handling, content approval rules, and dry-run mode expectations to AI/content governance before automating future campaigns. |

### Inventory-related functions

| Classification | Finding |
| --- | --- |
| `preserve` | Capacity is enforced with boule/specialty/combined limits, daily counts, cutoff logic, waitlist logging, and Friday bake-sheet generation. |
| `refactor` | Inventory is derived from confirmed/not-cancelled sheet rows rather than a first-class inventory ledger with holds, releases, sales channels, and reconciliation states. |
| `add` | Add an inventory/channel orchestration document before implementing Next.js inventory APIs or multi-channel sync. |

### GitHub Actions workflows

| Classification | Finding |
| --- | --- |
| `preserve` | `validate.yml` runs the local validation script on push and pull request, and `weekly-maintenance.yml` creates a weekly issue/report. |
| `refactor` | Validation targets the legacy static site and hard-coded Apps Script endpoint assumptions. |
| `add` | Future Ratio work needs Next.js/TypeScript checks, unit tests, lint/typecheck/build, and Apps Script static checks. |

### Deployment scripts

| Classification | Finding |
| --- | --- |
| `preserve` | Existing scripts provide safety checks for the current static site and maintenance reporting. |
| `refactor` | Scripts use recursive `grep` despite repository guidance preferring `rg`, and they validate legacy deployment artifacts rather than Ratio app deployment. |
| `unknown` | `validate-site.sh` expects `wrangler.jsonc`, but that file was not listed in the initial scoped file scan; CI status should be confirmed. |

### Hotplate references

| Classification | Finding |
| --- | --- |
| `preserve` | Repository search found no `Hotplate` or `hotplate` references. No cleanup is currently needed. |

## Key gaps to close before runtime changes

1. Restore or create the three missing source-of-truth docs.
2. Inventory live Apps Script deployment URL, triggers, Script Properties, spreadsheet tab headers, and Square webhook destination.
3. Decide whether direct Apps Script or Cloudflare Worker is the Square webhook production topology.
4. Freeze the data model before moving runtime behavior into Ratio.
5. Add AI/content governance before automating newsletter or generated content workflows.
