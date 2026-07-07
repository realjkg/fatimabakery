# Agent Release Checklist

Use this before every Fatima Bakery front-end release.

## Content

- [ ] CTA wording is correct.
- [ ] Event dates and addresses are current.
- [ ] Loaf Reserve terminology is consistent.
- [ ] No outdated Pilgrim Reserve wording remains.
- [ ] Local SEO wording is natural and useful.
- [ ] No promo text is stale.

## Forms

- [ ] Order form posts to the current Apps Script `/exec` endpoint.
- [ ] Contact form posts to the current Apps Script `/exec` endpoint.
- [ ] No secrets are present in HTML, JavaScript, docs, or config.

## Deployment

- [ ] `wrangler.jsonc` exists.
- [ ] `wrangler.jsonc` includes static assets config.
- [ ] Branch name is descriptive.
- [ ] README or build docs updated.
- [ ] Local validation passes.
- [ ] GitHub validation passes.
- [ ] Cloudflare build succeeds.
- [ ] Main is merged only after review.
