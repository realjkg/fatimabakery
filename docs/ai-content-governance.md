# AI Content Governance

## Purpose

This document defines how GPT, Claude, and similar tools may support Fatima Bakery editorial workflows without gaining authority over inventory, prices, orders, payments, customers, or memberships.

## Allowed AI activities

AI tools may draft structured proposals for:

- Weekly drop descriptions
- Product storytelling
- Recipe drafts
- Newsletter drafts
- SMS or email alert copy
- Loaf Reserve member-perk copy
- Channel-neutral metadata suggestions

AI tools may also flag inconsistencies, missing required fields, unclear wording, or content that needs human review.

## Prohibited AI activities

AI tools must never directly:

- Change production inventory quantities.
- Change product prices.
- Create, confirm, cancel, refund, or fulfill orders.
- Change payment state.
- Change customer records or communication consent.
- Change Loaf Reserve membership state.
- Publish, unpublish, or send customer-facing messages without human approval.
- Write to production spreadsheets, Apps Script deployments, order forms, deployment workflows, or channel APIs.

## Required controls

1. AI output must be structured JSON when intended for workflow use.
2. AI output must validate against the relevant JSON schema before review.
3. A human must approve the validated output before publication or sending.
4. Approval records must include the schema version, proposal ID, approver, timestamp, and decision.
5. Apps Script or CI should reject unknown fields unless a schema explicitly allows them.
6. Channel adapters may only consume approved proposals.

## Human approval gates

Human approval is required for:

- Weekly drop publication.
- Newsletter publication or sending.
- Recipe publication.
- Subscriber alerts.
- Loaf Reserve member-perk publication.
- Any content containing prices, quantities, fulfillment dates, cutoff times, or availability claims.

## Schema validation

The initial schemas are:

- `schemas/weekly-drop.schema.json`
- `schemas/channel-publication.schema.json`
- `schemas/newsletter-content.schema.json`

Validation should happen before human review and again before publication. Validation success does not imply approval.

## Audit and traceability

Each AI-assisted proposal should retain:

- Proposal ID
- Prompt or brief summary
- Model/provider name when known
- Schema ID and schema version
- Validation result
- Human approval decision
- Publication records created from the proposal
- Correlation ID across Apps Script logs and channel-publication records

## Failure behavior

- Invalid AI output is rejected and may be returned for revision.
- Ambiguous copy is held for human clarification.
- Approval failures stop publication.
- Channel-publication failures do not modify core inventory or customer records.
- Retry behavior must be recorded in channel-publication and audit records.

## Implementation phases

1. Define schemas and governance documentation.
2. Add examples and CI schema validation.
3. Add human approval records for proposal review.
4. Add dry-run publication previews.
5. Add channel adapter execution only after approval gates are operational.
