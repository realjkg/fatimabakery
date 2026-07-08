# Fatima Bakery Build Updates

For future front-end updates, use this workflow:

1. Sync latest code from `main`.
2. Create a descriptive branch for the update.
3. Edit only required front-end files.
4. Review changes with `git status` and `git diff`.
5. Run local validation:
   - `./scripts/validate-site.sh`
   - `./scripts/create-maintenance-report.sh`
6. Open a pull request and merge only after human review.
7. Confirm Cloudflare deployment succeeds after merge.

Typical front-end files:

- `index.html`
- `order/index.html`
- `contact/index.html`
- `collection/index.html`
- `story/index.html`
- `privacy/index.html`
- `terms/index.html`
- `README.md`
- `wrangler.jsonc`
- `images/`

Do not include backend secrets in this repository.

Apps Script should be updated separately when changing backend behavior (order routing, confirmations, payment/webhook logic, sheet writes, spam filtering, backend keys).
