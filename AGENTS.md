# Fatima Bakery — Agent Context

Read this before making any changes to this repository.

## Stack

The target stack is **Next.js + TypeScript** (App Router). New work should be built in that stack.

## Legacy root — do not extend

The files at the repository root (`index.html`, `order/`, `contact/`, `collection/`, `story/`, `privacy/`, `terms/`, `images/`) are a **legacy static HTML site** deployed to Cloudflare Pages. This code is slated for removal once the Next.js app is production-ready.

- Do **not** add features or refactor the legacy root HTML files.
- Do **not** model new work after the legacy root structure.
- Only apply minimal safety or content fixes to the legacy root if explicitly asked.

## Naming convention — Ratio

The canonical name for the Next.js application and any sub-packages in this repo is **Ratio** (e.g. `apps/ratio`, `packages/ratio-ui`). Use this name consistently in:

- Directory names
- Package names (`name` field in `package.json`)
- Import aliases
- Component and module prefixes where a namespace is appropriate

Do not invent alternate names such as `app`, `web`, `frontend`, or `fatimabakery-app`.

## Approved architecture and orchestration rules

Use the approved inventory and orchestration records in this repository as constraints for all new work. In particular, preserve the runtime ownership boundaries documented for Google Sheets, Apps Script, website code, newsletter workflows, Hotplate integrations, and future Ratio adapters.

- **Google Sheets is the system of record** for operational bakery data.
- **Apps Script owns orchestration and transaction validation**. Treat it as the authority for accepting or rejecting mutations, not as generated-content storage.
- **LLMs are proposal generators, not transaction authorities**. LLM output may draft copy, summarize, classify, or propose actions, but it must not approve or execute transactions.
- **Never let generated content directly modify inventory, orders, prices, payments, memberships, or consent records.** Generated content must go through deterministic validation, explicit user/owner approval where required, and Apps Script orchestration before any mutation.
- **Keep core models channel-neutral.** Product, inventory, order, customer, membership, payment, consent, and publication models must not bake in website-, newsletter-, or Hotplate-specific fields as core behavior.
- **Implement website, newsletter, and Hotplate behavior through adapters.** Channel-specific formatting, delivery, API mapping, and publication behavior belongs in adapter layers around the core models.
- **Hotplate must remain removable.** Do not make Hotplate a required dependency for core inventory, order, payment, membership, consent, or publication flows.
- **Never deploy Apps Script automatically from a feature branch.** Apps Script deployments require explicit human approval and must be performed separately from routine feature-branch validation.
- **Never expose secrets or Script Properties.** Do not print, commit, log, snapshot, or include values from Apps Script Script Properties, Square, Google, Cloudflare, newsletter providers, Hotplate, or payment systems.
- **Never replace an existing Apps Script deployment when an update is sufficient.** Prefer additive, reversible updates and preserve rollback paths.
- **Use stable identifiers** for durable records: `product_id`, `week_id`, `inventory_id`, `customer_id`, `membership_id`, `order_id`, and `publication_id`. Do not use display names, row numbers, or generated prose as durable identifiers.
- **Require idempotency keys for mutating orchestration operations.** Any operation that creates, updates, reserves, charges, publishes, subscribes, unsubscribes, or records consent must include a stable idempotency key.
- **Require validation and audit logging.** Mutating operations must validate required fields, identifiers, authorization/consent, quantities, prices, dates, and state transitions, then write an audit trail sufficient to explain what changed and why.
- **Make one small change per task.** Keep diffs focused and avoid combining unrelated refactors, docs changes, and behavior changes.
- **Run the repository validation commands before proposing a commit.** If a required command cannot be run, report it with the reason.
- **Report tests that could not be run.** Include skipped or unavailable checks in the final response and PR body.
- **Do not commit, push, merge, or deploy unless explicitly instructed.** When commit permission is granted, still do not push, merge, or deploy unless separately instructed.

## Repository-specific validation commands

Use actual commands that exist in this repository or are direct checks against repository files. Do not invent missing npm scripts, clasp commands, deploy commands, or schema validators.

| Purpose | Command | Notes |
| --- | --- | --- |
| Site validation | `./scripts/validate-site.sh` | Runs the repository's local site checks, including legacy endpoint, copy, Wrangler, local reference, Apps Script wording, and obvious secret checks. |
| Secret scanning | `./scripts/validate-site.sh` | This is the only committed secret-scanning check currently present; it fails on obvious Square/Bearer token patterns. |
| Apps Script checks | `node --check apps-script/Code.js` | Syntax-checks the committed Apps Script source without deploying it. Do not run deployment commands from a feature branch. |
| Test suite | `npm test` | Runs the repository's Node test suite (`node --test`). |
| JSON schema validation | `python3 -m json.tool apps-script/appsscript.json >/dev/null` | There is no dedicated JSON Schema validator script in this repository; this command validates the Apps Script manifest JSON syntax only. |

## Existing agent instructions

Content and release rules for the legacy static site are in `docs/AGENT_INSTRUCTIONS.md`. Those rules apply only to legacy root files.
