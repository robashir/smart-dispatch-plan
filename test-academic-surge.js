// Sprint 57: Unified Event Database — TDD scaffold.
// Sprint 59: fs roundtrip stripped (config moved to browser localStorage,
// no longer round-trips through disk). The findActiveEvent contract is
// unchanged — the eventConfig object is now passed in-memory instead of
// being mock-written to /tmp and read back.

// ---- YMD helper (mirrors toYmd in route.js) ----
function toYmd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---- The contract under test ----
// Iterates the eventConfig object and returns the first matching entry
// (with its `name` key attached) or null. Match semantics:
//   - type "holiday" / activeWindows null|undefined|empty: today's date matches → fire
//   - type "academic" with activeWindows: today's date matches AND dispatchHour
//     falls inside one of the windows; OR yesterday's date matches AND
//     (dispatchHour + 24) falls inside a window (cross-midnight tail).
function findActiveEvent(dispatchDate, dispatchHour, eventConfig) {
  if (!eventConfig || typeof eventConfig !== "object") return null;
  if (!(dispatchDate instanceof Date) || Number.isNaN(dispatchDate.getTime())) return null;
  if (!Number.isFinite(dispatchHour)) return null;

  const todayYmd = toYmd(dispatchDate);
  const prevDay = new Date(dispatchDate.getTime() - 24 * 60 * 60 * 1000);
  const prevYmd = toYmd(prevDay);

  for (const [name, entry] of Object.entries(eventConfig)) {
    if (!entry || typeof entry !== "object" || typeof entry.date !== "string") continue;

    const windows = Array.isArray(entry.activeWindows) ? entry.activeWindows : null;

    // Holiday-style match (no windows): just date.
    if (!windows || windows.length === 0) {
      if (entry.date === todayYmd) return { name, ...entry };
      continue;
    }

    // Academic-style match: date + window membership (same-day or cross-midnight).
    for (const w of windows) {
      if (
        entry.date === todayYmd &&
        dispatchHour >= w.start &&
        dispatchHour <= w.end
      ) {
        return { name, ...entry };
      }
      if (entry.date === prevYmd) {
        const shifted = dispatchHour + 24;
        if (shifted >= w.start && shifted <= w.end) {
          return { name, ...entry };
        }
      }
    }
  }
  return null;
}

function isActiveSurge(dispatchDate, dispatchHour, eventConfig) {
  return findActiveEvent(dispatchDate, dispatchHour, eventConfig) !== null;
}

// ---- In-memory event config fixture (Sprint 59: no fs roundtrip) ----
const eventConfig = {
  Halloween: {
    date: "2026-10-31",
    type: "holiday",
    multiplier: 3.5,
    activeWindows: null,
  },
  "New Year's Day": {
    date: "2026-01-01",
    type: "holiday",
    multiplier: 3.5,
    activeWindows: null,
  },
  "Fall Move-In Day 1": {
    date: "2026-08-22",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [{ start: 9.0, end: 17.0 }],
  },
  Homecoming: {
    date: "2026-10-17",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [
      { start: 11.5, end: 14.5 },
      { start: 18.5, end: 20.0 },
      { start: 21.0, end: 23.0 },
      { start: 25.5, end: 27.0 },
    ],
  },
  "Halloweekend (Downtown)": {
    date: "2026-10-31",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [{ start: 21.0, end: 27.0 }],
  },
};

// Build a "wall-clock-as-UTC" Date for a given YMD + decimal hour. Mirrors
// the Sprint 3.1 trick — localStart is constructed the same way so
// getUTCHours() returns wall-clock hour.
function wallClockDate(ymd, decimalHour) {
  const [y, m, d] = ymd.split("-").map(Number);
  const hours = Math.floor(decimalHour);
  const minutes = Math.round((decimalHour - hours) * 60);
  return new Date(Date.UTC(y, m - 1, d, hours, minutes, 0));
}

// ---- Assertions ----
let pass = 0;
let fail = 0;
function assert(name, actual, expected) {
  const eq = actual === expected;
  if (eq) {
    pass++;
    console.log(`PASS — ${name}`);
  } else {
    fail++;
    console.log(`FAIL — ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
  }
}

// ---- Brief's required acceptance assertions ----

// 1) Dispatch at 12:00 PM on Homecoming → fires
{
  const d = wallClockDate("2026-10-17", 12.0);
  assert("Homecoming 12:00 PM triggers surge", isActiveSurge(d, 12.0, eventConfig), true);
}

// 2) Dispatch at 4:00 PM on Homecoming → falls in gap, NO trigger
{
  const d = wallClockDate("2026-10-17", 16.0);
  assert("Homecoming 4:00 PM falls in gap (no surge)", isActiveSurge(d, 16.0, eventConfig), false);
}

// 3) Dispatch at 2:00 AM the night of Homecoming → cross-midnight fires
{
  const d = wallClockDate("2026-10-18", 2.0);
  assert("Homecoming cross-midnight 2:00 AM triggers surge", isActiveSurge(d, 2.0, eventConfig), true);
}

// ---- Academic boundary + half-hour cases ----

{
  const d = wallClockDate("2026-10-17", 11.5);
  assert("Homecoming 11:30 AM start boundary", isActiveSurge(d, 11.5, eventConfig), true);
}
{
  const d = wallClockDate("2026-10-17", 14.5);
  assert("Homecoming 2:30 PM end boundary", isActiveSurge(d, 14.5, eventConfig), true);
}
{
  const d = wallClockDate("2026-10-17", 11 + 29 / 60);
  assert("Homecoming 11:29 AM just before start (no surge)", isActiveSurge(d, 11 + 29 / 60, eventConfig), false);
}
{
  const d = wallClockDate("2026-10-17", 20.25);
  assert("Homecoming 8:15 PM in gap (no surge)", isActiveSurge(d, 20.25, eventConfig), false);
}
{
  const d = wallClockDate("2026-10-18", 1.5);
  assert("Homecoming cross-midnight 1:30 AM start boundary", isActiveSurge(d, 1.5, eventConfig), true);
}
{
  const d = wallClockDate("2026-10-18", 3.0);
  assert("Homecoming cross-midnight 3:00 AM end boundary", isActiveSurge(d, 3.0, eventConfig), true);
}
{
  const d = wallClockDate("2026-10-18", 1 + 29 / 60);
  assert("Homecoming 1:29 AM just before cross start (no surge)", isActiveSurge(d, 1 + 29 / 60, eventConfig), false);
}
{
  const d = wallClockDate("2026-10-18", 3 + 1 / 60);
  assert("Homecoming 3:01 AM just after cross end (no surge)", isActiveSurge(d, 3 + 1 / 60, eventConfig), false);
}

// Simple 9-17 academic window
{
  const d = wallClockDate("2026-08-22", 12.0);
  assert("Move-In 12 PM triggers surge", isActiveSurge(d, 12.0, eventConfig), true);
}
{
  const d = wallClockDate("2026-08-22", 17 + 1 / 60);
  assert("Move-In 5:01 PM just past end (no surge)", isActiveSurge(d, 17 + 1 / 60, eventConfig), false);
}

// Halloweekend cross-midnight 21.0-27.0
{
  const d = wallClockDate("2026-10-31", 23.0);
  assert("Halloweekend 11:00 PM same-day triggers surge", isActiveSurge(d, 23.0, eventConfig), true);
}
{
  const d = wallClockDate("2026-11-01", 2.5);
  assert("Halloweekend cross-midnight 2:30 AM next day triggers surge", isActiveSurge(d, 2.5, eventConfig), true);
}

// ---- Holiday branch (no activeWindows) ----

{
  const d = wallClockDate("2026-10-31", 12.0);
  // Halloween fires at noon since holiday has no activeWindows → all day.
  assert("Halloween (holiday) at noon triggers surge", isActiveSurge(d, 12.0, eventConfig), true);
}
{
  const d = wallClockDate("2026-10-31", 23.0);
  assert("Halloween (holiday) at 11 PM triggers surge", isActiveSurge(d, 23.0, eventConfig), true);
}
{
  // Nov 1 is NOT Halloween — even at 2 AM Nov 1 the holiday branch does NOT
  // cross midnight (that's the documented behavioral simplification).
  const d = wallClockDate("2026-11-01", 2.0);
  const match = findActiveEvent(d, 2.0, eventConfig);
  // Halloweekend academic CAN still cross-midnight match here; assert by name
  // that it's Halloweekend (academic), not Halloween (holiday).
  assert(
    "Nov 1 2 AM is Halloweekend (academic), NOT Halloween (holiday)",
    match && match.type,
    "academic"
  );
}
{
  const d = wallClockDate("2026-01-01", 0.5);
  assert("NYD at 12:30 AM triggers surge", isActiveSurge(d, 0.5, eventConfig), true);
}
{
  const d = wallClockDate("2026-01-02", 0.5);
  assert("Jan 2 (after NYD) does NOT trigger surge", isActiveSurge(d, 0.5, eventConfig), false);
}

// ---- Defensive ----
{
  const d = wallClockDate("2026-06-15", 12.0);
  assert("Random non-event date does not trigger surge", isActiveSurge(d, 12.0, eventConfig), false);
}
assert("Null config returns null", findActiveEvent(new Date(), 12, null), null);
assert("Empty config returns null", findActiveEvent(new Date(), 12, {}), null);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
