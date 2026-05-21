// Sprint 30 Phase 1 — TDD scaffold for the UberXL / Leisure Hub Engine.
// Validates the Strict AND-gate logic BEFORE touching route.js.
//
// Rule (locked by PO):
//   departureIata in LEISURE_HUBS  AND  airlineIata in LEISURE_AIRLINES → 1.4
//   otherwise → 1.0

const LEISURE_HUBS = ["MCO", "LAS", "MIA", "CUN", "RSW", "OGG"];
const LEISURE_AIRLINES = ["NK", "F9", "B6", "WN", "SY"];

function computeLeisureMod(departureIata, airlineIata) {
  const hubMatch = LEISURE_HUBS.includes(departureIata);
  const airlineMatch = LEISURE_AIRLINES.includes(airlineIata);
  if (hubMatch && airlineMatch) return 1.4;
  return 1.0;
}

const results = [];

function assert(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, actual, expected, pass });
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | actual=${actual} expected=${expected}`);
}

assert(
  "MCO + NK (Hub + Airline match) → 1.4x",
  computeLeisureMod("MCO", "NK"),
  1.4
);

assert(
  "MCO + DL (Hub match, Airline miss) → 1.0x",
  computeLeisureMod("MCO", "DL"),
  1.0
);

assert(
  "JFK + NK (Airline match, Hub miss) → 1.0x",
  computeLeisureMod("JFK", "NK"),
  1.0
);

// Phase 3 — Integration verification of the multiplicative stack.
// Mirrors buildItinerary's surgeScore formula for flights:
//   volume * finalRideMod * fatigueMod * leisureMod
// PO mock: Spirit (NK) flight from MCO during a normal-hour bucket.
function surgeScoreFlight(volume, finalRideMod, fatigueMod, leisureMod) {
  return volume * finalRideMod * fatigueMod * leisureMod;
}

const volume = 1;
const finalRideMod = 1.0;
const fatigueMod = 1.0;
const leisureMod = computeLeisureMod("MCO", "NK");
const baselineScore = surgeScoreFlight(volume, finalRideMod, fatigueMod, 1.0);
const liftedScore = surgeScoreFlight(volume, finalRideMod, fatigueMod, leisureMod);

assert(
  "Stack: Spirit/MCO flight inflates surgeScore by exactly 1.4x",
  liftedScore / baselineScore,
  1.4
);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
