# Automated Apps Script deployments

The repository is the source of truth for the Fatima Bakery Apps Script backend. The `Deploy Apps Script` GitHub Actions workflow deploys `apps-script/**` after changes reach `main`, and it can also be started manually.

The workflow uses `@google/clasp@3.3.0`, updates the existing production deployment, preserves the public `/exec` URL, and verifies both the health endpoint and the unsigned order route.

## One-time setup

### 1. Confirm local clasp access

On the computer where manual deployments currently work:

```bash
clasp login
cd apps-script
clasp deployments
```

Confirm that the Google Apps Script API is enabled and identify the existing production deployment used by the public `/exec` URL.

Do not create a new deployment for this automation. Updating the existing deployment keeps integrations and the order form on the same URL.

### 2. Create the protected GitHub environment

In the repository, open **Settings → Environments** and create:

```text
apps-script-production
```

Recommended protection:

- Add yourself as the required reviewer.
- Restrict deployments to the `main` branch.
- Prevent administrators from bypassing the approval when that option is available.

The workflow will pause at this environment before it receives Google credentials or changes production.

### 3. Add environment secrets

Add these secrets to `apps-script-production`, not to repository files:

| Secret | Value |
| --- | --- |
| `CLASPRC_JSON` | Complete contents of the working `~/.clasprc.json` created by `clasp login` |
| `CLASP_JSON` | Complete contents of the working `apps-script/.clasp.json` |
| `APPS_SCRIPT_DEPLOYMENT_ID` | Existing production deployment ID shown by `clasp deployments` |
| `APPS_SCRIPT_WEBAPP_URL` | Existing public URL ending in `/exec` |

Both clasp JSON files are ignored by Git and must never be committed, pasted into a PR, or placed in Actions logs. Rotate `CLASPRC_JSON` if the Google authorization is revoked or the workflow reports an authentication failure.

## Deployment behavior

Automatic deployment runs only when files under `apps-script/**` reach `main`. Documentation-only, frontend-only, and workflow-only merges do not deploy Apps Script.

A manual recovery deployment is available from **Actions → Deploy Apps Script → Run workflow**.

Every deployment performs these steps:

1. Validate the website and parse `apps-script/Code.js`.
2. Recreate clasp configuration from protected environment secrets.
3. Install the pinned clasp CLI.
4. Run `clasp push --force`.
5. Update the existing deployment with `clasp update-deployment`.
6. Verify the public health endpoint.
7. Send a honeypot order payload that must return `ignored` without creating an order or sending payment messages.
8. Remove temporary credentials from the runner.

Only one production deployment can run at a time.

## Current order-signing compatibility

The current emergency order form submits directly to Apps Script. Therefore, the Apps Script property `APPS_SCRIPT_SIGNING_SECRET` must be unset until the Cloudflare signing Worker is implemented and the form is routed back through it.

The deployment smoke test intentionally uses an unsigned honeypot order. If signing-only mode is configured while the browser still posts directly, the workflow fails instead of allowing customers to see false success messages.

Do not weaken or bypass this check. Implement and test the Worker signing route before enabling `APPS_SCRIPT_SIGNING_SECRET`.

## Codex workflow

Codex may:

- update `apps-script/**`
- run repository validations
- open a pull request
- review deployment failures and prepare fixes

Codex must not place Google credentials in code, comments, artifacts, or logs. Production deployment happens through the protected GitHub environment after a human merges and approves it.

## Recovery

If deployment fails:

- **Missing secret:** add the named secret to `apps-script-production`.
- **Authentication error:** run `clasp login` locally and replace `CLASPRC_JSON`.
- **Wrong project:** replace `CLASP_JSON` with the known working local file.
- **Wrong deployment:** confirm `APPS_SCRIPT_DEPLOYMENT_ID` with `clasp deployments`.
- **Health check failure:** confirm `APPS_SCRIPT_WEBAPP_URL` and that the deployment remains accessible to anonymous users.
- **Unsigned smoke test failure:** verify `APPS_SCRIPT_SIGNING_SECRET` is not enabled while the frontend uses direct Apps Script submission.

A failed workflow does not change the Cloudflare frontend deployment. Correct the configuration or code, then use the manual recovery deployment.
