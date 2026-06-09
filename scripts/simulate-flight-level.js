// Sprint 86 - Flight-Level Demand Simulator.
//
// Compares the current hourly bucket behavior with a proposed individual
// high-value-flight model using fake data only. No production dispatch code
// is changed by this script.

const HIGH_VALUE_HUBS = ["MCO", "ATL", "ORD", "DFW", "DEN", "LAX", "LAS", "JFK", "LGA"];
const HUB_IATA_TO_CITY = {
  MCO: "Orlando",
  ATL: "Atlanta",
  ORD: "Chicago",
  DFW: "Dallas-Fort Worth",
  DEN: "Denver",
  LAX: "Los Angeles",
  LAS: "Las Vegas",
  JFK: "New York (JFK)",
  LGA: "LaGuardia",
};

const ALB_EGRESS_MINUTES = 25;
const MINUTES_TO_AIRPORT = 15;
const localStart = new Date(Date.UTC(2026, 5, 9, 15, 0)); // 3:00 PM wall-clock
const localEnd = new Date(Date.UTC(2026, 5, 9, 19, 0));   // 7:00 PM wall-clock

const flights = [
  {
    id: "WN123-live",
    flight: { iata: "WN123" },
    flight_status: "scheduled",
    departure: { iata: "MCO", airport: "Orlando International" },
    airline: { iata: "WN" },
    arrival: {
      scheduled: "2026-06-09T16:05:00",
      estimated: "2026-06-09T16:30:00",
    },
  },
  {
    id: "DL456",
    flight: { iata: "DL456" },
    flight_status: "scheduled",
    departure: { iata: "ATL", airport: "Atlanta" },
    airline: { iata: "DL" },
    arrival: {
      scheduled: "2026-06-09T16:55:00",
      estimated: "2026-06-09T16:55:00",
    },
  },
  {
    id: "UA789-delayed-out",
    flight: { iata: "UA789" },
    flight_status: "scheduled",
    departure: { iata: "DEN", airport: "Denver" },
    airline: { iata: "UA" },
    arrival: {
      scheduled: "2026-06-09T18:20:00",
      estimated: "2026-06-09T19:30:00",
    },
  },
  {
    id: "AA222-delayed-in",
    flight: { iata: "AA222" },
    flight_status: "scheduled",
    departure: { iata: "DFW", airport: "Dallas/Fort Worth" },
    airline: { iata: "AA" },
    arrival: {
      scheduled: "2026-06-09T14:40:00",
      estimated: "2026-06-09T15:20:00",
    },
  },
  {
    id: "B612-cancelled",
    flight: { iata: "B612" },
    flight_status: "cancelled",
    departure: { iata: "JFK", airport: "New York" },
    airline: { iata: "B6" },
    arrival: {
      scheduled: "2026-06-09T17:10:00",
      estimated: "2026-06-09T17:10:00",
    },
  },
  {
    id: "WN123-byod-duplicate",
    flight: { iata: "WN123" },
    flight_status: "scheduled",
    departure: { iata: "MCO", airport: "Orlando" },
    airline: { iata: "WN" },
    arrival: {
      scheduled: "2026-06-09T16:05:00",
      estimated: "2026-06-09T16:30:00",
    },
  },
  {
    id: "LOCAL-ignored",
    flight: { iata: "AA999" },
    flight_status: "scheduled",
    departure: { iata: "PHL", airport: "Philadelphia" },
    airline: { iata: "AA" },
    arrival: {
      scheduled: "2026-06-09T16:15:00",
      estimated: "2026-06-09T16:15:00",
    },
  },
];

function parseIsoLocal(value) {
  if (!value) return null;
  const match = String(value).match(/T(\d{2}):(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(2026, 5, 9, Number(match[1]), Number(match[2])));
}

function formatTime(date) {
  let h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

function hourLabel(date) {
  let h = date.getUTCHours();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h} ${ampm}`;
}

function effectiveArrival(flight) {
  return (
    parseIsoLocal(flight.arrival?.actual) ||
    parseIsoLocal(flight.arrival?.estimated) ||
    parseIsoLocal(flight.arrival?.scheduled)
  );
}

function scheduledArrival(flight) {
  return parseIsoLocal(flight.arrival?.scheduled);
}

function fingerprintOld(flight) {
  const scheduled = flight.arrival?.scheduled || "";
  const match = scheduled.match(/T(\d{2}):(\d{2})/);
  const time = match ? `${match[1]}:${match[2]}` : scheduled;
  return `${time}_${flight.departure?.iata || ""}`;
}

function fingerprintNew(flight) {
  const ident = flight.flight?.iata || flight.flight?.number || "";
  const origin = flight.departure?.iata || "";
  const effective = flight.arrival?.actual || flight.arrival?.estimated || flight.arrival?.scheduled || "";
  return `${ident}_${origin}_${effective}`;
}

function eligibleFlights(raw, fingerprintFn) {
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const flight of raw) {
    const status = String(flight.flight_status || "").toLowerCase();
    const origin = flight.departure?.iata;
    const fp = fingerprintFn(flight);
    if (status === "cancelled") {
      dropped.push(`${flight.id}: cancelled`);
      continue;
    }
    if (!HIGH_VALUE_HUBS.includes(origin)) {
      dropped.push(`${flight.id}: non-high-value origin ${origin}`);
      continue;
    }
    if (seen.has(fp)) {
      dropped.push(`${flight.id}: duplicate ${fp}`);
      continue;
    }
    seen.add(fp);
    kept.push(flight);
  }
  return { kept, dropped };
}

function currentHourlyModel(raw) {
  const { kept, dropped } = eligibleFlights(raw, fingerprintOld);
  const buckets = new Map();
  for (const flight of kept) {
    const scheduled = scheduledArrival(flight);
    if (!scheduled) continue;
    const curb = new Date(scheduled.getTime() + ALB_EGRESS_MINUTES * 60000);
    if (curb < localStart || curb >= localEnd) {
      dropped.push(`${flight.id}: scheduled curb ${formatTime(curb)} outside window`);
      continue;
    }
    const label = hourLabel(curb);
    const bucket = buckets.get(label) || {
      hourBucket: label,
      volume: 0,
      origins: [],
      earliestCurb: curb,
    };
    bucket.volume += 1;
    bucket.origins.push(flight.departure.iata);
    if (curb < bucket.earliestCurb) bucket.earliestCurb = curb;
    buckets.set(label, bucket);
  }
  return {
    rows: [...buckets.values()].map((bucket) => ({
      hourBucket: bucket.hourBucket,
      volume: bucket.volume,
      origins: bucket.origins,
      leaveBy: formatTime(new Date(bucket.earliestCurb.getTime() - MINUTES_TO_AIRPORT * 60000)),
    })),
    dropped,
  };
}

function proposedFlightLevelModel(raw) {
  const { kept, dropped } = eligibleFlights(raw, fingerprintNew);
  const rows = [];
  for (const flight of kept) {
    const scheduled = scheduledArrival(flight);
    const effective = effectiveArrival(flight);
    if (!scheduled || !effective) continue;
    const curb = new Date(effective.getTime() + ALB_EGRESS_MINUTES * 60000);
    if (curb < localStart || curb >= localEnd) {
      dropped.push(`${flight.id}: effective curb ${formatTime(curb)} outside window`);
      continue;
    }
    const delayMinutes = Math.round((effective.getTime() - scheduled.getTime()) / 60000);
    rows.push({
      flight: flight.flight?.iata || flight.id,
      origin: flight.departure.iata,
      originLabel: HUB_IATA_TO_CITY[flight.departure.iata] || flight.departure.iata,
      scheduled: formatTime(scheduled),
      effective: formatTime(effective),
      curb: formatTime(curb),
      delayMinutes,
      leaveBy: formatTime(new Date(curb.getTime() - MINUTES_TO_AIRPORT * 60000)),
      confidence: flight.arrival?.actual ? "actual" : flight.arrival?.estimated ? "estimated" : "scheduled",
    });
  }
  rows.sort((a, b) => a.curb.localeCompare(b.curb));
  return { rows, dropped };
}

const hourly = currentHourlyModel(flights);
const flightLevel = proposedFlightLevelModel(flights);

console.log("=== Flight-Level Demand Simulator ===");
console.log(`Window: ${formatTime(localStart)} - ${formatTime(localEnd)} | ALB curb shift: +${ALB_EGRESS_MINUTES}m | Driver travel: ${MINUTES_TO_AIRPORT}m\n`);

console.log("Current hourly bucket model:");
console.table(hourly.rows);
console.log("Dropped / ignored:");
for (const line of hourly.dropped) console.log(`  - ${line}`);

console.log("\nProposed individual-flight model:");
console.table(flightLevel.rows);
console.log("Dropped / ignored:");
for (const line of flightLevel.dropped) console.log(`  - ${line}`);

console.log("\nKey comparison:");
console.log("- DFW is delayed into the active window in the proposed model.");
console.log("- DEN is delayed out of the active window in the proposed model.");
console.log("- MCO duplicate is removed in both models.");
console.log("- Proposed rows preserve exact leave-by time per high-value flight.");
