// Sprint 67 — TDD scaffold for the BYOD Bus Inbound Pipeline.
// Validates the strict-filter regex parser BEFORE touching route.js / page.js.
//
// Spec rules (Sprint 67 §3.B):
//   - Identify blocks containing  Arriving \n [TIME]  AND  To \n [DESTINATION].
//   - STRICT FILTER: if the destination contains "SUNY" → drop the entry.
//   - Keep ONLY destinations naming "Greyhound Bus Terminal" or
//     "Trailways Bus Terminal" (anything else also drops).
//
// Output shape per surviving bus:
//   { arrivalTime, arrivalTimeRaw, destination, operator }
//     arrivalTime     "H:MM AM/PM"  → parseTimeLabel-compatible
//     arrivalTimeRaw  "H:MMp"       → mirrors Sprint 54 EventCard "Arrives:" line
//     destination     raw matched DESTINATION STRING from the To-block
//     operator        "Greyhound" | "Trailways"

function parseBusSchedule(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const text = rawText.replace(/\r\n/g, "\n");

  // Each trip block carries an `Arriving\n[time]` pair and a later
  // `To\n[destination]` pair. The non-greedy `[\s\S]*?` between them
  // binds the To-line to the SAME block (the next iteration starts after
  // the matched destination, so cross-block bleed is impossible).
  const pattern =
    /Arriving\s*\n\s*(\d{1,2}:\d{2})\s*([ap])m[\s\S]*?To\s*\n\s*([^\n]+)/gi;

  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const timeDigits = match[1];
    const ampmLetter = match[2].toLowerCase();
    const destination = match[3].trim();

    // Strict drop: SUNY buses are explicitly out-of-scope (Sprint 67 §6).
    if (/SUNY/i.test(destination)) continue;

    let operator;
    if (/Greyhound Bus Terminal/i.test(destination)) operator = "Greyhound";
    else if (/Trailways Bus Terminal/i.test(destination)) operator = "Trailways";
    else continue;

    const arrivalTime = `${timeDigits} ${ampmLetter.toUpperCase()}M`;
    const arrivalTimeRaw = `${timeDigits}${ampmLetter}`;
    results.push({ arrivalTime, arrivalTimeRaw, destination, operator });
  }
  return results;
}

// Spec mock (Sprint 67 §4) rewritten with the DOM line-break shape — each
// label and its value appear on adjacent lines, as a typical bus ticketing
// site renders them.
const SAMPLE = `Departing
5:00 pm
Arriving
7:55 pm
From
New York
To
Albany (Greyhound Bus Terminal)

Departing
5:00 pm
Arriving
8:15 pm
From
New York
To
Albany (SUNY)

Departing
7:30 pm
Arriving
11:15 pm
From
New York
To
Albany (Trailways Bus Terminal)

Departing
9:30 pm
Arriving
12:20 am
From
New York
To
Albany (Trailways Bus Terminal)`;

const results = [];

function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, actual, expected, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

const parsed = parseBusSchedule(SAMPLE);

// Assertion 1 (spec §4): exactly 3 valid buses survive.
assert("Exactly 3 valid buses parsed", parsed.length, 3);

// Assertion 2 (spec §4): the 8:15 pm SUNY entry is STRICTLY dropped.
assert(
  "SUNY entry dropped",
  parsed.filter((b) => /SUNY/i.test(b.destination)).length,
  0
);

// Whole-shape assertion: exact list of 3 surviving entries in order.
assert("All 3 surviving entries in order", parsed, [
  {
    arrivalTime: "7:55 PM",
    arrivalTimeRaw: "7:55p",
    destination: "Albany (Greyhound Bus Terminal)",
    operator: "Greyhound",
  },
  {
    arrivalTime: "11:15 PM",
    arrivalTimeRaw: "11:15p",
    destination: "Albany (Trailways Bus Terminal)",
    operator: "Trailways",
  },
  {
    arrivalTime: "12:20 AM",
    arrivalTimeRaw: "12:20a",
    destination: "Albany (Trailways Bus Terminal)",
    operator: "Trailways",
  },
]);

// Edge cases: empty / whitespace / non-string → [].
assert("Empty string → []", parseBusSchedule(""), []);
assert("Whitespace-only → []", parseBusSchedule("   \n\n  "), []);
assert("Non-string → []", parseBusSchedule(null), []);

// Standalone SUNY block also returns [] (proves the filter is global, not
// positional — the order/position of the SUNY block doesn't matter).
const SUNY_ONLY = `Departing
4:00 pm
Arriving
6:30 pm
From
New York
To
Albany (SUNY)`;
assert("SUNY-only input → []", parseBusSchedule(SUNY_ONLY), []);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
