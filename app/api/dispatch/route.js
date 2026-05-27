// Sprint 26: in-memory TTL cache shared across requests on a warm process.
// Lives at module scope so it persists across POST invocations on the same
// Node container (dev server and prod lambda warm container alike). Entry
// shape is { data, expiresAt }; stale entries are refetched on access.
// Validated in isolation by test-cache.js before being ported here.
const globalCache = new Map();

async function withCache(key, ttlMinutes, fetchCallback) {
  const now = Date.now();
  const entry = globalCache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.data;
  }
  const data = await fetchCallback();
  globalCache.set(key, { data, expiresAt: now + ttlMinutes * 60 * 1000 });
  return data;
}

// Sprint V2: only count arrivals from major leisure/business hubs — these
// riders are more likely to need rideshare (and XL for luggage). Short
// commuter hops (EWR, PHL, etc.) are dropped before bucketing.
const HIGH_VALUE_HUBS = ["MCO", "ATL", "ORD", "DFW", "DEN", "LAX", "LAS", "JFK", "LGA"];

// Sprint 16: Amtrak precision filter. Penn Station NYC, Boston, Washington
// DC, Philadelphia — high-income business + leisure hubs. Locals (Rutland,
// Schenectady commuter hops, etc.) are dropped before bucketing.
const HIGH_VALUE_STATIONS = ["NYP", "BOS", "WAS", "PHL"];

// Sprint 30: UberXL / Leisure Hub Engine. A flight from a known vacation
// hub (Orlando, Vegas, Miami, Cancun, Fort Myers, Maui) operated by a
// leisure-focused airline (Spirit, Frontier, JetBlue, Southwest, Sun
// Country) is statistically luggage-heavy and family-sized → XL fare.
const LEISURE_HUBS = ["MCO", "LAS", "MIA", "CUN", "RSW", "OGG"];
const LEISURE_AIRLINES = ["NK", "F9", "B6", "WN", "SY"];

// Sprint 20: spatial anchor for the airport. Used with haversineMiles +
// the 20 mph city-speed assumption to compute the driver's leaveBy time.
const ALB_COORDS = { lat: 42.7483, lng: -73.8017 };

// Sprint 37: spatial anchor for Albany-Rensselaer Amtrak station. Used to
// pin train surge buckets on the Mapbox radar.
const AMTRAK_COORDS = { lat: 42.6463, lng: -73.7392 };

// Sprint 36: spatial anchors for the State Capital engine. ESP gates the
// Lobbyist Premium (1.5-mi centroid radius); both ESP + Harriman are the
// location label on the 4 PM commuter synthetic event.
const ESP_COORDS = { lat: 42.6514, lng: -73.7608 };
const HARRIMAN_COORDS = { lat: 42.6841, lng: -73.8164 };

// Sprint 44: Expanded Institutional Engine. Time Matrix Array — replaces
// the Sprint 34 hardcoded two-window if statement. Decouples the schedule
// from the execution logic so future 8-hour clinic/admin overlaps can be
// added by editing this array alone. Morning row's 4.0x stacks the
// 12-hour nursing changeover with the 8-hour clinic open; afternoon and
// night rows are single 8-hour shifts (2.0x); evening row is the single
// 12-hour nursing changeover (3.0x). Boundaries validated in isolation
// by test-hospital-engine.js before being ported here.
const HOSPITAL_SHIFTS = [
  { start: 390, end: 450, mod: 4.0, label: "Morning Shift Overlap" },     // 6:30 AM - 7:30 AM
  { start: 900, end: 960, mod: 2.0, label: "Afternoon Clinic Shift" },    // 3:00 PM - 4:00 PM
  { start: 1110, end: 1170, mod: 3.0, label: "Evening Nursing Shift" },   // 6:30 PM - 7:30 PM
  { start: 1350, end: 1410, mod: 2.0, label: "Night Admin Shift" },       // 10:30 PM - 11:30 PM
];

// Sprint 43: Ticketmaster Geocoding. Hardcoded venue dictionary keyed by
// the lowercase/trimmed venue name. Used as a strict whitelist — events
// whose venue is not present are dropped before reaching the frontend.
// No external geocoding APIs; mirror normalization (.toLowerCase().trim())
// on both the keys and the raw payload values to survive minor formatting.
const VENUE_DICTIONARY = {
  "mvp arena": { lat: 42.6483, lng: -73.7547 },
  "palace theatre": { lat: 42.6542, lng: -73.7485 },
  "the egg": { lat: 42.6514, lng: -73.7593 },
  "empire live": { lat: 42.6510, lng: -73.7495 },
};

// Sprint 45 + Sprint 48: Mathematical ROI Filter. Converts a scoreable
// item's densityScore (0-100+ percent-of-capacity scale) into dollars-of-
// expected-value so it can be compared against the driver's haversine
// deadhead cost (distance × costPerMile). Items where the cost exceeds
// the value are dropped inside buildItinerary. Recalibrated from 1.50 to
// 0.25 in Sprint 48 because the densityScore scale grew ~10x (volume math
// is now (yield/capacity)*100 instead of raw volume * mod).
const DOLLAR_PER_SURGE_POINT = 0.25;

// Sprint 48: Normalized Density Engine. Map each surge type to its
// "Expected Rideshare Yield" — the rough number of rideshare-eligible
// passengers it produces. Used as the numerator alongside the venue
// capacity denominator to convert raw multiplicative volume math into a
// universal density ratio (0-100+ percent-of-capacity). Validated in
// isolation by test-density-engine.js before being ported here.
const YIELD_RATES = {
  flight: 15,
  train: 10,
  food: 5,
  grocery: 5,
  event: 50,
  mega_event: 450,
  hospital: 30,
};

// Sprint 48: Static capacity dictionary keyed by lowercased primary
// category (foods/events) or hub name (flights/trains). Unknown keys fall
// back to DEFAULT_CAPACITY (80) so a new Yelp category can never crash
// the density math — it just lands in the middle of the curve until the
// dictionary is extended.
const DEFAULT_CAPACITY = 80;
const CAPACITY_DICTIONARY = {
  // Transit hubs
  ALB: 600,
  Rensselaer: 300,
  // Food / restaurant primary categories
  "fast food": 200,
  "pizza": 100,
  "burgers": 100,
  "diners": 80,
  "steakhouse": 40,
  "sushi": 50,
  // Grocery primary categories
  "supermarket": 400,
  "grocery": 400,
  // Ticketmaster segment names
  "music": 1000,
  "sports": 5000,
  "arts": 800,
  "theatre": 800,
  // Synthetic injector first categories (lowercased)
  "morning shift overlap": 200,
  "afternoon clinic shift": 200,
  "evening nursing shift": 150,
  "night admin shift": 100,
  "state worker commute": 300,
  "nightlife egress": 250,
  "airport → venue": 600,
  "tourist ripple": 600,
};

function yieldRateFor(item) {
  if (item.type === "flight") return YIELD_RATES.flight;
  if (item.type === "train") return YIELD_RATES.train;
  if (item.type === "food") return YIELD_RATES.food;
  if (item.type === "grocery") return YIELD_RATES.grocery;
  if (item.type === "event") {
    const cat0 = (Array.isArray(item.categories) && item.categories[0]) || "";
    if (/shift|nursing|admin|clinic/i.test(cat0)) return YIELD_RATES.hospital;
    const egress = Number(item.egressMod) || 0;
    if (egress >= 2.5) return YIELD_RATES.mega_event;
    return YIELD_RATES.event;
  }
  return 0;
}

function capacityFor(item) {
  if (item.type === "flight" || item.type === "train") {
    return CAPACITY_DICTIONARY[item.hub] ?? DEFAULT_CAPACITY;
  }
  const key = (
    (Array.isArray(item.categories) && item.categories[0]) || ""
  )
    .toLowerCase()
    .trim();
  return CAPACITY_DICTIONARY[key] ?? DEFAULT_CAPACITY;
}

// Sprint 42: Nightlife Density Engine. Yelp price tier proxies wealth and
// nighttime demand density. Clone qualifying foodHotspots into structuredEvents
// (synthetic event clone) so rideshare-only drivers get the surge pin without
// the Sprint 11 food sanitizer wiping the signal. Mod scales with tier.
const TIER_MOD_MAP = {
  "$": 2.5,    // 2:00 AM Egress / Volume
  "$$": 3.0,   // Casual Nightlife
  "$$$": 3.5,  // Premium Surge / Executive
  "$$$$": 4.0, // Elite Dining
};

// Sprint 31: Campus Synergy Engine. Late-night (11 PM / 12 AM / 1 AM) food
// hotspots whose cluster centroid lands within 1.5 miles of a known campus
// earn a 1.5x campusMod. Validated in isolation by test-campus-engine.js
// before being ported here.
const CAMPUS_CENTERS = [
  { name: "SUNY Albany", lat: 42.6861, lng: -73.8237 },
  { name: "RPI", lat: 42.7298, lng: -73.6789 },
  { name: "Siena College", lat: 42.7194, lng: -73.7532 },
];

function computeCampusMod(hotspotLat, hotspotLng, currentHour) {
  const isLateNight = currentHour === 23 || currentHour === 0 || currentHour === 1;
  if (!isLateNight) return { campusMod: 1.0, campusName: null };
  for (const campus of CAMPUS_CENTERS) {
    const distance = haversineMiles(hotspotLat, hotspotLng, campus.lat, campus.lng);
    if (distance < 1.5) {
      return { campusMod: 1.5, campusName: campus.name };
    }
  }
  return { campusMod: 1.0, campusName: null };
}

// Sprint 36: Lobbyist Premium Engine. Strict all-of gate — Tue/Wed/Thu,
// 17:00-20:59 wall-clock, tier "High-Value ($$$)", cluster centroid within
// 1.5 mi of ESP. Mirrors campusMod's shape so it can chain multiplicatively
// inside surgeScore's food branch alongside qualityMod + campusMod.
function computeCorporateMod(hotspot, currentDay, currentHour) {
  if (currentDay < 2 || currentDay > 4) return 1.0;
  if (currentHour < 17 || currentHour > 20) return 1.0;
  if (hotspot.tier !== "High-Value ($$$)") return 1.0;
  const distance = haversineMiles(
    hotspot.centroidLat,
    hotspot.centroidLng,
    ESP_COORDS.lat,
    ESP_COORDS.lng
  );
  if (distance >= 1.5) return 1.0;
  return 1.8;
}

// Sprint 32: Event Egress Engine. Project the event's end time off its
// classification segment (Sports 3.5h, Arts/Theatre 2.5h, Music/default 3.0h),
// expand the surge window when the venue name implies stadium-scale capacity,
// and return the corresponding egressMod ONLY while currentLocalTime falls
// inside that window. Ported verbatim from test-egress-engine.js after all
// PO scenarios PASSed.
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

// Sprint 47: Tourist Event Clustering Engine. Pure helper — returns a single
// synthetic `type: "event"` object (or null) when a non-cancelled flight in
// LEISURE_HUBS lands 1-4 hours BEFORE the target event's start time. One
// match is sufficient; the loop short-circuits so multiple matching planes
// collapse to ONE injection. egressMod stacks 5.0 + the target event's mod
// so the injected route dominates the Profitability sort. Ported verbatim
// from test-tourist-cluster.js after all 19 assertions PASSed.
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

// Sprint 32: shared with the trigger-log so the projected end time stays
// in lockstep with the duration table used inside computeEventEgress.
function eventDurationHours(segmentName) {
  if (/sports/i.test(segmentName)) return 3.5;
  if (/arts|theatre/i.test(segmentName)) return 2.5;
  return 3.0;
}

function toTicketmasterDateTime(date) {
  // Ticketmaster requires YYYY-MM-DDTHH:mm:ssZ (UTC, no milliseconds)
  return date.toISOString().split(".")[0] + "Z";
}

// Sprint 41: Holiday & Iftar Supply Engine. Hardcoded 5-year matrix covering
// Eid al-Fitr / Eid al-Adha (Eve + Day) and Ramadan windows 2026-2030. Used
// by computeSupplyDropMod to mathematically inflate the surge map-wide when
// a massive supply-side drop is expected. Ported verbatim from
// test-iftar-engine.js after all 4 assertions PASSed.
const ISLAMIC_HOLIDAYS = [
  "2026-03-19", "2026-03-20",
  "2026-05-26", "2026-05-27",
  "2027-03-08", "2027-03-09",
  "2027-05-16", "2027-05-17",
  "2028-02-25", "2028-02-26",
  "2028-05-04", "2028-05-05",
  "2029-02-13", "2029-02-14",
  "2029-04-23", "2029-04-24",
  "2030-02-03", "2030-02-04",
  "2030-04-13", "2030-04-14",
];

const RAMADAN_MONTHS = [
  { start: "2026-02-18", end: "2026-03-19" },
  { start: "2027-02-08", end: "2027-03-08" },
  { start: "2028-01-28", end: "2028-02-26" },
  { start: "2029-01-16", end: "2029-02-14" },
  { start: "2030-01-05", end: "2030-02-03" },
];

function toYmd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isInRamadan(ymd) {
  for (const { start, end } of RAMADAN_MONTHS) {
    if (ymd >= start && ymd <= end) return true;
  }
  return false;
}

function computeSupplyDropMod(localStart, sunsetTimeStr) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return 1.0;
  const ymd = toYmd(localStart);

  if (ISLAMIC_HOLIDAYS.includes(ymd)) return 1.5;

  if (isInRamadan(ymd)) {
    if (typeof sunsetTimeStr !== "string") return 1.0;
    const match = sunsetTimeStr.match(/T(\d{2}):(\d{2})/);
    if (!match) return 1.0;
    const sunsetMin = Number(match[1]) * 60 + Number(match[2]);
    const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
    if (Math.abs(nowMin - sunsetMin) <= 30) return 1.5;
  }

  return 1.0;
}

// Sprint 19: Predictive Weather Engine. 1-hour-lookahead state machine over
// the existing Open-Meteo array — reads only weatherArray[0] (current hour)
// and weatherArray[1] (next hour). Output stacks multiplicatively onto the
// Sprint 18 temporal modifiers downstream — no caps, no floors on the
// combined product. Priority order is strict: Active Storm → Pre-Surge →
// Heatwave → Default. Ported verbatim from test-weather.js after all
// 16 scenarios PASSed (4 states, priority tiebreakers, graceful degradation,
// and pure-multiplicative stacking against Sprint 18 temporal mods).
function computeWeatherModifiers(weatherArray) {
  if (!Array.isArray(weatherArray) || weatherArray.length < 2) {
    return { weatherFoodMod: 1.0, weatherRideMod: 1.0 };
  }
  const current = weatherArray[0];
  const next = weatherArray[1];
  if (!current || !next) {
    return { weatherFoodMod: 1.0, weatherRideMod: 1.0 };
  }

  // 1. Active Storm
  if (current.precipChancePct >= 50 || current.precipInches > 0.1) {
    return { weatherFoodMod: 1.5, weatherRideMod: 0.75 };
  }
  // 2. Pre-Surge (1-hour lookahead — riders scramble to flee before the storm)
  if (current.precipChancePct < 50 && next.precipChancePct >= 50) {
    return { weatherFoodMod: 1.0, weatherRideMod: 1.5 };
  }
  // 3. Heatwave
  if (current.tempF >= 90) {
    return { weatherFoodMod: 1.25, weatherRideMod: 0.9 };
  }
  // 4. Default
  return { weatherFoodMod: 1.0, weatherRideMod: 1.0 };
}

// Sprint 18: Temporal Baseline Engine. Hardcoded wall-clock time blocks
// produce deterministic multipliers applied to raw data volumes BEFORE the
// payload reaches the LLM. Input Date's UTC fields must equal the driver's
// wall-clock time (we pass `localStart`, which is built that way).
// Ported verbatim from test-time.js after all 7 scenarios PASSed.
function computeTemporalModifiers(dateObj) {
  const day = dateObj.getUTCDay();
  const hour = dateObj.getUTCHours();

  let foodMod = 1.0;
  let rideMod = 1.0;

  if (day >= 1 && day <= 5 && hour >= 7 && hour <= 8) rideMod = 1.5;
  if (hour >= 11 && hour <= 13) foodMod = 1.5;
  if (day >= 1 && day <= 5 && hour >= 16 && hour <= 17) rideMod = 1.5;
  if (hour >= 17 && hour <= 19) foodMod = 1.5;
  if ((day === 5 || day === 6) && hour >= 22) {
    rideMod = 1.5;
    foodMod = 0.5;
  }
  if ((day === 6 || day === 0) && hour < 2) {
    rideMod = 1.5;
    foodMod = 0.5;
  }

  return { foodMod, rideMod };
}

async function fetchTicketmasterEvents({ latitude, longitude, start, end, apiKey }) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("latlong", `${latitude},${longitude}`);
  url.searchParams.set("radius", "25");
  url.searchParams.set("unit", "miles");
  url.searchParams.set("startDateTime", toTicketmasterDateTime(start));
  url.searchParams.set("endDateTime", toTicketmasterDateTime(end));
  url.searchParams.set("size", "20");
  url.searchParams.set("sort", "date,asc");

  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Ticketmaster API ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  return data._embedded?.events || [];
}

async function fetchWeatherWindowed({ latitude, longitude, hours }) {
  // Sprint 26: 60-min TTL cache per PO spec. Key encodes coords only;
  // `hours` is intentionally NOT in the key (per spec) — the cached array
  // is always sized to the first caller's window, and downstream consumers
  // (computeWeatherModifiers) read indices [0] and [1] only.
  const cacheKey = `weather_${latitude}_${longitude}`;
  return withCache(cacheKey, 60, async () => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set(
      "hourly",
      "temperature_2m,precipitation_probability,precipitation,weathercode"
    );
    // Sprint 41: append &daily=sunset so the existing Open-Meteo call also
    // returns today's local sunset time. Reused by computeSupplyDropMod for
    // the Ramadan Iftar ±30 min window — NO new network request.
    url.searchParams.set("daily", "sunset");
    // Open-Meteo aligns to whole hours; request hours+1 so windowing always covers the user's full block.
    url.searchParams.set("forecast_hours", String(hours + 1));
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("timezone", "auto");

    const MAX_ATTEMPTS = 3;
    let lastErr;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch(url.toString(), { signal: controller.signal, cache: "no-store" });
        clearTimeout(timeoutId);

        if (res.status >= 500 && res.status < 600) {
          throw new Error(`Weather API ${res.status}`);
        }
        if (!res.ok) {
          throw new Error(`Weather API ${res.status}: ${await res.text()}`);
        }

        const data = await res.json();
        const times = data.hourly?.time || [];
        const temps = data.hourly?.temperature_2m || [];
        const precipProb = data.hourly?.precipitation_probability || [];
        const precip = data.hourly?.precipitation || [];

        // Slice to exactly the user's selected window.
        const windowed = times.slice(0, hours + 1).map((t, i) => ({
          time: t,
          tempF: temps[i],
          precipChancePct: precipProb[i],
          precipInches: precip[i],
        }));

        // Sprint 41: extract today's sunset (daily.sunset[0]) alongside the
        // hourly array so the Iftar engine can read it without a new fetch.
        const sunsetTime = data.daily?.sunset?.[0] ?? null;

        return { weatherWindowed: windowed, sunsetTime };
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }

    console.warn(
      `Weather fetch failed after ${MAX_ATTEMPTS} attempts:`,
      lastErr?.message
    );
    // Sprint 41: return the object shape even on failure so destructuring
    // in the POST handler stays safe — both fields stay null/undefined and
    // downstream code (computeWeatherModifiers / computeSupplyDropMod)
    // already tolerates that.
    return { weatherWindowed: null, sunsetTime: null };
  });
}

// Sprint 7: revert from Puppeteer scrape to AviationStack API. Heavy browser
// dependency + bot protection on albanyairport.com made the scrape unreliable.
// AviationStack returns flights in the shape `aggregateArrivalsByHour` already
// expects: `{ flight_status, arrival: { scheduled }, departure: { iata } }`.
async function fetchAlbArrivals({ apiKey }) {
  // Sprint 26: 15-min TTL cache per PO spec. Key is the static hub label
  // because every dispatch request reads the same ALB feed.
  return withCache("flights_ALB", 15, async () => {
    const url = new URL("http://api.aviationstack.com/v1/flights");
    url.searchParams.set("access_key", apiKey);
    url.searchParams.set("arr_iata", "ALB");
    url.searchParams.set("limit", "100");

    try {
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        console.warn(`AviationStack API ${res.status}`);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : [];
    } catch (err) {
      console.warn("Flight fetch failed:", err.message);
      return [];
    }
  });
}

// Sprint 29: Aviation Fatigue Engine. Late-Night Synergy rule — a flight
// delayed >= 45 min AND scheduled to land >= 9 PM or before 4 AM (airport
// local time) earns a 1.3x fatigueMod. Local hour is regex-extracted from
// the ISO string so the airport's embedded offset is preserved (using
// `new Date(...).getUTCHours()` would drift for non-zero offsets). Ported
// verbatim from test-flight-fatigue.js after both PO scenarios PASSed.
function computeFatigueMod(flight) {
  const delay = Number(flight?.arrival?.delay);
  if (!Number.isFinite(delay) || delay < 45) return 1.0;

  const scheduled = flight?.arrival?.scheduled;
  if (typeof scheduled !== "string") return 1.0;

  const match = scheduled.match(/T(\d{2}):/);
  if (!match) return 1.0;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return 1.0;

  if (hour >= 21 || hour < 4) return 1.3;
  return 1.0;
}

// Sprint 30: Strict AND-gate. Both the origin hub AND the airline must
// belong to the leisure cohort for the 1.4x multiplier to fire. Validated
// in isolation by test-leisure-engine.js (3 assertions) before being
// ported here.
function computeLeisureMod(departureIata, airlineIata) {
  const hubMatch = LEISURE_HUBS.includes(departureIata);
  const airlineMatch = LEISURE_AIRLINES.includes(airlineIata);
  if (hubMatch && airlineMatch) return 1.4;
  return 1.0;
}

// Sprint 39: Amtrak Capacity Engine (Multiplier Merge). The live Amtraker
// API still owns arrival times; this helper looks up the live trainNum in
// the driver's uploaded daily capacity list and returns a stacking
// multiplier when a "Sold Out" / "Almost Full" status is found. Ported
// verbatim from test-amtrak-capacity.js after 3/3 assertions PASSed.
function computeCapacityMod(trainNum, todayCapacityList) {
  if (!trainNum || !Array.isArray(todayCapacityList)) return 1.0;
  const target = String(trainNum).trim();
  if (!target) return 1.0;

  const row = todayCapacityList.find(
    (r) => String(r?.trainNumber || "").trim() === target
  );
  if (!row) return 1.0;

  const status = String(row.status || "").trim().toLowerCase();
  if (status === "sold out") return 2.0;
  if (status === "almost full") return 1.5;
  return 1.0;
}

// Bucket arrivals into local-hour labels ("5 PM", "6 PM") for the window.
// Mirrors the timezone trick in toWallClockLabel: shift by offsetMin then read UTC fields.
// Sprint 4.1: de-duplicate codeshares — one physical plane often appears as 3-5 records.
// Sprint V2: drop flights whose departure IATA isn't in HIGH_VALUE_HUBS, and
// emit values as "<count> Arrivals (from CODE, CODE)" strings instead of ints
// so the LLM sees origin context inline.
// Sprint 27: rideMod stripped. Aggregator returns the RAW counted volume so
// the frontend reads the true physical plane count. buildItinerary is now
// the only place finalRideMod is applied (to the hidden surgeScore for sort
// + the <1.0 strict filter). Prevents the Sprint 23 "squaring" bug where the
// volume was multiplied here AND again at routing time.
// Sprint 29: per-flight fatigueMod computed inside the dedupe/filter loop;
// the bucket carries the MAX across its members so a single late-night
// delay flags the whole hour as a fatigue hub.
// Sprint 30: per-flight leisureMod (strict Hub+Airline AND-gate) computed
// in the same loop; bucket carries MAX across members (parity with fatigue).
// Sprint 27.1: destructured-object signature. Locks each argument to its
// name so future inserts/removals in the middle of the list can't silently
// shift downstream positionals (the airport-egress math was the highest-
// risk site for that drift). `rideMod` is accepted defensively even though
// the Sprint 27 body never reads it.
function aggregateArrivalsByHour({ flights, localStart, localEnd, offsetMin, rideMod = 1.0, minutesToAirport = 0 }) {
  const originsByHour = {};
  const earliestShiftedByHour = {};
  const fatigueModByHour = {};
  const leisureModByHour = {};
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

    // Sprint 20: +30 min egress shift BEFORE bucketing. Passengers don't
    // hit the curb when the plane lands — they deplane, gather bags, and
    // walk out ~30 min later. The driver should be dispatched to the curb,
    // not the runway.
    const shiftedUtc = new Date(arrivalUtc.getTime() + 30 * 60 * 1000);

    // Shift into the same "wall-clock-as-UTC" frame the rest of the file uses.
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

    // Sprint 29: compute per-flight fatigue; log every trigger so the PO
    // can spot each contributor; carry the MAX across the bucket so one
    // late-night delay marks the whole hour.
    const fatigueMod = computeFatigueMod(f);
    if (fatigueMod > 1.0) {
      const ident = f.flight?.iata || f.flight?.number || depIata;
      const delayMin = Number(f.arrival?.delay) || 0;
      console.log(
        `AVIATION FATIGUE TRIGGERED: ${ident} | Delay: ${delayMin}m | Mod: ${fatigueMod}x`
      );
    }
    if (!fatigueModByHour[label] || fatigueMod > fatigueModByHour[label]) {
      fatigueModByHour[label] = fatigueMod;
    }

    // Sprint 30: leisureMod fires only when origin hub AND airline both
    // belong to the leisure cohort. Log every trigger; bucket carries MAX.
    const airlineIata = f.airline?.iata;
    const leisureMod = computeLeisureMod(depIata, airlineIata);
    if (leisureMod > 1.0) {
      const ident = f.flight?.iata || f.flight?.number || depIata;
      console.log(
        `LEISURE HUB TRIGGERED: ${ident} | Hub: ${depIata} | Mod: ${leisureMod}x`
      );
    }
    if (!leisureModByHour[label] || leisureMod > leisureModByHour[label]) {
      leisureModByHour[label] = leisureMod;
    }
  }

  // Sprint 20: leaveBy = earliest shifted arrival in bucket − minutesToAirport.
  // Sprint 21: emit a strict array of objects so the frontend can .map() it.
  // Sprint 27: emit the RAW codes.length as volume. Multiplier application
  // lives exclusively inside buildItinerary now (kills the double-scaling
  // "squaring" bug from Sprint 23).
  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    const earliest = earliestShiftedByHour[hour];
    const leaveByDate = new Date(earliest.getTime() - minutesToAirport * 60 * 1000);
    buckets.push({
      type: "flight",
      hourBucket: hour,
      volume: codes.length,
      origins: codes,
      leaveBy: formatLeaveBy(leaveByDate),
      hub: "ALB",
      // Sprint 29: bucket carries the MAX fatigueMod across its members.
      fatigueMod: fatigueModByHour[hour] || 1.0,
      // Sprint 30: bucket carries the MAX leisureMod across its members.
      leisureMod: leisureModByHour[hour] || 1.0,
      // Sprint 37: ALB coords so the Mapbox radar can pin each flight bucket.
      lat: ALB_COORDS.lat,
      lng: ALB_COORDS.lng,
    });
  }
  return buckets;
}

// Sprint 4.5 + Hotfix: live Amtrak arrivals for Albany-Rensselaer (station code ALB).
// Amtraker v3 has shipped multiple response shapes:
//   - top-level array of trains
//   - { ALB: [...trains] }
//   - { ALB: { trainId: {...}, ... } }   <-- this shape caused "trains is not iterable"
// Inspector log + ironclad fallback guarantee this function ALWAYS returns an array.
async function fetchAlbTrainArrivals() {
  // Sprint 26: 15-min TTL cache per PO spec. Rensselaer is the hub label
  // (Amtrak station is colloquially "Rensselaer/ALB"); key matches the
  // PO example "trains_Rensselaer".
  return withCache("trains_Rensselaer", 15, async () => {
    const url = "https://api-v3.amtraker.com/v3/stations/ALB";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        console.warn(`Amtraker API ${res.status}`);
        return [];
      }
      const data = await res.json();

      console.log("RAW AMTRAK DATA:", data);

      try {
        let extracted;
        if (Array.isArray(data)) {
          extracted = data;
        } else if (Array.isArray(data?.ALB)) {
          extracted = data.ALB;
        } else if (data?.ALB && typeof data.ALB === "object") {
          extracted = Object.values(data.ALB);
        } else if (data && typeof data === "object") {
          extracted = Object.values(data).flat();
        }

        if (!Array.isArray(extracted)) {
          console.warn("Amtrak Parse Failed, falling back to empty array");
          return [];
        }
        return extracted;
      } catch (parseErr) {
        console.warn("Amtrak Parse Failed, falling back to empty array");
        return [];
      }
    } catch (err) {
      console.warn("Train fetch failed:", err.message);
      return [];
    }
  });
}

// Bucket train arrivals at ALB into local-hour labels for the window.
// Use estimated/actual arrival (`arr`) when present; fall back to scheduled (`schArr`).
// Sprint 16: drop cancelled trains AND drop trains whose origCode isn't in
// HIGH_VALUE_STATIONS. Emit values as "<count> Arrival(s) (from CODE, CODE)"
// strings so the LLM sees origin context inline (mirrors flight aggregator).
// Sprint 27: rideMod stripped (parity with the flight aggregator). Raw
// bucket counts only; buildItinerary applies finalRideMod for sort + filter.
// Sprint 27.1: destructured-object signature (parity with the flight
// aggregator). `rideMod` is accepted defensively even though the Sprint 27
// body never reads it.
// Sprint 39: BYOD trainCapacity flows in alongside the live Amtraker
// response. The list is already filtered to today's date by the frontend,
// so the aggregator can match purely on trainNum. The MAX capacityMod
// across each hour bucket follows the fatigueMod / leisureMod pattern so
// one sold-out train marks the whole hour as a capacity hub.
function aggregateTrainArrivalsByHour({ trains, localStart, localEnd, offsetMin, rideMod = 1.0, trainCapacity = [] }) {
  if (!Array.isArray(trains)) return [];
  const originsByHour = {};
  const capacityModByHour = {};
  const seen = new Set();
  for (const t of trains) {
    const status = (t.status || t.trainState || "").toLowerCase();
    if (status === "cancelled") continue;

    const origCode = t.origCode;
    if (!origCode || !HIGH_VALUE_STATIONS.includes(origCode)) continue;

    const stations = Array.isArray(t.stations) ? t.stations : [];
    const albStop = stations.find((s) => s?.code === "ALB");
    if (!albStop) continue;

    const arrival = albStop.arr || albStop.schArr;
    if (!arrival) continue;

    const fingerprint = `${t.trainNum || t.trainID || ""}|${arrival}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const arrivalUtc = new Date(arrival);
    if (Number.isNaN(arrivalUtc.getTime())) continue;

    const arrivalLocal = new Date(arrivalUtc.getTime() - offsetMin * 60 * 1000);
    if (arrivalLocal < localStart || arrivalLocal >= localEnd) continue;

    let h = arrivalLocal.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const label = `${h} ${ampm}`;
    if (!originsByHour[label]) originsByHour[label] = [];
    originsByHour[label].push(origCode);

    // Sprint 39: per-train capacityMod from the BYOD list. Live trainNum is
    // resolved off the Amtraker object (object key OR t.trainNum); the
    // helper itself tolerates blanks. Log every trigger; bucket carries
    // MAX across its members (parity with fatigueMod / leisureMod).
    const trainNum = t.trainNum || t.trainID || "";
    const capacityMod = computeCapacityMod(trainNum, trainCapacity);
    if (capacityMod > 1.0) {
      console.log(
        `AMTRAK CAPACITY TRIGGERED: Train ${trainNum} | Mod: ${capacityMod}x`
      );
    }
    if (!capacityModByHour[label] || capacityMod > capacityModByHour[label]) {
      capacityModByHour[label] = capacityMod;
    }
  }

  // Sprint 22: emit a strict array of objects so the frontend can .map() it.
  // No leaveBy — train egress is instant (PO anti-goal).
  // Sprint 27: emit RAW codes.length as volume (parity with flight aggregator).
  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    buckets.push({
      type: "train",
      hourBucket: hour,
      volume: codes.length,
      origins: codes,
      hub: "Rensselaer",
      // Sprint 37: Amtrak coords so the Mapbox radar can pin each train bucket.
      lat: AMTRAK_COORDS.lat,
      lng: AMTRAK_COORDS.lng,
      // Sprint 39: bucket carries the MAX capacityMod across its members.
      capacityMod: capacityModByHour[hour] || 1.0,
    });
  }
  return buckets;
}

// Sprint V2.5: meters between two lat/lng points via Haversine. Used to
// cluster businesses within 200m of each other into hotspots.
function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sprint 20: miles between two lat/lng points via Haversine. Driver →
// ALB_COORDS feeds the Zero-Prompt-Math leaveBy calculator
// (minutesToAirport = ceil((miles / 20) * 60)). Ported verbatim from
// test-airport-math.js after all 8 scenarios PASSed.
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Sprint 20: render a "wall-clock-as-UTC" Date into "h:mm AM/PM" for the
// leaveBy substring. Mirrors toWallClockLabel but keeps the minutes (not
// padded to top-of-hour) since the leaveBy is rarely on the hour.
function formatLeaveBy(date) {
  let h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

// Sprint V2.5: fetch top 10 open businesses for one category with full
// spatial detail (name, coords, price, categories, address) so we can
// cluster them downstream. Defensive per L1: inspector-log the raw shape,
// Array.isArray guard, return [] on any failure.
async function fetchYelpBusinesses({ latitude, longitude, category, apiKey }) {
  // Sprint 26: 30-min TTL cache per PO spec. Key encodes both category
  // and driver coords so two drivers in different cities cannot collide.
  const cacheKey = `hotspots_${category}_${latitude}_${longitude}`;
  return withCache(cacheKey, 30, async () => {
    const url = new URL("https://api.yelp.com/v3/businesses/search");
    url.searchParams.set("latitude", String(latitude));
    url.searchParams.set("longitude", String(longitude));
    url.searchParams.set("radius", "5000");
    url.searchParams.set("categories", category);
    url.searchParams.set("open_now", "true");
    url.searchParams.set("limit", "10");

    try {
      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: "no-store",
      });
      if (!res.ok) {
        console.warn(`Yelp API ${res.status} for category=${category}`);
        return [];
      }
      const data = await res.json();
      const sample = (Array.isArray(data?.businesses) ? data.businesses : []).map((b) => ({
        name: b.name,
        price: b.price,
        coordinates: b.coordinates,
        address: b.location?.address1,
        categories: b.categories?.map((c) => c.title),
      }));
      console.log(`RAW YELP DATA (${category}):`, JSON.stringify(sample, null, 2));
      if (!Array.isArray(data?.businesses)) {
        console.warn(`Yelp parse failed for category=${category}, falling back to []`);
        return [];
      }
      return data.businesses
        .map((b) => ({
          name: b.name || "Unknown",
          lat: b.coordinates?.latitude,
          lng: b.coordinates?.longitude,
          price: b.price || "",
          categories: Array.isArray(b.categories) ? b.categories.map((c) => c.title) : [],
          address1: b.location?.address1 || "",
          // Sprint 28: Anchor signal — Popularity Score = rating * reviewCount.
          rating: Number(b.rating) || 0,
          reviewCount: Number(b.review_count) || 0,
        }))
        .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
    } catch (err) {
      console.warn(`Yelp fetch failed (${category}):`, err.message);
      return [];
    }
  });
}

// Sprint 28: Yelp Quality Engine. Late-night fast-food categories trigger
// the +0.5 Additive Stack bonus on the Anchor's qualityMod. Case-insensitive
// substring match so "Fast Food", "Pizza Place", "Burger Joint", etc. all hit.
const LATE_NIGHT_ANCHOR_CATEGORIES = ["fast food", "pizza", "burgers", "diners"];

// Sprint V2.5: greedy 200m cluster sweep. Pick the business with the most
// neighbors-within-200m as the next cluster center, label it with the
// dominant cross-streets / tier / categories, remove its members, repeat.
// Up to 3 clusters returned.
// Sprint 28: per-cluster Anchor (max rating * reviewCount) + Additive Stack
// qualityMod (+0.3 popularity > 5000, +0.5 late-night fast-food). Ported
// verbatim from test-yelp-quality.js after both Daytime + 1 AM tests PASSed.
function computeHotspots(businesses, type, localStart) {
  if (!Array.isArray(businesses) || businesses.length === 0) return [];

  const remaining = [...businesses];
  const hotspots = [];

  while (remaining.length > 0 && hotspots.length < 3) {
    let bestCluster = [remaining[0]];
    for (const center of remaining) {
      const cluster = remaining.filter(
        (other) => haversineMeters(center.lat, center.lng, other.lat, other.lng) <= 200
      );
      if (cluster.length > bestCluster.length) bestCluster = cluster;
    }

    // Strip leading numbers from address1 ("123 Pearl St" -> "Pearl St") and
    // pick the top 1-2 most common streets in the cluster as the label.
    const streetCounts = {};
    for (const b of bestCluster) {
      const street = (b.address1 || "").replace(/^\d+\s*/, "").trim();
      if (street) streetCounts[street] = (streetCounts[street] || 0) + 1;
    }
    const topStreets = Object.entries(streetCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([s]) => s);
    let location = "Unnamed area";
    if (topStreets.length === 2) location = `${topStreets[0]} & ${topStreets[1]}`;
    else if (topStreets.length === 1) location = `near ${topStreets[0]}`;

    // Sprint 42: track the 4-char ($$$$) tier separately so the Nightlife
    // Density Engine can map it to the 4.0x Elite Dining mod. Anything 3-char
    // still falls under "High-Value ($$$)" to preserve existing surgeScore math.
    const hasElite = bestCluster.some((b) => (b.price || "").length === 4);
    const hasHighEnd = bestCluster.some((b) => (b.price || "").length >= 3);
    const midCount = bestCluster.filter((b) => b.price === "$$").length;
    let tier;
    if (hasElite) tier = "Elite ($$$$)";
    else if (hasHighEnd) tier = "High-Value ($$$)";
    else if (midCount > bestCluster.length / 2) tier = "Mid-Tier ($$)";
    else tier = "Quick-Turn ($)";

    const catCounts = {};
    for (const b of bestCluster) {
      for (const c of b.categories || []) {
        catCounts[c] = (catCounts[c] || 0) + 1;
      }
    }
    // Sprint 22: keep categories as a trimmed array (was comma-joined string)
    // so a future Next.js frontend can render each as its own badge.
    const topCats = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c.trim());

    // Sprint 28: Anchor pick + Additive Stack qualityMod.
    let anchor = bestCluster[0];
    let popularityScore = (Number(anchor?.rating) || 0) * (Number(anchor?.reviewCount) || 0);
    for (const b of bestCluster) {
      const score = (Number(b.rating) || 0) * (Number(b.reviewCount) || 0);
      if (score > popularityScore) {
        anchor = b;
        popularityScore = score;
      }
    }
    let qualityMod = 1.0;
    if (popularityScore > 5000) qualityMod += 0.3;
    const hour = localStart instanceof Date ? localStart.getUTCHours() : -1;
    const isLateNight = hour === 23 || hour === 0 || hour === 1 || hour === 2;
    const anchorCats = (anchor?.categories || []).map((c) => String(c).toLowerCase());
    const matchesLateNightCat = anchorCats.some((c) =>
      LATE_NIGHT_ANCHOR_CATEGORIES.some((trigger) => c.includes(trigger))
    );
    if (isLateNight && matchesLateNightCat) qualityMod += 0.5;

    console.log(
      `YELP ANCHOR: ${anchor?.name || "Unknown"} | Pop Score: ${popularityScore} | Mod: ${qualityMod}x`
    );

    // Sprint 37: cluster centroid computed for ALL hotspots (food + grocery)
    // so the Mapbox radar can pin both families. Sprint 31's campus gate +
    // Sprint 36's lobbyist gate still consume it only for food.
    const centroidLat =
      bestCluster.reduce((sum, b) => sum + b.lat, 0) / bestCluster.length;
    const centroidLng =
      bestCluster.reduce((sum, b) => sum + b.lng, 0) / bestCluster.length;

    // Sprint 31: Campus Synergy. Run the spatial+temporal gate against
    // CAMPUS_CENTERS. Only food hotspots qualify — grocery clusters are out
    // of scope.
    // Sprint 36: same centroid feeds the Lobbyist Premium gate (ESP 1.5-mi
    // radius). currentDay is wall-clock-as-UTC per Sprint 3.1.
    let campusMod = 1.0;
    let campusName = null;
    let corporateMod = 1.0;
    if (type === "food") {
      const campusResult = computeCampusMod(centroidLat, centroidLng, hour);
      campusMod = campusResult.campusMod;
      campusName = campusResult.campusName;
      if (campusMod > 1.0) {
        console.log(
          `CAMPUS SYNERGY TRIGGERED: ${location} | Campus: ${campusName} | Mod: ${campusMod}x`
        );
      }

      const currentDay = localStart instanceof Date ? localStart.getUTCDay() : -1;
      corporateMod = computeCorporateMod(
        { tier, centroidLat, centroidLng },
        currentDay,
        hour
      );
      if (corporateMod > 1.0) {
        console.log(
          `CORPORATE LOBBYIST PREMIUM TRIGGERED: ${anchor?.name || "Unknown"} | Mod: ${corporateMod}x`
        );
      }
    }

    hotspots.push({
      type,
      location,
      volume: bestCluster.length,
      tier,
      categories: topCats.length > 0 ? topCats : ["Mixed"],
      qualityMod,
      // Sprint 28.1: surface the Anchor's name so the React HotspotCard can
      // render "Anchored by <name>" beneath the intersection header.
      anchorName: anchor?.name,
      // Sprint 31: campusMod (1.0 default, 1.5x for late-night campus-adjacent
      // food clusters) and the matched campus label. Multiplied into the
      // food branch of surgeScore alongside qualityMod.
      campusMod,
      campusName,
      // Sprint 36: corporateMod (1.0 default, 1.8x for Tue/Wed/Thu 5-8 PM
      // High-Value clusters within 1.5 mi of ESP). Chains multiplicatively
      // into the food branch of surgeScore; grocery hotspots never set it,
      // so the read defaults to 1.0 there.
      corporateMod,
      // Sprint 37: cluster centroid so the Mapbox radar can drop a pin
      // on the geographic middle of the cluster.
      lat: centroidLat,
      lng: centroidLng,
    });

    const clusterSet = new Set(bestCluster);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (clusterSet.has(remaining[i])) remaining.splice(i, 1);
    }
  }

  return hotspots;
}

// Sprint 23: parse "H[:MM] AM/PM" into minutes-since-midnight. Powers both
// the chronological and hybrid sort comparators in buildItinerary.
function parseTimeLabel(label) {
  if (!label || typeof label !== "string") return Infinity;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return Infinity;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + min;
}

function itemTime(item) {
  if (item.leaveBy) return parseTimeLabel(item.leaveBy);
  if (item.hourBucket) return parseTimeLabel(item.hourBucket);
  return -Infinity;
}

// Sprint 32.1: Time-Decay modifier. Protects the driver's hourly wage by
// penalizing future surges that are too far away to chase. Tiers:
//   delta < 45 min (or in the past, or no time label) -> 1.0
//   45 <= delta <= 90 min                              -> 0.7
//   delta > 90 min                                     -> 0.4
// `delta` is computed against the driver's wall-clock (currentLocalStart
// already lives in the wall-clock-as-UTC frame per Sprint 3.1). The dispatch
// window can stretch up to 4 hours and may cross midnight, so a strongly
// negative raw delta is treated as next-day rather than "in the past".
function computeTimeDecayMod(itemTimeLabel, currentLocalStart) {
  if (!itemTimeLabel) return 1.0;
  if (!(currentLocalStart instanceof Date) || Number.isNaN(currentLocalStart.getTime())) return 1.0;

  const itemMin = parseTimeLabel(itemTimeLabel);
  if (!Number.isFinite(itemMin)) return 1.0;

  const currentMin = currentLocalStart.getUTCHours() * 60 + currentLocalStart.getUTCMinutes();
  let delta = itemMin - currentMin;
  // Midnight rollover: only legitimately-negative values are "small past"
  // values (within the dispatch window). Anything more than 6 hours negative
  // must belong to the next calendar day.
  if (delta < -360) delta += 1440;

  if (delta < 45) return 1.0;
  if (delta <= 90) return 0.7;
  return 0.4;
}

// Sprint 48: Normalized Density Engine. Replaces the unbounded multiplicative
// surgeScore with a Capacity Normalization (Density-Based) score. Each surge
// is converted into "Expected Rideshare Yield" (volume × YIELD_RATES[type])
// and divided by "Venue Capacity" (lookup on hub or categories[0], fallback
// 80). The ratio is multiplied by the appropriate final mod and scaled by
// 100 so the output reads as a whole-percentage integer (0.85 → 85.0). All
// pre-Sprint-48 per-item multipliers (fatigueMod, leisureMod, qualityMod,
// campusMod, corporateMod, capacityMod, egressMod) still travel on the
// items themselves and remain visible in the merged payload — they're
// intentionally absent from the density formula because the density ratio
// is now the single sort signal and the multipliers were already baked
// into the upstream volume / yield numbers they were tuned against. The
// item-preservation rule (Sprint 48 anti-goal) means item.volume stays the
// true physical count for the React UI.
function densityScore(item, finalRideMod, finalFoodMod) {
  const yieldRate = yieldRateFor(item);
  const capacity = capacityFor(item);
  if (yieldRate <= 0 || capacity <= 0) return 0;
  const mod =
    item.type === "food" || item.type === "grocery" ? finalFoodMod : finalRideMod;
  const numerator = (Number(item.volume) || 0) * yieldRate;
  return (numerator / capacity) * mod * 100;
}

// Sprint 23: deterministic router. Flattens flights + trains + hotspots
// into a single sorted array. Three driver-selectable strategies:
//   chronological — ascending by time; no-time items (hotspots) sort to top
//   profitability — surgeScore descending
//   hybrid        — group by hourBucket (chronological), within group by
//                   surgeScore desc; no-hourBucket items go to a
//                   "Current/Ongoing" group at the top.
function buildItinerary(
  payload,
  strategy,
  currentLocalStart,
  showRawData = false,
  driverLat = null,
  driverLng = null,
  costPerMile = 0.65
) {
  const flights = Array.isArray(payload?.flightsByHour) ? payload.flightsByHour : [];
  const trains = Array.isArray(payload?.trainsByHour) ? payload.trainsByHour : [];
  const food =
    payload?.gigDemand && Array.isArray(payload.gigDemand.foodHotspots)
      ? payload.gigDemand.foodHotspots
      : [];
  const grocery =
    payload?.gigDemand && Array.isArray(payload.gigDemand.groceryHotspots)
      ? payload.gigDemand.groceryHotspots
      : [];
  // Sprint 32: Sprint 32 structures events into the same itinerary stream as
  // flights / trains / hotspots. Only events with egressMod > 1.0 reach this
  // point — buildItinerary itself does no further filtering on them.
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const rawItems = [...flights, ...trains, ...food, ...grocery, ...events];

  const finalRideMod = Number.isFinite(payload?.finalRideMod) ? payload.finalRideMod : 1.0;
  const finalFoodMod = Number.isFinite(payload?.finalFoodMod) ? payload.finalFoodMod : 1.0;

  // Sprint 32.1 + Sprint 48: wrap densityScore with the Time-Decay multiplier.
  // Applied at every call site below (strict filter + profitability sort +
  // hybrid in-group sort) so a 2-hours-out surge can no longer outrank a
  // "now" surge.
  const decayed = (it) =>
    densityScore(it, finalRideMod, finalFoodMod) *
    computeTimeDecayMod(it.leaveBy || it.hourBucket, currentLocalStart);

  // Sprint 27 + Sprint 48: strict density filter. With the Normalized
  // Density Engine the score lives on a 0-100+ percent-of-capacity scale,
  // so the dropout floor moves from <1.0 to <10.0 (i.e., drop anything
  // generating less than 10% of venue capacity in expected yield). Any
  // item below the floor is pruned entirely. Synthetic ripple objects +
  // items with no scoreable type pass through untouched.
  // Sprint 48: stamp expectedYield / estimatedCapacity / densityScore on
  // every scoreable item so (a) the terminal merged-payload log surfaces
  // the math, and (b) the React UI can render "Density: X%" without
  // re-deriving anything.
  // Sprint 40: stamp isWeak BEFORE the strict cutoff so ghosted items
  // still carry the flag downstream. When showRawData is true the cutoff
  // is bypassed; when false the default Sprint 27 behavior holds.
  const items = rawItems
    .map((it) => {
      const scoreable =
        it.type === "flight" ||
        it.type === "train" ||
        it.type === "food" ||
        it.type === "grocery" ||
        it.type === "event";
      if (!scoreable) return it;
      const expectedYield = (Number(it.volume) || 0) * yieldRateFor(it);
      const estimatedCapacity = capacityFor(it);
      const score = decayed(it);
      return {
        ...it,
        expectedYield,
        estimatedCapacity,
        densityScore: score,
        isWeak: score < 10.0,
      };
    })
    .filter((it) => {
      const scoreable =
        it.type === "flight" ||
        it.type === "train" ||
        it.type === "food" ||
        it.type === "grocery" ||
        it.type === "event";
      if (!scoreable) return true;
      if (showRawData) return true;
      return decayed(it) >= 10.0;
    })
    // Sprint 45: Mathematical ROI Filter. After the Sprint 27 strict <1.0
    // cutoff, compute haversine distance from driver → each scoreable item
    // and drop anything whose deadhead cost (distance × costPerMile) exceeds
    // its expected value (surgeScore × DOLLAR_PER_SURGE_POINT). Skipped when
    // driver coords are missing or the item itself has no lat/lng so legacy
    // shapes can't accidentally get pruned.
    .filter((it) => {
      const scoreable =
        it.type === "flight" ||
        it.type === "train" ||
        it.type === "food" ||
        it.type === "grocery" ||
        it.type === "event";
      if (!scoreable) return true;
      if (
        !Number.isFinite(driverLat) ||
        !Number.isFinite(driverLng) ||
        !Number.isFinite(it.lat) ||
        !Number.isFinite(it.lng)
      ) {
        return true;
      }
      const distanceMiles = haversineMiles(driverLat, driverLng, it.lat, it.lng);
      const deadheadCost = distanceMiles * costPerMile;
      const expectedValue = decayed(it) * DOLLAR_PER_SURGE_POINT;
      if (deadheadCost > expectedValue) {
        console.log(
          `ROI FILTER DROPPED: ${it.location || it.hourBucket || it.type} | Cost: $${deadheadCost.toFixed(2)} | Value: $${expectedValue.toFixed(2)}`
        );
        return false;
      }
      return true;
    });

  if (strategy === "profitability") {
    return [...items].sort((a, b) => decayed(b) - decayed(a));
  }

  if (strategy === "chronological") {
    return [...items].sort((a, b) => itemTime(a) - itemTime(b));
  }

  const groups = new Map();
  for (const it of items) {
    const key = it.hourBucket || "__CURRENT__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(it);
  }
  const groupKeys = [...groups.keys()].sort((a, b) => {
    if (a === "__CURRENT__") return -1;
    if (b === "__CURRENT__") return 1;
    return parseTimeLabel(a) - parseTimeLabel(b);
  });
  const out = [];
  for (const key of groupKeys) {
    const arr = groups
      .get(key)
      .slice()
      .sort((a, b) => decayed(b) - decayed(a));
    out.push(...arr);
  }
  return out;
}

// Returns { foodHotspots, groceryHotspots } arrays, or null when no API key
// is configured (so dispatch can run degraded).
// Sprint 28: localStart threaded through for the late-night Anchor bonus.
async function getLocalDensityData(latitude, longitude, apiKey, localStart) {
  if (!apiKey) return null;
  const [foodBiz, groceryBiz] = await Promise.all([
    fetchYelpBusinesses({ latitude, longitude, category: "restaurants", apiKey }),
    fetchYelpBusinesses({ latitude, longitude, category: "grocery", apiKey }),
  ]);
  const foodHotspots = computeHotspots(foodBiz, "food", localStart);
  const groceryHotspots = computeHotspots(groceryBiz, "grocery", localStart);
  console.log(
    "=== HOTSPOT CLUSTERS ===\n" +
      JSON.stringify({ foodHotspots, groceryHotspots }, null, 2)
  );
  return { foodHotspots, groceryHotspots };
}

export async function POST(request) {
  try {
    const { latitude, longitude, hours, timezoneOffsetMinutes, platforms, includeAirport: includeAirportRaw, includeAmtrak: includeAmtrakRaw, routingStrategy: routingStrategyRaw, campusEvent, trainCapacity: trainCapacityRaw, showRawData: showRawDataRaw, costPerMile: costPerMileRaw } =
      await request.json();

    // Sprint 45: Mathematical ROI Filter. Driver-configurable vehicle cost
    // per mile (default 0.65 = the "Safe Sedan" baseline). Defended at the
    // boundary — non-numeric / negative values fall back to the default so a
    // malformed payload can't disable the filter by accident.
    const costPerMile =
      Number.isFinite(Number(costPerMileRaw)) && Number(costPerMileRaw) >= 0
        ? Number(costPerMileRaw)
        : 0.65;

    // Sprint 40: X-Ray Vision Toggle. Default false so the standard
    // experience keeps Sprint 27's strict <1.0 filter intact; explicit
    // true bypasses the cutoff and ghosts weak items in the UI.
    const showRawData = showRawDataRaw === true;

    // Sprint 39: BYOD Amtrak capacity. Frontend filters its uploaded CSV
    // down to today's local date before sending; the backend just defends
    // the shape (array of { trainNumber, status }).
    const trainCapacity = Array.isArray(trainCapacityRaw) ? trainCapacityRaw : [];

    // Sprint 23: deterministic router strategy. Default to "hybrid" when
    // missing/undefined; reject anything outside the allowed set.
    const routingStrategy = ["chronological", "profitability", "hybrid"].includes(routingStrategyRaw)
      ? routingStrategyRaw
      : "hybrid";

    // Sprint 15 (Ripple Effect): default to true when missing/undefined so
    // existing callers keep working. Only an explicit `false` disables ALB.
    const includeAirport = includeAirportRaw !== false;
    // Sprint 17 (Amtrak Geographic Toggle): mirror Sprint 15. Explicit
    // `false` disables Rensselaer; missing/undefined keeps it on.
    const includeAmtrak = includeAmtrakRaw !== false;

    const activePlatforms = {
      rideshare: platforms?.rideshare !== false,
      food: !!platforms?.food,
      grocery: !!platforms?.grocery,
    };

    if (typeof latitude !== "number" || typeof longitude !== "number") {
      return Response.json({ error: "Invalid coordinates." }, { status: 400 });
    }
    const hoursNum = Number(hours);
    if (!Number.isFinite(hoursNum) || hoursNum < 1 || hoursNum > 4) {
      return Response.json({ error: "Invalid hours (must be 1-4)." }, { status: 400 });
    }
    const offsetMin = Number.isFinite(Number(timezoneOffsetMinutes))
      ? Number(timezoneOffsetMinutes)
      : 0;

    // Shift "now" by the client's offset so the ISO Z-string visually matches
    // the user's local wall-clock time (e.g., 4:19 PM EDT → "...T16:19:00Z").
    const now = new Date();
    const localStart = new Date(now.getTime() - offsetMin * 60 * 1000);
    const localEnd = new Date(localStart.getTime() + hoursNum * 60 * 60 * 1000);

    console.log("=== TIMEZONE HOTFIX CHECK ===", {
      localStart: toTicketmasterDateTime(localStart),
      localEnd: toTicketmasterDateTime(localEnd),
      timezoneOffsetMinutes: offsetMin,
    });

    if (!process.env.TICKETMASTER_API_KEY) {
      return Response.json(
        { error: "TICKETMASTER_API_KEY is not set in .env" },
        { status: 500 }
      );
    }

    const flightApiKey = process.env.FLIGHT_API_KEY;
    if (!flightApiKey) {
      console.warn("FLIGHT_API_KEY not set — skipping AviationStack fetch");
    }

    const yelpApiKey = process.env.YELP_API_KEY;
    if (!yelpApiKey) {
      console.warn("YELP_API_KEY not set — skipping Yelp density fetch");
    }

    const [events, weatherResult, rawFlights, rawTrains, gigDemand] = await Promise.all([
      fetchTicketmasterEvents({
        latitude,
        longitude,
        start: localStart,
        end: localEnd,
        apiKey: process.env.TICKETMASTER_API_KEY,
      }),
      fetchWeatherWindowed({ latitude, longitude, hours: hoursNum }),
      flightApiKey ? fetchAlbArrivals({ apiKey: flightApiKey }) : Promise.resolve([]),
      fetchAlbTrainArrivals(),
      getLocalDensityData(latitude, longitude, yelpApiKey, localStart),
    ]);

    // Sprint 41: fetchWeatherWindowed now returns { weatherWindowed, sunsetTime }
    // off the same Open-Meteo call. Unpack here so the rest of the pipeline
    // (computeWeatherModifiers, mergedPayload.weather, computeSupplyDropMod)
    // keeps its existing shape.
    const weatherWindowed = weatherResult?.weatherWindowed ?? null;
    const sunsetTime = weatherResult?.sunsetTime ?? null;

    // Sprint 18: compute temporal multipliers off the driver's wall-clock
    // (localStart's UTC fields == wall-clock per Sprint 3.1). These scale
    // raw data volumes BEFORE the payload is built.
    const temporalModifiers = computeTemporalModifiers(localStart);
    const { foodMod, rideMod } = temporalModifiers;

    // Sprint 19: weather modifiers stack multiplicatively on top of temporal.
    // No cap/floor on the combined product — chaotic events (e.g., Fri bar
    // rush + thunderstorm) must compound naturally.
    const weatherModifiers = computeWeatherModifiers(weatherWindowed);
    const { weatherFoodMod, weatherRideMod } = weatherModifiers;
    let finalFoodMod = foodMod * weatherFoodMod;
    let finalRideMod = rideMod * weatherRideMod;

    // Sprint 41: Holiday & Iftar Supply Engine. Universal map-wide multiplier
    // — stacks on BOTH finalRideMod and finalFoodMod (flat 1.5x supply drop
    // on Eid / Eid Eve, or within ±30 min of sunset during Ramadan). Default
    // 1.0 is a no-op on any other day.
    const supplyDropMod = computeSupplyDropMod(localStart, sunsetTime);
    if (supplyDropMod > 1.0) {
      const ymd = toYmd(localStart);
      const reason = ISLAMIC_HOLIDAYS.includes(ymd) ? "Eid / Eid Eve" : "Ramadan Iftar window";
      console.log(`HOLIDAY/IFTAR SUPPLY DROP ACTIVE: ${reason} | Mod: ${supplyDropMod}x`);
    }
    finalRideMod = finalRideMod * supplyDropMod;
    finalFoodMod = finalFoodMod * supplyDropMod;

    // Sprint 34: BYOD Campus Calendar — Move-In / Break days surge transit
    // demand (departing students, arriving families) before flights/trains
    // are aggregated. Game / Syllabus days surge food demand around campus
    // hotspots; that branch fires after Yelp data is in hand (below).
    const campusEventStr = typeof campusEvent === "string" ? campusEvent : "";
    const isTransitCampusDay = /move|break/i.test(campusEventStr);
    const isFoodCampusDay = /game|syllabus/i.test(campusEventStr);
    if (isTransitCampusDay) {
      finalRideMod *= 1.5;
      console.log(`BYOD CAMPUS EVENT ACTIVE: ${campusEventStr}`);
    } else if (isFoodCampusDay) {
      console.log(`BYOD CAMPUS EVENT ACTIVE: ${campusEventStr}`);
    }

    // Sprint 20: Zero-Prompt Math. Compute exact driving time to ALB from the
    // driver's current coords (Haversine miles ÷ 20 mph city assumption) so
    // the aggregator can pre-bake the "Leave current location by" minute
    // directly into each hour bucket. The LLM is forbidden from re-deriving.
    const milesToAirport = haversineMiles(latitude, longitude, ALB_COORDS.lat, ALB_COORDS.lng);
    const minutesToAirport = Math.ceil((milesToAirport / 20) * 60);

    // Sprint 27: aggregators return RAW volumes (no rideMod scaling). The
    // finalRideMod / finalFoodMod multipliers ride alongside in mergedPayload
    // and are applied exclusively inside buildItinerary (hidden surgeScore
    // for sort + strict <1.0 filter). Kills the Sprint 23 squaring bug.
    let flightsByHour = aggregateArrivalsByHour({
      flights: rawFlights,
      localStart,
      localEnd,
      offsetMin,
      minutesToAirport,
    });

    let trainsByHour = aggregateTrainArrivalsByHour({
      trains: rawTrains,
      localStart,
      localEnd,
      offsetMin,
      trainCapacity,
    });

    // Sprint 32: Event Egress Engine. Walk the raw TM array, derive each
    // event's segment/venue/startTime, compute egressMod against localStart
    // (wall-clock-as-UTC), and KEEP only the events whose mod > 1.0. The
    // surviving objects match the Phase 1 Structuring shape so they slot into
    // buildItinerary alongside flights / trains / hotspots. Raw TM events
    // were unused by the frontend (Sprint 25 excised the LLM) so replacing
    // mergedPayload.events with the structured array is safe.
    let structuredEvents = [];
    if (Array.isArray(events)) {
      for (const e of events) {
        const segmentName = e?.classifications?.[0]?.segment?.name || "";
        const venueName = e?._embedded?.venues?.[0]?.name || "";

        // Sprint 43: Ticketmaster Geocoding — strict whitelist. Normalize
        // the raw venue name and look it up in VENUE_DICTIONARY. Unknown
        // venues are dropped before the egress math so they cannot reach
        // the frontend without a Mapbox pin.
        const venueCoords = VENUE_DICTIONARY[venueName.toLowerCase().trim()];
        if (!venueCoords) continue;

        const localDate = e?.dates?.start?.localDate;
        const localTime = e?.dates?.start?.localTime;
        let startTime = null;
        if (typeof localDate === "string" && typeof localTime === "string") {
          // Wall-clock-as-UTC frame to match localStart (per Sprint 3.1 trick).
          const d = new Date(`${localDate}T${localTime}Z`);
          if (!Number.isNaN(d.getTime())) startTime = d;
        }
        const egressMod = computeEventEgress(
          { segmentName, venueName, startTime },
          localStart
        );

        // Sprint 47: the egress filter is no longer a hard `continue` — events
        // that haven't entered their egress window can still trigger Tourist
        // Clustering below (the tourist signal hinges on flights 1-4h before
        // event START, not on proximity to event END).
        if (egressMod > 1.0) {
          const duration = eventDurationHours(segmentName);
          const projectedEnd = startTime
            ? formatLeaveBy(new Date(startTime.getTime() + duration * 60 * 60 * 1000))
            : "Unknown";
          console.log(
            `EVENT EGRESS TRIGGERED: ${venueName || "Unknown Venue"} | Mod: ${egressMod}x | Projected End: ${projectedEnd}`
          );

          structuredEvents.push({
            type: "event",
            location: venueName || "Unknown Venue",
            volume: 1,
            egressMod,
            categories: [segmentName || "Music"],
            lat: venueCoords.lat,
            lng: venueCoords.lng,
          });
        }

        // Sprint 47: Tourist Event Clustering. Inject ONE synthetic event per
        // target venue when a non-cancelled leisure-hub flight lands 1-4h
        // before this event's start time. egressMod stacks 5.0 + the target
        // event's mod so the injected route dominates the Profitability sort.
        const touristCluster = computeTouristCluster({
          eventStartTime: startTime,
          eventLat: venueCoords.lat,
          eventLng: venueCoords.lng,
          venueName: venueName || "Unknown Venue",
          eventEgressMod: egressMod,
          flights: rawFlights,
          includeAirport,
        });
        if (touristCluster) {
          structuredEvents.push(touristCluster);
          console.log(
            `TOURIST CLUSTER INJECTED: ${touristCluster.location} | egressMod ${touristCluster.egressMod}x`
          );
        }
      }
    }

    // PIPELINE PHASE 2: Inject synthetic local events strictly AFTER external API filtering.
    // Sprint 36.2: this sequencing is load-bearing — Phase 1 (above) maps Ticketmaster's
    // raw `{ classifications, _embedded.venues, dates.start.localDate/localTime }` objects
    // through the egressMod > 1.0 gate. Synthetic injections (Hospital, State Commuter)
    // skip that filter entirely because they're authored locally with the structured
    // shape already in hand. Re-ordering would either feed the TM filter a synthetic
    // object missing its required paths (crash) or drop the synthetic events on the
    // egressMod <= 1.0 floor when their numbers happen to fall there.

    // Sprint 44: Hospital Shift Injector — driven by the HOSPITAL_SHIFTS
    // Time Matrix (replaces the Sprint 34 two-window hardcoded if). Time
    // gate reads wall-clock-as-UTC off localStart (Sprint 3.1). The matched
    // row's `mod` and `label` flow straight onto egressMod and the leading
    // category so the UI EventCard renders the exact shift name natively.
    const wallMinutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
    const activeShift = HOSPITAL_SHIFTS.find(
      s => wallMinutes >= s.start && wallMinutes <= s.end
    );
    if (activePlatforms.rideshare && activeShift) {
      structuredEvents.push({
        type: "event",
        location: "Albany Med & St. Peter's Hospitals",
        volume: 1,
        egressMod: activeShift.mod,
        categories: [activeShift.label, "High Demand"],
        // Sprint 37: Albany Med area coords for the Mapbox radar pin.
        lat: 42.6534,
        lng: -73.7933,
      });
      console.log(
        `HOSPITAL SHIFT INJECTED: ${activeShift.label} | egressMod ${activeShift.mod}x`
      );
    }

    // Sprint 36: State Commuter Injector. Mon-Fri 15:30-17:00 wall-clock
    // (inclusive on both ends — wall-clock hours 15 to 16, or 17 if minutes
    // are 0) is the densest predictable rideshare event in Albany: the
    // Empire State Plaza + Harriman Campus state workforce all clocking out
    // at once. egressMod 2.5 mirrors a Mega-Venue so it surfaces near the
    // top of Profitability without overriding the 3.0x hospital surge.
    const currentDay = localStart.getUTCDay();
    const inStateCommuterWindow = wallMinutes >= 930 && wallMinutes <= 1020;
    if (
      activePlatforms.rideshare &&
      currentDay >= 1 &&
      currentDay <= 5 &&
      inStateCommuterWindow
    ) {
      structuredEvents.push({
        type: "event",
        location: "Empire State Plaza & Harriman Campus",
        volume: 1,
        egressMod: 2.5,
        categories: ["State Worker Commute"],
        // Sprint 37: ESP coords for the Mapbox radar pin.
        lat: ESP_COORDS.lat,
        lng: ESP_COORDS.lng,
      });
      console.log(
        "STATE COMMUTER INJECTED: Empire State Plaza & Harriman Campus | egressMod 2.5x"
      );
    }

    // Sprint 42: Nightlife Density Engine. Yelp's price tier is the cheapest
    // available proxy for nighttime population density + disposable income.
    // We clone qualifying foodHotspots into structuredEvents as type="event"
    // so the signal survives the Sprint 11 food sanitizer that fires next.
    // Gated on rideshare (the audience) + the local-hour window 20:00-03:00
    // + a tier whose extracted price key hits TIER_MOD_MAP.
    const localHour = localStart.getUTCHours();
    const inNightlifeWindow = localHour >= 20 || localHour <= 3;
    if (
      activePlatforms.rideshare &&
      inNightlifeWindow &&
      gigDemand &&
      Array.isArray(gigDemand.foodHotspots)
    ) {
      for (const hotspot of gigDemand.foodHotspots) {
        const priceMatch = typeof hotspot.tier === "string"
          ? hotspot.tier.match(/\((\$+)\)/)
          : null;
        const priceKey = priceMatch ? priceMatch[1] : null;
        if (!priceKey || !(priceKey in TIER_MOD_MAP)) continue;
        const corridorName = hotspot.anchorName || hotspot.location || "Unnamed";
        structuredEvents.push({
          type: "event",
          location: `Surge: ${corridorName} Corridor`,
          volume: 1,
          egressMod: TIER_MOD_MAP[priceKey] || 2.5,
          categories: ["Nightlife Egress", "High Demand"],
          lat: hotspot.lat,
          lng: hotspot.lng,
        });
        console.log(
          `NIGHTLIFE EGRESS INJECTED: ${corridorName} | Tier: ${priceKey} | Mod: ${TIER_MOD_MAP[priceKey]}x`
        );
      }
    }

    // Sprint 11: Payload sanitization. Prompt-only platform isolation kept
    // failing on the LLM's "data obligation". Erase inactive-platform data
    // BEFORE building/logging the payload so it never reaches the LLM.
    if (!activePlatforms.rideshare) {
      flightsByHour = [];
      trainsByHour = [];
    }
    if (gigDemand && typeof gigDemand === "object") {
      if (!activePlatforms.food) gigDemand.foodHotspots = [];
      if (!activePlatforms.grocery) gigDemand.groceryHotspots = [];
    }

    // Sprint 34: BYOD Game / Syllabus day. Apply the 1.5x campusMod boost on
    // each surviving food hotspot (Sprint 31 already seeds campusMod 1.0/1.5
    // for late-night campus-adjacent clusters; this stacks on top of it).
    if (
      isFoodCampusDay &&
      gigDemand &&
      typeof gigDemand === "object" &&
      Array.isArray(gigDemand.foodHotspots)
    ) {
      for (const h of gigDemand.foodHotspots) {
        h.campusMod = (Number(h.campusMod) || 1.0) * 1.5;
      }
    }

    // Sprint 15 refinement — Synthetic Data Swap. Prompt-only "do not route
    // to ALB" lost to data obligation when the raw arrival string was strong.
    // Keep the bucket count so the AI still sees WHEN the ripple hits, but
    // replace each raw element with an off-airport instruction object.
    // Sprint 21: flightsByHour is now an array — iterate via map(), not
    // Object.keys (which would silently no-op on the new shape).
    if (!includeAirport && Array.isArray(flightsByHour) && flightsByHour.length > 0) {
      flightsByHour = flightsByHour.map(() => ({
        type: "flight_ripple",
        message:
          "Secondary Ripple Demand: High traveler volume detected. Route driver to downtown hotels and destination corridors. DO NOT mention ALB.",
      }));
    }

    // Sprint 17 — Amtrak Synthetic Data Swap (belt + suspenders per L5).
    // Same pattern as the airport swap: preserve the bucket count so the AI
    // still sees WHEN the business-traveler ripple hits, but overwrite each
    // raw element so the model can't be tempted to route to Rensselaer.
    // Sprint 22: trainsByHour is now an array — iterate via map(), not
    // Object.keys (which would silently no-op on the new shape).
    if (!includeAmtrak && Array.isArray(trainsByHour) && trainsByHour.length > 0) {
      trainsByHour = trainsByHour.map(() => ({
        type: "train_ripple",
        message:
          "Secondary Ripple Demand: High business-traveler volume detected (NYP/BOS). Route driver to downtown state offices and high-end hotels. DO NOT mention Rensselaer.",
      }));
    }

    const mergedPayload = {
      location: { latitude, longitude },
      hours: hoursNum,
      includeAirport,
      includeAmtrak,
      routingStrategy,
      temporalModifiers,
      weatherModifiers,
      // Sprint 41: surface the universal map-wide supply-drop multiplier so
      // the terminal log makes it obvious why finalRideMod / finalFoodMod
      // are inflated on Eid / Iftar days.
      supplyDropMod,
      finalRideMod,
      finalFoodMod,
      events: structuredEvents,
      weather: weatherWindowed ?? "Weather data unavailable",
      flightsByHour,
      trainsByHour,
      gigDemand: gigDemand ?? "Density data unavailable",
    };

    // Sprint 23: deterministic router. Flatten + sort the merged surge data
    // by the driver's chosen strategy. Visible in the terminal log so future
    // React timeline cards can consume it directly without an LLM call.
    // Sprint 27: buildItinerary is now the SOLE consumer of finalRideMod /
    // finalFoodMod — it computes the hidden surgeScore for sorting and the
    // strict <1.0 filter, so the volumes in flightsByHour / trainsByHour /
    // gigDemand stay raw and physical for the frontend.
    mergedPayload.itinerary = buildItinerary(
      mergedPayload,
      routingStrategy,
      localStart,
      showRawData,
      latitude,
      longitude,
      costPerMile
    );

    // Acceptance Criteria: log the fully merged payload BEFORE the LLM call.
    console.log(
      "=== MERGED DISPATCH PAYLOAD ===\n" +
        JSON.stringify(mergedPayload, null, 2)
    );

    // Sprint 25: LLM excised. Deterministic engine returns the merged payload
    // directly — frontend reads `data.itinerary` (Sprint 23/24 contract).
    return Response.json(mergedPayload);
  } catch (err) {
    console.error("Dispatch error:", err);
    return Response.json(
      { error: err.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
