#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

source "$SCRIPT_DIR/maintenance-config.sh"

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

echo "Checking emergency order routing..."
EXPECTED_ORDER_ENDPOINT="https://script.google.com/macros/s/AKfycby6ahtqJ1pe7sLVk4BgcU48WIn34P1P1giY5lxh8pmEABxpQX3m0wI96lIhnjreiDO-/exec"
grep -F "APPS_SCRIPT_URL = '$EXPECTED_ORDER_ENDPOINT'" order/index.html >/dev/null || {
  echo "Order page is not using the approved Apps Script endpoint."
  exit 1
}
if grep -F "ORDER_API_URL = '/api/order'" order/index.html >/dev/null; then
  echo "Order page still points at the undeployed /api/order route."
  exit 1
fi
grep -F "mode:   'no-cors'" order/index.html >/dev/null || {
  echo "Direct Apps Script recovery requires no-cors submission."
  exit 1
}

echo "Checking Loaf Reserve terminology in customer-facing HTML..."
if grep -Rni "Pilgrim Reserve\|Piligrim" \
  "${CUSTOMER_HTML_PATHS[@]}" \
  --include="*.html"; then
  echo "Old/confusing Reserve terminology found in customer-facing HTML."
  exit 1
fi

echo "Checking newsletter CTA in customer-facing HTML..."
grep -R "$NEWSLETTER_CTA" "${CUSTOMER_HTML_PATHS[@]}" --include="*.html" >/dev/null || {
  echo "Newsletter CTA not found in customer-facing HTML."
  exit 1
}



echo "Checking delivery and pickup schedule copy..."
if grep -Rni "within 5 miles\|within a 5 mile\|Delivery to the Santa Rita Ranch neighborhood\|delivery on Friday morning" \
  index.html order/index.html collection/index.html terms/index.html apps-script/Code.js docs \
  --include="*.html" --include="*.js" --include="*.md"; then
  echo "Outdated delivery or pickup schedule copy found."
  exit 1
fi

grep -F "Delivery is available Thursday only from 3 PM to 5 PM." order/index.html >/dev/null || {
  echo "Order page missing Thursday-only delivery validation message."
  exit 1
}

grep -F "Loaf Reserve pickup is available Friday only from 9 AM to 12 PM." apps-script/Code.js >/dev/null || {
  echo "Apps Script missing Friday-only Loaf Reserve validation."
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

echo "Checking local HTML href/src references..."
is_valid_local_path() {
  local target="$1"
  [ -f "$target" ] || [ -d "$target" ] || [ -f "$target/index.html" ] || [ -f "${target}.html" ]
}

broken_refs=0
for file in "${PAGE_HTML_FILES[@]}"; do
  while IFS= read -r ref; do
    ref="${ref%%#*}"
    ref="${ref%%\?*}"
    [ -z "$ref" ] && continue

    case "$ref" in
      http://*|https://*|mailto:*|tel:*|sms:*|javascript:*|data:*)
        continue
        ;;
    esac

    if [[ "$ref" == /* ]]; then
      target=".$ref"
    else
      target="$(dirname "$file")/$ref"
    fi

    if is_valid_local_path "$target"; then
      continue
    fi

    echo "Broken local reference in $file: $ref"
    broken_refs=1
  done < <(
    perl -nE 'while (/(?:href|src)\s*=\s*(?:"([^"]+)"|'\'\''([^'\'']+)'\''|([^>\s]+))/g) { say $1 // $2 // $3 }' "$file" \
      | sort -u
  )
done

if [ "$broken_refs" -ne 0 ]; then
  echo "Local HTML reference check failed."
  exit 1
fi

echo "Validation passed."
