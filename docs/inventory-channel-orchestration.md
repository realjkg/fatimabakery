# Inventory and Channel Orchestration Foundation

## Purpose

This document defines the documentation-only foundation for a channel-neutral inventory and publishing system for Fatima Bakery. It does not change production application code, Apps Script code, order forms, deployment workflows, or spreadsheet data.

## System boundaries

### Core systems

- **Google Sheets** is the long-term system of record for products, weekly inventory, customers, memberships, orders, and channel publication state.
- **Google Apps Script** is the orchestration and transaction layer that reads and writes authoritative spreadsheet records, applies validation, coordinates reservations, and records audit events.
- **fatimabakery.com** remains the owned website and primary customer experience.

### Channel systems

A channel is any removable publishing or notification destination outside the core model. Channel adapters may publish approved records, read channel configuration, and write channel-publication status records, but they must not own product, inventory, order, payment, customer, or membership truth.

**Hotplate** is a temporary channel for specialty loaf drops, SMS and email subscriber alerts, recipes, newsletters, and Loaf Reserve membership perks. Hotplate must never become the inventory authority.

### AI systems

GPT, Claude, or similar tools may generate structured editorial proposals only. They must never directly change production inventory, prices, orders, payment state, customer records, or membership state.

## Source-of-truth rules

1. Product definitions, prices, weekly inventory quantities, customer records, Loaf Reserve memberships, orders, and channel publication state are authoritative only in Google Sheets.
2. Google Apps Script is the only automation layer that may perform production writes to authoritative sheets.
3. Channel platforms may cache published copy and channel-specific metadata, but their state is derivative.
4. AI output is non-authoritative until schema validated and approved by a human.
5. Channel-specific values, including Hotplate identifiers and delivery settings, belong only in channel configuration or channel-publication records.
6. The core model must use channel-neutral names so a channel can be added, disabled, or removed without changing core entities.

## Inventory reservation lifecycle

1. **Planned**: Weekly inventory is drafted for a fulfillment window.
2. **Approved**: A human approves the weekly inventory plan for publication.
3. **Published**: One or more channel-publication records expose the approved inventory to configured channels.
4. **Reservation requested**: A customer order or membership allocation requests inventory.
5. **Reserved**: Apps Script atomically records a reservation against available weekly inventory.
6. **Awaiting payment**: If payment is required, inventory remains reserved while payment is pending according to a defined expiration policy.
7. **Confirmed**: Payment, membership entitlement, or manual approval confirms the reservation.
8. **Released**: Expired, canceled, failed, duplicate, or manually rejected reservations return inventory to availability.
9. **Fulfilled**: Confirmed reservations are completed for pickup, delivery, or membership allocation.
10. **Reconciled**: End-of-week review compares planned, reserved, released, fulfilled, spoiled, and manually adjusted quantities.

Every lifecycle transition should include a stable record identifier, prior state, next state, actor, timestamp, reason, and idempotency key.

## Channel adapter boundaries

Channel adapters may:

- Read approved products, inventory windows, editorial content, and channel-publication records.
- Transform channel-neutral content into channel-specific payloads.
- Publish, update, unpublish, or archive content in a configured channel.
- Record channel request IDs, external IDs, status, errors, and retry state back to channel-publication records.

Channel adapters must not:

- Create or modify core product, price, inventory, order, payment, customer, or membership records.
- Treat external channel availability as authoritative inventory.
- Bypass schema validation or human approval gates.
- Store secrets in repository files or public documentation.

## Hotplate onboarding

Hotplate onboarding should be additive and reversible:

1. Create a channel configuration record with `channelKey` set to `hotplate`.
2. Map approved channel-neutral publication types to Hotplate-supported destinations.
3. Configure Hotplate-specific external identifiers only in channel configuration or channel-publication records.
4. Run dry-run validation before first live publication.
5. Require human approval before enabling subscriber alerts, newsletters, recipes, drops, or Loaf Reserve perks.
6. Record first-publication audit events and retain rollback instructions.

## Hotplate offboarding

Hotplate offboarding must not require core model changes:

1. Disable the Hotplate channel configuration.
2. Stop new publication jobs for `channelKey: hotplate`.
3. Archive or unpublish active Hotplate channel-publication records where appropriate.
4. Preserve historical channel-publication and audit records for reconciliation.
5. Keep products, inventory, orders, customers, and memberships unchanged.
6. Confirm fatimabakery.com remains the primary customer experience.

## Human approval gates

Human approval is required before:

- Weekly inventory is published.
- Prices, quantities, fulfillment windows, or availability rules become customer-visible.
- AI-generated editorial proposals are published.
- Subscriber alerts, newsletters, recipes, or membership perks are sent.
- A new channel is enabled for live publication.
- A channel is offboarded, archived, or bulk-unpublished.

Approval records should include approver, timestamp, source proposal ID, approved schema version, decision, and notes.

## Idempotency expectations

Apps Script transactions and channel adapters should accept deterministic idempotency keys for reservation, publication, unpublication, and retry operations. Replaying the same operation with the same key should not duplicate inventory reservations, customer messages, orders, payment state changes, or channel posts.

Recommended key components include operation type, entity ID, fulfillment week, channel key, schema version, and normalized payload digest.

## Audit logging

Audit logs should be append-only and searchable by stable identifier. Each audit event should include:

- Event ID
- Timestamp
- Actor type and actor ID
- Operation
- Entity type and entity ID
- Previous state summary
- Next state summary
- Idempotency key
- Correlation ID
- Validation result
- Channel key, when applicable
- Error code and retry count, when applicable

## Failure and retry behavior

- Validation failures should stop before production writes and return actionable errors.
- Transient channel failures should be retried with bounded backoff and an explicit retry count.
- Permanent channel failures should mark the publication record as failed without changing core inventory.
- Partial publication failures should be visible in channel-publication status and audit logs.
- Reservation failures should leave inventory unchanged unless a complete transaction is recorded.
- Recovery actions should be manual or scripted through Apps Script, never direct edits by AI tools.

## CI validation responsibilities

CI should validate documentation and schema artifacts before merge. At minimum, CI should:

- Parse all JSON schema files.
- Validate example proposal payloads when examples are added.
- Check schema files use stable `$id` values and explicit versions.
- Run repository tests that already exist.
- Avoid any workflow that writes to production spreadsheets, Apps Script deployments, order forms, or channel APIs.

## Phased implementation plan

1. **Documentation foundation**: Define boundaries, entities, schemas, approval gates, and channel-neutral language.
2. **Schema examples**: Add non-production example payloads and CI validation for examples.
3. **Spreadsheet design review**: Map proposed entities to Google Sheets tabs and columns without changing production data.
4. **Apps Script design review**: Draft transaction and audit helpers without deploying them.
5. **Read-only prototype**: Build read-only exports from Sheets to approved publication proposals.
6. **Human approval workflow**: Add explicit approval records and dry-run publication review.
7. **Channel adapter pilot**: Implement a removable adapter for a single channel with dry-run first.
8. **Hotplate limited launch**: Enable Hotplate only for approved publication types and monitored retries.
9. **Owned-site integration**: Prioritize fatimabakery.com as the primary customer experience.
10. **Offboarding readiness**: Verify Hotplate can be disabled with configuration only.

## Conflicts and unclear assumptions

- Existing docs describe current production spreadsheet tabs such as Orders, Subscriptions, Line Items, Waitlist, and Email Events. The proposed model preserves those terms as implementation history while using channel-neutral names for new architecture.
- Existing docs preserve Loaf Reserve terminology and reject older Loaf Reserve wording.
- The exact future Google Sheets tab names, column headers, Apps Script function names, and Hotplate API fields remain unresolved until a separate design review.
