// Sprint 23 — The Deterministic Router (Multi-Algorithm) TDD scaffolding
//
// Validates the new `buildItinerary(payload, strategy)` function. Flattens
// flightsByHour, trainsByHour, and food/grocery hotspots into a single
// sorted array. Three strategies must work:
//   chronological — sort ascending by time (leaveBy preferred, then hourBucket;
//                   items with no time signal sort to top — "Current/Ongoing")
//   profitability — sort by surgeScore desc:
//                     flight/train: volume * finalRideMod
//                     food/grocery: volume * finalFoodMod + (tier==="High-Value ($$$)" ? 2 : 0)
//   hybrid        — group by hourBucket (chronological order), within each
//                   group sort by surgeScore desc. No-hourBucket items go
//                   to the "Current/Ongoing" group at the top.

function parseTimeLabel(label) {
  if (!label || typeof label !== "string") return Infinity;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return Infinity;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + min;
}

function itemTime(item) {
  if (item.leaveBy) return parseTimeLabel(item.leaveBy);
  if (item.hourBucket) return parseTimeLabel(item.hourBucket);
  return -Infinity;
}

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

function flattenPayload(payload) {
  const flights = Array.isArray(payload?.flightsByHour) ? payload.flightsByHour : [];
  const trains = Array.isArray(payload?.trainsByHour) ? payload.trainsByHour : [];
  const food =
    payload?.gigDemand && Array.isArray(payload.gigDemand.foodHotspots)
      ? payload.gigDemand.foodHotspots
      : [];
  const grocery =
    payload?.gigDemand && Array.isArray(payload.gigDemand.groceryHotspots)
      ? payload.gigDemand.groceryHotspots
      : [];
  return [...flights, ...trains, ...food, ...grocery];
}

function buildItinerary(payload, strategy) {
  const items = flattenPayload(payload);
  const finalRideMod = Number.isFinite(payload?.finalRideMod) ? payload.finalRideMod : 1.0;
  const finalFoodMod = Number.isFinite(payload?.finalFoodMod) ? payload.finalFoodMod : 1.0;

  if (strategy === "profitability") {
    return [...items].sort(
      (a, b) =>
        surgeScore(b, finalRideMod, finalFoodMod) -
        surgeScore(a, finalRideMod, finalFoodMod)
    );
  }

  if (strategy === "chronological") {
    return [...items].sort((a, b) => itemTime(a) - itemTime(b));
  }

  // hybrid (default)
  const groups = new Map();
  for (const it of items) {
    const key = it.hourBucket || "__CURRENT__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    if (a === "__CURRENT__") return -1;
    if (b === "__CURRENT__") return 1;
    return parseTimeLabel(a) - parseTimeLabel(b);
  });
  const out = [];
  for (const key of groupKeys) {
    const arr = groups
      .get(key)
      .slice()
      .sort(
        (a, b) =>
          surgeScore(b, finalRideMod, finalFoodMod) -
          surgeScore(a, finalRideMod, finalFoodMod)
      );
    out.push(...arr);
  }
  return out;
}

// ----- Mock payload (per PO spec) -----
const mergedPayload = {
  flightsByHour: [
    { type: "flight", hourBucket: "3 PM", volume: 1, origins: ["MCO"], leaveBy: "2:45 PM", hub: "ALB" },
  ],
  trainsByHour: [
    { type: "train", hourBucket: "5 PM", volume: 3, origins: ["NYP", "BOS", "WAS"], hub: "Rensselaer" },
  ],
  gigDemand: {
    foodHotspots: [
      { type: "food", location: "Pearl St & State St", volume: 4, tier: "High-Value ($$$)", categories: ["Steakhouse"] },
    ],
    groceryHotspots: [],
  },
  finalRideMod: 1.5,
  finalFoodMod: 1.0,
};

const flight = mergedPayload.flightsByHour[0];
const train = mergedPayload.trainsByHour[0];
const food = mergedPayload.gigDemand.foodHotspots[0];

// ----- Expected outputs -----
//
// chronological:
//   food (no time → Current/Ongoing → top)
//   flight (leaveBy 2:45 PM = 885 min)
//   train  (hourBucket 5 PM   = 1020 min)
const expectedChronological = [food, flight, train];

// profitability (surgeScore desc):
//   food   = 4 * 1.0 + 2 = 6
//   train  = 3 * 1.5     = 4.5
//   flight = 1 * 1.5     = 1.5
const expectedProfitability = [food, train, flight];

// hybrid: groups = [Current/Ongoing (food), 3 PM (flight), 5 PM (train)]
const expectedHybrid = [food, flight, train];

const gotChrono = buildItinerary(mergedPayload, "chronological");
const gotProfit = buildItinerary(mergedPayload, "profitability");
const gotHybrid = buildItinerary(mergedPayload, "hybrid");

const chronoPass = JSON.stringify(gotChrono) === JSON.stringify(expectedChronological);
const profitPass = JSON.stringify(gotProfit) === JSON.stringify(expectedProfitability);
const hybridPass = JSON.stringify(gotHybrid) === JSON.stringify(expectedHybrid);

console.log("=== Sprint 23 Deterministic Router — Test Run ===\n");
console.log((chronoPass ? "PASS" : "FAIL") + " — chronological");
console.log("  expected " + JSON.stringify(expectedChronological));
console.log("  got      " + JSON.stringify(gotChrono));
console.log((profitPass ? "PASS" : "FAIL") + " — profitability");
console.log("  expected " + JSON.stringify(expectedProfitability));
console.log("  got      " + JSON.stringify(gotProfit));
console.log((hybridPass ? "PASS" : "FAIL") + " — hybrid");
console.log("  expected " + JSON.stringify(expectedHybrid));
console.log("  got      " + JSON.stringify(gotHybrid));

const allPass = chronoPass && profitPass && hybridPass;
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
