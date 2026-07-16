#!/usr/bin/env bash
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

node --check apps-script/Code.js
node --check apps-script/SubscriptionOrchestrator.js
node --check apps-script/SubscriptionRetry.js
node --check apps-script/SubscriptionSandboxAdapters.js

node scripts/regression/subscription-contract.test.mjs
node scripts/regression/subscription-pricing.test.mjs
node scripts/regression/subscription-kinds.test.mjs
node scripts/regression/subscription-orchestrator.test.mjs
node scripts/regression/subscription-sandbox-e2e.test.mjs
node scripts/regression/subscription-retry.test.mjs

echo
echo "PASS: complete Loaf Reserve regression gate."
