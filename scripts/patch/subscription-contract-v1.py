#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
import time

CODE = Path("apps-script/Code.js")

if not CODE.exists():
    raise SystemExit("apps-script/Code.js not found. Run from repo root.")

backup = Path("/tmp") / f"Code.subscription-contract-v1.{int(time.time())}.js"
shutil.copy2(CODE, backup)

source = CODE.read_text()


def find_function(text, name):
    match = re.search(
        rf"\bfunction\s+{re.escape(name)}\s*\([^)]*\)\s*\{{",
        text
    )

    if not match:
        raise RuntimeError(f"Function not found: {name}")

    start = match.start()
    brace = text.find("{", match.start())
    depth = 0

    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                return start, index + 1

    raise RuntimeError(f"Unclosed function: {name}")


def replace_function(text, name, replacement):
    start, end = find_function(text, name)
    return text[:start] + replacement.strip() + text[end:]


strict_normalizer = r'''
function normalizeSubscriptionTier(data) {
  data = data || {};

  // Only explicit plan fields may select a billing tier.
  // Never infer price from notes, dates, phone numbers, or order text.
  var candidates = [
    data.subscription_tier,
    data.membership_tier,
    data.tier,
    data.plan,
    data.duration
  ];

  for (var i = 0; i < candidates.length; i++) {
    var raw = String(candidates[i] || "").toLowerCase().trim();
    if (!raw) continue;

    var match = raw.match(/^(?:plan\s*)?(4|6|8)(?:\s*[- ]?\s*weeks?)?$/);

    if (match) {
      return match[1] + " weeks";
    }
  }

  throw new Error(
    "Please choose a valid Loaf Reserve plan: 4, 6, or 8 weeks."
  );
}
'''

source = replace_function(
    source,
    "normalizeSubscriptionTier",
    strict_normalizer
)

validator = r'''

function validateSubscriptionPlan_(data) {
  data = data || {};

  var tier = normalizeSubscriptionTier(data);

  var kindText = [
    data.subscription_kind,
    data.membership_kind,
    data.kind,
    data.subscription_loaf,
    data.membership_loaf,
    data.loaf
  ].join(" ").toLowerCase();

  var kind = kindText.indexOf("special") > -1
    ? "specialty"
    : "fatima";

  var kindTable = SUBSCRIPTIONS[kind];
  var subInfo = kindTable && kindTable[tier];

  if (!subInfo || Number(subInfo.price) <= 0) {
    throw new Error(
      "The selected Loaf Reserve plan is unavailable."
    );
  }

  // Advertised Classic Loaf Reserve contract.
  if (
    kind === "fatima" &&
    tier === "6 weeks" &&
    Number(subInfo.price) !== 60
  ) {
    throw new Error(
      "Configuration error: the six-week Classic Loaf Reserve must be $60."
    );
  }

  return {
    tier: tier,
    kind: kind,
    info: subInfo
  };
}
'''

if "function validateSubscriptionPlan_(" not in source:
    normalizer_start, normalizer_end = find_function(
        source,
        "normalizeSubscriptionTier"
    )

    source = (
        source[:normalizer_end]
        + validator
        + source[normalizer_end:]
    )


handler_start, handler_end = find_function(source, "handleSubscription")
handler = source[handler_start:handler_end]

if "var plan = validateSubscriptionPlan_(data);" not in handler:
    old_plan_pattern = re.compile(
        r'''
        \s*var\s+tier\s*=\s*normalizeSubscriptionTier\(data\);\s*
        .*?
        var\s+subInfo\s*=\s*kindTable\[tier\]\s*\|\|\s*
        \{\s*price:\s*0,\s*desc:\s*""\s*\};
        ''',
        re.DOTALL | re.VERBOSE
    )

    replacement = '''
  var plan = validateSubscriptionPlan_(data);
  var tier = plan.tier;
  var kind = plan.kind;
  var subInfo = plan.info;'''

    updated_handler, count = old_plan_pattern.subn(
        replacement,
        handler,
        count=1
    )

    if count != 1:
        raise RuntimeError(
            "Could not isolate the existing plan-selection block. "
            f"Backup preserved at {backup}"
        )

    source = (
        source[:handler_start]
        + updated_handler
        + source[handler_end:]
    )


# Static safety assertions.
final_handler_start, final_handler_end = find_function(
    source,
    "handleSubscription"
)
final_handler = source[final_handler_start:final_handler_end]

required = [
    "function validateSubscriptionPlan_",
    "var plan = validateSubscriptionPlan_(data);",
    'tier === "6 weeks"',
    "Number(subInfo.price) !== 60"
]

missing = [item for item in required if item not in source]

if missing:
    raise RuntimeError("Missing required code: " + ", ".join(missing))

for forbidden in [
    "BOULE_LIMIT",
    "SPECIALTY_LIMIT",
    "COMBINED_LIMIT",
    "ENFORCE_CAPACITY_LIMITS",
    "waitlist",
    "soldOut"
]:
    if forbidden in final_handler:
        raise RuntimeError(
            f"Subscription handler contains forbidden capacity logic: {forbidden}"
        )

CODE.write_text(source)

print("PASS: strict subscription contract installed.")
print("PASS: six-week Classic plan is required to equal $60.")
print("PASS: handleSubscription contains no capacity guard.")
print(f"Backup: {backup}")
