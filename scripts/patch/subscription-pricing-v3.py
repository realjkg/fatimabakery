#!/usr/bin/env python3

from pathlib import Path
import re
import shutil
import time

CODE = Path("apps-script/Code.js")

if not CODE.exists():
    raise SystemExit("Run this command from the fatimabakery repository root.")

backup = Path("/tmp") / f"Code.subscription-pricing-v3.{int(time.time())}.js"
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
        raise RuntimeError(f"Object not found: {name}")

    start = match.start()
    brace = text.find("{", start)
    depth = 0

    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                semicolon = text.find(";", index)
                return start, semicolon + 1

    raise RuntimeError(f"Unclosed object: {name}")


def find_property_object(text, property_name):
    match = re.search(
        rf'(?:"{re.escape(property_name)}"|'
        rf"'{re.escape(property_name)}'|"
        rf"\b{re.escape(property_name)}\b)\s*:\s*\{{",
        text
    )

    if not match:
        raise RuntimeError(f"Property object not found: {property_name}")

    brace = text.find("{", match.start())
    depth = 0

    for index in range(brace, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1

            if depth == 0:
                return match.start(), index + 1

    raise RuntimeError(f"Unclosed property object: {property_name}")


def update_prices(block, prices, label):
    for tier, price in prices.items():
        pattern = re.compile(
            rf'(["\']{re.escape(tier)}["\']\s*:\s*\{{'
            rf'[^}}]*?\bprice\s*:\s*)'
            rf'\d+(?:\.\d+)?',
            re.DOTALL
        )

        block, count = pattern.subn(
            rf"\g<1>{price}",
            block,
            count=1
        )

        if count != 1:
            raise RuntimeError(
                f"Could not update {label} {tier} to ${price}."
            )

    return block


classic_prices = {
    "4 weeks": 44,
    "6 weeks": 60,
    "8 weeks": 72
}

premium_prices = {
    "4 weeks": 58,
    "6 weeks": 84,
    "8 weeks": 104
}


subscriptions_start, subscriptions_end = find_object_assignment(
    source,
    "SUBSCRIPTIONS"
)

subscriptions = source[subscriptions_start:subscriptions_end]

fatima_start, fatima_end = find_property_object(
    subscriptions,
    "fatima"
)

fatima_block = subscriptions[fatima_start:fatima_end]
fatima_block = update_prices(
    fatima_block,
    classic_prices,
    "Fatima Classic"
)

subscriptions = (
    subscriptions[:fatima_start]
    + fatima_block
    + subscriptions[fatima_end:]
)

specialty_start, specialty_end = find_property_object(
    subscriptions,
    "specialty"
)

specialty_block = subscriptions[specialty_start:specialty_end]
specialty_block = update_prices(
    specialty_block,
    premium_prices,
    "Specialty"
)

subscriptions = (
    subscriptions[:specialty_start]
    + specialty_block
    + subscriptions[specialty_end:]
)

source = (
    source[:subscriptions_start]
    + subscriptions
    + source[subscriptions_end:]
)


validator = r'''
function validateSubscriptionPlan_(data) {
  data = data || {};

  var tier = normalizeSubscriptionTier(data);
  var kind = normalizeSubscriptionKind_(data);

  /*
   * The legacy internal key "fatima" represents Fatima Classic.
   * Baker's Choice remains distinct but shares Specialty pricing.
   */
  var pricingKey = kind === "classic"
    ? "fatima"
    : "specialty";

  var kindTable = SUBSCRIPTIONS[pricingKey];
  var baseInfo = kindTable && kindTable[tier];

  if (!baseInfo) {
    throw new Error(
      "The selected Loaf Reserve plan is unavailable."
    );
  }

  var expectedPrices = {
    classic: {
      "4 weeks": 44,
      "6 weeks": 60,
      "8 weeks": 72
    },

    specialty: {
      "4 weeks": 58,
      "6 weeks": 84,
      "8 weeks": 104
    },

    bakers_choice: {
      "4 weeks": 58,
      "6 weeks": 84,
      "8 weeks": 104
    }
  };

  var expectedPrice =
    expectedPrices[kind] &&
    expectedPrices[kind][tier];

  if (
    expectedPrice === undefined ||
    Number(baseInfo.price) !== expectedPrice
  ) {
    throw new Error(
      "Loaf Reserve pricing configuration error for " +
      kind +
      " / " +
      tier +
      "."
    );
  }

  var labels = {
    classic: "Fatima Classic Loaf Reserve",
    specialty: "Specialty Loaf Reserve",
    bakers_choice: "Baker's Choice Loaf Reserve"
  };

  return {
    tier: tier,
    kind: kind,
    pricingKey: pricingKey,
    label: labels[kind],

    info: {
      price: expectedPrice,
      desc: labels[kind]
    }
  };
}
'''

if "function normalizeSubscriptionKind_(" not in source:
    raise RuntimeError(
        "normalizeSubscriptionKind_ is missing. "
        "Apply the three-kind contract patch before pricing v3."
    )

source = replace_function(
    source,
    "validateSubscriptionPlan_",
    validator
)

CODE.write_text(source)

print("PASS: Fatima Classic pricing is $44 / $60 / $72.")
print("PASS: Specialty pricing is $58 / $84 / $104.")
print("PASS: Baker's Choice shares Specialty pricing.")
print(f"Backup: {backup}")
