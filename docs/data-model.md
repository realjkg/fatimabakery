# Channel-Neutral Data Model

## Purpose

This document defines stable, channel-neutral entities for future Google Sheets and Apps Script design. It is documentation only and does not create or modify spreadsheet data.

## Naming principles

- Use channel-neutral core entity names.
- Use **Loaf Reserve** for membership terminology.
- Do not use Hotplate-specific names in core product, inventory, order, customer, membership, or reservation records.
- Store channel-specific values only in channel configuration and channel-publication records.

## Stable identifiers

Identifiers should be immutable once assigned and safe to reference across Sheets, Apps Script logs, channel-publication records, and audit events.

Recommended prefixes:

| Entity | Prefix | Example |
| --- | --- | --- |
| Product | `prod` | `prod_country_sourdough` |
| Fulfillment window | `fw` | `fw_2026w32_fri_pickup` |
| Weekly inventory | `winv` | `winv_2026w32_country` |
| Customer | `cust` | `cust_01k2example` |
| Membership | `mbr` | `mbr_01k2example` |
| Order | `ord` | `ord_2026w32_0001` |
| Reservation | `res` | `res_2026w32_0001` |
| Content proposal | `cnt` | `cnt_2026w32_drop` |
| Channel configuration | `chan` | `chan_hotplate` |
| Channel publication | `pub` | `pub_2026w32_hotplate_drop` |
| Audit event | `aud` | `aud_01k2example` |

## Entity relationships

```text
Product
  -> WeeklyInventory
       -> Reservation
            -> Order
Customer
  -> Order
Customer
  -> Membership
Membership
  -> Reservation
FulfillmentWindow
  -> WeeklyInventory
ContentProposal
  -> ChannelPublication
ChannelConfiguration
  -> ChannelPublication
Any entity
  -> AuditEvent
```

## Core entities

### Product

Represents a sellable or publishable bakery item. Product records contain stable identity, name, description, default price, active status, dietary notes, and production constraints.

Product records do not contain channel-specific IDs.

### Fulfillment window

Represents a pickup, delivery, market, or membership allocation window. It includes date, time range, fulfillment method, capacity constraints, cutoff rules, and status.

### Weekly inventory

Represents approved or planned quantity for a product in a fulfillment window. It includes planned quantity, approved quantity, reserved quantity, released quantity, fulfilled quantity, adjustment quantity, and status.

### Reservation

Represents a claim against weekly inventory. Reservations may be created by one-time orders or Loaf Reserve membership allocations. A reservation references exactly one weekly inventory record and should have a lifecycle state.

### Order

Represents a customer purchase intent and payment/fulfillment workflow. Orders may contain one or more reservations. Payment state belongs to the order, not the channel.

### Customer

Represents a person or household with contact preferences and consent records. Customer records are authoritative only in Google Sheets.

### Membership

Represents a Loaf Reserve membership, entitlement, renewal state, and allocation preferences. Membership records may create reservations but should not be stored in a channel-specific system as the authority.

### Content proposal

Represents structured editorial content proposed for publication, such as a weekly drop description, recipe, newsletter, or member perk. AI may draft this entity, but it remains non-authoritative until schema validated and human approved.

### Channel configuration

Represents a removable destination configuration, such as owned website publication, Hotplate, email, or SMS. This is the only place where channel adapter settings belong.

### Channel publication

Represents the publication state of approved content or availability in one channel. It records channel key, publication type, source entity IDs, external IDs, status, approval, errors, retries, and timestamps.

### Audit event

Represents an append-only record of validation, approval, reservation, publication, retry, failure, unpublication, or reconciliation activity.

## State enumerations

### Inventory status

- `draft`
- `approved`
- `published`
- `closed`
- `reconciled`

### Reservation status

- `requested`
- `reserved`
- `awaiting_payment`
- `confirmed`
- `released`
- `fulfilled`
- `canceled`
- `failed`

### Publication status

- `draft`
- `pending_approval`
- `approved`
- `scheduled`
- `published`
- `update_pending`
- `unpublish_pending`
- `unpublished`
- `failed`
- `disabled`

## Unresolved data-model decisions

- Final Google Sheets tab names and column ordering.
- Whether current production tabs are migrated or wrapped by compatibility views.
- Exact reservation expiration policy for unpaid orders.
- Exact membership allocation priority when inventory is limited.
- Exact owned-site publication format for fatimabakery.com.
