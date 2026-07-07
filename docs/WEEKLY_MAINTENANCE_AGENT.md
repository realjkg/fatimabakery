# Fatima Bakery Weekly Maintenance Agent

## Purpose

This repo uses a mostly automated weekly maintenance workflow for the Fatima Bakery Cloudflare static site.

The workflow checks site health, content freshness, terminology consistency, local SEO wording, deployment config, and obvious secret exposure.

It does not automatically merge to production.

## Operating Model

The agent can:

- Inspect the repo
- Validate customer-facing wording
- Check the public Apps Script endpoint
- Check Cloudflare Wrangler config
- Check for obvious committed secrets
- Generate a weekly maintenance report
- Open a GitHub issue
- Prepare future PRs for safe copy or docs updates

The agent cannot do without human approval:

- Merge to `main`
- Change payment behavior
- Change Google Apps Script backend logic
- Change Script Properties
- Change Square, Cash App, or Venmo behavior
- Email customers
- Delete deployments or branches
- Modify customer/order data

## Current Production Rules

Production branch:

`main`

Cloudflare deploys from:

`main`

Public Apps Script endpoint:

`https://script.google.com/macros/s/AKfycby6ahtqJ1pe7sLVk4BgcU48WIn34P1P1giY5lxh8pmEABxpQX3m0wI96lIhnjreiDO-/exec`

Preferred CTA:

`Join the Fatima Bakery newsletter list.`

Preferred terminology:

`Loaf Reserve`

Do not use:

`Pilgrim Reserve`

Current local SEO areas:

- Liberty Hill
- Leander
- Georgetown
- Cedar Park
- North Austin

Current next market event:

- August 6, 2026
- 5:00-8:30 PM
- Wolf Ranch River Camp
- 101 River Overlook Rd., Georgetown, TX 78626

## Weekly Human Review Questions

Each week, review:

- Is the next market date still correct?
- Should menu availability change?
- Should preorder language change?
- Should the newsletter CTA change?
- Should customers be asked for Google reviews?
- Which local connectors should be contacted this week?
- Are there any backend/payment changes needed?

## Release Rule

All production changes follow:

branch → validation → pull request → human review → merge to main → Cloudflare deploy
