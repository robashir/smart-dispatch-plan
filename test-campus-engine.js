// Sprint 31: Campus Synergy Engine — TDD scaffold.
// Validates the spatial (1.5-mile radius) and temporal (11 PM / 12 AM / 1 AM)
// gates BEFORE the logic gets ported into app/api/dispatch/route.js.
// Run: node test-campus-engine.js

const CAMPUS_CENTERS = [
  { name: "SUNY Albany", lat: 42.6861, lng: -73.8237 },
  { name: "RPI", lat: 42.7298, lng: -73.6789 },
  { name: "Siena College", lat: 42.7194, lng: -73.7532 },
];

// Reused verbatim from Sprint 20's route.js helper. Earth radius in miles.
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

function computeCampusMod(hotspotLat, hotspotLng, currentHour) {
  const isLateNight = currentHour === 23 || currentHour === 0 || currentHour === 1;
  if (!isLateNight) return { campusMod: 1.0, campusName: null };

  for (const campus of CAMPUS_CENTERS) {
    const distance = haversineMiles(hotspotLat, hotspotLng, campus.lat, campus.lng);
    if (distance < 1.5) {
      return { campusMod: 1.5, campusName: campus.name };
    }
  }
  return { campusMod: 1.0, campusName: null };
}

function assertEq(actual, expected, label) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | got=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!pass) process.exitCode = 1;
}

// Test 1: ~0.27 mi north of SUNY Albany centroid at 11 PM -> trigger.
const nearSUNY = { lat: 42.6900, lng: -73.8237 };
assertEq(
  computeCampusMod(nearSUNY.lat, nearSUNY.lng, 23),
  { campusMod: 1.5, campusName: "SUNY Albany" },
  "Near SUNY Albany at 11 PM (hour 23)"
);

// Test 2: same coords, but 2 PM -> no trigger (time gate fails).
assertEq(
  computeCampusMod(nearSUNY.lat, nearSUNY.lng, 14),
  { campusMod: 1.0, campusName: null },
  "Near SUNY Albany at 2 PM (hour 14)"
);

// Test 3: well outside any campus radius at midnight -> no trigger (spatial gate fails).
const farFromCampus = { lat: 42.5500, lng: -73.5000 };
assertEq(
  computeCampusMod(farFromCampus.lat, farFromCampus.lng, 0),
  { campusMod: 1.0, campusName: null },
  "5+ mi from any campus at midnight (hour 0)"
);

// Test 4: surgeScore food-branch stack inflates by exactly 1.5x when campusMod fires.
// Mirrors the in-route formula: volume * finalFoodMod * qualityMod * campusMod (+ tier bonus).
function foodSurgeScore(item, finalFoodMod) {
  const qualityMod = Number(item.qualityMod) || 1.0;
  const campusMod = Number(item.campusMod) || 1.0;
  const base = (Number(item.volume) || 0) * finalFoodMod * qualityMod * campusMod;
  const bonus = item.tier === "High-Value ($$$)" ? 2 : 0;
  return base + bonus;
}
const baseline = foodSurgeScore({ volume: 5, qualityMod: 1.0, campusMod: 1.0, tier: "Quick-Turn ($)" }, 1.0);
const boosted = foodSurgeScore({ volume: 5, qualityMod: 1.0, campusMod: 1.5, tier: "Quick-Turn ($)" }, 1.0);
assertEq(boosted, baseline * 1.5, "surgeScore inflates by exactly 1.5x when campusMod fires");
