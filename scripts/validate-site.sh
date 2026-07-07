#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

source "$SCRIPT_DIR/maintenance-config.sh"

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

echo "Checking required public Apps Script endpoint in form pages..."
for file in "${FORM_ENDPOINT_FILES[@]}"; do
  grep -F "$ENDPOINT" "$file" >/dev/null || {
    echo "Apps Script endpoint missing in $file."
    exit 1
  }
done

echo "Checking form pages do not contain mismatched Apps Script endpoints..."
mismatched_endpoints="$(grep -RhoE "https://script.google.com/macros/s/[A-Za-z0-9_-]+/exec" "${FORM_ENDPOINT_FILES[@]}" | sort -u | grep -Fvx "$ENDPOINT" || true)"
if [ -n "$mismatched_endpoints" ]; then
  echo "Unexpected Apps Script endpoint(s) found:"
  echo "$mismatched_endpoints"
  exit 1
fi

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
