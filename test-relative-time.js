// Sprint 65 — TDD scaffold for the Relative Time Indicator helper.
// Proves `computeRelativeTimeString` outputs the correct future / zero /
// past strings for both inbound (Arriving / Arrived) and outbound
// (Departing / Departed) kinds, plus survives cross-midnight wrap-around
// using the same delta convention as Sprint 61's computeOutboundLeaveBy
// (delta < -360 → +1440 ; delta > 720 → -1440).
//
// Run with: node test-relative-time.js
// Must exit with 0 failures BEFORE any edit to route.js or DispatchCards.jsx.

// --- The unit under test ---
// Mirrors the exact helper Sprint 65 will install in route.js. Pure
// function — non-finite inputs return null so the renderer can fall
// through to the absolute time without crashing.
function formatRelativeUnit(absMin) {
  if (absMin < 60) return `${absMin} mins`;
  const hrs = Math.floor(absMin / 60);
  const mins = absMin % 60;
  const hrLabel = hrs === 1 ? "1 hr" : `${hrs} hrs`;
  return mins === 0 ? hrLabel : `${hrLabel} ${mins} mins`;
}
function computeRelativeTimeString(targetMinutes, startMinutes, kind = "arrival") {
  if (!Number.isFinite(targetMinutes) || !Number.isFinite(startMinutes)) return null;
  let delta = targetMinutes - startMinutes;
  if (delta < -360) delta += 1440;
  else if (delta > 720) delta -= 1440;

  const futureVerb = kind === "departure" ? "Departing" : "Arriving";
  const pastVerb = kind === "departure" ? "Departed" : "Arrived";
  const unit = formatRelativeUnit(Math.abs(delta));
  if (delta < 0) return `${pastVerb} ${unit} ago`;
  return `${futureVerb} in ${unit}`;
}

// --- Assertion harness (mirrors test-amtrak-outbound.js style) ---
const results = [];
function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

// === 1. Future deltas ===

// 4:00 PM start (960) → 4:45 PM target (1005) = +45 min, arrival kind.
assert(
  "Future arrival 45 min ahead → 'Arriving in 45 mins'",
  computeRelativeTimeString(1005, 960, "arrival"),
  "Arriving in 45 mins"
);

// 4:00 PM start → 4:30 PM target = +30 min, departure kind.
assert(
  "Future departure 30 min ahead → 'Departing in 30 mins'",
  computeRelativeTimeString(990, 960, "departure"),
  "Departing in 30 mins"
);

// Default kind is "arrival" — no third arg. 60-min boundary collapses
// to the hours format ("1 hr") under the Sprint 65.1 unit rules.
assert(
  "Default kind = arrival, 60 min boundary → 'Arriving in 1 hr'",
  computeRelativeTimeString(1020, 960),
  "Arriving in 1 hr"
);

// === 2. Zero delta (the Precise Historian's zero state) ===

assert(
  "Zero delta arrival → 'Arriving in 0 mins'",
  computeRelativeTimeString(960, 960, "arrival"),
  "Arriving in 0 mins"
);
assert(
  "Zero delta departure → 'Departing in 0 mins'",
  computeRelativeTimeString(960, 960, "departure"),
  "Departing in 0 mins"
);

// === 3. Past deltas (NOT clamped) ===

// 4:30 PM start → 4:25 PM target = -5 min, arrival kind.
assert(
  "Past arrival 5 min ago → 'Arrived 5 mins ago'",
  computeRelativeTimeString(985, 990, "arrival"),
  "Arrived 5 mins ago"
);
// 4:30 PM start → 4:25 PM target = -5 min, departure kind.
assert(
  "Past departure 5 min ago → 'Departed 5 mins ago'",
  computeRelativeTimeString(985, 990, "departure"),
  "Departed 5 mins ago"
);
// Larger past delta (still inside the -360 window so no rollover applies).
// 90 min = "1 hr 30 mins" under Sprint 65.1.
assert(
  "Past arrival 90 min ago → 'Arrived 1 hr 30 mins ago'",
  computeRelativeTimeString(900, 990, "arrival"),
  "Arrived 1 hr 30 mins ago"
);

// === 3b. Hours-and-mins formatting (Sprint 65.1) ===

// Sub-60 stays as plain mins.
assert(
  "59 min future arrival stays as 'Arriving in 59 mins'",
  computeRelativeTimeString(1019, 960, "arrival"),
  "Arriving in 59 mins"
);

// 60 collapses to '1 hr' (singular).
assert(
  "60 min future departure → 'Departing in 1 hr'",
  computeRelativeTimeString(1020, 960, "departure"),
  "Departing in 1 hr"
);

// 75 min → '1 hr 15 mins'.
assert(
  "75 min future arrival → 'Arriving in 1 hr 15 mins'",
  computeRelativeTimeString(1035, 960, "arrival"),
  "Arriving in 1 hr 15 mins"
);

// 120 min exactly → '2 hrs' (plural, no trailing mins).
assert(
  "120 min future arrival → 'Arriving in 2 hrs'",
  computeRelativeTimeString(1080, 960, "arrival"),
  "Arriving in 2 hrs"
);

// 135 min → '2 hrs 15 mins'.
assert(
  "135 min future departure → 'Departing in 2 hrs 15 mins'",
  computeRelativeTimeString(1095, 960, "departure"),
  "Departing in 2 hrs 15 mins"
);

// Past 65 min → '1 hr 5 mins ago'.
assert(
  "65 min ago (arrival) → 'Arrived 1 hr 5 mins ago'",
  computeRelativeTimeString(925, 990, "arrival"),
  "Arrived 1 hr 5 mins ago"
);

// === 4. Cross-midnight rollovers ===

// Forward wrap: localStart = 11:30 PM (1410), target = 12:15 AM (15).
// Raw delta = -1395 → < -360 so +=1440 → 45 → future arrival.
assert(
  "Cross-midnight forward (11:30 PM → 12:15 AM) → 'Arriving in 45 mins'",
  computeRelativeTimeString(15, 1410, "arrival"),
  "Arriving in 45 mins"
);

// Forward wrap for outbound (driver's last shift hour, train at 12:30 AM).
// Raw delta = 30 - 1410 = -1380 → +=1440 → 60 → future departure.
// Sprint 65.1: 60 min collapses to '1 hr'.
assert(
  "Cross-midnight forward outbound (11:30 PM → 12:30 AM) → 'Departing in 1 hr'",
  computeRelativeTimeString(30, 1410, "departure"),
  "Departing in 1 hr"
);

// Backward wrap: localStart = 12:15 AM (15), target = 11:30 PM (1410).
// Raw delta = 1395 → > 720 so -=1440 → -45 → past arrival.
assert(
  "Cross-midnight backward (12:15 AM → 11:30 PM prior) → 'Arrived 45 mins ago'",
  computeRelativeTimeString(1410, 15, "arrival"),
  "Arrived 45 mins ago"
);

// Backward wrap for outbound.
assert(
  "Cross-midnight backward outbound → 'Departed 45 mins ago'",
  computeRelativeTimeString(1410, 15, "departure"),
  "Departed 45 mins ago"
);

// === 5. Invalid / non-finite inputs return null ===

assert(
  "Non-finite target → null",
  computeRelativeTimeString(NaN, 960, "arrival"),
  null
);
assert(
  "Non-finite start → null",
  computeRelativeTimeString(960, undefined, "arrival"),
  null
);
assert(
  "Both non-finite → null",
  computeRelativeTimeString(null, null, "arrival"),
  null
);
// parseTimeLabel returns Infinity on malformed labels — that's NOT finite
// either, so should also yield null (mirrors the helper's contract).
assert(
  "Infinity target (mirrors parseTimeLabel fail-mode) → null",
  computeRelativeTimeString(Infinity, 960, "arrival"),
  null
);

// === Summary ===
const failed = results.filter((r) => !r.pass);
console.log(`\n=== Sprint 65 relative-time tests: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.label}`);
  process.exit(1);
}
