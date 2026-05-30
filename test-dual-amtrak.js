// Sprint 64 — TDD scaffold for the Dual-Direction BYOD Amtrak Engine.
// Proves the backend Pre-Merge correctly stamps `direction` onto each train
// AND defensively defaults `inboundTrains` / `outboundTrains` to `[]` when
// the frontend payload is malformed (one or both arrays missing/undefined).
//
// Run with: node test-dual-amtrak.js
// Must exit with 0 failures BEFORE any edit to route.js or page.js.

// --- The unit under test ---
// Mirrors the exact shape Sprint 64 will install in route.js. Body is the
// raw POST body; the helper returns the merged + stamped BYOD array the
// downstream loop will iterate.
function preMergeByod(body) {
  const { inboundTrains = [], outboundTrains = [] } = body || {};
  const safeInbound = Array.isArray(inboundTrains) ? inboundTrains : [];
  const safeOutbound = Array.isArray(outboundTrains) ? outboundTrains : [];
  return [
    ...safeInbound.map((t) => ({ ...t, direction: "inbound" })),
    ...safeOutbound.map((t) => ({ ...t, direction: "outbound" })),
  ];
}

// --- Mock fixtures ---
const mockInbound = [
  { trainNumber: "283", status: "On Time", time: "5:47 PM", arrivalTime: "5:47p" },
  { trainNumber: "285", status: "Almost Full", time: "7:12 PM", arrivalTime: "7:12p" },
];
const mockOutbound = [
  { trainNumber: "284", status: "Sold Out", time: "6:30 PM", arrivalTime: "6:30p" },
  { trainNumber: "286", status: "On Time", time: "8:05 PM", arrivalTime: "8:05p" },
];

// --- Assertion harness ---
const results = [];
function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}
function assertTrue(label, condition) {
  results.push({ label, pass: !!condition });
  console.log(`${condition ? "PASS" : "FAIL"} | ${label}`);
}

// === 1. Pre-merge stamps direction on individual objects ===

const merged = preMergeByod({
  inboundTrains: mockInbound,
  outboundTrains: mockOutbound,
});

assert("Merged length = inbound.length + outbound.length", merged.length, 4);

assert(
  "Inbound train #283 is stamped direction='inbound'",
  merged[0].direction,
  "inbound"
);
assert(
  "Inbound train #285 is stamped direction='inbound'",
  merged[1].direction,
  "inbound"
);
assert(
  "Outbound train #284 is stamped direction='outbound'",
  merged[2].direction,
  "outbound"
);
assert(
  "Outbound train #286 is stamped direction='outbound'",
  merged[3].direction,
  "outbound"
);

// Per-train fields survive the stamp (spread doesn't drop the original keys).
assert(
  "Inbound train #283 trainNumber preserved",
  merged[0].trainNumber,
  "283"
);
assert(
  "Inbound train #283 status preserved",
  merged[0].status,
  "On Time"
);
assert(
  "Outbound train #284 status preserved (Sold Out)",
  merged[2].status,
  "Sold Out"
);
assert(
  "Outbound train #284 time preserved",
  merged[2].time,
  "6:30 PM"
);

// Stamp must NOT mutate the source fixtures (immutability via spread).
assertTrue(
  "Original mockInbound[0] was not mutated with a direction key",
  mockInbound[0].direction === undefined
);
assertTrue(
  "Original mockOutbound[0] was not mutated with a direction key",
  mockOutbound[0].direction === undefined
);

// Order invariant: inbound entries come first, outbound entries after.
const inboundIdx = merged.findIndex((t) => t.direction === "inbound");
const outboundIdx = merged.findIndex((t) => t.direction === "outbound");
assertTrue(
  "Merge order: every inbound entry precedes every outbound entry",
  inboundIdx < outboundIdx
);

// === 2. Defensive defaulting prevents crashes on malformed payloads ===

// 2a. Both arrays missing entirely (e.g., frontend forgot to attach them).
let mergedMissingBoth;
let threwMissingBoth = false;
try {
  mergedMissingBoth = preMergeByod({});
} catch (e) {
  threwMissingBoth = true;
}
assertTrue("Empty body {} does not throw", !threwMissingBoth);
assert("Empty body {} → merged = []", mergedMissingBoth, []);

// 2b. Only inboundTrains supplied.
let mergedOnlyInbound;
let threwOnlyInbound = false;
try {
  mergedOnlyInbound = preMergeByod({ inboundTrains: mockInbound });
} catch (e) {
  threwOnlyInbound = true;
}
assertTrue("Missing outboundTrains does not throw", !threwOnlyInbound);
assert(
  "Missing outboundTrains → merged length = inbound length",
  mergedOnlyInbound.length,
  mockInbound.length
);
assert(
  "Missing outboundTrains → all merged entries stamped 'inbound'",
  mergedOnlyInbound.every((t) => t.direction === "inbound"),
  true
);

// 2c. Only outboundTrains supplied.
let mergedOnlyOutbound;
let threwOnlyOutbound = false;
try {
  mergedOnlyOutbound = preMergeByod({ outboundTrains: mockOutbound });
} catch (e) {
  threwOnlyOutbound = true;
}
assertTrue("Missing inboundTrains does not throw", !threwOnlyOutbound);
assert(
  "Missing inboundTrains → merged length = outbound length",
  mergedOnlyOutbound.length,
  mockOutbound.length
);
assert(
  "Missing inboundTrains → all merged entries stamped 'outbound'",
  mergedOnlyOutbound.every((t) => t.direction === "outbound"),
  true
);

// 2d. Body itself null / undefined.
let mergedNullBody;
let threwNullBody = false;
try {
  mergedNullBody = preMergeByod(null);
} catch (e) {
  threwNullBody = true;
}
assertTrue("null body does not throw", !threwNullBody);
assert("null body → merged = []", mergedNullBody, []);

// 2e. Both fields are non-array garbage (string / object / number).
let mergedGarbage;
let threwGarbage = false;
try {
  mergedGarbage = preMergeByod({ inboundTrains: "oops", outboundTrains: 42 });
} catch (e) {
  threwGarbage = true;
}
assertTrue("Non-array garbage does not throw", !threwGarbage);
assert("Non-array garbage → merged = []", mergedGarbage, []);

// 2f. Explicit undefined on both keys (the brief's exact scenario).
let mergedExplicitUndef;
let threwExplicitUndef = false;
try {
  mergedExplicitUndef = preMergeByod({
    inboundTrains: undefined,
    outboundTrains: undefined,
  });
} catch (e) {
  threwExplicitUndef = true;
}
assertTrue("Explicit undefined on both arrays does not throw", !threwExplicitUndef);
assert("Explicit undefined → merged = []", mergedExplicitUndef, []);

// === Summary ===
const failed = results.filter((r) => !r.pass);
console.log(`\n=== Sprint 64 dual-amtrak tests: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.label}`);
  process.exit(1);
}
