#!/bin/bash
set -e

echo "Running Fatima Bakery site validation..."

echo "Checking for forbidden secrets..."
if grep -RniE "SQUARE_ACCESS_TOKEN|SQUARE_WEBHOOK_SIGNATURE_KEY|sk_live|EAAA|client_secret|password|api_key|private_key" . \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude="*.md" \
  --exclude="validate-site.sh" \
  --exclude="validate.yml"; then
  echo "Potential secret found. Stop and review."
  exit 1
fi

echo "Checking required public Apps Script endpoint..."
grep -R "https://script.google.com/macros/s/AKfycby6ahtqJ1pe7sLVk4BgcU48WIn34P1P1giY5lxh8pmEABxpQX3m0wI96lIhnjreiDO-/exec" order contact index.html >/dev/null || {
  echo "Apps Script endpoint not found where expected."
  exit 1
}

echo "Checking Loaf Reserve terminology in customer-facing HTML..."
if grep -Rni "Pilgrim Reserve\|Piligrim" \
  index.html \
  order \
  contact \
  collection \
  story \
  privacy \
  terms \
  --include="*.html"; then
  echo "Old/confusing Reserve terminology found in customer-facing HTML."
  exit 1
fi

echo "Checking newsletter CTA..."
grep -R "Join the Fatima Bakery newsletter list" \
  index.html \
  order \
  contact \
  collection \
  story \
  privacy \
  terms \
  --include="*.html" >/dev/null || {
  echo "Newsletter CTA not found."
  exit 1
}

echo "Checking Wrangler config exists..."
test -f wrangler.jsonc || {
  echo "Missing wrangler.jsonc."
  exit 1
}

echo "Checking Wrangler config shape..."
grep -q '"name": "fatima-bakery"' wrangler.jsonc || {
  echo "wrangler.jsonc missing name."
  exit 1
}

grep -q '"assets"' wrangler.jsonc || {
  echo "wrangler.jsonc missing assets config."
  exit 1
}

echo "Validation passed."
