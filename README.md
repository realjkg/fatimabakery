# Fatima Bakery ATX — Cloudflare Static Site + Apps Script Backend

This repository contains the Cloudflare static front end for Fatima Bakery ATX.

## Current front-end structure

```text
/
├── index.html
├── order/index.html
├── contact/index.html
├── collection/index.html
├── story/index.html
├── privacy/index.html
├── terms/index.html
└── images/
```

## Important deployment note

The static front-end pages currently post to a Google Apps Script `/exec` endpoint in:

```text
order/index.html
contact/index.html
```

Before deploying, confirm that both pages use the same current Apps Script Web App URL from your latest deployment.

Search for:

```js
var APPS_SCRIPT_URL =
```

## Cloudflare Pages deployment

In Cloudflare Pages, use this repository as a static site.

Recommended settings:

- Framework preset: `None`
- Build command: leave blank
- Build output directory: `/`

After deployment, verify:

1. `/order` loads correctly.
2. `/contact` loads correctly.
3. A test contact submission reaches the Apps Script backend.
4. A test order reaches the `Orders` sheet.
5. Payment links in confirmation emails are generated as expected.

## Security reminder before a public GitHub commit

Do not commit live payment secrets or tokens into GitHub. For Apps Script, sensitive values are not included:
- Square access token
- Square webhook signature key
- Any other private API keys

## July 2026 promo/local SEO update

Current front-end updates included in this repo:

- Changed visible membership wording from “Pilgrim Reserve” to “Loaf Reserve.”
- Updated the next market event to August 6, 2026, 5:00–8:30 PM, Wolf Ranch River Camp, 101 River Overlook Rd., Georgetown, TX 78626.
- Added local SEO wording for Liberty Hill, Leander, Georgetown, Cedar Park, and North Austin.
- Renamed the email list callout to “Fatima Bakery newsletter list.”

Keep the form anchor `#Pilgrim Membership` unless/until the backend and front-end form payload are changed together. The user-facing label can say “Loaf Reserve” while the internal anchor stays stable.
