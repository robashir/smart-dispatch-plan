// Sprint 28 — Test-Driven Scaffolding.
// Validate the Anchor pick (Popularity Score = rating * review_count) and the
// Additive Stack qualityMod math BEFORE porting into computeHotspots inside
// app/api/dispatch/route.js.

const LATE_NIGHT_CATEGORIES = ["fast food", "pizza", "burgers", "diners"];

function pickAnchor(cluster) {
  let best = null;
  let bestScore = -Infinity;
  for (const b of cluster) {
    const score = (Number(b.rating) || 0) * (Number(b.review_count) || 0);
    if (score > bestScore) {
      bestScore = score;
      best = b;
    }
  }
  return { anchor: best, popularityScore: bestScore };
}

function computeQualityMod(anchor, popularityScore, localStart) {
  let mod = 1.0;
  if (popularityScore > 5000) mod += 0.3;

  const hour = localStart.getUTCHours();
  const isLateNight = hour === 23 || hour === 0 || hour === 1 || hour === 2;
  const cats = (anchor?.categories || []).map((c) => String(c).toLowerCase());
  const matchesLateNightCat = cats.some((c) =>
    LATE_NIGHT_CATEGORIES.some((trigger) => c.includes(trigger))
  );
  if (isLateNight && matchesLateNightCat) mod += 0.5;

  return mod;
}

const cluster = [
  { name: "Ghost Kitchen", rating: 5.0, review_count: 3, categories: ["New American"] },
  { name: "Legendary Pizza", rating: 4.7, review_count: 2500, categories: ["Pizza", "Fast Food"] },
];

// ---- Test 1: Daytime (2 PM wall-clock) ----
const daytime = new Date("2026-05-21T14:00:00Z");
const t1 = pickAnchor(cluster);
const mod1 = computeQualityMod(t1.anchor, t1.popularityScore, daytime);

console.log("=== TEST 1: Daytime (14:00) ===");
console.log({ anchor: t1.anchor.name, popularityScore: t1.popularityScore, qualityMod: mod1 });

let failed = false;
if (t1.anchor.name !== "Legendary Pizza") {
  console.error(`FAIL: expected Anchor=Legendary Pizza, got ${t1.anchor.name}`);
  failed = true;
}
if (mod1 !== 1.3) {
  console.error(`FAIL: daytime qualityMod expected 1.3, got ${mod1}`);
  failed = true;
}

// ---- Test 2: Late Night (1:00 AM wall-clock) ----
const lateNight = new Date("2026-05-21T01:00:00Z");
const t2 = pickAnchor(cluster);
const mod2 = computeQualityMod(t2.anchor, t2.popularityScore, lateNight);

console.log("\n=== TEST 2: Late Night (01:00) ===");
console.log({ anchor: t2.anchor.name, popularityScore: t2.popularityScore, qualityMod: mod2 });

if (t2.anchor.name !== "Legendary Pizza") {
  console.error(`FAIL: expected Anchor=Legendary Pizza, got ${t2.anchor.name}`);
  failed = true;
}
if (mod2 !== 1.8) {
  console.error(`FAIL: 1 AM qualityMod expected 1.8, got ${mod2}`);
  failed = true;
}

if (failed) {
  console.error("\nTEST FAILED");
  process.exit(1);
}
console.log("\nPASS: Anchor = Legendary Pizza in both tests; qualityMod = 1.3x daytime, 1.8x at 1 AM.");
