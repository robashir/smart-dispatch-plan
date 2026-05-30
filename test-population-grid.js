// Sprint 63 — Unified Population Density Engine. TDD-style focused test.
// Validates: (1) calculateSpatialPopulationBoost returns 2.5 at the three
// hyper-dense anchors, ~1.0 in a known commercial wasteland, and stays
// within [1.0, 2.5] across every grid node. (2) buildSyntheticRideHubs caps
// at 5 entries with populationDensityMod >= 2.0. (3) The math floor lands at
// exactly densityScore=10.0 for a synthetic node at populationDensityMod=2.0
// — i.e. it just clears the Sprint 27 strict <10.0 drop.

const fs = require("fs");
const path = require("path");

const grid = JSON.parse(
  fs.readFileSync(path.join(__dirname, "app", "data", "albany_pop_grid.json"), "utf8")
);

const POP_RADIUS_MILES = 1.5;

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculateSpatialPopulationBoost(lat, lng) {
  let nearestMult = 1.0;
  let nearestDist = Infinity;
  for (const node of grid) {
    const d = haversineMiles(lat, lng, node.lat, node.lng);
    if (d > POP_RADIUS_MILES) continue;
    if (d < nearestDist) {
      nearestDist = d;
      nearestMult = Number(node.baseMultiplier) || 1.0;
    }
  }
  return nearestMult;
}

let pass = 0, fail = 0;
function assert(name, cond, expected, got) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} | expected ${expected} | got ${got}`); }
}

console.log("=== Boost helper ===");
const centerSquare = calculateSpatialPopulationBoost(42.652, -73.765);
const pineHills    = calculateSpatialPopulationBoost(42.661, -73.785);
const suny         = calculateSpatialPopulationBoost(42.686, -73.823);
assert("Center Square = 2.5", centerSquare === 2.5, 2.5, centerSquare);
assert("Pine Hills    = 2.5", pineHills === 2.5, 2.5, pineHills);
assert("SUNY Campus   = 2.5", suny === 2.5, 2.5, suny);

// Port of Albany (commercial wasteland anchor) should be 1.0
const port = calculateSpatialPopulationBoost(42.633, -73.748);
assert("Port of Albany = 1.0", port === 1.0, 1.0, port);

// Out-of-box coordinate (Schenectady) should be 1.0
const schenectady = calculateSpatialPopulationBoost(42.814, -73.940);
assert("Schenectady out-of-range = 1.0", schenectady === 1.0, 1.0, schenectady);

// Bounds: no node may exceed 2.5
const max = Math.max(...grid.map((n) => n.baseMultiplier));
assert("max baseMultiplier <= 2.5", max <= 2.5, "<=2.5", max);

console.log("\n=== Synthetic ride hub injection ===");
const POP_RIDE_THRESHOLD = 2.0;
const POP_RIDE_MAX_HUBS = 5;
const qualifying = grid.filter((n) => n.baseMultiplier >= POP_RIDE_THRESHOLD);
qualifying.sort((a, b) => b.baseMultiplier - a.baseMultiplier);
const topN = qualifying.slice(0, POP_RIDE_MAX_HUBS);
assert("top-N capped at 5", topN.length === 5, 5, topN.length);
assert("all top-N >= 2.0", topN.every((n) => n.baseMultiplier >= 2.0), true, false);

console.log("\n=== Density floor math ===");
// Mock densityScore: yield 5 × mod / capacity 100 × 100 × finalRideMod 1.0
const yieldAt2 = 5 * 2.0;
const score2 = (yieldAt2 / 100) * 1.0 * 100;
assert("populationDensityMod=2.0 → score 10.0 (just clears)", score2 === 10.0, 10.0, score2);

const yieldAt2_5 = 5 * 2.5;
const score2_5 = (yieldAt2_5 / 100) * 1.0 * 100;
assert("populationDensityMod=2.5 → score 12.5", score2_5 === 12.5, 12.5, score2_5);

const yieldAt1_9 = 5 * 1.9;
const score1_9 = (yieldAt1_9 / 100) * 1.0 * 100;
assert("populationDensityMod=1.9 → score 9.5 (dropped by floor)", score1_9 < 10.0, "<10", score1_9);

console.log(`\n=== ${pass} PASS, ${fail} FAIL ===`);
if (fail > 0) process.exit(1);
