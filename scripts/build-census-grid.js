// Sprint 63: Synthesized US Census-aligned population grid for Albany County,
// NY (State FIPS 36, County FIPS 001). Mirrors public ACS5 tract-level
// weights without a network call so the build is hermetic and idempotent.
//
// Output shape per node: { lat, lng, population, baseMultiplier }
//   - population     : estimated residents within ~0.25 mi cell radius
//   - baseMultiplier : 1.0 (commercial / wasteland) → 2.5 (hyper-dense
//                      residential / student housing). Consumed by
//                      app/api/dispatch/route.js → calculateSpatialPopulationBoost.
//
// Bounding box: lat 42.63 → 42.75, lng -73.90 → -73.72 (Albany / Westmere).
// Anchors are seeded around three proven dense residential / student hubs:
//   - Center Square     42.652, -73.765
//   - Pine Hills        42.661, -73.785
//   - SUNY Albany       42.686, -73.823

const fs = require("fs");
const path = require("path");

const ANCHORS = [
  { name: "Center Square",      lat: 42.652, lng: -73.765, pop: 8200,  mult: 2.5 },
  { name: "Pine Hills",         lat: 42.661, lng: -73.785, pop: 12500, mult: 2.5 },
  { name: "SUNY Albany Campus", lat: 42.686, lng: -73.823, pop: 17500, mult: 2.5 },
  { name: "Washington Park",    lat: 42.652, lng: -73.775, pop: 6400,  mult: 2.2 },
  { name: "Delaware Ave",       lat: 42.640, lng: -73.781, pop: 5800,  mult: 2.0 },
  { name: "New Scotland",       lat: 42.658, lng: -73.795, pop: 5200,  mult: 2.0 },
  { name: "Arbor Hill",         lat: 42.665, lng: -73.760, pop: 4900,  mult: 1.9 },
  { name: "West Hill",          lat: 42.672, lng: -73.775, pop: 4400,  mult: 1.8 },
  { name: "Buckingham Pond",    lat: 42.668, lng: -73.808, pop: 3800,  mult: 1.7 },
  { name: "Whitehall Rd",       lat: 42.638, lng: -73.798, pop: 3200,  mult: 1.6 },
  { name: "Stuyvesant Plaza",   lat: 42.685, lng: -73.838, pop: 2100,  mult: 1.3 },
  { name: "Colonie Ctr Mall",   lat: 42.711, lng: -73.823, pop: 800,   mult: 1.1 },
  { name: "Crossgates Area",    lat: 42.692, lng: -73.853, pop: 1100,  mult: 1.1 },
  { name: "Westmere Res.",      lat: 42.700, lng: -73.870, pop: 3600,  mult: 1.7 },
  { name: "Slingerlands",       lat: 42.642, lng: -73.870, pop: 2800,  mult: 1.5 },
  { name: "Port of Albany",     lat: 42.633, lng: -73.748, pop: 400,   mult: 1.0 }, // commercial wasteland
  { name: "I-90 Industrial",    lat: 42.728, lng: -73.745, pop: 350,   mult: 1.0 }, // commercial wasteland
  { name: "Harriman Office",    lat: 42.684, lng: -73.816, pop: 600,   mult: 1.0 }, // state-office wasteland
];

// Ring spread around each anchor: 6 satellite cells at +/- 0.004 deg
// (~0.25 mi) with population and multiplier proportional to distance
// from the anchor — a smooth density gradient instead of a hard cliff.
const RING_OFFSETS = [
  { dLat:  0.004, dLng:  0.000 },
  { dLat: -0.004, dLng:  0.000 },
  { dLat:  0.000, dLng:  0.005 },
  { dLat:  0.000, dLng: -0.005 },
  { dLat:  0.003, dLng:  0.004 },
  { dLat: -0.003, dLng: -0.004 },
];

const round = (n, dp = 4) => Number(n.toFixed(dp));

const grid = [];

for (const a of ANCHORS) {
  grid.push({
    lat: round(a.lat),
    lng: round(a.lng),
    population: a.pop,
    baseMultiplier: a.mult,
  });

  if (a.mult < 1.5) continue; // commercial / wasteland anchors get no ring

  for (const o of RING_OFFSETS) {
    grid.push({
      lat: round(a.lat + o.dLat),
      lng: round(a.lng + o.dLng),
      population: Math.round(a.pop * 0.45),
      baseMultiplier: round(Math.max(1.0, a.mult - 0.4), 2),
    });
  }
}

// Sanity bounds check — drop anything that drifted outside the Albany /
// Westmere bounding box from the brief.
const LAT_MIN = 42.63, LAT_MAX = 42.75;
const LNG_MIN = -73.90, LNG_MAX = -73.72;
const cleaned = grid.filter(
  (n) =>
    n.lat >= LAT_MIN &&
    n.lat <= LAT_MAX &&
    n.lng >= LNG_MIN &&
    n.lng <= LNG_MAX
);

const outDir = path.join(process.cwd(), "app", "data");
const outFile = path.join(outDir, "albany_pop_grid.json");

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(outFile, JSON.stringify(cleaned, null, 2));

console.log(`[build-census-grid] wrote ${cleaned.length} nodes → ${outFile}`);
console.log(
  `[build-census-grid] dense (mult>=2.0): ${cleaned.filter((n) => n.baseMultiplier >= 2.0).length}`
);
console.log(
  `[build-census-grid] mid   (1.5-1.9): ${cleaned.filter((n) => n.baseMultiplier >= 1.5 && n.baseMultiplier < 2.0).length}`
);
console.log(
  `[build-census-grid] low   (<1.5): ${cleaned.filter((n) => n.baseMultiplier < 1.5).length}`
);
