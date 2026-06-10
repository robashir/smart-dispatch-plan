// Sprint 84/88 - Food daypart filter validator.
//
// Mirrors the production food policy: use the active daypart's matching POIs
// when at least one exists nearby, otherwise fall back to all nearby food.

const FOOD_DAYPART_POLICIES = [
  {
    label: "morning breakfast filter",
    startMin: 6 * 60,
    endMin: 11 * 60,
    tags: ["breakfast", "morning", "brunch"],
    categories: [],
  },
  {
    label: "lunch filter",
    startMin: 11 * 60,
    endMin: 14 * 60,
    tags: ["lunch", "brunch"],
    categories: ["sandwiches", "salads", "fast food", "pizza", "american", "mexican", "chinese", "indian", "thai", "korean", "vietnamese", "japanese", "mediterranean", "halal", "wings", "burgers", "latin american"],
  },
  {
    label: "dinner filter",
    startMin: 17 * 60,
    endMin: 21 * 60,
    tags: ["dinner"],
    categories: ["pizza", "italian", "american", "mexican", "chinese", "indian", "thai", "korean", "vietnamese", "japanese", "sushi", "seafood", "steakhouse", "mediterranean", "halal", "wings", "burgers", "latin american", "dominican", "colombian", "salvadoran", "caribbean", "jamaican", "southern", "barbecue"],
  },
  {
    label: "late-night filter",
    startMin: 21 * 60,
    endMin: 2 * 60,
    tags: ["late-night", "late night"],
    categories: ["pizza", "fast food", "wings", "burgers", "halal", "sandwiches", "mexican", "american", "desserts"],
  },
];

function getFoodDaypartPolicy(localStart) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const minutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  return FOOD_DAYPART_POLICIES.find((policy) => {
    if (policy.startMin < policy.endMin) return minutes >= policy.startMin && minutes < policy.endMin;
    return minutes >= policy.startMin || minutes < policy.endMin;
  });
}

function hasBreakfastDaypart(poi) {
  if (!Array.isArray(poi?.dayparts)) return false;
  return poi.dayparts.some((d) => {
    const tag = String(d).toLowerCase();
    return tag === "breakfast" || tag === "morning" || tag === "brunch";
  });
}

function matchesFoodDaypart(poi, policy) {
  if (!policy) return false;
  const dayparts = Array.isArray(poi?.dayparts) ? poi.dayparts : [];
  const categories = Array.isArray(poi?.categories) ? poi.categories : [];
  const haystack = [...dayparts, ...categories].map((v) => String(v).toLowerCase().trim());
  return haystack.some((value) =>
    [...policy.tags, ...policy.categories].some((needle) => value.includes(needle))
  );
}

function filterFoodPois(pois, localStart) {
  const policy = getFoodDaypartPolicy(localStart);
  if (!policy) return pois;
  return pois.some((p) => matchesFoodDaypart(p, policy))
    ? pois.filter((p) => matchesFoodDaypart(p, policy))
    : pois;
}

function isMorningYieldWindow(localStart) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const minutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  return minutes >= 6 * 60 && minutes < 11 * 60;
}

function foodYieldForHotspot(item, localStart = null) {
  const foodYields = {
    coffee: 2,
    cafes: 2,
    "breakfast & brunch": 4,
  };
  const base = foodYields[String(item.categories?.[0] || "").toLowerCase()] ?? 5;
  const adjustedBase = hasBreakfastDaypart(item) && isMorningYieldWindow(localStart) ? Math.max(base, 4) : base;
  return adjustedBase * (Number(item.populationDensityMod) || 1);
}

function itineraryScoreFloorFor(item, localStart = null) {
  if (item?.type === "food" && isMorningYieldWindow(localStart)) return 4;
  return 10;
}

function mk(hour, minute = 0) {
  return new Date(Date.UTC(2026, 5, 9, hour, minute));
}

const sample = [
  { name: "Coffee Shop", categories: ["Coffee"], dayparts: ["breakfast", "morning"] },
  { name: "Brunch Cafe", categories: ["Breakfast & Brunch"], dayparts: ["brunch"] },
  { name: "Pizza Place", categories: ["Pizza"], dayparts: [] },
  { name: "Korean BBQ", categories: ["Korean", "Barbecue"] },
  { name: "Wingstop", categories: ["Wings", "Fast Food"] },
  { name: "Bakery", categories: ["Bakeries"] },
];

const cases = [
  { name: "Morning keeps breakfast only", pois: sample, date: mk(8, 0), expect: ["Coffee Shop", "Brunch Cafe"] },
  { name: "Late morning keeps breakfast only", pois: sample, date: mk(10, 59), expect: ["Coffee Shop", "Brunch Cafe"] },
  { name: "Lunch keeps lunch-friendly food", pois: sample, date: mk(12, 0), expect: ["Brunch Cafe", "Pizza Place", "Korean BBQ", "Wingstop"] },
  { name: "Dinner keeps dinner-friendly food", pois: sample, date: mk(18, 0), expect: ["Pizza Place", "Korean BBQ", "Wingstop"] },
  { name: "Late night keeps late-night-friendly food", pois: sample, date: mk(22, 0), expect: ["Pizza Place", "Wingstop"] },
  { name: "Late night wraps after midnight", pois: sample, date: mk(1, 30), expect: ["Pizza Place", "Wingstop"] },
  { name: "Afternoon shoulder keeps all", pois: sample, date: mk(15, 0), expect: ["Coffee Shop", "Brunch Cafe", "Pizza Place", "Korean BBQ", "Wingstop", "Bakery"] },
  { name: "Morning fallback when no breakfast nearby", pois: sample.slice(2, 5), date: mk(8, 0), expect: ["Pizza Place", "Korean BBQ", "Wingstop"] },
  { name: "Dinner fallback when no dinner nearby", pois: [sample[0], sample[5]], date: mk(18, 0), expect: ["Coffee Shop", "Bakery"] },
];

const yieldCases = [
  {
    name: "Breakfast coffee floor",
    item: { categories: ["Coffee"], dayparts: ["breakfast", "morning"], populationDensityMod: 1 },
    date: mk(8, 0),
    expect: 4,
  },
  {
    name: "Breakfast coffee normal at lunch",
    item: { categories: ["Coffee"], dayparts: ["breakfast", "morning"], populationDensityMod: 1 },
    date: mk(12, 0),
    expect: 2,
  },
  {
    name: "Breakfast coffee normal at dinner",
    item: { categories: ["Coffee"], dayparts: ["breakfast", "morning"], populationDensityMod: 1 },
    date: mk(18, 0),
    expect: 2,
  },
  {
    name: "Non-breakfast coffee stays low",
    item: { categories: ["Coffee"], dayparts: [], populationDensityMod: 1 },
    date: mk(8, 0),
    expect: 2,
  },
  {
    name: "Breakfast brunch naturally stays four",
    item: { categories: ["Breakfast & Brunch"], dayparts: ["breakfast"], populationDensityMod: 1 },
    date: mk(8, 0),
    expect: 4,
  },
];

const floorCases = [
  {
    name: "Morning food floor is four",
    item: { type: "food" },
    date: mk(8, 0),
    expect: 4,
  },
  {
    name: "Lunch food floor stays ten",
    item: { type: "food" },
    date: mk(12, 0),
    expect: 10,
  },
  {
    name: "Morning grocery floor stays ten",
    item: { type: "grocery" },
    date: mk(8, 0),
    expect: 10,
  },
  {
    name: "Morning train floor stays ten",
    item: { type: "train" },
    date: mk(8, 0),
    expect: 10,
  },
];

let allPass = true;
console.log("=== Sprint 84 Food Daypart Filter - Test Run ===\n");
for (const c of cases) {
  const got = filterFoodPois(c.pois, c.date).map((p) => p.name);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(got)}`);
}
for (const c of yieldCases) {
  const got = foodYieldForHotspot(c.item, c.date);
  const ok = got === c.expect;
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${c.expect}\n  got      ${got}`);
}
for (const c of floorCases) {
  const got = itineraryScoreFloorFor(c.item, c.date);
  const ok = got === c.expect;
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${c.expect}\n  got      ${got}`);
}
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
