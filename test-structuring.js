// Sprint 22 — Data Structuring Phase 1 (Trains & Yelp) TDD scaffolding
//
// Standalone validators for the rewritten `aggregateTrainArrivalsByHour`
// and `computeHotspots`. Both must return STRICT ARRAYS of typed objects
// (not dicts of strings, not strings with comma-joined categories) so the
// future Next.js/React frontend can `.map()` directly.
//
// Required output shapes per PO:
//   trains:    [{ type: "train", hourBucket, volume, origins, hub: "Rensselaer" }]
//   hotspots:  [{ type: "food"|"grocery", location, volume, tier, categories: [...] }]

const HIGH_VALUE_STATIONS = ["NYP", "BOS", "WAS", "PHL"];

function aggregateTrainArrivalsByHour(trains, localStart, localEnd, offsetMin, rideMod = 1.0) {
  if (!Array.isArray(trains)) return [];
  const originsByHour = {};
  const seen = new Set();
  for (const t of trains) {
    const status = (t.status || t.trainState || "").toLowerCase();
    if (status === "cancelled") continue;

    const origCode = t.origCode;
    if (!origCode || !HIGH_VALUE_STATIONS.includes(origCode)) continue;

    const stations = Array.isArray(t.stations) ? t.stations : [];
    const albStop = stations.find((s) => s?.code === "ALB");
    if (!albStop) continue;

    const arrival = albStop.arr || albStop.schArr;
    if (!arrival) continue;

    const fingerprint = `${t.trainNum || t.trainID || ""}|${arrival}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const arrivalUtc = new Date(arrival);
    if (Number.isNaN(arrivalUtc.getTime())) continue;

    const arrivalLocal = new Date(arrivalUtc.getTime() - offsetMin * 60 * 1000);
    if (arrivalLocal < localStart || arrivalLocal >= localEnd) continue;

    let h = arrivalLocal.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const label = `${h} ${ampm}`;
    if (!originsByHour[label]) originsByHour[label] = [];
    originsByHour[label].push(origCode);
  }

  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    const scaled = Math.round(codes.length * rideMod);
    if (scaled <= 0) continue;
    buckets.push({
      type: "train",
      hourBucket: hour,
      volume: scaled,
      origins: codes,
      hub: "Rensselaer",
    });
  }
  return buckets;
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeHotspots(businesses, type) {
  if (!Array.isArray(businesses) || businesses.length === 0) return [];

  const remaining = [...businesses];
  const hotspots = [];

  while (remaining.length > 0 && hotspots.length < 3) {
    let bestCluster = [remaining[0]];
    for (const center of remaining) {
      const cluster = remaining.filter(
        (other) => haversineMeters(center.lat, center.lng, other.lat, other.lng) <= 200
      );
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    }

    const streetCounts = {};
    for (const b of bestCluster) {
      const street = (b.address1 || "").replace(/^\d+\s*/, "").trim();
      if (street) streetCounts[street] = (streetCounts[street] || 0) + 1;
    }
    const topStreets = Object.entries(streetCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([s]) => s);
    let location = "Unnamed area";
    if (topStreets.length === 2) location = `${topStreets[0]} & ${topStreets[1]}`;
    else if (topStreets.length === 1) location = `near ${topStreets[0]}`;

    const hasHighEnd = bestCluster.some((b) => (b.price || "").length >= 3);
    const midCount = bestCluster.filter((b) => b.price === "$$").length;
    let tier;
    if (hasHighEnd) tier = "High-Value ($$$)";
    else if (midCount > bestCluster.length / 2) tier = "Mid-Tier ($$)";
    else tier = "Quick-Turn ($)";

    const catCounts = {};
    for (const b of bestCluster) {
      for (const c of b.categories || []) {
        catCounts[c] = (catCounts[c] || 0) + 1;
      }
    }
    const topCats = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c.trim());

    hotspots.push({
      type,
      location,
      volume: bestCluster.length,
      tier,
      categories: topCats.length > 0 ? topCats : ["Mixed"],
    });

    const clusterSet = new Set(bestCluster);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (clusterSet.has(remaining[i])) remaining.splice(i, 1);
    }
  }

  return hotspots;
}

// --- Train scenario --------------------------------------------------------
// 5 PM local bucket. offsetMin = 240 (EDT). Two trains from NYP and BOS,
// both arriving in the 5 PM hour at ALB.
const localStart = new Date(Date.UTC(2026, 4, 20, 17, 0));
const localEnd = new Date(Date.UTC(2026, 4, 20, 18, 0));
const offsetMin = 240;

const trains = [
  { trainNum: "281", origCode: "NYP", status: "Active", stations: [{ code: "ALB", arr: "2026-05-20T21:00:00Z" }] },
  { trainNum: "449", origCode: "BOS", status: "Active", stations: [{ code: "ALB", arr: "2026-05-20T21:30:00Z" }] },
];

const expectedTrain = [
  { type: "train", hourBucket: "5 PM", volume: 2, origins: ["NYP", "BOS"], hub: "Rensselaer" },
];
const gotTrain = aggregateTrainArrivalsByHour(trains, localStart, localEnd, offsetMin, 1.0);

const trainPass = JSON.stringify(gotTrain) === JSON.stringify(expectedTrain);

// --- Yelp hotspot scenario -------------------------------------------------
// Two restaurants ~11m apart on Crossgates Mall Rd. Cuisines "New American"
// and "Chinese". Both $ → "Quick-Turn ($)". Shared street → "near ...".
const businesses = [
  { name: "A", lat: 42.71, lng: -73.86, price: "$", categories: ["New American"], address1: "1 Crossgates Mall Rd" },
  { name: "B", lat: 42.7101, lng: -73.8601, price: "$", categories: ["Chinese"], address1: "2 Crossgates Mall Rd" },
];

const expectedHot = [
  {
    type: "food",
    location: "near Crossgates Mall Rd",
    volume: 2,
    tier: "Quick-Turn ($)",
    categories: ["New American", "Chinese"],
  },
];
const gotHot = computeHotspots(businesses, "food");

const hotPass = JSON.stringify(gotHot) === JSON.stringify(expectedHot);

// --- Empty-input safety ----------------------------------------------------
const emptyTrain = aggregateTrainArrivalsByHour([], localStart, localEnd, offsetMin, 1.0);
const emptyHot = computeHotspots([], "food");
const emptyPass = Array.isArray(emptyTrain) && emptyTrain.length === 0 && Array.isArray(emptyHot) && emptyHot.length === 0;

console.log("=== Sprint 22 Trains & Yelp Structuring — Test Run ===\n");
console.log((trainPass ? "PASS" : "FAIL") + " — train aggregator returns strict array shape");
console.log("  expected " + JSON.stringify(expectedTrain));
console.log("  got      " + JSON.stringify(gotTrain));
console.log((hotPass ? "PASS" : "FAIL") + " — hotspot computer returns typed array with split categories");
console.log("  expected " + JSON.stringify(expectedHot));
console.log("  got      " + JSON.stringify(gotHot));
console.log((emptyPass ? "PASS" : "FAIL") + " — empty inputs return []");
console.log("  trains   " + JSON.stringify(emptyTrain));
console.log("  hotspots " + JSON.stringify(emptyHot));

const allPass = trainPass && hotPass && emptyPass;
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
