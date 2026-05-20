// Sprint 21 — Data Structuring Phase 1 (Flights) TDD scaffolding
//
// Standalone validator for the rewritten `aggregateArrivalsByHour`. The
// function must now return a STRICT ARRAY of objects (not a dictionary of
// strings) so the future Next.js/React frontend can `.map()` directly.
//
// Expected shape per PO spec:
//   [{ type: "flight", hourBucket, volume, origins, leaveBy, hub: "ALB" }]
//
// Once this prints PASS, the same logic gets ported into
// app/api/dispatch/route.js (Phase 2).

const HIGH_VALUE_HUBS = ["MCO", "ATL", "ORD", "DFW", "DEN", "LAX", "LAS", "JFK", "LGA"];

function formatLeaveBy(date) {
  let h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function aggregateArrivalsByHour(flights, localStart, localEnd, offsetMin, rideMod = 1.0, minutesToAirport = 0) {
  const originsByHour = {};
  const earliestShiftedByHour = {};
  const seen = new Set();
  for (const f of flights) {
    const status = (f.flight_status || "").toLowerCase();
    if (status === "cancelled") continue;
    const scheduled = f.arrival?.scheduled;
    if (!scheduled) continue;

    const depIata = f.departure?.iata;
    if (!depIata || !HIGH_VALUE_HUBS.includes(depIata)) continue;

    const fingerprint = `${scheduled}|${depIata}|${f.departure?.airport || ""}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const arrivalUtc = new Date(scheduled);
    if (Number.isNaN(arrivalUtc.getTime())) continue;

    const shiftedUtc = new Date(arrivalUtc.getTime() + 30 * 60 * 1000);
    const shiftedLocal = new Date(shiftedUtc.getTime() - offsetMin * 60 * 1000);
    if (shiftedLocal < localStart || shiftedLocal >= localEnd) continue;

    let h = shiftedLocal.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const label = `${h} ${ampm}`;
    if (!originsByHour[label]) originsByHour[label] = [];
    originsByHour[label].push(depIata);

    if (!earliestShiftedByHour[label] || shiftedLocal < earliestShiftedByHour[label]) {
      earliestShiftedByHour[label] = shiftedLocal;
    }
  }

  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    const scaled = Math.round(codes.length * rideMod);
    if (scaled <= 0) continue;
    const earliest = earliestShiftedByHour[hour];
    const leaveByDate = new Date(earliest.getTime() - minutesToAirport * 60 * 1000);
    buckets.push({
      type: "flight",
      hourBucket: hour,
      volume: scaled,
      origins: codes,
      leaveBy: formatLeaveBy(leaveByDate),
      hub: "ALB",
    });
  }
  return buckets;
}

// --- Test harness ----------------------------------------------------------
// Scenario: 5 PM local bucket. offsetMin = 240 (EDT). minutesToAirport = 0.
// Two flights from MCO and ATL both arrive 20:30 UTC. After the +30-min egress
// shift → 21:00 UTC → wall-clock-as-UTC 17:00 (= 5 PM local bucket). With
// minutesToAirport = 0, leaveBy = earliest local arrival = 5:00 PM.

const localStart = new Date(Date.UTC(2026, 4, 20, 17, 0));
const localEnd = new Date(Date.UTC(2026, 4, 20, 18, 0));
const offsetMin = 240;

const flights = [
  { arrival: { scheduled: "2026-05-20T20:30:00Z" }, departure: { iata: "MCO" }, flight_status: "active" },
  { arrival: { scheduled: "2026-05-20T20:30:00Z" }, departure: { iata: "ATL" }, flight_status: "active" },
];

const expected = [
  {
    type: "flight",
    hourBucket: "5 PM",
    volume: 2,
    origins: ["MCO", "ATL"],
    leaveBy: "5:00 PM",
    hub: "ALB",
  },
];

const got = aggregateArrivalsByHour(flights, localStart, localEnd, offsetMin, 1.0, 0);

const pass = JSON.stringify(got) === JSON.stringify(expected);

console.log("=== Sprint 21 Flight Data Structuring — Test Run ===\n");
console.log((pass ? "PASS" : "FAIL") + " — aggregator returns strict array shape");
console.log("  expected " + JSON.stringify(expected));
console.log("  got      " + JSON.stringify(got));

// Bonus: empty input must return [] (not {}, not null).
const emptyGot = aggregateArrivalsByHour([], localStart, localEnd, offsetMin, 1.0, 0);
const emptyPass = Array.isArray(emptyGot) && emptyGot.length === 0;
console.log((emptyPass ? "PASS" : "FAIL") + " — empty input returns []");
console.log("  got      " + JSON.stringify(emptyGot));

const allPass = pass && emptyPass;
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
