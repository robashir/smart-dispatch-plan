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

    let status;
    if (/Sold Out/i.test(tail)) {
      status = "Sold Out";
    } else if (/Only\s+\d+\s+seat/i.test(tail)) {
      status = "Almost Full";
    } else {
      status = "On Time";
    }

    results.push({ trainNumber, status, time, arrivalTime: arrivalTimeRaw });
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

// Whole-shape assertion — exact list of 5 trains in order.
assert("All 5 trains parsed in order", parsed, [
  { trainNumber: "237", status: "Sold Out", time: "7:10 PM", arrivalTime: "7:10p" },
  { trainNumber: "239", status: "Sold Out", time: "8:28 PM", arrivalTime: "8:28p" },
  { trainNumber: "241", status: "Almost Full", time: "9:15 PM", arrivalTime: "9:15p" },
  { trainNumber: "243", status: "Almost Full", time: "11:59 PM", arrivalTime: "11:59p" },
  { trainNumber: "245", status: "On Time", time: "1:56 AM", arrivalTime: "1:56a" },
]);

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
  { trainNumber: "237", status: "Sold Out", time: "7:10 PM", arrivalTime: "7:10p" },
]);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
