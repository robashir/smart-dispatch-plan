// Sprint 61 Phase 1 — TDD scaffold for the Outbound Amtrak Ingress Engine.
// Validates the DEPARTS-time parser, the 60-min shift, the 40-min strict
// drop, and the clamp-to-now clause BEFORE touching route.js.
//
// Rules (locked by PO):
//   OUTBOUND_BUFFER_MINUTES = 60   (target arrival lead time at ESP)
//   OUTBOUND_DROP_THRESHOLD = 40   (under this, driver cannot make it)
//
//   delta = depMin - nowMin                              (wall-clock minutes)
//   if (delta < -360) delta += 1440                      (cross-midnight)
//
//   delta < 40                  → DROP (return null)
//   40 <= delta < 60            → leaveBy = formatTimeLabel(nowMin)
//   delta >= 60                 → leaveBy = formatTimeLabel(depMin - 60)
//
// localStart is a wall-clock-as-UTC Date (Sprint 3.1 trick) so UTC getters
// read the driver's wall-clock — mirrors test-time-gate.js conventions.

const OUTBOUND_BUFFER_MINUTES = 60;
const OUTBOUND_DROP_THRESHOLD = 40;

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

function formatTimeLabel(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function computeOutboundLeaveBy(departureTimeStr, localStart) {
  const depMin = parseTimeLabel(departureTimeStr);
  if (!Number.isFinite(depMin)) return null;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return null;
  const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  let delta = depMin - nowMin;
  if (delta < -360) delta += 1440;

  if (delta < OUTBOUND_DROP_THRESHOLD) return null;
  if (delta < OUTBOUND_BUFFER_MINUTES) return formatTimeLabel(nowMin);
  return formatTimeLabel(depMin - OUTBOUND_BUFFER_MINUTES);
}

// Direction-aware parser. When direction === "outbound" the regex anchors
// on DEPARTS (the time block immediately below it) instead of ARRIVES.
// Output shape unchanged so the existing { trainNumber, status, time,
// arrivalTime } consumers stay byte-compatible.
function parseAmtrakText(rawText, direction = "inbound") {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const text = rawText.replace(/\r\n/g, "\n");
  const pattern =
    direction === "outbound"
      ? /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g
      : /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS[\s\S]*?ARRIVES\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g;

  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const trainNumber = match[1];
    const rawTime = match[2];
    const ampmLetter = match[3].toUpperCase();
    const tail = match[4] || "";
    const time = `${rawTime} ${ampmLetter}M`;
    const arrivalTime = `${rawTime}${ampmLetter.toLowerCase()}`;
    let status;
    if (/Sold Out/i.test(tail)) status = "Sold Out";
    else if (/Only\s+\d+\s+seat/i.test(tail)) status = "Almost Full";
    else status = "On Time";
    results.push({ trainNumber, status, time, arrivalTime });
  }
  return results;
}

// Build a wall-clock-as-UTC Date — same convention as test-time-gate.js.
function wallClockDate(hour, minute = 0) {
  return new Date(Date.UTC(2026, 4, 28, hour, minute, 0));
}

const results = [];

function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, actual, expected, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

// --- Time math ---

// Standard 60-min shift: 5:00 PM departure, now = 3:00 PM (120 min away).
assert(
  "5:00 PM departure, now 3:00 PM (delta 120) → leaveBy 4:00 PM",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(15, 0)),
  "4:00 PM"
);

// 60-min boundary: delta exactly 60 → shift branch wins (leaveBy = now).
assert(
  "5:00 PM departure, now 4:00 PM (delta 60) → leaveBy 4:00 PM (shift edge)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(16, 0)),
  "4:00 PM"
);

// Clamp-to-now band [40, 60).
assert(
  "5:00 PM departure, now 4:10 PM (delta 50) → leaveBy 4:10 PM (clamp)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(16, 10)),
  "4:10 PM"
);

// 40-min boundary inclusive: still clamps, does not drop.
assert(
  "5:00 PM departure, now 4:20 PM (delta 40 exact) → leaveBy 4:20 PM (clamp edge)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(16, 20)),
  "4:20 PM"
);

// Strict drop at delta < 40.
assert(
  "5:00 PM departure, now 4:21 PM (delta 39) → null (drop)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(16, 21)),
  null
);
assert(
  "5:00 PM departure, now 4:30 PM (delta 30) → null (drop)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(16, 30)),
  null
);
assert(
  "5:00 PM departure, now 5:00 PM (delta 0) → null (drop)",
  computeOutboundLeaveBy("5:00 PM", wallClockDate(17, 0)),
  null
);

// Cross-midnight rollover: 12:30 AM departure, now 11:00 PM (delta 90).
assert(
  "12:30 AM departure, now 11:00 PM (rollover delta 90) → leaveBy 11:30 PM",
  computeOutboundLeaveBy("12:30 AM", wallClockDate(23, 0)),
  "11:30 PM"
);

// Cross-midnight inside the clamp band.
assert(
  "12:30 AM departure, now 11:45 PM (rollover delta 45) → leaveBy 11:45 PM (clamp)",
  computeOutboundLeaveBy("12:30 AM", wallClockDate(23, 45)),
  "11:45 PM"
);

// Cross-midnight in the drop band.
assert(
  "12:30 AM departure, now 11:55 PM (rollover delta 35) → null (drop)",
  computeOutboundLeaveBy("12:30 AM", wallClockDate(23, 55)),
  null
);

// Shift result that crosses backwards into PM — 1:00 AM dep → 12:00 AM leaveBy.
assert(
  "1:00 AM departure, now 10:00 PM prior day (rollover delta 180) → leaveBy 12:00 AM",
  computeOutboundLeaveBy("1:00 AM", wallClockDate(22, 0)),
  "12:00 AM"
);

// Invalid inputs.
assert(
  "Malformed departure label → null",
  computeOutboundLeaveBy("garbage", wallClockDate(16, 0)),
  null
);
assert(
  "Empty departure label → null",
  computeOutboundLeaveBy("", wallClockDate(16, 0)),
  null
);
assert(
  "Non-Date localStart → null",
  computeOutboundLeaveBy("5:00 PM", null),
  null
);

// --- Parser: DEPARTS capture for outbound ---

// Verbatim Sprint 53 sample reused so the regex symmetry is obvious.
const SAMPLE = `Departure
Thursday, May 28
New York, NY to Albany-Rensselaer, NY
NYP

ALB

Compare Fare Types

NYP to ALB
Fastest

237
Empire Service
DEPARTS
4:45
p

2h 25m
ARRIVES
7:10
p
Trip Details

Coach

from

$
59
Only 2 seats left


Business

Sold Out
NYP to ALB

239
Empire Service
DEPARTS
5:47
p

2h 41m
ARRIVES
8:28
p
Trip Details

Coach

from

$
99
Only 4 seats left


Business

Sold Out
NYP to ALB

241
Empire Service
DEPARTS
6:46
p

2h 29m
ARRIVES
9:15
p
Trip Details

Coach

from

$
99

Business

from

$
139
Only 1 seat left

NYP to ALB

243
Empire Service
DEPARTS
9:30
p

2h 29m
ARRIVES
11:59
p
Trip Details

Coach

from

$
44
Only 1 seat left


Business

from

$
115
Only 1 seat left

NYP to ALB
Lowest Fare

245
Empire Service
DEPARTS
11:25
p

2h 31m
ARRIVES
1:56
a
Fri, May 29
Trip Details

Coach

from

$
38

Business

Not Offered`;

assert(
  "Outbound parser captures DEPARTS times in order",
  parseAmtrakText(SAMPLE, "outbound"),
  [
    { trainNumber: "237", status: "Sold Out", time: "4:45 PM", arrivalTime: "4:45p" },
    { trainNumber: "239", status: "Sold Out", time: "5:47 PM", arrivalTime: "5:47p" },
    { trainNumber: "241", status: "Almost Full", time: "6:46 PM", arrivalTime: "6:46p" },
    { trainNumber: "243", status: "Almost Full", time: "9:30 PM", arrivalTime: "9:30p" },
    { trainNumber: "245", status: "On Time", time: "11:25 PM", arrivalTime: "11:25p" },
  ]
);

// Default direction must still capture ARRIVES — Sprint 60 behavior is unchanged.
assert(
  "Default (inbound) parser still captures ARRIVES — 1st train",
  parseAmtrakText(SAMPLE)[0],
  { trainNumber: "237", status: "Sold Out", time: "7:10 PM", arrivalTime: "7:10p" }
);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
