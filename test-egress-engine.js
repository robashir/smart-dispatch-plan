// Sprint 32: Event Egress Engine — TDD scaffold.
// Validates computeEventEgress BEFORE the logic gets ported into
// app/api/dispatch/route.js. Run: node test-egress-engine.js
//
// PO logic (locked):
//   Category durations: /sports/i = 3.5h, /arts|theatre/i = 2.5h, else 3.0h.
//   Mega-Venue keyword on venue name: /stadium|arena|amphitheater|coliseum/i
//   Mega-Venue   -> egressMod 2.5x, surge window ±30 min around projected end.
//   Standard     -> egressMod 2.0x, surge window ±15 min around projected end.
//   Outside the window -> 1.0 (no surge).

function computeEventEgress(event, currentLocalTime) {
  const segmentName = event?.segmentName || "";
  const venueName = event?.venueName || "";
  const startTime = event?.startTime;

  let durationHours;
  if (/sports/i.test(segmentName)) durationHours = 3.5;
  else if (/arts|theatre/i.test(segmentName)) durationHours = 2.5;
  else durationHours = 3.0;

  const isMegaVenue = /stadium|arena|amphitheater|coliseum/i.test(venueName);
  const egressMod = isMegaVenue ? 2.5 : 2.0;
  const windowMinutes = isMegaVenue ? 30 : 15;

  if (!(startTime instanceof Date) || Number.isNaN(startTime.getTime())) return 1.0;
  if (!(currentLocalTime instanceof Date) || Number.isNaN(currentLocalTime.getTime())) return 1.0;

  const end = new Date(startTime.getTime() + durationHours * 60 * 60 * 1000);
  const windowStart = new Date(end.getTime() - windowMinutes * 60 * 1000);
  const windowEnd = new Date(end.getTime() + windowMinutes * 60 * 1000);

  if (currentLocalTime >= windowStart && currentLocalTime <= windowEnd) return egressMod;
  return 1.0;
}

function assertEq(actual, expected, label) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | got=${actual} expected=${expected}`);
  if (!pass) process.exitCode = 1;
}

// Scenario A: Sports @ standard venue, inside 15-min window -> 2.0.
// Start 7:00 PM + 3.5h = end 10:30 PM. Window 10:15 PM - 10:45 PM. Current 10:20 PM -> hit.
assertEq(
  computeEventEgress(
    {
      segmentName: "Sports",
      venueName: "High School Field",
      startTime: new Date("2026-05-21T19:00:00Z"),
    },
    new Date("2026-05-21T22:20:00Z")
  ),
  2.0,
  "A: Sports 7 PM @ HS Field, current 10:20 PM (end 10:30, std window 10:15-10:45)"
);

// Scenario B: Music @ Mega-Venue, inside 30-min window -> 2.5.
// Start 8:00 PM + 3.0h = end 11:00 PM. Window 10:30 PM - 11:30 PM. Current 10:45 PM -> hit.
assertEq(
  computeEventEgress(
    {
      segmentName: "Music",
      venueName: "Madison Square Arena",
      startTime: new Date("2026-05-21T20:00:00Z"),
    },
    new Date("2026-05-21T22:45:00Z")
  ),
  2.5,
  "B: Music 8 PM @ Arena, current 10:45 PM (end 11:00, mega window 10:30-11:30)"
);

// Scenario C: Same event as B but too early -> 1.0.
// Current 9:00 PM is outside the 10:30 PM - 11:30 PM window.
assertEq(
  computeEventEgress(
    {
      segmentName: "Music",
      venueName: "Madison Square Arena",
      startTime: new Date("2026-05-21T20:00:00Z"),
    },
    new Date("2026-05-21T21:00:00Z")
  ),
  1.0,
  "C: Music 8 PM @ Arena, current 9 PM (outside 10:30-11:30 window)"
);

// Scenario D: Missing category + venue -> falls back to Music defaults (3.0h, ±15 min).
// Start 7:00 PM + 3.0h = end 10:00 PM. Window 9:45 PM - 10:15 PM. Current 10:00 PM -> hit at 2.0.
assertEq(
  computeEventEgress(
    { startTime: new Date("2026-05-21T19:00:00Z") },
    new Date("2026-05-21T22:00:00Z")
  ),
  2.0,
  "D: Missing category + venue, start 7 PM, current 10 PM (default 3h + ±15 min, hits at 2.0)"
);

// Scenario D-bonus: graceful fallback when there is no startTime at all.
assertEq(
  computeEventEgress({}, new Date("2026-05-21T22:00:00Z")),
  1.0,
  "D-bonus: No startTime -> graceful 1.0 (no surge)"
);
