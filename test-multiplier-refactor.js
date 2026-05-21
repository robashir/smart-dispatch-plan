// Sprint 27 — Test-Driven Scaffolding.
// Validate the strict (< 1.0) surge filter + single-application of the
// finalRideMod / finalFoodMod multipliers in isolation BEFORE porting the
// behavior into app/api/dispatch/route.js::buildItinerary.

function surgeScore(item, finalRideMod, finalFoodMod) {
  if (item.type === "flight" || item.type === "train") {
    return (Number(item.volume) || 0) * finalRideMod;
  }
  if (item.type === "food" || item.type === "grocery") {
    const base = (Number(item.volume) || 0) * finalFoodMod;
    const bonus = item.tier === "High-Value ($$$)" ? 2 : 0;
    return base + bonus;
  }
  return 0;
}

function buildItinerary(payload) {
  const items = [
    ...(payload.flightsByHour || []),
    ...(payload.foodHotspots || []),
  ];
  return items
    .map((it) => ({
      ...it,
      surgeScore: surgeScore(it, payload.finalRideMod, payload.finalFoodMod),
    }))
    .filter((it) => it.surgeScore >= 1.0);
}

const payload = {
  finalFoodMod: 0.5,
  finalRideMod: 1.5,
  flightsByHour: [
    { type: "flight", hourBucket: "7 PM", volume: 10, hub: "ALB", origins: ["MCO"] },
  ],
  foodHotspots: [
    { type: "food", location: "Pearl St", volume: 1, tier: "Quick-Turn ($)", categories: ["Pizza"] },
  ],
};

const result = buildItinerary(payload);

console.log("=== TEST RESULT ===");
console.log(JSON.stringify(result, null, 2));

const flight = result.find((i) => i.type === "flight");
const food = result.find((i) => i.type === "food");

let failed = false;
if (food) {
  console.error("FAIL: food hotspot (volume=1 * 0.5 = 0.5) should be filtered out");
  failed = true;
}
if (!flight) {
  console.error("FAIL: flight surge should remain");
  failed = true;
} else if (flight.surgeScore !== 15) {
  console.error(`FAIL: flight surgeScore expected 15, got ${flight.surgeScore}`);
  failed = true;
}

if (failed) {
  console.error("\nTEST FAILED");
  process.exit(1);
}
console.log("\nPASS: food dropped (0.5 < 1.0), flight retained (surgeScore = 15).");
