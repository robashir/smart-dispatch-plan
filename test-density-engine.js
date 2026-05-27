// Sprint 48: TDD scaffold for the Normalized Density Engine.
// Validates the Yield × Capacity → Density Ratio math + categories[0]
// fallback rules BEFORE the math gets ported into route.js. Mirror the
// in-route constants/helpers verbatim so the test acts as a contract.

const YIELD_RATES = {
  flight: 15,
  train: 10,
  food: 5,
  grocery: 5,
  event: 50,
  mega_event: 450,
  hospital: 30,
};

const CAPACITY_DICTIONARY = {
  // Transit hubs (flight/train look up hub name directly)
  ALB: 600,
  Rensselaer: 300,
  // Food / event categories (lowercase, primary category only — categories[0])
  "fast food": 200,
  "pizza": 100,
  "burgers": 100,
  "diners": 80,
  "steakhouse": 40,
  "sushi": 50,
  "supermarket": 400,
  "music": 1000,
  "sports": 5000,
  "arts": 800,
  "theatre": 800,
  // Synthetic injector first categories
  "morning shift overlap": 200,
  "afternoon clinic shift": 200,
  "evening nursing shift": 150,
  "night admin shift": 100,
  "state worker commute": 300,
  "nightlife egress": 250,
  "airport → venue": 600,
  "tourist ripple": 600,
};

const DEFAULT_CAPACITY = 80;

function yieldRateFor(item) {
  if (item.type === "flight") return YIELD_RATES.flight;
  if (item.type === "train") return YIELD_RATES.train;
  if (item.type === "food") return YIELD_RATES.food;
  if (item.type === "grocery") return YIELD_RATES.grocery;
  if (item.type === "event") {
    const cat0 = (item.categories && item.categories[0]) || "";
    if (/shift|nursing|admin|clinic/i.test(cat0)) return YIELD_RATES.hospital;
    const egress = Number(item.egressMod) || 0;
    if (egress >= 2.5) return YIELD_RATES.mega_event;
    return YIELD_RATES.event;
  }
  return 0;
}

function capacityFor(item) {
  if (item.type === "flight" || item.type === "train") {
    return CAPACITY_DICTIONARY[item.hub] ?? DEFAULT_CAPACITY;
  }
  const key = ((item.categories && item.categories[0]) || "")
    .toLowerCase()
    .trim();
  return CAPACITY_DICTIONARY[key] ?? DEFAULT_CAPACITY;
}

function densityScore(item, finalRideMod, finalFoodMod) {
  const numerator = (Number(item.volume) || 0) * yieldRateFor(item);
  const denominator = capacityFor(item);
  if (denominator <= 0) return 0;
  const mod =
    item.type === "food" || item.type === "grocery" ? finalFoodMod : finalRideMod;
  return (numerator / denominator) * mod * 100;
}

// ---- Assertions ----
let pass = 0;
let fail = 0;
function assert(name, actual, expected) {
  const eq =
    typeof expected === "number"
      ? Math.abs(actual - expected) < 0.001
      : actual === expected;
  if (eq) {
    pass++;
    console.log(`PASS — ${name}`);
  } else {
    fail++;
    console.log(`FAIL — ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// 1. Flight at ALB: 4 arrivals × 15 / 600 × 1.0 × 100 = 10.0 (just at floor)
const flight = { type: "flight", volume: 4, hub: "ALB" };
assert("flight ALB yield+capacity math", densityScore(flight, 1.0, 1.0), 10.0);

// 2. Train at Rensselaer: 3 arrivals × 10 / 300 × 1.0 × 100 = 10.0
const train = { type: "train", volume: 3, hub: "Rensselaer" };
assert("train Rensselaer yield+capacity math", densityScore(train, 1.0, 1.0), 10.0);

// 3. Food hotspot categories[0]="Sushi" → 50 cap; vol 4 × 5 / 50 × 1.5 × 100 = 60
const food = { type: "food", volume: 4, categories: ["Sushi", "Asian Fusion"] };
assert("food Sushi categories[0]", densityScore(food, 1.0, 1.5), 60.0);

// 4. Food hotspot categories[0] unknown ("Crepes") → fallback 80
const food2 = { type: "food", volume: 8, categories: ["Crepes"] };
const expected4 = (8 * 5) / 80 * 1.0 * 100; // = 50
assert("food unknown category falls back to 80", densityScore(food2, 1.0, 1.0), expected4);

// 5. Mega event: egressMod >= 2.5 → mega_event yield 450
const megaEvent = {
  type: "event",
  volume: 1,
  egressMod: 2.5,
  categories: ["Sports"], // capacity 5000
};
const expected5 = (1 * 450) / 5000 * 1.0 * 100; // = 9.0
assert("mega event uses mega_event yield", densityScore(megaEvent, 1.0, 1.0), expected5);

// 6. Standard event: egressMod < 2.5 → event yield 50
const stdEvent = {
  type: "event",
  volume: 1,
  egressMod: 2.0,
  categories: ["Music"], // capacity 1000
};
const expected6 = (1 * 50) / 1000 * 1.0 * 100; // = 5.0 (sub-10 floor)
assert("standard event uses event yield", densityScore(stdEvent, 1.0, 1.0), expected6);

// 7. Hospital event override: categories[0] matches /shift|nursing|admin|clinic/i
const hospitalEvent = {
  type: "event",
  volume: 1,
  egressMod: 4.0,
  categories: ["Morning Shift Overlap", "High Demand"],
};
// categories[0] lowercase = "morning shift overlap" → capacity 200
// hospital yield = 30
const expected7 = (1 * 30) / 200 * 1.0 * 100; // = 15.0
assert("hospital injector uses hospital yield", densityScore(hospitalEvent, 1.0, 1.0), expected7);

// 8. Unknown event category and not mega → 80 fallback for capacity
const oddEvent = {
  type: "event",
  volume: 1,
  egressMod: 2.0,
  categories: ["Unknown Genre"],
};
const expected8 = (1 * 50) / 80 * 1.0 * 100; // = 62.5
assert("event unknown category fallback 80", densityScore(oddEvent, 1.0, 1.0), expected8);

// 9. Sprint 27 floor recalibration check: a hotspot just under 10% capacity drops
const weakFood = { type: "food", volume: 1, categories: ["Fast Food"] }; // 1*5/200*1.0*100 = 2.5
const weakScore = densityScore(weakFood, 1.0, 1.0);
assert("weak food density < 10.0 (would drop)", weakScore < 10.0, true);

// 10. Strong food density well above 10.0 floor
const strongFood = { type: "food", volume: 12, categories: ["Steakhouse"] }; // 12*5/40*1.5*100 = 225
const strongScore = densityScore(strongFood, 1.0, 1.5);
assert("strong food density > 10.0 (would keep)", strongScore > 10.0, true);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
