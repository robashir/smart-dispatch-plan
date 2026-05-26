// Sprint 43: Ticketmaster Geocoder — TDD scaffold.
// Validates the venue whitelist + normalization BEFORE the logic gets ported
// into app/api/dispatch/route.js. Run: node test-ticketmaster-geocoder.js
//
// PO logic (locked):
//   - Hardcoded dictionary, keys are lowercase + trimmed venue names.
//   - Raw venue name is normalized via .toLowerCase().trim() before lookup.
//   - Hit  -> append { lat, lng } to the event, push to structuredEvents.
//   - Miss -> drop the event entirely (strict whitelist).

const VENUE_DICTIONARY = {
  "mvp arena": { lat: 42.6483, lng: -73.7547 },
  "palace theatre": { lat: 42.6542, lng: -73.7485 },
  "the egg": { lat: 42.6514, lng: -73.7593 },
  "empire live": { lat: 42.6510, lng: -73.7495 },
};

function geocodeTicketmasterEvents(rawEvents) {
  const structuredEvents = [];
  for (const e of rawEvents) {
    const rawVenueName = e?._embedded?.venues?.[0]?.name || "";
    const key = rawVenueName.toLowerCase().trim();
    const coords = VENUE_DICTIONARY[key];
    if (!coords) continue;
    structuredEvents.push({
      ...e,
      lat: coords.lat,
      lng: coords.lng,
    });
  }
  return structuredEvents;
}

function assertEq(actual, expected, label) {
  const pass = actual === expected;
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | got=${actual} expected=${expected}`);
  if (!pass) process.exitCode = 1;
}

// Mock payload — three events with venue-name variations.
const mockEvents = [
  { _embedded: { venues: [{ name: "MVP Arena" }] } },
  { _embedded: { venues: [{ name: " The Egg " }] } },
  { _embedded: { venues: [{ name: "Unknown Local Pub" }] } },
];

const out = geocodeTicketmasterEvents(mockEvents);

// Assert 1: MVP Arena maps successfully and retains lat/lng.
const mvp = out.find((e) => e._embedded?.venues?.[0]?.name === "MVP Arena");
assertEq(!!mvp, true, "1a: MVP Arena present in output");
assertEq(mvp?.lat, 42.6483, "1b: MVP Arena lat attached");
assertEq(mvp?.lng, -73.7547, "1c: MVP Arena lng attached");

// Assert 2: " The Egg " maps despite trailing spaces + capitalization.
const egg = out.find((e) => e._embedded?.venues?.[0]?.name === " The Egg ");
assertEq(!!egg, true, "2a: ' The Egg ' present after normalization");
assertEq(egg?.lat, 42.6514, "2b: The Egg lat attached");
assertEq(egg?.lng, -73.7593, "2c: The Egg lng attached");

// Assert 3: Unknown Local Pub is strictly dropped.
const unknown = out.find((e) => e._embedded?.venues?.[0]?.name === "Unknown Local Pub");
assertEq(unknown, undefined, "3: 'Unknown Local Pub' dropped from output");

// Bonus: total count is exactly 2 (the two whitelisted venues, no extras).
assertEq(out.length, 2, "4: structuredEvents length is exactly 2");
