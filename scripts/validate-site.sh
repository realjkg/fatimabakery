#!/bin/bash
set -e

echo "Running Fatima Bakery site validation..."

echo "Checking for forbidden secrets..."

SECRET_HITS="$(grep -RInE \
  --exclude-dir=.git \
  --exclude-dir=node_modules \
  --exclude='*.md' \
  --exclude='script.properties.example' \
  '(EAAA[a-zA-Z0-9_-]{20,}|sq0[a-zA-Z0-9_-]{20,}|Bearer[[:space:]]+[A-Za-z0-9._-]{20,})' \
  . || true)"

if [ -n "$SECRET_HITS" ]; then
  echo "$SECRET_HITS"
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
