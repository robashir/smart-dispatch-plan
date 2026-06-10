// Sprint 53 Phase 1 — TDD scaffold for the BYOD Amtrak Pipeline.
// Validates the "Raw Text Dump" regex parser BEFORE touching route.js.
//
// Format (Amtrak booking page, NOT live status page):
//   Each train block carries DEPARTS / ARRIVES markers with the time digit
//   line and am/pm letter line separated. "On Time" / "Delayed" do NOT
//   appear in this view — derive status from "Sold Out" / "Only N seat".
//
// Status derivation:
//   "Sold Out" anywhere in block       → "Sold Out"
//   else "Only N seat" anywhere        → "Almost Full"
//   else                               → "On Time"
//
// Output shape per match: { trainNumber, status, time, arrivalTime }
//   time         "H:MM AM/PM"   for parseTimeLabel / time-decay engines
//   arrivalTime  "H:MMp" raw    for the EventCard "Arrives:" line (Sprint 54)

function parseFareAvailabilitySection(section = "") {
  const text = String(section);
  const seatMatch = text.match(/Only\s+(\d+)\s+(?:seat|room)s?\s+left/i);
  if (/not\s+offered/i.test(text)) return { status: "notOffered" };
  if (/sold\s+out/i.test(text)) return { status: "soldOut" };
  if (seatMatch) return { status: "almostFull", remaining: Number(seatMatch[1]) };
  if (/\bfrom\b|\$\s*\d+/i.test(text)) return { status: "available" };
  return { status: "unknown" };
}

function parseFareAvailability(tail = "") {
  const text = String(tail).replace(/\r\n/g, "\n");
  const labels = [
    ["coach", "Coach"],
    ["business", "Business"],
    ["privateRooms", "Private Rooms"],
  ];
  const availability = {};
  for (const [key, label] of labels) {
    const pattern = new RegExp(
      `${label}\\s*([\\s\\S]*?)(?=\\n\\s*(?:Coach|Business|Private Rooms)\\s*(?:\\n|$)|$)`,
      "i"
    );
    const match = text.match(pattern);
    availability[key] = match
      ? parseFareAvailabilitySection(match[1])
      : { status: "unknown" };
  }
  return availability;
}

function deriveAmtrakStatus(availability, fallbackText = "") {
  const statuses = [
    availability?.coach?.status,
    availability?.business?.status,
    availability?.privateRooms?.status,
  ];
  if (statuses.includes("soldOut")) return "Sold Out";
  if (statuses.includes("almostFull")) return "Almost Full";
  if (/Sold Out/i.test(fallbackText)) return "Sold Out";
  if (/Only\s+\d+\s+(?:seat|room)/i.test(fallbackText)) return "Almost Full";
  return "On Time";
}

function parseAmtrakText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  // Normalize CRLF → LF so the line-anchored regex works on Windows pastes.
  const text = rawText.replace(/\r\n/g, "\n");

  // Anchor on the DEPARTS / ARRIVES markers so we don't depend on the
  // service name (Empire / Lake Shore / Vermonter). Lookahead at the tail
  // captures everything between this block's am/pm letter and the start
  // of the next train block (or end of input) — that tail holds the
  // Coach / Business seat-availability strings used for status.
  const pattern =
    /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS[\s\S]*?ARRIVES\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g;

  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const trainNumber = match[1];
    const arrivalTime = match[2];
    const ampmLetter = match[3].toUpperCase();
    const tail = match[4] || "";

    const time = `${arrivalTime} ${ampmLetter}M`;
    // Sprint 54: raw "H:MMp" form (e.g., "5:47p") for the EventCard's
    // "Arrives:" line — preserves what the driver pasted verbatim.
    const arrivalTimeRaw = `${arrivalTime}${ampmLetter.toLowerCase()}`;

    const availability = parseFareAvailability(tail);
    const status = deriveAmtrakStatus(availability, tail);

    results.push({ trainNumber, status, time, arrivalTime: arrivalTimeRaw, availability });
  }
  return results;
}

// Verbatim sample data from the Amtrak booking page (Thursday 2026-05-28
// NYP → ALB lookup). 5 trains: 237, 239, 241, 243, 245.
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

const results = [];

function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, actual, expected, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

const parsed = parseAmtrakText(SAMPLE);
const legacyShape = parsed.map(({ trainNumber, status, time, arrivalTime }) => ({
  trainNumber,
  status,
  time,
  arrivalTime,
}));

// Whole-shape assertion — exact list of 5 trains in order.
assert("All 5 trains parsed in order", legacyShape, [
  { trainNumber: "237", status: "Sold Out", time: "7:10 PM", arrivalTime: "7:10p" },
  { trainNumber: "239", status: "Sold Out", time: "8:28 PM", arrivalTime: "8:28p" },
  { trainNumber: "241", status: "Almost Full", time: "9:15 PM", arrivalTime: "9:15p" },
  { trainNumber: "243", status: "Almost Full", time: "11:59 PM", arrivalTime: "11:59p" },
  { trainNumber: "245", status: "On Time", time: "1:56 AM", arrivalTime: "1:56a" },
]);
assert("Train 237 separates coach almost-full and business sold-out", parsed[0].availability, {
  coach: { status: "almostFull", remaining: 2 },
  business: { status: "soldOut" },
  privateRooms: { status: "unknown" },
});
assert("Train 241 separates business almost-full from available coach", parsed[2].availability, {
  coach: { status: "available" },
  business: { status: "almostFull", remaining: 1 },
  privateRooms: { status: "unknown" },
});
assert("Train 245 preserves business not offered", parsed[4].availability, {
  coach: { status: "available" },
  business: { status: "notOffered" },
  privateRooms: { status: "unknown" },
});

// Empty / whitespace-only / non-string inputs all return [].
assert("Empty string → []", parseAmtrakText(""), []);
assert("Whitespace-only → []", parseAmtrakText("   \n\n  "), []);
assert("Non-string → []", parseAmtrakText(null), []);

// Single-train slice still parses (driver may paste one block at a time).
const SINGLE = `237
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

Sold Out`;
assert("Single-train slice", parseAmtrakText(SINGLE), [
  {
    trainNumber: "237",
    status: "Sold Out",
    time: "7:10 PM",
    arrivalTime: "7:10p",
    availability: {
      coach: { status: "almostFull", remaining: 2 },
      business: { status: "soldOut" },
      privateRooms: { status: "unknown" },
    },
  },
]);

const PRIVATE_ROOM_SAMPLE = `49
Lake Shore Limited
DEPARTS
3:40
p

2h 40m
ARRIVES
6:20
p
Trip Details

Coach

from

$
91

Business

Not Offered

Private Rooms

Sold Out`;

assert("Private-room sold out is parsed separately", parseAmtrakText(PRIVATE_ROOM_SAMPLE)[0].availability, {
  coach: { status: "available" },
  business: { status: "notOffered" },
  privateRooms: { status: "soldOut" },
});

const JUNE_10_SAMPLE = `Departure
Wednesday, June 10
New York, NY to Albany-Rensselaer, NY
NYP

ALB

Compare Fare Types

NYP to ALB
Lowest Fare

291
Ethan Allen Express
DEPARTS
2:19
p

2h 30m
ARRIVES
4:49
p
Trip Details

Coach

from

$
38
Only 1 seat left


Business

Sold Out

Private Rooms

Not Offered
NYP to ALB

235
Empire Service
DEPARTS
3:15
p

2h 32m
ARRIVES
5:47
p
Trip Details

Coach

from

$
91

Business

Not Offered

Private Rooms

Not Offered`;

const june10Parsed = parseAmtrakText(JUNE_10_SAMPLE);
assert(
  "June 10 paste parses first two inbound arrivals",
  june10Parsed.map(({ trainNumber, status, time, arrivalTime }) => ({
    trainNumber,
    status,
    time,
    arrivalTime,
  })),
  [
    { trainNumber: "291", status: "Sold Out", time: "4:49 PM", arrivalTime: "4:49p" },
    { trainNumber: "235", status: "On Time", time: "5:47 PM", arrivalTime: "5:47p" },
  ]
);
assert("June 10 train 291 keeps coach/business/private availability", june10Parsed[0].availability, {
  coach: { status: "almostFull", remaining: 1 },
  business: { status: "soldOut" },
  privateRooms: { status: "notOffered" },
});

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
