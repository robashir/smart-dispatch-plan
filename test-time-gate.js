// Sprint 54 Phase 1 — TDD scaffold for the BYOD Time Gate.
// Validates the -10 min buffer math BEFORE touching route.js.
//
// Rules (locked by PO):
//   delta = arrivalMin - startMin                         (wall-clock minutes)
//   if (delta < -360) delta += 1440                       (cross-midnight rollover)
//   INCLUDE when delta >= -10 AND delta <= hoursNum * 60
//
// The -10 min buffer covers active unloading already underway when the
// driver hits dispatch. The 1440 rollover mirrors Sprint 32.1's time-decay
// engine so the same convention holds across the codebase.
//
// localStart is a wall-clock-as-UTC Date (per the Sprint 3.1 trick used
// throughout route.js) — UTC getters read the driver's wall-clock.

function parseTimeLabel(label) {
  if (!label || typeof label !== "string") return Infinity;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return Infinity;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + min;
}

function isTrainInWindow(arrivalTimeStr, localStart, hoursNum) {
  const arrivalMin = parseTimeLabel(arrivalTimeStr);
  if (!Number.isFinite(arrivalMin)) return false;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const hours = Number(hoursNum);
  if (!Number.isFinite(hours) || hours <= 0) return false;

  const startMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  let delta = arrivalMin - startMin;
  if (delta < -360) delta += 1440;

  return delta >= -10 && delta <= hours * 60;
}

// Build a wall-clock-as-UTC Date — mirrors how route.js shifts the real
// Date by the client's timezone offset so UTC getters return wall-clock.
function wallClockDate(hour, minute = 0) {
  return new Date(Date.UTC(2026, 4, 28, hour, minute, 0));
}

const results = [];

function assert(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, actual, expected, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${actual} expected=${expected}`
  );
}

// Standard window: 4:00 PM start, 2-hour window → end 6:00 PM.
const start4pm = wallClockDate(16, 0);

assert(
  "4:00 PM exact start → IN",
  isTrainInWindow("4:00 PM", start4pm, 2),
  true
);
assert(
  "6:00 PM exact end → IN",
  isTrainInWindow("6:00 PM", start4pm, 2),
  true
);
assert(
  "3:50 PM (-10 min buffer edge) → IN",
  isTrainInWindow("3:50 PM", start4pm, 2),
  true
);
assert(
  "3:55 PM (-5 min, mid-buffer) → IN",
  isTrainInWindow("3:55 PM", start4pm, 2),
  true
);
assert(
  "3:49 PM (-11 min, just past buffer) → OUT",
  isTrainInWindow("3:49 PM", start4pm, 2),
  false
);
assert(
  "6:01 PM (just past end) → OUT",
  isTrainInWindow("6:01 PM", start4pm, 2),
  false
);
assert(
  "5:30 PM (mid-window) → IN",
  isTrainInWindow("5:30 PM", start4pm, 2),
  true
);

// Cross-midnight: 11:55 PM start, 2-hour window → end 1:55 AM.
const start1155pm = wallClockDate(23, 55);

assert(
  "12:30 AM after 11:55 PM start (rollover) → IN",
  isTrainInWindow("12:30 AM", start1155pm, 2),
  true
);
assert(
  "11:50 PM (-5 min buffer before midnight start) → IN",
  isTrainInWindow("11:50 PM", start1155pm, 2),
  true
);
assert(
  "11:44 PM (-11 min, just past buffer) → OUT",
  isTrainInWindow("11:44 PM", start1155pm, 2),
  false
);
assert(
  "1:55 AM exact end → IN",
  isTrainInWindow("1:55 AM", start1155pm, 2),
  true
);
assert(
  "2:00 AM (just past end) → OUT",
  isTrainInWindow("2:00 AM", start1155pm, 2),
  false
);

// 4-hour window from 4:00 PM → end 8:00 PM. The original Sprint 53 sample:
assert(
  "237: 7:10 PM in 4h window from 4 PM → IN",
  isTrainInWindow("7:10 PM", start4pm, 4),
  true
);
assert(
  "239: 8:28 PM in 4h window from 4 PM → OUT",
  isTrainInWindow("8:28 PM", start4pm, 4),
  false
);
assert(
  "245: 1:56 AM in 4h window from 4 PM → OUT",
  isTrainInWindow("1:56 AM", start4pm, 4),
  false
);

// Invalid inputs.
assert("Empty arrival string → false", isTrainInWindow("", start4pm, 2), false);
assert("Non-string arrival → false", isTrainInWindow(null, start4pm, 2), false);
assert("Malformed arrival → false", isTrainInWindow("garbage", start4pm, 2), false);
assert("Non-Date localStart → false", isTrainInWindow("4:00 PM", null, 2), false);
assert("Zero hours → false", isTrainInWindow("4:00 PM", start4pm, 0), false);
assert("Negative hours → false", isTrainInWindow("4:00 PM", start4pm, -1), false);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
