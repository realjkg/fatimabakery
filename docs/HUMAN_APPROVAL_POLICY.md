# Fatima Bakery Human Approval Policy

## Purpose

This policy defines which actions can be automated and which actions require human approval.

## Allowed Without Human Approval

The weekly maintenance workflow may:

- Run validation
- Generate reports
- Upload artifacts
- Create GitHub issues
- Flag stale content
- Flag missing local SEO wording
- Flag old terminology
- Flag missing deployment config

## Requires Human Approval

The following require explicit human approval:

- Merge to `main`
- Production deployment approval
- Payment link changes
- Apps Script endpoint changes
- Apps Script backend changes
- Google Script Properties changes
- Square configuration changes
- Customer email sending
- Newsletter sends
- Review requests sent to customers
- Deleting branches
- Deleting Cloudflare deployments
- Any customer/order data handling

## Production Rule

No automation may merge to `main`.

Production changes must be reviewed and merged by the owner.
