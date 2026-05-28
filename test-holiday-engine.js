// Sprint 49: Localized BYOD Holiday Engine — TDD scaffold.
// Validates the 10-entry Temporal Logic Matrix (window membership across
// normal + split + cross-midnight windows) AND the 1.5x stacking math
// against finalRideMod (anti-goal: NEVER touch finalFoodMod).
// Mirror the in-route constants/helpers verbatim so the test acts as a contract.

const HOLIDAY_WINDOWS = {
  "New Year's Day": [
    { start: 0, end: 180 },     // 00:00-03:00
    { start: 600, end: 780 },   // 10:00-13:00
  ],
  "Super Bowl Sunday": [{ start: 1290, end: 30 }],   // 21:30-00:30 (cross-midnight)
  "Valentine's Day":   [{ start: 1080, end: 1410 }], // 18:00-23:30
  "St. Patrick's Day": [{ start: 900, end: 120 }],   // 15:00-02:00 (cross)
  "Cinco de Mayo":     [{ start: 1020, end: 60 }],   // 17:00-01:00 (cross)
  "4th of July":       [{ start: 1290, end: 1410 }], // 21:30-23:30
  "Halloween":         [{ start: 1200, end: 180 }],  // 20:00-03:00 (cross)
  "Thanksgiving":      [{ start: 1140, end: 120 }],  // 19:00-02:00 (cross)
  "Christmas":         [{ start: 1080, end: 60 }],   // 18:00-01:00 (cross)
  "New Year's Eve":    [{ start: 1200, end: 180 }],  // 20:00-03:00 (cross)
};

function isInHolidayWindow(holiday, wallMinutes) {
  const windows = HOLIDAY_WINDOWS[holiday];
  if (!Array.isArray(windows)) return false;
  for (const { start, end } of windows) {
    if (start <= end) {
      if (wallMinutes >= start && wallMinutes <= end) return true;
    } else {
      // Cross-midnight window: 21:30-00:30 fires for both 22:00 (>=1290) and 00:15 (<=30).
      if (wallMinutes >= start || wallMinutes <= end) return true;
    }
  }
  return false;
}

// Boost math contract: holiday multiplier stacks multiplicatively onto
// finalRideMod ONLY. finalFoodMod must never receive the 1.5x.
function applyHolidayBoost({ finalRideMod, finalFoodMod, holiday, wallMinutes }) {
  if (!isInHolidayWindow(holiday, wallMinutes)) {
    return { finalRideMod, finalFoodMod };
  }
  return { finalRideMod: finalRideMod * 1.5, finalFoodMod };
}

// ---- Assertions ----
let pass = 0;
let fail = 0;
function assert(name, actual, expected) {
  const eq =
    typeof expected === "number"
      ? Math.abs(actual - expected) < 0.0001
      : actual === expected;
  if (eq) {
    pass++;
    console.log(`PASS — ${name}`);
  } else {
    fail++;
    console.log(`FAIL — ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// --- Matrix membership ---

// Halloween (cross-midnight 20:00-03:00)
assert("Halloween 22:00 in window", isInHolidayWindow("Halloween", 22 * 60), true);
assert("Halloween 02:00 in window (cross-midnight)", isInHolidayWindow("Halloween", 2 * 60), true);
assert("Halloween 20:00 boundary (start)", isInHolidayWindow("Halloween", 20 * 60), true);
assert("Halloween 03:00 boundary (end)", isInHolidayWindow("Halloween", 3 * 60), true);
assert("Halloween 19:59 NOT in window", isInHolidayWindow("Halloween", 19 * 60 + 59), false);
assert("Halloween 03:01 NOT in window", isInHolidayWindow("Halloween", 3 * 60 + 1), false);

// Valentine's Day (non-crossing 18:00-23:30)
assert("Valentine's 19:00 in window", isInHolidayWindow("Valentine's Day", 19 * 60), true);
assert("Valentine's 23:30 boundary (end)", isInHolidayWindow("Valentine's Day", 23 * 60 + 30), true);
assert("Valentine's 23:31 NOT in window", isInHolidayWindow("Valentine's Day", 23 * 60 + 31), false);
assert("Valentine's 17:59 NOT in window", isInHolidayWindow("Valentine's Day", 17 * 60 + 59), false);

// New Year's Day (split window 00:00-03:00 AND 10:00-13:00)
assert("NYD 01:00 in first window", isInHolidayWindow("New Year's Day", 60), true);
assert("NYD 11:00 in second window", isInHolidayWindow("New Year's Day", 11 * 60), true);
assert("NYD 04:00 NOT in either", isInHolidayWindow("New Year's Day", 4 * 60), false);
assert("NYD 14:00 NOT in either", isInHolidayWindow("New Year's Day", 14 * 60), false);

// 4th of July (tight 21:30-23:30)
assert("4th 21:30 boundary (start)", isInHolidayWindow("4th of July", 21 * 60 + 30), true);
assert("4th 23:30 boundary (end)", isInHolidayWindow("4th of July", 23 * 60 + 30), true);
assert("4th 21:29 NOT in window", isInHolidayWindow("4th of July", 21 * 60 + 29), false);
assert("4th 23:31 NOT in window", isInHolidayWindow("4th of July", 23 * 60 + 31), false);

// Super Bowl Sunday (tight cross-midnight 21:30-00:30)
assert("Super Bowl 22:00 in window", isInHolidayWindow("Super Bowl Sunday", 22 * 60), true);
assert("Super Bowl 00:30 boundary (end)", isInHolidayWindow("Super Bowl Sunday", 30), true);
assert("Super Bowl 00:31 NOT in window", isInHolidayWindow("Super Bowl Sunday", 31), false);
assert("Super Bowl 21:29 NOT in window", isInHolidayWindow("Super Bowl Sunday", 21 * 60 + 29), false);

// Unknown holiday → never fires
assert("Unknown holiday returns false", isInHolidayWindow("Easter Sunday", 12 * 60), false);

// --- Boost math ---

// Inside window: finalRideMod boosted 1.5x, finalFoodMod untouched
const inside = applyHolidayBoost({
  finalRideMod: 1.0,
  finalFoodMod: 1.5,
  holiday: "Halloween",
  wallMinutes: 22 * 60,
});
assert("inside-window ride 1.0 -> 1.5", inside.finalRideMod, 1.5);
assert("inside-window food untouched at 1.5", inside.finalFoodMod, 1.5);

// Outside window: no change
const outside = applyHolidayBoost({
  finalRideMod: 1.0,
  finalFoodMod: 1.5,
  holiday: "Halloween",
  wallMinutes: 12 * 60,
});
assert("outside-window ride unchanged 1.0", outside.finalRideMod, 1.0);
assert("outside-window food unchanged 1.5", outside.finalFoodMod, 1.5);

// Stacking: weather/supply already scaled rideMod to 2.25; holiday should yield 3.375
const stacked = applyHolidayBoost({
  finalRideMod: 2.25,   // e.g., 1.5 (weather) × 1.5 (supply drop)
  finalFoodMod: 0.75,
  holiday: "Christmas",
  wallMinutes: 20 * 60, // 20:00 inside 18:00-01:00 cross
});
assert("stacking 2.25 -> 3.375", stacked.finalRideMod, 3.375);
assert("stacking food still 0.75", stacked.finalFoodMod, 0.75);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
