import fs from "node:fs";

const source = fs.readFileSync("apps-script/Code.js", "utf8");
const failures = [];

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const installers = [
  ...source.matchAll(
    /\bfunction\s+installSquareQueueTrigger\s*\([^)]*\)\s*\{/g
  )
];

assert(
  installers.length === 1,
  `Expected one installSquareQueueTrigger definition, found ${installers.length}.`
);

assert(
  /function\s+installSquareQueueTrigger\s*\([^)]*\)\s*\{[\s\S]*?ensureSquareQueueTrigger\s*\(\s*\)/.test(source),
  "installSquareQueueTrigger must delegate to ensureSquareQueueTrigger."
);

const minuteValues = [
  ...source.matchAll(/\.everyMinutes\(\s*(\d+)\s*\)/g)
].map(match => Number(match[1]));

const allowed = new Set([1, 5, 10, 15, 30]);
const invalid = minuteValues.filter(value => !allowed.has(value));

assert(
  invalid.length === 0,
  `Invalid everyMinutes values found: ${invalid.join(", ")}`
);

const queueCadences = [
  ...source.matchAll(
    /newTrigger\(\s*["']processSquareQueue["']\s*\)[\s\S]{0,140}?everyMinutes\(\s*(\d+)\s*\)/g
  )
].map(match => Number(match[1]));

assert(
  queueCadences.length === 2,
  `Expected two processSquareQueue trigger declarations, found ${queueCadences.length}.`
);

assert(
  queueCadences.every(value => value === 1),
  `Expected all processSquareQueue cadences to equal 1 minute; found ${queueCadences.join(", ")}.`
);

if (failures.length) {
  failures.forEach(message => console.log(`FAIL: ${message}`));
  console.log("");
  console.log(`${failures.length} failed.`);
  process.exit(1);
}

console.log("PASS: one Square queue installer definition.");
console.log("PASS: installer delegates to the idempotent helper.");
console.log("PASS: all everyMinutes values are supported.");
console.log("PASS: both Square queue declarations use one minute.");
console.log("");
console.log("4 passed, 0 failed.");
