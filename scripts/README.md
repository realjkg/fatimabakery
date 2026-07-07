
## Weekly Maintenance Agent

This repository includes a mostly automated weekly maintenance workflow.

The workflow checks:

- Customer-facing wording
- Loaf Reserve terminology
- Newsletter CTA
- Public Apps Script endpoint
- Local SEO area mentions
- Cloudflare Wrangler static assets config
- Obvious secret exposure

The workflow creates a weekly GitHub issue for human review.

Production changes still require human approval and merge to `main`.

Key files:

- `scripts/validate-site.sh`
- `scripts/create-maintenance-report.sh`
- `.github/workflows/validate.yml`
- `.github/workflows/weekly-maintenance.yml`
- `docs/WEEKLY_MAINTENANCE_AGENT.md`
- `docs/HUMAN_APPROVAL_POLICY.md`

To run locally:

```bash
./scripts/validate-site.sh
./scripts/create-maintenance-report.sh
cat reports/weekly/latest.md

## Weekly Maintenance Agent

This repository includes a mostly automated weekly maintenance workflow.

The workflow checks:

- Customer-facing wording
- Loaf Reserve terminology
- Newsletter CTA
- Public Apps Script endpoint
- Local SEO area mentions
- Cloudflare Wrangler static assets config
- Obvious secret exposure

The workflow creates a weekly GitHub issue for human review.

Production changes still require human approval and merge to `main`.

Key files:

- `scripts/validate-site.sh`
- `scripts/create-maintenance-report.sh`
- `.github/workflows/validate.yml`
- `.github/workflows/weekly-maintenance.yml`
- `docs/WEEKLY_MAINTENANCE_AGENT.md`
- `docs/HUMAN_APPROVAL_POLICY.md`

To run locally:

```bash
./scripts/validate-site.sh
./scripts/create-maintenance-report.sh
cat reports/weekly/latest.md

