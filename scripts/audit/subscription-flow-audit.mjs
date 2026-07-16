import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const file = path.join(repoRoot, "apps-script/Code.js");
const reportDir = path.join(repoRoot, "reports/audit");
const reportFile = path.join(reportDir, "subscription-flow-audit.md");

fs.mkdirSync(reportDir, { recursive: true });

const source = fs.readFileSync(file, "utf8");
const lines = source.split("\n");

const functionPattern = /^\s*function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/;
const functions = new Map();

for (let i = 0; i < lines.length; i++) {
  const match = lines[i].match(functionPattern);

  if (!match) continue;

  const name = match[1];
  const entry = {
    name,
    line: i + 1,
    args: match[2],
    occurrences: []
  };

  if (!functions.has(name)) functions.set(name, []);
  functions.get(name).push(entry);
}

const subscriptionTerms = [
  "handleSubscription",
  "sendSubscriptionEmail",
  "sendOwnerSubscriptionAlert",
  "resendSelectedSubscriptionNotice",
  "resendSubscriptionNoticeFromRow_",
  "createSquarePaymentLink",
  "createCashAppLink",
  "createVenmoLink",
  "SUBSCRIPTIONS",
  "subscription_kind",
  "subscription_loaf",
  "tier",
  "EMAIL_AUDIT_BCC",
  "failed_subscription",
  "BOULE_LIMIT",
  "SPECIALTY_LIMIT",
  "COMBINED_LIMIT",
  "ENFORCE_CAPACITY_LIMITS",
  "CAPACITY_LIMITS_ENABLED",
  "waitlist",
  "sold out",
  "capacity"
];

const matches = [];

for (let i = 0; i < lines.length; i++) {
  const lower = lines[i].toLowerCase();

  for (const term of subscriptionTerms) {
    if (lower.includes(term.toLowerCase())) {
      matches.push({
        line: i + 1,
        term,
        text: lines[i].trim()
      });
    }
  }
}

const duplicateFunctions = [...functions.entries()]
  .filter(([, definitions]) => definitions.length > 1)
  .map(([name, definitions]) => ({
    name,
    lines: definitions.map(d => d.line)
  }));

const conflictMarkers = lines
  .map((line, index) => ({ line: index + 1, text: line }))
  .filter(x =>
    /^<<<<<<<|^=======$|^>>>>>>>/.test(x.text)
  );

const suspectedLegacy = matches.filter(x =>
  /pilgrim|capacity|waitlist|sold.?out|audit_bcc|applycapacitydefaults|checkcapacityconfig/i.test(x.text)
);

let report = `# Subscription Flow Audit\n\n`;

report += `Source: ${file}\n\n`;
report += `Generated: ${new Date().toISOString()}\n\n`;

report += `## Syntax/conflict markers\n\n`;

if (conflictMarkers.length === 0) {
  report += `PASS: no Git conflict markers found.\n\n`;
} else {
  for (const marker of conflictMarkers) {
    report += `- Line ${marker.line}: ${marker.text}\n`;
  }
  report += `\n`;
}

report += `## Duplicate function definitions\n\n`;

if (duplicateFunctions.length === 0) {
  report += `PASS: no duplicate function names found.\n\n`;
} else {
  for (const duplicate of duplicateFunctions) {
    report += `- ${duplicate.name}: lines ${duplicate.lines.join(", ")}\n`;
  }
  report += `\n`;
}

report += `## Subscription-related function definitions\n\n`;

for (const [name, definitions] of functions.entries()) {
  if (/subscription|squarepayment|cashapp|venmo/i.test(name)) {
    for (const definition of definitions) {
      report += `- ${name}() — line ${definition.line}\n`;
    }
  }
}

report += `\n## Subscription-related references\n\n`;

for (const match of matches) {
  report += `- Line ${match.line} [${match.term}]: ${match.text}\n`;
}

report += `\n## Suspected legacy or conflicting logic\n\n`;

if (suspectedLegacy.length === 0) {
  report += `No obvious legacy references detected.\n`;
} else {
  for (const match of suspectedLegacy) {
    report += `- Line ${match.line}: ${match.text}\n`;
  }
}

fs.writeFileSync(reportFile, report);

console.log(report);
console.log("\nWrote " + reportFile);
