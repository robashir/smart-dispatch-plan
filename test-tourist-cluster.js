// Sprint 47: Tourist Event Clustering — TDD scaffold.
// Validates computeTouristCluster BEFORE the logic gets ported into
// app/api/dispatch/route.js. Run: node test-tourist-cluster.js
//
// PO logic (locked):
//   Trigger: any non-cancelled flight whose `departure.iata` is in
//   LEISURE_HUBS AND whose `arrival.scheduled` is 1-4 hours before the
//   target event's projected start time.
//   Match -> exactly ONE synthetic event per target event (no spam).
//   No match (non-leisure hub, outside time window, etc.) -> null.
//   includeAirport === true  -> "ALB -> <venue>" + ["Airport -> Venue", "Tourist Surge"]
//   includeAirport === false -> "<venue>"       + ["Tourist Ripple", "Venue Staging"]
//   egressMod = 5.0 + targetEvent.egressMod (so it dominates Profitability sort).

const LEISURE_HUBS = ["MCO", "LAS", "MIA", "CUN", "RSW", "OGG"];

function computeTouristCluster({
  eventStartTime,
  eventLat,
  eventLng,
  venueName,
  eventEgressMod,
  flights,
  includeAirport,
}) {
  if (!(eventStartTime instanceof Date) || Number.isNaN(eventStartTime.getTime())) return null;
  if (!Array.isArray(flights)) return null;

  const eventStartMs = eventStartTime.getTime();
  let matched = false;
  for (const f of flights) {
    const depIata = f?.departure?.iata;
    if (!depIata || !LEISURE_HUBS.includes(depIata)) continue;
    if ((f.flight_status || "").toLowerCase() === "cancelled") continue;
    const scheduled = f?.arrival?.scheduled;
    if (typeof scheduled !== "string") continue;
    const arrivalMs = new Date(scheduled).getTime();
    if (Number.isNaN(arrivalMs)) continue;
    const hoursBefore = (eventStartMs - arrivalMs) / (1000 * 60 * 60);
    if (hoursBefore >= 1 && hoursBefore <= 4) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  return {
    type: "event",
    volume: 1,
    location: includeAirport ? `ALB → ${venueName}` : venueName,
    categories: includeAirport
      ? ["Airport → Venue", "Tourist Surge"]
      : ["Tourist Ripple", "Venue Staging"],
    lat: eventLat,
    lng: eventLng,
    egressMod: 5.0 + (Number(eventEgressMod) || 0),
  };
}

function assert(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"} | ${label}`);
  if (!cond) process.exitCode = 1;
}

const MVP_ARENA = { lat: 42.6483, lng: -73.7547 };
const EVENT_START = new Date("2026-05-26T20:00:00Z"); // 8 PM event

// Scenario A: Golden Path. MCO flight lands 2h before event, includeAirport=true.
{
  const flight = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T18:00:00Z" },
    departure: { iata: "MCO" },
  };
  const out = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 2.0,
    flights: [flight],
    includeAirport: true,
  });
  assert(out !== null, "A1: Golden Path returns synthetic object (not null)");
  assert(out?.type === "event", "A2: type === 'event'");
  assert(out?.volume === 1, "A3: volume === 1");
  assert(out?.location === "ALB → MVP Arena", "A4: location reads 'ALB → MVP Arena'");
  assert(
    JSON.stringify(out?.categories) === JSON.stringify(["Airport → Venue", "Tourist Surge"]),
    "A5: categories === ['Airport → Venue', 'Tourist Surge']"
  );
  assert(out?.lat === MVP_ARENA.lat && out?.lng === MVP_ARENA.lng, "A6: lat/lng copied from event venue");
  assert(out?.egressMod === 7.0, "A7: egressMod === 5.0 + 2.0 = 7.0 (stacked)");
}

// Scenario B: Ripple Edge Case. includeAirport=false drops ALB prefix.
{
  const flight = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T18:00:00Z" },
    departure: { iata: "LAS" },
  };
  const out = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [flight],
    includeAirport: false,
  });
  assert(out !== null, "B1: Ripple mode still injects when flight matches");
  assert(out?.location === "MVP Arena", "B2: location drops 'ALB →' prefix");
  assert(
    JSON.stringify(out?.categories) === JSON.stringify(["Tourist Ripple", "Venue Staging"]),
    "B3: categories === ['Tourist Ripple', 'Venue Staging']"
  );
  assert(out?.egressMod === 6.0, "B4: egressMod === 5.0 + 1.0 = 6.0");
}

// Scenario C: No Duplicate Spam. Multiple matching leisure flights -> ONE synthetic.
// (computeTouristCluster returns at most one object per call; the caller pushes once.)
{
  const flights = [
    { flight_status: "active", arrival: { scheduled: "2026-05-26T17:30:00Z" }, departure: { iata: "MCO" } },
    { flight_status: "active", arrival: { scheduled: "2026-05-26T18:00:00Z" }, departure: { iata: "LAS" } },
    { flight_status: "active", arrival: { scheduled: "2026-05-26T18:30:00Z" }, departure: { iata: "MIA" } },
  ];
  const out = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights,
    includeAirport: true,
  });
  assert(out !== null, "C1: Multi-flight match still injects");
  // The function returns one object; the caller pushes once. Verified by shape:
  assert(typeof out === "object" && !Array.isArray(out), "C2: Function returns a SINGLE object, not an array of N");
}

// Scenario D: Non-Leisure Hub. ORD flight at the right time -> no injection.
{
  const flight = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T18:00:00Z" },
    departure: { iata: "ORD" },
  };
  const out = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [flight],
    includeAirport: true,
  });
  assert(out === null, "D: Non-leisure hub (ORD) -> null (no injection)");
}

// Scenario E: Outside 1-4h window. 5h before -> too early; 30min before -> too late.
{
  const tooEarly = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T15:00:00Z" }, // 5h before 8 PM event
    departure: { iata: "MCO" },
  };
  const tooLate = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T19:30:00Z" }, // 30 min before event
    departure: { iata: "MCO" },
  };
  const outEarly = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [tooEarly],
    includeAirport: true,
  });
  const outLate = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [tooLate],
    includeAirport: true,
  });
  assert(outEarly === null, "E1: Leisure flight 5h before event -> null");
  assert(outLate === null, "E2: Leisure flight 30 min before event -> null");
}

// Scenario F: Cancelled leisure flight is ignored.
{
  const flight = {
    flight_status: "cancelled",
    arrival: { scheduled: "2026-05-26T18:00:00Z" },
    departure: { iata: "MCO" },
  };
  const out = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [flight],
    includeAirport: true,
  });
  assert(out === null, "F: Cancelled leisure flight -> null");
}

// Scenario G: Boundary cases. Exactly 1h before and exactly 4h before -> match.
{
  const exactly1h = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T19:00:00Z" }, // exactly 1h before
    departure: { iata: "MCO" },
  };
  const exactly4h = {
    flight_status: "active",
    arrival: { scheduled: "2026-05-26T16:00:00Z" }, // exactly 4h before
    departure: { iata: "MCO" },
  };
  const out1 = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [exactly1h],
    includeAirport: true,
  });
  const out4 = computeTouristCluster({
    eventStartTime: EVENT_START,
    eventLat: MVP_ARENA.lat,
    eventLng: MVP_ARENA.lng,
    venueName: "MVP Arena",
    eventEgressMod: 1.0,
    flights: [exactly4h],
    includeAirport: true,
  });
  assert(out1 !== null, "G1: Exactly 1h before -> match (inclusive lower bound)");
  assert(out4 !== null, "G2: Exactly 4h before -> match (inclusive upper bound)");
}
