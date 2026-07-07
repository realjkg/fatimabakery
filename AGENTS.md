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

## Existing agent instructions

Content and release rules for the legacy static site are in `docs/AGENT_INSTRUCTIONS.md`. Those rules apply only to legacy root files.
