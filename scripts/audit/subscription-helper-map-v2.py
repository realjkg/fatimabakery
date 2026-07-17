#!/usr/bin/env python3

from pathlib import Path
from collections import defaultdict
import re

CODE = Path("apps-script/Code.js")
REPORT = Path(
    "reports/audit/subscription-production-helper-map-v2.md"
)

source = CODE.read_text()

function_pattern = re.compile(
    r"\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)"
    r"\s*\([^)]*\)\s*\{"
)


def find_function_end(text, opening_brace):
    depth = 0

    for index in range(opening_brace, len(text)):
        char = text[index]

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1

            if depth == 0:
                return index + 1

    raise RuntimeError(
        f"Unclosed function beginning near character {opening_brace}"
    )


definitions = []

for match in function_pattern.finditer(source):
    name = match.group(1)
    opening_brace = source.find("{", match.start())
    end = find_function_end(source, opening_brace)
    line = source.count("\n", 0, match.start()) + 1

    definitions.append({
        "name": name,
        "line": line,
        "start": match.start(),
        "end": end,
        "body": source[opening_brace + 1:end - 1]
    })


by_name = defaultdict(list)

for definition in definitions:
    by_name[definition["name"]].append(definition)

# With repeated top-level declarations, the later definition is the
# effective one. Preserve every definition in the duplicate report.
active = {
    name: items[-1]
    for name, items in by_name.items()
}


non_code_pattern = re.compile(
    r"""
      //[^\n]*
    | /\*.*?\*/
    | "(?:\\.|[^"\\])*"
    | '(?:\\.|[^'\\])*'
    | `(?:\\.|[^`\\])*`
    """,
    re.DOTALL | re.VERBOSE
)


def mask_non_code(text):
    def replacement(match):
        return "".join(
            "\n" if char == "\n" else " "
            for char in match.group(0)
        )

    return non_code_pattern.sub(replacement, text)


call_pattern = re.compile(
    r"\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\("
)


def local_calls(definition):
    cleaned = mask_non_code(definition["body"])
    discovered = set(call_pattern.findall(cleaned))

    return sorted(
        name
        for name in discovered
        if name in active
    )


def infrastructure(body):
    checks = [
        ("Subscriptions sheet",
         r'getSheetByName\s*\(\s*["\']Subscriptions["\']'),
        ("SpreadsheetApp", r"\bSpreadsheetApp\b"),
        ("Append row", r"\bappendRow\s*\("),
        ("MailApp", r"\bMailApp\b"),
        ("Tracked email", r"\bsendTrackedEmail\s*\("),
        ("UrlFetchApp", r"\bUrlFetchApp\b"),
        ("PropertiesService", r"\bPropertiesService\b"),
        ("Square", r"squareup|SQUARE_|createSquare"),
        ("Venmo", r"\bvenmo\b|createVenmo"),
        ("Cash App", r"\bcash\s*app\b|cashapp|createCashApp"),
        ("Retry/queue", r"\bretry\b|\bqueue\b|failed_.*email")
    ]

    found = []

    for label, pattern in checks:
        if re.search(pattern, body, re.IGNORECASE):
            found.append(label)

    return found


if "handleSubscription" not in active:
    raise SystemExit("handleSubscription() was not found.")


direct_calls = local_calls(active["handleSubscription"])

focused_names = {
    "handleSubscription",
    "normalizeSubscriptionTier",
    "normalizeSubscriptionKind_",
    "validateSubscriptionPlan_",
    "createSquarePaymentLink",
    "createVenmoLink",
    "createCashAppLink",
    "sendSubscriptionEmail",
    "sendOwnerSubscriptionAlert",
    "sendSubscriptionActiveEmail",
    "updateSubscriptionStatus",
    "recordSubscriptionEmailFailure_",
    "resendSelectedSubscriptionNotice",
    "resendSubscriptionNoticeFromRow_",
    "subscriptionRenewalAgent",
    "processSquareQueue",
    "squareResolveOrderId",
    "sendTrackedEmail",
    "jsonResponse",
    "formatPhone_"
}

focused_names.update(direct_calls)

for name in list(direct_calls):
    focused_names.update(local_calls(active[name]))

focused_names = {
    name for name in focused_names
    if name in active
}


report = [
    "# Loaf Reserve production helper map — v2",
    "",
    "## Duplicate function definitions",
    ""
]

duplicates = {
    name: items
    for name, items in by_name.items()
    if len(items) > 1
}

if not duplicates:
    report.append("No duplicate function definitions detected.")
else:
    for name in sorted(duplicates):
        lines = [
            str(item["line"])
            for item in duplicates[name]
        ]

        report.append(
            f"- `{name}()` is defined {len(lines)} times "
            f"at lines {', '.join(lines)}. "
            f"The last definition is at line {lines[-1]}."
        )


report.extend([
    "",
    "## Clean direct calls from active handleSubscription",
    ""
])

for name in direct_calls:
    report.append(
        f"- line {active[name]['line']}: `{name}()`"
    )


report.extend([
    "",
    "## Focused production helpers",
    "",
    "| Line | Definitions | Function | Infrastructure |",
    "|---:|---:|---|---|"
])

for name in sorted(
    focused_names,
    key=lambda item: active[item]["line"]
):
    definition = active[name]
    infra = infrastructure(definition["body"])

    report.append(
        f"| {definition['line']} | {len(by_name[name])} | "
        f"`{name}()` | "
        f"{', '.join(infra) if infra else 'none detected'} |"
    )


report.extend([
    "",
    "## Clean local call relationships",
    ""
])

for name in sorted(
    focused_names,
    key=lambda item: active[item]["line"]
):
    calls = [
        call for call in local_calls(active[name])
        if call in focused_names
    ]

    if calls:
        report.append(
            f"- `{name}()` → " +
            ", ".join(f"`{call}()`" for call in calls)
        )


REPORT.parent.mkdir(parents=True, exist_ok=True)
REPORT.write_text("\n".join(report) + "\n")

print(f"Wrote {REPORT}")
