// Sprint 45 — Mathematical ROI Filter TDD Scaffold.
// Validates the deadhead-cost-vs-expected-value math in isolation before
// porting it into app/api/dispatch/route.js. Mirrors the shape of
// test-hospital-engine.js / test-egress-engine.js.

const DOLLAR_PER_SURGE_POINT = 1.50;

// Inline copy of the existing haversineMiles helper from route.js so the
// test exercises the SAME spherical-law-of-cosines math the production
// filter will use. Driver coords are constant; item coords vary per case.
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

// The candidate filter — drops an item iff deadheadCost > expectedValue.
// `score` is the already-decayed surgeScore the production buildItinerary
// pipes through this gate; the math doesn't care how it was computed.
function passesRoiFilter(item, driverLat, driverLng, costPerMile, score) {
  const distance = haversineMiles(driverLat, driverLng, item.lat, item.lng);
  const deadheadCost = distance * costPerMile;
  const expectedValue = score * DOLLAR_PER_SURGE_POINT;
  return deadheadCost <= expectedValue;
}

function assert(name, actual, expected) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}`);
  if (!pass) {
    console.log("   expected:", expected);
    console.log("   actual:  ", actual);
    process.exitCode = 1;
  }
}

// Driver sits at downtown Albany. All test items are offset from this
// origin along the latitude axis so the haversine distance is predictable
// (~1 degree latitude ≈ 69 miles).
const DRIVER = { lat: 42.6526, lng: -73.7562 };

// Assert 1: Cheap, close, profitable surge. 1 mile out, score 2.0, $0.65/mi.
//   deadheadCost  = 1 * 0.65 = 0.65
//   expectedValue = 2.0 * 1.50 = 3.00 → kept.
const oneMileNorth = { lat: DRIVER.lat + 1 / 69, lng: DRIVER.lng };
assert(
  "Profitable close surge (1mi, score 2.0, $0.65/mi) → kept",
  passesRoiFilter(oneMileNorth, DRIVER.lat, DRIVER.lng, 0.65, 2.0),
  true
);

// Assert 2: Far, weak surge. 15 miles out, score 1.5, $0.65/mi.
//   deadheadCost  = 15 * 0.65 = 9.75
//   expectedValue = 1.5 * 1.50 = 2.25 → dropped.
const fifteenMilesNorth = { lat: DRIVER.lat + 15 / 69, lng: DRIVER.lng };
assert(
  "Money-losing far surge (15mi, score 1.5, $0.65/mi) → dropped",
  passesRoiFilter(fifteenMilesNorth, DRIVER.lat, DRIVER.lng, 0.65, 1.5),
  false
);

// Assert 3: Expensive vehicle, mediocre surge. 1 mile out, score 0.5, $2.00/mi.
//   deadheadCost  = 1 * 2.00 = 2.00
//   expectedValue = 0.5 * 1.50 = 0.75 → dropped.
assert(
  "High-cost vehicle erodes weak surge ($2.00/mi, 1mi, score 0.5) → dropped",
  passesRoiFilter(oneMileNorth, DRIVER.lat, DRIVER.lng, 2.00, 0.5),
  false
);

// Assert 4: Boundary — deadheadCost exactly equals expectedValue → kept.
// Solve costPerMile for cost == value at score 1.0 against the REAL haversine
// distance (1° latitude is not exactly 69 miles, so a hardcoded ratio drifts
// past the strict inequality). The filter spec is `cost > value drops` —
// equality must survive.
const twoMilesNorth = { lat: DRIVER.lat + 2 / 69, lng: DRIVER.lng };
const realDistance = haversineMiles(
  DRIVER.lat,
  DRIVER.lng,
  twoMilesNorth.lat,
  twoMilesNorth.lng
);
const boundaryCostPerMile = (1.0 * DOLLAR_PER_SURGE_POINT) / realDistance;
assert(
  "Boundary cost==value → kept (strict `cost > value` drops)",
  passesRoiFilter(twoMilesNorth, DRIVER.lat, DRIVER.lng, boundaryCostPerMile, 1.0),
  true
);
