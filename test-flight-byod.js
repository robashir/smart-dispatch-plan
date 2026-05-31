// Sprint 68 — TDD scaffold for the BYOD Flight Arrivals Pipeline.
// Validates parseFlightText (chunking + dictionary scan + telemetry +
// strict drop) AND the relaxed `HH:MM_IATA` dedupe fingerprint BEFORE
// touching app/api/dispatch/route.js (per Sprint 68 §7 + Dictionary Scan
// Overhaul §4 CRITICAL EXECUTION RULES).
//
// Spec rules (Sprint 68 Dictionary Scan Overhaul §2):
//   - Chunking: split lines, buffer until a `\d{1,2}:\d{2}[ap]m` time
//     line is hit, treat the buffered chunk as one flight block.
//   - Dictionary scan per block: iterate HUB_CITY_PATTERNS keys
//     (longest-first), substring-include test, take the FIRST match.
//   - Time extraction: `/\d{1,2}:\d{2}\s*[ap]m/i` anywhere in the block.
//     (`\s*` added to honor §3 "Format Agnostic" — supports both mobile
//     "10:07am" AND desktop "3:45 PM" without changing the dictionary.)
//   - Strict drop: no dictionary city OR no time → silently dropped.
//   - Retain telemetry: console.log("BYOD PARSE RESULT: ", { ... })
//     fires immediately before push.
//
// Test-only inline copies of parseFlightText, HUB_CITY_PATTERNS, and the
// relaxed-fingerprint dedupe step. The route.js port MUST be byte-identical
// or this test stops being authoritative.

const HUB_CITY_PATTERNS = {
  Orlando: "MCO",
  Atlanta: "ATL",
  Chicago: "ORD",
  "Dallas-Fort Worth": "DFW",
  "Dallas/Fort Worth": "DFW",
  Dallas: "DFW",
  Denver: "DEN",
  "Los Angeles": "LAX",
  "Las Vegas": "LAS",
  Miami: "MIA",
  Cancun: "CUN",
  "Fort Myers": "RSW",
  Maui: "OGG",
  "New York (JFK)": "JFK",
  "New York (LGA)": "LGA",
  LaGuardia: "LGA",
};

const HUB_CITY_KEYS_LONGEST_FIRST = Object.keys(HUB_CITY_PATTERNS).sort(
  (a, b) => b.length - a.length
);

function parseFlightText(rawText, offsetMin = 0) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];

  const now = new Date();
  const local = new Date(now.getTime() - offsetMin * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  const datePart = `${y}-${m}-${d}`;

  const sign = offsetMin >= 0 ? "-" : "+";
  const absOff = Math.abs(offsetMin);
  const offH = String(Math.floor(absOff / 60)).padStart(2, "0");
  const offM = String(absOff % 60).padStart(2, "0");
  const isoOffset = `${sign}${offH}:${offM}`;

  const TIME_RE = /(\d{1,2}):(\d{2})\s*([ap])m/i;

  // Chunking: buffer lines until a time line closes the block. Mobile
  // ALB board pastes each cell on its own line (Flight \n City \n Gate
  // \n Status \n Time), so the time line is the natural block terminator.
  // Horizontal desktop pastes also work — the whole row is one line
  // that contains the time, so the buffer flushes after that single line.
  const blocks = [];
  let buf = [];
  for (const line of rawText.split(/\r?\n/)) {
    buf.push(line);
    if (TIME_RE.test(line)) {
      blocks.push(buf.join("\n"));
      buf = [];
    }
  }
  // Trailing buffer without a time → silently dropped (no flight to push).

  const flights = [];
  for (const block of blocks) {
    const timeMatch = block.match(TIME_RE);
    if (!timeMatch) continue;
    const parsedTime = timeMatch[0];

    let matchedIata = null;
    let parsedCity = null;
    const blockLower = block.toLowerCase();
    for (const city of HUB_CITY_KEYS_LONGEST_FIRST) {
      if (blockLower.includes(city.toLowerCase())) {
        matchedIata = HUB_CITY_PATTERNS[city];
        parsedCity = city;
        break;
      }
    }
    if (!matchedIata) continue;

    console.log("BYOD PARSE RESULT: ", { parsedCity, parsedTime });

    let hour = Number(timeMatch[1]);
    const min = timeMatch[2];
    const ampm = timeMatch[3].toLowerCase() === "p" ? "PM" : "AM";
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const hourStr = String(hour).padStart(2, "0");

    const scheduled = `${datePart}T${hourStr}:${min}:00${isoOffset}`;
    flights.push({
      flight_status: "scheduled",
      arrival: { scheduled },
      departure: { iata: matchedIata, airport: parsedCity },
      airline: { iata: null },
      flight: { iata: null, number: null },
    });
  }
  return flights;
}

function relaxedFingerprint(flight) {
  const scheduled = flight?.arrival?.scheduled || "";
  const depIata = flight?.departure?.iata || "";
  const match = scheduled.match(/T(\d{2}):(\d{2})/);
  const timeKey = match ? `${match[1]}:${match[2]}` : scheduled;
  return `${timeKey}_${depIata}`;
}

const results = [];
function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, actual, expected, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

const EDT_OFFSET_MIN = 240;

// --- VERTICAL MOBILE-PASTE FIXTURE (the bug context) ---
// Per-cell newline-delimited blocks separated by a blank line. "Chicago O Hare"
// proves the dictionary scan matches the dictionary key "Chicago" even when
// the raw text carries extra trailing tokens. "Baltimore" + "Detroit" prove
// the strict drop fires when no dictionary key is present in the block.
const MOBILE_BOARD = `WN1234
Chicago O Hare
B12
On Time
10:07am

WN5678
Baltimore
A3
Delayed
11:30am

WN9012
Orlando
C5
On Time
12:45pm

DL222
Detroit
D1
On Time
2:30pm

AA555
Atlanta
B7
On Time
3:15pm`;

const parsedMobile = parseFlightText(MOBILE_BOARD, EDT_OFFSET_MIN);

// Assertion 1: exactly 3 dictionary cities survive (Baltimore + Detroit dropped).
assert("Mobile paste: 3 dictionary cities survive", parsedMobile.length, 3);

// Assertion 2: IATA list in paste order.
assert(
  "Mobile paste: IATA list in order",
  parsedMobile.map((f) => f.departure.iata),
  ["ORD", "MCO", "ATL"]
);

// Assertion 3: parsedCity passthrough — "Chicago O Hare" resolves to the
// dictionary KEY "Chicago" (not the raw line), so FlightCard renders "Chicago".
assert(
  "Mobile paste: parsedCity is dictionary key, not raw text",
  parsedMobile.map((f) => f.departure.airport),
  ["Chicago", "Orlando", "Atlanta"]
);

// Assertion 4: Chicago block extracted the mobile time "10:07am" and converted
// to local 24-hour 10:07 (no PM bump → "T10:07" in the ISO).
const chicagoRec = parsedMobile.find((f) => f.departure.iata === "ORD");
assert(
  "Chicago O Hare → ISO carries T10:07",
  /T10:07:00/.test(chicagoRec.arrival.scheduled),
  true
);
assert(
  "Chicago O Hare → ISO carries -04:00 (airport-local offset)",
  /-04:00$/.test(chicagoRec.arrival.scheduled),
  true
);

// Assertion 5: Atlanta block extracted "3:15pm" → 24-hour 15:15.
const atlantaRec = parsedMobile.find((f) => f.departure.iata === "ATL");
assert("Atlanta 3:15pm → ISO carries T15:15", /T15:15:00/.test(atlantaRec.arrival.scheduled), true);

// Assertion 6: Baltimore + Detroit dropped — neither IATA present.
assert(
  "Mobile paste: Baltimore + Detroit silently dropped",
  parsedMobile.filter((f) =>
    ["BWI", "DTW"].includes(f.departure.iata)
  ).length,
  0
);

// --- HORIZONTAL DESKTOP-PASTE FIXTURE (format-agnostic acceptance §3) ---
// Same parser must still handle a horizontal "TIME AIRLINE FLIGHT CITY STATUS"
// row layout because the dictionary scan is substring-only. Desktop format
// uses "3:45 PM" (space + uppercase + M); the regex tolerates the optional
// whitespace before [ap]m.
const DESKTOP_BOARD = `3:45 PM    Southwest 1234    Orlando        Arrived
5:35 PM    United 234        Chicago        On Time
8:05 PM    Spirit 777        Cancun         On Time`;

const parsedDesktop = parseFlightText(DESKTOP_BOARD, EDT_OFFSET_MIN);
assert("Desktop paste: 3 cities survive", parsedDesktop.length, 3);
assert(
  "Desktop paste: IATA list",
  parsedDesktop.map((f) => f.departure.iata),
  ["MCO", "ORD", "CUN"]
);

// --- LONGEST-MATCH-FIRST (preserved from prior assertion set) ---
const DFW_BLOCK = `AA999
Dallas-Fort Worth
B7
On Time
7:15pm`;
const parsedDfw = parseFlightText(DFW_BLOCK, EDT_OFFSET_MIN);
assert("Dallas-Fort Worth → DFW with full key", parsedDfw[0].departure.airport, "Dallas-Fort Worth");

// --- BLOCK WITH NO TIME → dropped ---
const NO_TIME_BLOCK = `WN0001
Orlando
B12
On Time`;
assert("Block with no time → []", parseFlightText(NO_TIME_BLOCK, EDT_OFFSET_MIN), []);

// --- BLOCK WITH TIME BUT NO DICT CITY → dropped ---
const NO_CITY_BLOCK = `WN0002
Boston
A1
On Time
4:00pm`;
assert("Block with no dict city → []", parseFlightText(NO_CITY_BLOCK, EDT_OFFSET_MIN), []);

// --- Edge cases ---
assert("Empty string → []", parseFlightText("", EDT_OFFSET_MIN), []);
assert("Whitespace-only → []", parseFlightText("   \n\n   ", EDT_OFFSET_MIN), []);
assert("Non-string → []", parseFlightText(null, EDT_OFFSET_MIN), []);

// --- Relaxed fingerprint dedupe (unchanged from Sprint 68 base) ---
const liveRecord = {
  flight_status: "scheduled",
  arrival: { scheduled: "2026-05-30T15:45:00-04:00" },
  departure: { iata: "MCO", airport: "Orlando International" },
  airline: { iata: "WN" },
  flight: { iata: "WN1234", number: "1234" },
};

// BYOD parsed record at the same time/IATA (constructed via the new parser).
const BYOD_MCO_SAME_TIME = `WN1234
Orlando
B12
Arrived
3:45pm`;
const byodRecord = parseFlightText(BYOD_MCO_SAME_TIME, EDT_OFFSET_MIN)[0];

assert(
  "Live and BYOD records share the relaxed fingerprint",
  relaxedFingerprint(liveRecord),
  relaxedFingerprint(byodRecord)
);
assert("Relaxed fingerprint matches spec example", relaxedFingerprint(liveRecord), "15:45_MCO");

function dedupeRelaxed(flights) {
  const seen = new Set();
  const kept = [];
  for (const f of flights) {
    const fp = relaxedFingerprint(f);
    if (seen.has(fp)) continue;
    seen.add(fp);
    kept.push(f);
  }
  return kept;
}
const merged = dedupeRelaxed([liveRecord, byodRecord]);
assert("Merged stream deduped to 1 record (same plane)", merged.length, 1);

const differentIata = {
  flight_status: "scheduled",
  arrival: { scheduled: "2026-05-30T15:45:00-04:00" },
  departure: { iata: "ATL", airport: "Hartsfield-Jackson" },
  airline: { iata: "DL" },
};
const merged2 = dedupeRelaxed([liveRecord, differentIata]);
assert("Two distinct IATAs same time → 2 records", merged2.length, 2);

const sameIataLater = {
  flight_status: "scheduled",
  arrival: { scheduled: "2026-05-30T17:30:00-04:00" },
  departure: { iata: "MCO", airport: "Orlando International" },
  airline: { iata: "WN" },
};
const merged3 = dedupeRelaxed([liveRecord, sameIataLater]);
assert("Same IATA different times → 2 records", merged3.length, 2);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
