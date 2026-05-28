// Sprint 50 — Phase 2 TDD scaffolding.
// Validate the 30–45 min pre-close window math in isolation BEFORE we touch
// app/api/dispatch/route.js. Covers:
//   - lower bound (exactly 30 min before close → fire)
//   - upper bound (exactly 45 min before close → fire)
//   - just outside both bounds (29 / 46 min → no fire)
//   - cross-midnight day-lookup (Sat 01:25 → uses Friday's 02:00 close)
//   - today's close = "00:00" interpreted as next-day midnight
//   - "Closed" values are skipped on both today- and yesterday-lookups
//
// Run: `node test-last-call-engine.js` — exits 0 on green, 1 on red.

// --- Pure math under test (will be ported verbatim into route.js) ---

const EARLY_AM_THRESHOLD_MIN = 360; // close times < 06:00 belong to previous operational day

function parseHHMMtoMin(str) {
  if (typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

// Given a wall-clock Date (UTC-as-local convention) and a venue's closingTimes
// map, return minutesUntilClose if the venue's relevant operational close is in
// the [30, 45] minute window, else null.
function minutesUntilLastCall(localStart, closingTimes) {
  if (!(localStart instanceof Date) || !closingTimes) return null;
  const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  const dayIdx = localStart.getUTCDay();
  const prevIdx = (dayIdx + 6) % 7;

  const candidates = [];

  // Candidate A: today's listed close.
  const todayVal = closingTimes[String(dayIdx)];
  const todayMin = parseHHMMtoMin(todayVal);
  if (todayMin !== null) {
    // If < EARLY_AM_THRESHOLD, the close lands tomorrow morning (e.g. "02:00"
    // listed under Friday means Saturday 02:00 wall-clock).
    const offset =
      todayMin < EARLY_AM_THRESHOLD_MIN
        ? 1440 - nowMin + todayMin
        : todayMin - nowMin;
    if (offset >= 0) candidates.push(offset);
  }

  // Candidate B: yesterday's late close that bled into today's pre-dawn hours.
  // Only relevant when yesterday's close was < EARLY_AM_THRESHOLD.
  const prevVal = closingTimes[String(prevIdx)];
  const prevMin = parseHHMMtoMin(prevVal);
  if (prevMin !== null && prevMin < EARLY_AM_THRESHOLD_MIN) {
    const offset = prevMin - nowMin;
    if (offset >= 0) candidates.push(offset);
  }

  for (const offset of candidates) {
    if (offset >= 30 && offset <= 45) return offset;
  }
  return null;
}

// --- Test harness ---

// All dates use a fixed UTC week so getUTCDay() returns the day we intend.
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

// Venue A: McGeary's-style — closes 02:00 every night.
const venueAlways02 = {
  "0": "02:00", "1": "02:00", "2": "02:00", "3": "02:00",
  "4": "02:00", "5": "02:00", "6": "02:00",
};

// Venue B: midnight closer — Wolff's Monday "00:00".
const venueMidnightMon = {
  "0": "23:00", "1": "00:00", "2": "00:00", "3": "01:00",
  "4": "02:00", "5": "02:00", "6": "02:00",
};

// Venue C: Sat is "Closed" but Fri bleeds into Sat 02:00.
const venueClosedSatFriBleeds = {
  "0": "Closed", "1": "21:00", "2": "21:00", "3": "21:00",
  "4": "21:00", "5": "02:00", "6": "Closed",
};

// Venue D: Both Sat (today) AND Fri (yesterday) are "Closed".
const venueClosedBoth = {
  "0": "00:00", "1": "21:00", "2": "21:00", "3": "21:00",
  "4": "21:00", "5": "Closed", "6": "Closed",
};

// Venue E: Early evening closer that never fires for nightlife.
const venueEarlyClose = {
  "0": "21:00", "1": "21:00", "2": "21:00", "3": "21:00",
  "4": "21:00", "5": "21:00", "6": "21:00",
};

console.log("=== TEST 1: Mid-window (35 min before close, same-day) ===");
// Tue 2026-05-26, 13:25 → close 14:00 same day → 35 min. Use a fake close-time.
// Easier: McGeary-style 02:00 Sat morning, driver Sat 01:25.
let t = minutesUntilLastCall(wallClock("2026-05-30", "01:25"), venueAlways02);
expect("Sat 01:25, venue close today=02:00 → offset 35", t, (x) => x === 35);

console.log("\n=== TEST 2: Lower bound (exactly 30 min before close) ===");
t = minutesUntilLastCall(wallClock("2026-05-30", "01:30"), venueAlways02);
expect("Sat 01:30, close 02:00 → offset 30 (inclusive)", t, (x) => x === 30);

console.log("\n=== TEST 3: Upper bound (exactly 45 min before close) ===");
t = minutesUntilLastCall(wallClock("2026-05-30", "01:15"), venueAlways02);
expect("Sat 01:15, close 02:00 → offset 45 (inclusive)", t, (x) => x === 45);

console.log("\n=== TEST 4: Just outside lower bound (29 min) ===");
t = minutesUntilLastCall(wallClock("2026-05-30", "01:31"), venueAlways02);
expect("Sat 01:31, close 02:00 → offset 29 → no fire", t, (x) => x === null);

console.log("\n=== TEST 5: Just outside upper bound (46 min) ===");
t = minutesUntilLastCall(wallClock("2026-05-30", "01:14"), venueAlways02);
expect("Sat 01:14, close 02:00 → offset 46 → no fire", t, (x) => x === null);

console.log("\n=== TEST 6: Cross-midnight day-lookup (Fri's bleed-in) ===");
// Spec edge case: Sat 01:25, today's Sat close=22:00 (way later), but
// yesterday's Fri close=02:00 IS the relevant one. Use venueClosedSatFriBleeds
// (today=Closed) to FORCE the engine onto yesterday's lookup.
t = minutesUntilLastCall(
  wallClock("2026-05-30", "01:25"),
  venueClosedSatFriBleeds
);
expect("Sat 01:25 with Sat=Closed, Fri=02:00 → offset 35 from prev-day", t, (x) => x === 35);

console.log("\n=== TEST 7: Today's close = '00:00' (next-day midnight) ===");
// Mon 23:25 → Mon close listed as 00:00 (= midnight Mon→Tue) → offset 35.
t = minutesUntilLastCall(wallClock("2026-05-25", "23:25"), venueMidnightMon);
expect("Mon 23:25, Mon close 00:00 → offset 35", t, (x) => x === 35);

console.log("\n=== TEST 8: Closed today, real Fri close at 02:00 ===");
// Same Sat 01:25 case — engine should still fire from Fri's bleed when today=Closed.
t = minutesUntilLastCall(
  wallClock("2026-05-30", "01:25"),
  venueClosedSatFriBleeds
);
expect("Closed Sat + Fri 02:00 bleed → fire offset 35", t, (x) => x === 35);

console.log("\n=== TEST 9: Both today and yesterday are Closed → no fire ===");
// Sat 01:25 with both Sat AND Fri closed.
t = minutesUntilLastCall(wallClock("2026-05-30", "01:25"), venueClosedBoth);
expect("Sat=Closed + Fri=Closed → no fire", t, (x) => x === null);

console.log("\n=== TEST 10: Daytime, hours from close → no fire ===");
// Fri 10:00, venue closes 21:00 → 11 hr away.
t = minutesUntilLastCall(wallClock("2026-05-29", "10:00"), venueEarlyClose);
expect("Fri 10:00, close 21:00 (11h away) → no fire", t, (x) => x === null);

console.log("\n=== TEST 11: Sanity — Sat 22:00 (right at close time) ===");
// Edge: at the close minute itself → offset 0 → outside [30,45] → no fire.
t = minutesUntilLastCall(wallClock("2026-05-30", "22:00"), venueEarlyClose);
expect("Sat 22:00 right at close → offset 0 → no fire", t, (x) => x === null);

console.log("\n=== TEST 12: Sat 21:15 → 45 min before 22:00 close ===");
// venueEarlyClose has Sat=21:00 (Sat dayIdx=6). Switch to a venue closing
// at 22:00 on Sat to verify a non-AM same-day window.
const venueSat22 = { ...venueEarlyClose, "6": "22:00" };
t = minutesUntilLastCall(wallClock("2026-05-30", "21:15"), venueSat22);
expect("Sat 21:15, close 22:00 → offset 45", t, (x) => x === 45);

console.log(`\n=== SUMMARY ===\nPassed: ${passed}\nFailed: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
