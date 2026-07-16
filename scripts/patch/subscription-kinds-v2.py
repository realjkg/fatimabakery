#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
import time

CODE = Path("apps-script/Code.js")

if not CODE.exists():
    raise SystemExit("apps-script/Code.js not found. Run from repo root.")

backup = Path("/tmp") / f"Code.subscription-kinds-v2.{int(time.time())}.js"
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
    brace = text.find("{", start)
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


def find_object_assignment(text, name):
    match = re.search(
        rf"\bvar\s+{re.escape(name)}\s*=\s*\{{",
        text
    )

    if not match:
        raise RuntimeError(f"Object assignment not found: {name}")

    start = match.start()
    brace = text.find("{", match.start())
    depth = 0

    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                semicolon = text.find(";", index)
                return start, semicolon + 1

    raise RuntimeError(f"Unclosed object assignment: {name}")


def find_property_object(text, property_name):
    match = re.search(
        rf'(?:["\']?{re.escape(property_name)}["\']?)\s*:\s*\{{',
        text
    )

    if not match:
        raise RuntimeError(
            f"Object property not found: {property_name}"
        )

    brace = text.find("{", match.start())
    depth = 0

    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                return match.start(), index + 1

    raise RuntimeError(
        f"Unclosed object property: {property_name}"
    )


# Enforce the confirmed Specialty price table.
subscriptions_start, subscriptions_end = find_object_assignment(
    source,
    "SUBSCRIPTIONS"
)

subscriptions_block = source[
    subscriptions_start:subscriptions_end
]

specialty_start, specialty_end = find_property_object(
    subscriptions_block,
    "specialty"
)

specialty_block = subscriptions_block[
    specialty_start:specialty_end
]

confirmed_prices = {
    "4 weeks": 58,
    "6 weeks": 84,
    "8 weeks": 104
}

for tier, price in confirmed_prices.items():
    pattern = re.compile(
        rf'(["\']{re.escape(tier)}["\']\s*:\s*\{{'
        rf'[^}}]*?\bprice\s*:\s*)'
        rf'\d+(?:\.\d+)?',
        re.DOTALL
    )

    specialty_block, count = pattern.subn(
        rf'\g<1>{price}',
        specialty_block,
        count=1
    )

    if count != 1:
        raise RuntimeError(
            f"Could not set Specialty {tier} price."
        )

subscriptions_block = (
    subscriptions_block[:specialty_start]
    + specialty_block
    + subscriptions_block[specialty_end:]
)

source = (
    source[:subscriptions_start]
    + subscriptions_block
    + source[subscriptions_end:]
)


kind_normalizer = r'''
function normalizeSubscriptionKind_(data) {
  data = data || {};

  var raw = String(
    data.subscription_kind ||
    data.membership_kind ||
    data.kind ||
    ""
  ).toLowerCase().trim();

  raw = raw
    .replace(/[’']/g, "")
    .replace(/[\s-]+/g, "_");

  // Backward-compatible aliases normalize to one canonical value.
  if (
    raw === "classic" ||
    raw === "fatima" ||
    raw === "fatima_classic" ||
    raw === "classic_loaf"
  ) {
    return "classic";
  }

  if (
    raw === "specialty" ||
    raw === "special" ||
    raw === "specialty_loaf"
  ) {
    return "specialty";
  }

  if (
    raw === "bakers_choice" ||
    raw === "baker_choice" ||
    raw === "bakerschoice"
  ) {
    return "bakers_choice";
  }

  throw new Error(
    "Please choose Classic, Specialty, or Baker's Choice."
  );
}
'''


validator = r'''
function validateSubscriptionPlan_(data) {
  data = data || {};

  var tier = normalizeSubscriptionTier(data);
  var kind = normalizeSubscriptionKind_(data);

  /*
   * The existing internal Classic table is named "fatima".
   * Baker's Choice intentionally shares Specialty pricing.
   */
  var pricingKey = kind === "classic"
    ? "fatima"
    : "specialty";

  var kindTable = SUBSCRIPTIONS[pricingKey];
  var baseInfo = kindTable && kindTable[tier];

  if (!baseInfo || Number(baseInfo.price) <= 0) {
    throw new Error(
      "The selected Loaf Reserve plan is unavailable."
    );
  }

  if (
    kind === "classic" &&
    tier === "6 weeks" &&
    Number(baseInfo.price) !== 60
  ) {
    throw new Error(
      "Configuration error: the six-week Classic Loaf Reserve must be $60."
    );
  }

  var sharedPremiumPrices = {
    "4 weeks": 58,
    "6 weeks": 84,
    "8 weeks": 104
  };

  if (
    kind !== "classic" &&
    Number(baseInfo.price) !== sharedPremiumPrices[tier]
  ) {
    throw new Error(
      "Configuration error: Specialty and Baker's Choice pricing must be " +
      "$58, $84, and $104 for 4, 6, and 8 weeks."
    );
  }

  var descriptions = {
    classic: "Classic Loaf Reserve",
    specialty: "Specialty Loaf Reserve",
    bakers_choice: "Baker's Choice Loaf Reserve"
  };

  return {
    tier: tier,
    kind: kind,
    pricingKey: pricingKey,
    label: descriptions[kind],

    info: {
      price: Number(baseInfo.price),
      desc: descriptions[kind]
    }
  };
}
'''


if "function normalizeSubscriptionKind_(" in source:
    source = replace_function(
        source,
        "normalizeSubscriptionKind_",
        kind_normalizer
    )
else:
    _, tier_end = find_function(
        source,
        "normalizeSubscriptionTier"
    )

    source = (
        source[:tier_end]
        + "\n\n"
        + kind_normalizer.strip()
        + source[tier_end:]
    )


source = replace_function(
    source,
    "validateSubscriptionPlan_",
    validator
)


required = [
    "function normalizeSubscriptionKind_",
    'return "classic";',
    'return "specialty";',
    'return "bakers_choice";',
    '"4 weeks": 58',
    '"6 weeks": 84',
    '"8 weeks": 104',
    'pricingKey = kind === "classic"'
]

missing = [item for item in required if item not in source]

if missing:
    raise RuntimeError(
        "Required subscription-kind code missing: "
        + ", ".join(missing)
    )

CODE.write_text(source)

print("PASS: Classic, Specialty, and Baker's Choice are distinct.")
print("PASS: Specialty pricing is $58 / $84 / $104.")
print("PASS: Baker's Choice shares Specialty pricing.")
print(f"Backup: {backup}")
