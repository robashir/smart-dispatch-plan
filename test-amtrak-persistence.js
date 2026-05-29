// Sprint 58: BYOD Amtrak Persistence — TDD scaffold.
// Sprint 59: fs roundtrip stripped (trains now persist in browser
// localStorage, not on disk). The two contracts under test remain:
//   1. parseAmtrakText produces the Sprint 53/54 output shape.
//   2. The lazy auto-wipe: applyLazyWipe({savedDate, trains}, today)
//      returns [] when savedDate !== today, the saved array otherwise.
// Both functions now live client-side in app/page.js.

function parseAmtrakText(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const text = rawText.replace(/\r\n/g, "\n");
  const pattern =
    /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS[\s\S]*?ARRIVES\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g;

  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const trainNumber = match[1];
    const arrivalRaw = match[2];
    const ampmLetter = match[3].toUpperCase();
    const tail = match[4] || "";
    const time = `${arrivalRaw} ${ampmLetter}M`;
    const arrivalTime = `${arrivalRaw}${ampmLetter.toLowerCase()}`;
    let status;
    if (/Sold Out/i.test(tail)) status = "Sold Out";
    else if (/Only\s+\d+\s+seat/i.test(tail)) status = "Almost Full";
    else status = "On Time";
    results.push({ trainNumber, status, time, arrivalTime });
  }
  return results;
}

// The lazy auto-wipe: same shape as the client-side helper in page.js
// (handleDispatch reads localStorage["trainConfig"] then calls this).
// Garbage-in → []; stale-date → []; same-day → the saved trains.
function applyLazyWipe(stored, todayISO) {
  if (!stored || typeof stored !== "object") return [];
  if (stored.savedDate !== todayISO) return [];
  if (!Array.isArray(stored.trains)) return [];
  return stored.trains;
}

const SAMPLE = `237
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

const EXPECTED_TRAINS = [
  { trainNumber: "237", status: "Sold Out", time: "7:10 PM", arrivalTime: "7:10p" },
];

const results = [];
function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

// ─── Parser output shape ───
const parsed = parseAmtrakText(SAMPLE);
assert("Parser output matches expected shape", parsed, EXPECTED_TRAINS);
assert("Empty rawText → []", parseAmtrakText(""), []);

// ─── Lazy auto-wipe semantics ───
const todayPayload = { savedDate: "2026-05-29", trains: EXPECTED_TRAINS };
assert("Same-day payload returns trains", applyLazyWipe(todayPayload, "2026-05-29"), EXPECTED_TRAINS);
assert("Stale-date payload returns []", applyLazyWipe(todayPayload, "2026-05-30"), []);

const yesterdayPayload = { savedDate: "2026-05-28", trains: EXPECTED_TRAINS };
assert("Yesterday savedDate vs today returns []", applyLazyWipe(yesterdayPayload, "2026-05-29"), []);

// ─── Defensive: null / missing / malformed inputs all collapse to [] ───
assert("Null stored returns []", applyLazyWipe(null, "2026-05-29"), []);
assert("Undefined stored returns []", applyLazyWipe(undefined, "2026-05-29"), []);
assert("Missing trains key returns []", applyLazyWipe({ savedDate: "2026-05-29" }, "2026-05-29"), []);
assert("Non-array trains returns []", applyLazyWipe({ savedDate: "2026-05-29", trains: "nope" }, "2026-05-29"), []);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
