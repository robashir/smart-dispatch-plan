// Sprint 52 — Phase 1 TDD scaffolding.
// Validate the day-lookup + ±30 minute Crossgates close window in isolation
// BEFORE we touch app/api/dispatch/route.js. Covers:
//   - all 7 days resolve to the correct closeMinute (Sun=1080, Mon-Thu=1200, Fri-Sat=1260)
//   - lower bound (closeMinute - 30 → fire)
//   - upper bound (closeMinute + 30 → fire)
//   - just outside both bounds (closeMinute - 31, closeMinute + 31 → no fire)
//   - mid-day (way outside window → no fire)
//   - platform gate (rideshare OFF → no fire regardless of clock)
//
// Run: `node test-crossgates-engine.js` — exits 0 on green, 1 on red.

// --- Pure math under test (will be ported verbatim into route.js) ---

const CROSSGATES_HOURS = {
  0: 1080, // Sunday        6:00 PM
  1: 1200, // Monday        8:00 PM
  2: 1200, // Tuesday       8:00 PM
  3: 1200, // Wednesday     8:00 PM
  4: 1200, // Thursday      8:00 PM
  5: 1260, // Friday        9:00 PM
  6: 1260, // Saturday      9:00 PM
};

// Mirrors the gate inside the POST handler.
function shouldInjectCrossgates(localStart, rideshareActive) {
  if (!rideshareActive) return false;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const currentDay = localStart.getUTCDay();
  const closeMinute = CROSSGATES_HOURS[currentDay];
  if (typeof closeMinute !== "number") return false;
  const wallMinutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  return wallMinutes >= closeMinute - 30 && wallMinutes <= closeMinute + 30;
}

// --- Test harness ---

// Fixed UTC week aligned with the rest of the repo's tests:
// 2026-05-24 = Sunday (dayIdx 0), 2026-05-25 = Monday, ..., 2026-05-30 = Saturday.
function wallClock(yyyyMmDd, hhmm) {
  return new Date(`${yyyyMmDd}T${hhmm}:00.000Z`);
}

let failed = 0;
let passed = 0;
function expect(label, actual, predicate) {
  const ok = predicate(actual);
  if (ok) {
    passed++;
    console.log(`PASS — ${label} (got ${JSON.stringify(actual)})`);
  } else {
    failed++;
    console.error(`FAIL — ${label} (got ${JSON.stringify(actual)})`);
  }
}

console.log("=== TEST 1: Matrix lookup — every day resolves to its close ===");
expect("Sun closeMinute = 1080", CROSSGATES_HOURS[0], (x) => x === 1080);
expect("Mon closeMinute = 1200", CROSSGATES_HOURS[1], (x) => x === 1200);
expect("Tue closeMinute = 1200", CROSSGATES_HOURS[2], (x) => x === 1200);
expect("Wed closeMinute = 1200", CROSSGATES_HOURS[3], (x) => x === 1200);
expect("Thu closeMinute = 1200", CROSSGATES_HOURS[4], (x) => x === 1200);
expect("Fri closeMinute = 1260", CROSSGATES_HOURS[5], (x) => x === 1260);
expect("Sat closeMinute = 1260", CROSSGATES_HOURS[6], (x) => x === 1260);

console.log("\n=== TEST 2: Sunday — 6:00 PM close (1080). Window 17:30-18:30. ===");
// 5:30 PM exactly (lower bound inclusive)
expect("Sun 17:30 → fire", shouldInjectCrossgates(wallClock("2026-05-24", "17:30"), true), (x) => x === true);
// 6:00 PM (at close)
expect("Sun 18:00 → fire", shouldInjectCrossgates(wallClock("2026-05-24", "18:00"), true), (x) => x === true);
// 6:30 PM (upper bound inclusive)
expect("Sun 18:30 → fire", shouldInjectCrossgates(wallClock("2026-05-24", "18:30"), true), (x) => x === true);
// 5:29 PM (one min before window)
expect("Sun 17:29 → no fire", shouldInjectCrossgates(wallClock("2026-05-24", "17:29"), true), (x) => x === false);
// 6:31 PM (one min after window)
expect("Sun 18:31 → no fire", shouldInjectCrossgates(wallClock("2026-05-24", "18:31"), true), (x) => x === false);

console.log("\n=== TEST 3: Wednesday — 8:00 PM close (1200). Window 19:30-20:30. ===");
expect("Wed 19:30 → fire", shouldInjectCrossgates(wallClock("2026-05-27", "19:30"), true), (x) => x === true);
expect("Wed 20:00 → fire", shouldInjectCrossgates(wallClock("2026-05-27", "20:00"), true), (x) => x === true);
expect("Wed 20:30 → fire", shouldInjectCrossgates(wallClock("2026-05-27", "20:30"), true), (x) => x === true);
expect("Wed 19:29 → no fire", shouldInjectCrossgates(wallClock("2026-05-27", "19:29"), true), (x) => x === false);
expect("Wed 20:31 → no fire", shouldInjectCrossgates(wallClock("2026-05-27", "20:31"), true), (x) => x === false);

console.log("\n=== TEST 4: Saturday — 9:00 PM close (1260). Window 20:30-21:30. ===");
expect("Sat 20:30 → fire", shouldInjectCrossgates(wallClock("2026-05-30", "20:30"), true), (x) => x === true);
expect("Sat 21:00 → fire", shouldInjectCrossgates(wallClock("2026-05-30", "21:00"), true), (x) => x === true);
expect("Sat 21:30 → fire", shouldInjectCrossgates(wallClock("2026-05-30", "21:30"), true), (x) => x === true);
expect("Sat 20:29 → no fire", shouldInjectCrossgates(wallClock("2026-05-30", "20:29"), true), (x) => x === false);
expect("Sat 21:31 → no fire", shouldInjectCrossgates(wallClock("2026-05-30", "21:31"), true), (x) => x === false);

console.log("\n=== TEST 5: Day-lookup precision — Sat 18:00 must NOT fire on Sun's schedule ===");
// Sat 18:00 → Sat closes 21:00, so wall=1080 vs close=1260 → 180 min before → outside window.
// If the day-lookup were broken (e.g., using a single global close), this would fire on Sun's matrix.
expect("Sat 18:00 → no fire (Sat closes 21:00)", shouldInjectCrossgates(wallClock("2026-05-30", "18:00"), true), (x) => x === false);
// Sun 20:00 → Sun closed at 18:00, so wall=1200 vs close=1080 → 120 min AFTER → outside window.
expect("Sun 20:00 → no fire (Sun closed 18:00, 120 min past upper bound)", shouldInjectCrossgates(wallClock("2026-05-24", "20:00"), true), (x) => x === false);

console.log("\n=== TEST 6: Mid-day (way outside window) — no fire on any day ===");
expect("Mon 12:00 → no fire", shouldInjectCrossgates(wallClock("2026-05-25", "12:00"), true), (x) => x === false);
expect("Thu 03:00 → no fire", shouldInjectCrossgates(wallClock("2026-05-28", "03:00"), true), (x) => x === false);
expect("Fri 09:15 → no fire", shouldInjectCrossgates(wallClock("2026-05-29", "09:15"), true), (x) => x === false);

console.log("\n=== TEST 7: Platform gate — rideshare OFF blocks every fire ===");
expect("Sat 21:00 BUT rideshare OFF → no fire", shouldInjectCrossgates(wallClock("2026-05-30", "21:00"), false), (x) => x === false);
expect("Sun 18:00 BUT rideshare OFF → no fire", shouldInjectCrossgates(wallClock("2026-05-24", "18:00"), false), (x) => x === false);
expect("Wed 20:00 BUT rideshare OFF → no fire", shouldInjectCrossgates(wallClock("2026-05-27", "20:00"), false), (x) => x === false);

console.log(`\n=== SUMMARY ===\nPassed: ${passed}\nFailed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
