// Sprint 39 Phase 1 — TDD scaffold for the Amtrak Capacity Engine.
// Validates the Multiplier Merge strategy BEFORE touching route.js.
//
// Rule (locked by PO):
//   trainNum matches a "Sold Out" row in today's capacity list   → 2.0
//   trainNum matches an "Almost Full" row in today's list        → 1.5
//   trainNum missing from the list (or list empty/blank)         → 1.0
//
// trainNum comparison is string-equality on the trimmed values. Status
// match is case-insensitive so a CSV typed "sold out" / "SOLD OUT" still
// triggers. The live Amtraker API still owns arrival times; this multiplier
// only stacks ON TOP of the existing train surge score.

function computeCapacityMod(trainNum, todayCapacityList) {
  if (!trainNum || !Array.isArray(todayCapacityList)) return 1.0;
  const target = String(trainNum).trim();
  if (!target) return 1.0;

  const row = todayCapacityList.find(
    (r) => String(r?.trainNumber || "").trim() === target
  );
  if (!row) return 1.0;

  const status = String(row.status || "").trim().toLowerCase();
  if (status === "sold out") return 2.0;
  if (status === "almost full") return 1.5;
  return 1.0;
}

const todayCapacityList = [
  { trainNumber: "283", status: "Sold Out" },
  { trainNumber: "284", status: "Almost Full" },
];

const results = [];

function assert(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, actual, expected, pass });
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | actual=${actual} expected=${expected}`);
}

assert(
  'Train 283 (Sold Out) → 2.0x',
  computeCapacityMod("283", todayCapacityList),
  2.0
);

assert(
  'Train 284 (Almost Full) → 1.5x',
  computeCapacityMod("284", todayCapacityList),
  1.5
);

assert(
  'Train 285 (missing) → 1.0x',
  computeCapacityMod("285", todayCapacityList),
  1.0
);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
