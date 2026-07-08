#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

source "$SCRIPT_DIR/maintenance-config.sh"

REPORT_DIR="reports/weekly"
REPORT_FILE="$REPORT_DIR/latest.md"
TODAY=$(date -u +"%Y-%m-%d")

mkdir -p "$REPORT_DIR"

echo "# Fatima Bakery Weekly Maintenance Report" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Date: $TODAY" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "## Summary" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "This report was generated automatically from the Fatima Bakery GitHub repository." >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

echo "## Required Files" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for file in index.html order/index.html contact/index.html collection/index.html story/index.html privacy/index.html terms/index.html wrangler.jsonc; do
  if [ -f "$file" ]; then
    echo "- ✅ $file exists" >> "$REPORT_FILE"
  else
    echo "- ❌ $file is missing" >> "$REPORT_FILE"
  fi
done

echo "" >> "$REPORT_FILE"
echo "## Customer-Facing Wording" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if grep -R "$NEWSLETTER_CTA" "${CUSTOMER_HTML_PATHS[@]}" --include="*.html" >/dev/null; then
  echo "- ✅ Newsletter CTA found" >> "$REPORT_FILE"
else
  echo "- ❌ Newsletter CTA missing" >> "$REPORT_FILE"
fi

if grep -Rni "Pilgrim Reserve\|Piligrim" "${CUSTOMER_HTML_PATHS[@]}" --include="*.html" >/tmp/fatima-maintenance-old-terms.txt; then
  echo "- ❌ Old Reserve wording found in customer-facing HTML:" >> "$REPORT_FILE"
  echo '```' >> "$REPORT_FILE"
  cat /tmp/fatima-maintenance-old-terms.txt >> "$REPORT_FILE"
  echo '```' >> "$REPORT_FILE"
else
  echo "- ✅ No old Pilgrim Reserve wording found in customer-facing HTML" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "## Apps Script Endpoint" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if grep -R "$ENDPOINT" "${FORM_ENDPOINT_FILES[@]}" >/dev/null; then
  echo "- ✅ Current public Apps Script endpoint found" >> "$REPORT_FILE"
else
  echo "- ❌ Current public Apps Script endpoint not found where expected" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "## Local SEO Areas" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

for area in "${LOCAL_SEO_AREAS[@]}"; do
  if grep -R "$area" index.html order contact collection story --include="*.html" >/dev/null; then
    echo "- ✅ $area mentioned" >> "$REPORT_FILE"
  else
    echo "- ⚠️ $area not found in customer-facing HTML" >> "$REPORT_FILE"
  fi
done

echo "" >> "$REPORT_FILE"
echo "## Cloudflare / Wrangler" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"

if [ -f "wrangler.jsonc" ]; then
  echo "- ✅ wrangler.jsonc exists" >> "$REPORT_FILE"
else
  echo "- ❌ wrangler.jsonc missing" >> "$REPORT_FILE"
fi

if grep -q '"assets"' wrangler.jsonc 2>/dev/null; then
  echo "- ✅ Static assets config found" >> "$REPORT_FILE"
else
  echo "- ❌ Static assets config missing" >> "$REPORT_FILE"
fi

echo "" >> "$REPORT_FILE"
echo "## Human Decisions Needed" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- [ ] Is the next market date still accurate?" >> "$REPORT_FILE"
echo "- [ ] Should this week's preorder language change?" >> "$REPORT_FILE"
echo "- [ ] Should menu availability change?" >> "$REPORT_FILE"
echo "- [ ] Should customers be asked for Google reviews this week?" >> "$REPORT_FILE"
echo "- [ ] Should outreach begin or continue to local connectors?" >> "$REPORT_FILE"
echo "- [ ] Are any payment/backend changes needed?" >> "$REPORT_FILE"

echo "" >> "$REPORT_FILE"
echo "## Recommended Safe Next Actions" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "- Keep production unchanged unless a human approves a PR." >> "$REPORT_FILE"
echo "- Use a new branch for any site content update." >> "$REPORT_FILE"
echo "- Do not change Apps Script, Script Properties, payment links, or Square behavior from this workflow." >> "$REPORT_FILE"

echo "Weekly maintenance report created at $REPORT_FILE"
