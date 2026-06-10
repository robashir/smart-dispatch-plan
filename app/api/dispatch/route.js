// Sprint 50: Last Call Egress Engine. 7-Day Matrix dictionary built by
// tasks/pull-nightlife.js and hand-curated by the driver. Frozen so no
// runtime mutation can drift the closing-time source of truth.
import ALBANY_NIGHTLIFE_HOURS_RAW from "../../../nightlife_dictionary.json" with { type: "json" };
const ALBANY_NIGHTLIFE_HOURS = Object.freeze(ALBANY_NIGHTLIFE_HOURS_RAW);

// Sprint 71: Static Albany POI Dictionary. Curated local food/grocery anchors
// in the same normalized shape as the Yelp business mapper, so computeHotspots
// stays the single clustering/scoring path when Yelp is missing or empty.
import ALBANY_POI_DICTIONARY_RAW from "../../../albany_poi_dictionary.json" with { type: "json" };
const ALBANY_POI_DICTIONARY = Object.freeze(ALBANY_POI_DICTIONARY_RAW);

// Sprint 73: DoorDash POI enrichment. Factual merchant metadata extracted
// from the user's DoorDash Albany takeout PDF. It has no coordinates, so it
// enriches matching static POIs by normalized name instead of creating pins.
import DOORDASH_POI_ENRICHMENT_RAW from "../../../doordash_poi_enrichment.json" with { type: "json" };
const DOORDASH_POI_ENRICHMENT = Object.freeze(DOORDASH_POI_ENRICHMENT_RAW);

// Sprint 63: Unified Population Density Engine. Static US Census-aligned grid
// built by scripts/build-census-grid.js and loaded once at module-load time
// via process.cwd() (production-safe on Netlify Lambdas — read-only fs but
// the build artifact lives at the project root, not /tmp). Synchronous read
// keeps the per-request dispatch path at zero filesystem cost and well under
// the 10s serverless timeout.
import fs from "node:fs";
import path from "node:path";
let POPULATION_GRID = [];
try {
  const gridPath = path.join(process.cwd(), "app", "data", "albany_pop_grid.json");
  POPULATION_GRID = JSON.parse(fs.readFileSync(gridPath, "utf8"));
} catch (err) {
  console.warn(
    `[Sprint 63] Population grid load failed (${err.message}). Boost helper will return 1.0 for all coords.`
  );
  POPULATION_GRID = [];
}

// Sprint 57: Unified Event Database.
// Sprint 59: filesystem persistence removed (Netlify Lambdas have a
// read-only fs). The eventConfig + byodTrains objects are now owned by
// the browser (localStorage, seeded from a static import of
// event-config.json) and travel in the dispatch request body. The
// dispatch route reads them off the body with defensive type-guards
// instead of off the disk — no more fs / path imports needed here.

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

// Sprint 68: BYOD Flight Arrivals dictionary. Maps raw city names visible
// on the ALB live-arrivals board to IATA codes that already belong to
// HIGH_VALUE_HUBS ∪ LEISURE_HUBS — so the existing aggregator whitelist
// accepts every translated record without a separate filter. Cities NOT
// in this dictionary are silently dropped by parseFlightText (per spec §4).
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

// Sprint 68: longest-match-first key order so "Dallas-Fort Worth" wins
// over "Dallas" and "New York (LGA)" wins over "New York". Computed once
// at module load — the dictionary is static.
const HUB_CITY_KEYS_LONGEST_FIRST = Object.keys(HUB_CITY_PATTERNS).sort(
  (a, b) => b.length - a.length
);

// Sprint 68: reverse map (IATA → first city name from the dictionary).
// Used by aggregateArrivalsByHour to stamp `originLabels` on each emitted
// bucket so FlightCard can render "Orlando" instead of "MCO" (spec §4
// city-name passthrough). Live records benefit from the same lookup —
// any IATA NOT in the map falls back to the raw code.
const HUB_IATA_TO_CITY = (() => {
  const out = {};
  for (const city of Object.keys(HUB_CITY_PATTERNS)) {
    const iata = HUB_CITY_PATTERNS[city];
    if (!(iata in out)) out[iata] = city;
  }
  return out;
})();

// Sprint 20: spatial anchor for the airport. Used with haversineMiles +
// the 20 mph city-speed assumption to compute the driver's leaveBy time.
const ALB_COORDS = { lat: 42.7483, lng: -73.8017 };
const ALB_CURB_BUFFER_MINUTES = 25;
const DEFAULT_AIRPORT_DRIVE_MINUTES = 15;

// Sprint 37: spatial anchor for Albany-Rensselaer Amtrak station. Used to
// pin train surge buckets on the Mapbox radar.
const AMTRAK_COORDS = { lat: 42.6463, lng: -73.7392 };

// Sprint 36: spatial anchors for the State Capital engine. ESP gates the
// Lobbyist Premium (1.5-mi centroid radius); both ESP + Harriman are the
// location label on the 4 PM commuter synthetic event.
// Sprint 61: ESP_COORDS doubles as the BYOD outbound-train anchor — drivers
// intercept departing-train passengers downtown 60 min before they leave.
const ESP_COORDS = { lat: 42.6514, lng: -73.7608 };
const HARRIMAN_COORDS = { lat: 42.6841, lng: -73.8164 };

// Sprint 67: Downtown Albany Bus Terminal (Greyhound / Trailways / Megabus).
// Single hardcoded anchor for every BYOD-parsed inbound bus — SUNY drop-off
// buses are filtered out at the parser, not re-mapped.
const DOWNTOWN_BUS_TERMINAL_COORDS = { lat: 42.6450, lng: -73.7487 };

// Sprint 61: Outbound Amtrak Ingress Engine. Driver wants to be downtown
// 60 min before a train departs (BUFFER); if the train departs in less
// than 40 min from "now" the synthetic event is dropped because the
// driver can't realistically reach ESP + transport the rider to ALB in
// time. Validated in isolation by test-amtrak-outbound.js before being
// ported here.
const OUTBOUND_BUFFER_MINUTES = 60;
const OUTBOUND_DROP_THRESHOLD = 40;

// Sprint 52: spatial anchor for Crossgates Mall (largest indoor regional
// shopping center in the Capital District). Paired with CROSSGATES_HOURS
// below to fire a ±30 min retail egress event at posted close. Validated
// in isolation by test-crossgates-engine.js (30/30 assertions) before
// being ported here.
const CROSSGATES_COORDS = { lat: 42.6895, lng: -73.8504 };

// Sprint 52: Crossgates 7-Day Closing Matrix. JS getUTCDay() index → close
// minute-of-day (wall-clock). Sun 6 PM / Mon-Thu 8 PM / Fri-Sat 9 PM.
const CROSSGATES_HOURS = {
  0: 1080, // Sun  6:00 PM
  1: 1200, // Mon  8:00 PM
  2: 1200, // Tue  8:00 PM
  3: 1200, // Wed  8:00 PM
  4: 1200, // Thu  8:00 PM
  5: 1260, // Fri  9:00 PM
  6: 1260, // Sat  9:00 PM
};

// Sprint 44: Expanded Institutional Engine. Time Matrix Array — replaces
// the Sprint 34 hardcoded two-window if statement. Decouples the schedule
// from the execution logic so future 8-hour clinic/admin overlaps can be
// added by editing this array alone. Morning row's 4.0x stacks the
// 12-hour nursing changeover with the 8-hour clinic open; afternoon and
// night rows are single 8-hour shifts (2.0x); evening row is the single
// 12-hour nursing changeover (3.0x). Boundaries validated in isolation
// by test-hospital-engine.js before being ported here.
const LOCAL_ANCHOR_SCHEDULES = [
  {
    name: "UAlbany Uptown Campus",
    lat: 42.6868,
    lng: -73.8238,
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: 480, end: 525, expected: 8, label: "Morning Campus Arrival" },
      { start: 945, end: 990, expected: 7, label: "Afternoon Campus Exit" },
      { start: 1245, end: 1290, expected: 6, label: "Evening Class Exit" },
    ],
  },
  {
    name: "Colonie Center / Wolf Road Corridor",
    lat: 42.7151,
    lng: -73.8136,
    days: [0, 1, 2, 3, 4, 5, 6],
    windows: [
      { start: 630, end: 675, expected: 5, label: "Hotel Checkout" },
      { start: 720, end: 765, expected: 5, label: "Lunch Movement" },
      { start: 1080, end: 1125, expected: 7, label: "Dinner / Retail Movement" },
      { start: 1275, end: 1320, expected: 6, label: "Retail Closing Pulse" },
    ],
  },
  {
    name: "Downtown Albany Office Core",
    lat: 42.6506,
    lng: -73.7529,
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: 480, end: 525, expected: 6, label: "Morning Office Arrival" },
      { start: 720, end: 765, expected: 4, label: "Lunch Office Movement" },
      { start: 1005, end: 1050, expected: 10, label: "Evening Office Exit" },
    ],
  },
  {
    name: "Corporate Woods Office Cluster",
    lat: 42.6869,
    lng: -73.7638,
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: 480, end: 525, expected: 5, label: "Morning Office Arrival" },
      { start: 1005, end: 1050, expected: 8, label: "Evening Office Exit" },
    ],
  },
  {
    name: "Albany Med / University Heights",
    lat: 42.6534,
    lng: -73.7933,
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: 435, end: 480, expected: 7, label: "Campus / Clinical Arrival" },
      { start: 915, end: 960, expected: 7, label: "Campus / Clinical Exit" },
      { start: 1170, end: 1215, expected: 6, label: "Evening Class / Shift Exit" },
    ],
  },
];

const HOSPITAL_SHIFTS = [
  { start: 390, end: 450, mod: 4.0, label: "Morning Shift Overlap" },     // 6:30 AM - 7:30 AM
  { start: 900, end: 960, mod: 2.0, label: "Afternoon Clinic Shift" },    // 3:00 PM - 4:00 PM
  { start: 1110, end: 1170, mod: 3.0, label: "Evening Nursing Shift" },   // 6:30 PM - 7:30 PM
  { start: 1350, end: 1410, mod: 2.0, label: "Night Admin Shift" },       // 10:30 PM - 11:30 PM
];

// Sprint 57: Unified Event Database — match logic. Iterates the JSON-backed
// event config and returns the first entry whose date matches localStart
// (with cross-midnight tail-day handling for academic windows that span
// midnight, encoded with decimal hours > 24, e.g. 25.5 = 1:30 AM next day).
//
// Match semantics:
//   - type "holiday" / activeWindows null|empty: fire whenever today's
//     calendar date matches (whole-day surge — the Sprint 49 windowed
//     timing was deliberately collapsed in Sprint 57's schema simplification).
//   - type "academic" with activeWindows: today's date matches AND
//     dispatchHour falls inside a window, OR yesterday's date matches AND
//     (dispatchHour + 24) falls inside a window with hours > 24.
//
// Validated in isolation by test-academic-surge.js (23 assertions).
// Sprint 80: State Worker Commute Taper. The state-worker pool is a
// current-opportunity score, not cumulative riders across every slot.
// Evening outbound is front-loaded: peak starts at 4:15 PM, then decays.
const STATE_WORKER_EVENING_TAPER = [
  { start: 975, end: 1005, factor: 1.0, label: "Peak Exit Wave" },       // 4:15 PM - 4:44 PM
  { start: 1005, end: 1035, factor: 0.75, label: "Strong Exit Wave" },   // 4:45 PM - 5:14 PM
  { start: 1035, end: 1065, factor: 0.5, label: "Fading Exit Wave" },    // 5:15 PM - 5:44 PM
  { start: 1065, end: 1095, factor: 0.25, label: "Late Exit Tail" },     // 5:45 PM - 6:14 PM
];

export function computeStateWorkerCommuteTaper(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return { factor: 0, label: null };
  }
  const day = dateObj.getUTCDay();
  if (day < 1 || day > 5) return { factor: 0, label: null };

  const wallMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
  const activeWindow = STATE_WORKER_EVENING_TAPER.find(
    (slot) => wallMinutes >= slot.start && wallMinutes < slot.end
  );
  return activeWindow
    ? { factor: activeWindow.factor, label: activeWindow.label }
    : { factor: 0, label: null };
}

function computeLocalAnchorPulse(anchor, dateObj) {
  if (!anchor || !(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const day = dateObj.getUTCDay();
  if (!Array.isArray(anchor.days) || !anchor.days.includes(day)) return null;

  const wallMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
  let best = null;
  for (const slot of anchor.windows || []) {
    const expected = Number(slot.expected) || 0;
    if (expected <= 0) continue;

    let factor = 0;
    let phase = null;
    if (wallMinutes >= slot.start && wallMinutes < slot.end) {
      factor = 1.0;
      phase = "Peak";
    } else if (wallMinutes >= slot.start - 30 && wallMinutes < slot.start) {
      factor = 0.6;
      phase = "Build";
    } else if (wallMinutes >= slot.end && wallMinutes < slot.end + 30) {
      factor = 0.6;
      phase = "Taper";
    }

    if (factor <= 0) continue;
    const activeExpected = Math.max(1, Math.round(expected * factor));
    if (!best || activeExpected > best.expected) {
      best = {
        expected: activeExpected,
        label: slot.label,
        phase,
      };
    }
  }
  return best;
}

function buildLocalAnchorEvents(localStart) {
  const events = [];
  for (const anchor of LOCAL_ANCHOR_SCHEDULES) {
    const pulse = computeLocalAnchorPulse(anchor, localStart);
    if (!pulse) continue;
    events.push({
      type: "event",
      location: anchor.name,
      volume: pulse.expected,
      egressMod: Number((1 + pulse.expected / 10).toFixed(1)),
      categories: ["Local Anchor", pulse.label, pulse.phase],
      lat: anchor.lat,
      lng: anchor.lng,
    });
  }
  return events;
}

function findActiveEvent(dispatchDate, dispatchHour, eventConfig) {
  if (!eventConfig || typeof eventConfig !== "object") return null;
  if (!(dispatchDate instanceof Date) || Number.isNaN(dispatchDate.getTime())) return null;
  if (!Number.isFinite(dispatchHour)) return null;

  const todayYmd = toYmd(dispatchDate);
  const prevDay = new Date(dispatchDate.getTime() - 24 * 60 * 60 * 1000);
  const prevYmd = toYmd(prevDay);

  for (const [name, entry] of Object.entries(eventConfig)) {
    if (!entry || typeof entry !== "object" || typeof entry.date !== "string") continue;

    const windows = Array.isArray(entry.activeWindows) ? entry.activeWindows : null;

    if (!windows || windows.length === 0) {
      if (entry.date === todayYmd) return { name, ...entry };
      continue;
    }

    for (const w of windows) {
      if (entry.date === todayYmd && dispatchHour >= w.start && dispatchHour <= w.end) {
        return { name, ...entry };
      }
      if (entry.date === prevYmd) {
        const shifted = dispatchHour + 24;
        if (shifted >= w.start && shifted <= w.end) {
          return { name, ...entry };
        }
      }
    }
  }
  return null;
}

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
// Sprint 69: Per-category recalibration. Coarse `food: 5` and `hospital: 30`
// kept as fallback only — real lookups now resolve through FOOD_YIELDS and
// HOSPITAL_YIELDS dicts below. `state_worker` and `bus` carved out from
// mega_event / inline-5 so each cohort carries its own propensity number.
const YIELD_RATES = {
  flight: 15,
  train: 12,
  food: 5,
  grocery: 3,
  event: 50,
  mega_event: 500,
  hospital: 30,
  nightlife: 5,
  state_worker: 100,
  bus: 5,
  residential_node: 5,
  local_anchor: 1,
};

// Sprint 69: Per-category food yields. Replaces the blanket food=5 baseline
// for any food hotspot whose `categories[0].toLowerCase().trim()` matches.
// Reflects rideshare propensity per restaurant type (steakhouse drinkers
// out-rideshare drive-thru fast-food, etc.). Unknown food categories still
// fall back to YIELD_RATES.food.
const FOOD_YIELDS = {
  "steakhouse": 15,
  "sushi": 10,
  "burgers": 8,
  "pizza": 6,
  "diners": 4,
  "fast food": 3,
  "cafes": 2,
  "coffee": 2,
  "brunch": 4,
  "breakfast & brunch": 4,
};

const MORNING_FOOD_MIN_YIELD = 4;

// Sprint 69: Per-shift hospital yields. Replaces the blanket hospital=30
// baseline for the 4 HOSPITAL_SHIFTS rows. Stacking pattern mirrors the
// existing `mod` weights on each row (morning overlap > evening nursing >
// night admin > afternoon clinic).
const HOSPITAL_YIELDS = {
  "morning shift overlap": 40,
  "afternoon clinic shift": 20,
  "evening nursing shift": 35,
  "night admin shift": 25,
};

// Sprint 69: Per-segment event yields. Replaces the blanket event=50 default
// for mid-sized Ticketmaster classifications. Mega-venue sports/arena events
// still route through mega_event (500) via the egressMod >= 2.5 branch —
// EVENT_YIELDS is consulted AFTER that check so a stadium concert (Music +
// mega egress) stays at 500, not 200.
const EVENT_YIELDS = {
  "music": 200,
  "arts": 120,
  "theatre": 120,
  "arts & theatre": 120,
};

const BYOD_TRAIN_YIELDS = {
  default: 10,
  almostFull: 15,
  soldOut: 22,
};

function byodTrainYieldFor(item) {
  const availability = item?.availability;
  if (availability && typeof availability === "object") {
    const coach = String(availability?.coach?.status || "").toLowerCase();
    const business = String(availability?.business?.status || "").toLowerCase();
    const privateRooms = String(availability?.privateRooms?.status || "").toLowerCase();

    let yieldValue = BYOD_TRAIN_YIELDS.default;
    if (coach === "almostfull") yieldValue = BYOD_TRAIN_YIELDS.almostFull;
    if (coach === "soldout") yieldValue = BYOD_TRAIN_YIELDS.soldOut;

    if (business === "almostfull") yieldValue += 3;
    if (business === "soldout") yieldValue += 4;
    if (privateRooms === "almostfull") yieldValue += 1;
    if (privateRooms === "soldout") yieldValue += 2;

    return Math.min(yieldValue, 28);
  }

  const catsAll = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (/sold out/i.test(catsAll)) return BYOD_TRAIN_YIELDS.soldOut;
  if (/almost full/i.test(catsAll)) return BYOD_TRAIN_YIELDS.almostFull;
  return BYOD_TRAIN_YIELDS.default;
}

// Sprint 70: CAPACITY_DICTIONARY + DEFAULT_CAPACITY deleted. With the
// raw-yield formula in densityScore, capacity no longer participates in
// scoring — the venue-name vs categories[0] mismatch (e.g., MVP Arena
// Music using music capacity 1000 vs MVP Arena Sports using sports
// capacity 5000) cannot occur because no capacity is consulted.

function isMorningYieldWindow(localStart) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const minutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  return minutes >= 6 * 60 && minutes < 11 * 60;
}

export function yieldRateFor(item, localStart = null) {
  if (item.type === "flight") return YIELD_RATES.flight;
  if (item.type === "train") return YIELD_RATES.train;
  // Sprint 63: Food baseline multiplied by populationDensityMod when the
  // hotspot's centroid sits inside a dense residential pocket.
  // Sprint 69: per-category lookup (FOOD_YIELDS) replaces the blanket
  // baseline. Unknown categories still fall back to YIELD_RATES.food.
  if (item.type === "food") {
    const popMod = Number(item.populationDensityMod) || 1;
    const hasMorningDaypart =
      Array.isArray(item.dayparts) &&
      item.dayparts.some((d) => {
        const tag = String(d).toLowerCase();
        return tag === "breakfast" || tag === "morning" || tag === "brunch";
      });
    const cat0 = ((Array.isArray(item.categories) && item.categories[0]) || "")
      .toLowerCase()
      .trim();
    const base = FOOD_YIELDS[cat0] ?? YIELD_RATES.food;
    const adjustedBase =
      hasMorningDaypart && isMorningYieldWindow(localStart)
        ? Math.max(base, MORNING_FOOD_MIN_YIELD)
        : base;
    return adjustedBase * popMod;
  }
  if (item.type === "grocery") return YIELD_RATES.grocery;
  // Sprint 63: Synthetic residential ride hub. Baseline yield × the node's
  // populationDensityMod so denser nodes outscore sparser ones.
  if (item.type === "ride") {
    const popMod = Number(item.populationDensityMod) || 1;
    return YIELD_RATES.residential_node * popMod;
  }
  if (item.type === "event") {
    const cat0 = ((Array.isArray(item.categories) && item.categories[0]) || "")
      .toLowerCase()
      .trim();
    const catsAll = Array.isArray(item.categories) ? item.categories.join("|") : "";
    if (/BYOD Train/i.test(catsAll)) {
      return byodTrainYieldFor(item);
    }
    // Sprint 67: BYOD Bus surges get a flat expected yield (per spec
    // clarification). Checked FIRST so the rule can't fall through to the
    // event/egress branches and accidentally inherit a stadium-scale rate.
    if (/BYOD Bus/i.test(catsAll)) return YIELD_RATES.bus;
    if (/local anchor/i.test(catsAll)) return YIELD_RATES.local_anchor;
    // Sprint 69: State Worker Commute carved out from mega_event default —
    // 50k state workers leaving ESP/Harriman are drive-own-car-dominant,
    // not stadium-scale. Checked BEFORE the egress >= 2.5 branch since the
    // injector stamps egressMod 2.5 for radar prominence.
    if (cat0 === "state worker commute") return YIELD_RATES.state_worker;
    // Sprint 69: Per-shift hospital yields (HOSPITAL_YIELDS dict). Replaces
    // the blanket hospital=30 baseline so each of the 4 shifts carries its
    // own propensity number tied to its `mod` weight in HOSPITAL_SHIFTS.
    if (HOSPITAL_YIELDS[cat0] != null) return HOSPITAL_YIELDS[cat0];
    if (/shift|nursing|admin|clinic/i.test(cat0)) return YIELD_RATES.hospital;
    // Sprint 52: Crossgates Retail Egress — 150 expected rideshare yield.
    // Checked BEFORE the egress >= 2.5 mega-event branch so the 3.0x
    // egressMod doesn't fall through to the 500 stadium-scale rate.
    if (/retail egress/i.test(cat0)) return 150;
    // Sprint 62.3: Last Call / Nightlife Egress are MICRO venues (bars),
    // NOT stadium-scale. Checked BEFORE the egress >= 2.5 mega-event
    // branch so the 3.5x Sprint 50 egressMod doesn't fall through to
    // the 500 mega_event rate. Base × egressMod produces a per-venue
    // yield (25 × 3.5 = 87.5) that nears the 80 default-capacity ceiling
    // for an unlisted small venue.
    if (/last call|nightlife/i.test(catsAll)) {
      return YIELD_RATES.nightlife * (Number(item.egressMod) || 1);
    }
    const egress = Number(item.egressMod) || 0;
    if (egress >= 2.5) return YIELD_RATES.mega_event;
    // Sprint 69: Per-segment event yields (music / arts / theatre). Checked
    // AFTER mega_event so stadium-scale music events keep the 500 rate.
    if (EVENT_YIELDS[cat0] != null) return EVENT_YIELDS[cat0];
    return YIELD_RATES.event;
  }
  return 0;
}

// Sprint 70: capacityFor deleted alongside the capacity dictionary.

// Sprint 69: Campus Synergy (Sprint 31) and Lobbyist Premium (Sprint 36)
// engines removed. Per-category food yields (FOOD_YIELDS) and the
// State Worker Commute injector cover the same demand patterns more
// honestly without the multiplier-on-weak-base ghosting issue.
// `test-campus-engine.js` and any test exercising `computeCorporateMod` are
// now invalidated and will fail if re-run.

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

// Sprint 69: Tourist Event Clustering (Sprint 47) removed. The engine was
// double-counting leisure-hub flights — riders were already surging via the
// flight bucket's own yield + Sprint 30 leisureMod (1.4x), then the tourist
// ripple was re-injecting them as a mega_event-scale (450) event for the
// same passengers. `test-tourist-cluster.js` is invalidated.

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
const WEATHER_SEVERITY_RANK = {
  none: 0,
  clear: 0,
  trace: 1,
  light: 2,
  moderate: 3,
  heavy: 4,
};

const WEATHER_CODE_RAIN = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99]);
const WEATHER_CODE_SNOW = new Set([71, 73, 75, 77, 85, 86]);
const WEATHER_CODE_ICE = new Set([56, 57, 66, 67]);

function numericOrZero(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function classifyAmount(amountInches, thresholds) {
  const amount = numericOrZero(amountInches);
  if (amount >= thresholds.heavy) return "heavy";
  if (amount >= thresholds.moderate) return "moderate";
  if (amount >= thresholds.light) return "light";
  if (amount > 0) return "trace";
  return "none";
}

function classifyWeatherHour(row) {
  if (!row || typeof row !== "object") {
    return { condition: "clear", severity: "clear", rank: 0, precipChancePct: 0 };
  }

  const precipChancePct = numericOrZero(row.precipChancePct);
  const weatherCode = Number(row.weatherCode);
  const snowfallInches = numericOrZero(row.snowfallInches);
  const precipInches = numericOrZero(row.precipInches);
  const snowSeverity = classifyAmount(snowfallInches, {
    light: 0.1,
    moderate: 0.3,
    heavy: 0.7,
  });
  const rainSeverity = classifyAmount(precipInches, {
    light: 0.02,
    moderate: 0.1,
    heavy: 0.25,
  });

  if (snowSeverity !== "none" || WEATHER_CODE_SNOW.has(weatherCode) || WEATHER_CODE_ICE.has(weatherCode)) {
    const severity = snowSeverity !== "none" ? snowSeverity : precipChancePct >= 50 ? "light" : "trace";
    return {
      condition: WEATHER_CODE_ICE.has(weatherCode) ? "ice" : "snow",
      severity,
      rank: WEATHER_SEVERITY_RANK[severity],
      precipChancePct,
    };
  }

  if (rainSeverity !== "none" || WEATHER_CODE_RAIN.has(weatherCode)) {
    const severity = rainSeverity !== "none" ? rainSeverity : precipChancePct >= 50 ? "light" : "trace";
    return {
      condition: "rain",
      severity,
      rank: WEATHER_SEVERITY_RANK[severity],
      precipChancePct,
    };
  }

  const tempF = Number(row.tempF);
  if (Number.isFinite(tempF) && tempF >= 90) {
    const severity = tempF >= 100 ? "heavy" : "moderate";
    return {
      condition: "heat",
      severity,
      rank: WEATHER_SEVERITY_RANK[severity],
      precipChancePct,
    };
  }

  return { condition: "clear", severity: "clear", rank: 0, precipChancePct };
}

function weatherModsFor(condition, severity, isPrecipPreSurge = false) {
  if (isPrecipPreSurge) {
    return { weatherFoodMod: 1.05, weatherRideMod: 1.2, driverSupplyMod: 1.0 };
  }

  if (condition === "snow" || condition === "ice") {
    if (severity === "heavy") return { weatherFoodMod: 1.8, weatherRideMod: 1.3, driverSupplyMod: 0.55 };
    if (severity === "moderate") return { weatherFoodMod: 1.5, weatherRideMod: 1.2, driverSupplyMod: 0.7 };
    if (severity === "light") return { weatherFoodMod: 1.25, weatherRideMod: 1.1, driverSupplyMod: 0.85 };
    return { weatherFoodMod: 1.1, weatherRideMod: 1.05, driverSupplyMod: 0.9 };
  }

  if (condition === "rain") {
    if (severity === "heavy") return { weatherFoodMod: 1.6, weatherRideMod: 1.2, driverSupplyMod: 0.75 };
    if (severity === "moderate") return { weatherFoodMod: 1.35, weatherRideMod: 1.1, driverSupplyMod: 0.85 };
    if (severity === "light") return { weatherFoodMod: 1.15, weatherRideMod: 1.05, driverSupplyMod: 0.95 };
    return { weatherFoodMod: 1.05, weatherRideMod: 1.0, driverSupplyMod: 0.98 };
  }

  if (condition === "heat") {
    return { weatherFoodMod: 1.15, weatherRideMod: 1.1, driverSupplyMod: 0.9 };
  }

  return { weatherFoodMod: 1.0, weatherRideMod: 1.0, driverSupplyMod: 1.0 };
}

function weatherReasonFor(condition, severity, isPrecipPreSurge = false) {
  if (isPrecipPreSurge) return "Precipitation likely within the next hour";
  if (condition === "rain") return `${severity[0].toUpperCase()}${severity.slice(1)} rain active`;
  if (condition === "snow") return `${severity[0].toUpperCase()}${severity.slice(1)} snow active`;
  if (condition === "ice") return `${severity[0].toUpperCase()}${severity.slice(1)} icy precipitation active`;
  if (condition === "heat") return "Heat above 90F active";
  return "Clear weather baseline";
}
export function computeWeatherModifiers(weatherArray) {
  const fallback = {
    weatherFoodMod: 1.0,
    weatherRideMod: 1.0,
    driverSupplyMod: 1.0,
    opportunityPressure: 1.0,
    condition: "clear",
    severity: "clear",
    reason: "Weather data unavailable or clear",
    startsInMinutes: null,
    peakHour: null,
  };

  if (!Array.isArray(weatherArray) || weatherArray.length === 0) return fallback;

  const analyzed = weatherArray.map((row, index) => ({
    ...classifyWeatherHour(row),
    time: row?.time ?? null,
    minutesFromNow: index * 60,
  }));
  const current = analyzed[0] || fallback;
  const next = analyzed[1] || null;
  const precipRows = analyzed.filter((row) =>
    ["rain", "snow", "ice"].includes(row.condition) && row.rank > 0
  );
  const firstPrecip = precipRows[0] || null;
  const peak = analyzed.reduce(
    (best, row) => (row.rank > best.rank ? row : best),
    analyzed[0] || { rank: 0, time: null }
  );
  const preSurge =
    current.rank === 0 &&
    next &&
    ["rain", "snow", "ice"].includes(next.condition) &&
    (next.rank >= 2 || next.precipChancePct >= 50);
  const active = current.rank > 0 ? current : preSurge ? next : current;
  const mods = weatherModsFor(active.condition, active.severity, preSurge);
  const opportunityPressure = Number(
    (mods.weatherRideMod / Math.max(mods.driverSupplyMod, 0.1)).toFixed(2)
  );

  return {
    ...mods,
    opportunityPressure,
    condition: preSurge ? `pre_${active.condition}` : active.condition,
    severity: active.severity,
    reason: weatherReasonFor(active.condition, active.severity, preSurge),
    startsInMinutes: firstPrecip ? firstPrecip.minutesFromNow : null,
    peakHour: peak?.time ?? null,
  };
}

// Sprint 18: Temporal Baseline Engine. Hardcoded wall-clock time blocks
// produce deterministic multipliers. Input Date's UTC fields must equal the
// driver's wall-clock time (we pass `localStart`, which is built that way).
// Sprint 72: generic commute ride boosts removed because explicit engines
// now cover hospital, state-worker, transit, bus, and event demand. Ride-side
// temporal scoring is kept only as a mild late-night behavior modifier.
export function computeTemporalModifiers(dateObj) {
  const day = dateObj.getUTCDay();
  const hour = dateObj.getUTCHours();

  let foodMod = 1.0;
  let rideMod = 1.0;

  if ((day === 6 || day === 0) && hour === 10) foodMod = 1.3;
  if (hour >= 11 && hour <= 13) foodMod = 1.5;
  if (hour >= 17 && hour <= 20) foodMod = 1.5;
  if ((day === 5 || day === 6) && hour >= 22) {
    rideMod = 1.15;
    foodMod = 0.8;
  }
  if ((day === 6 || day === 0) && hour < 2) {
    rideMod = 1.15;
    foodMod = 0.8;
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
      "temperature_2m,precipitation_probability,precipitation,snowfall,weathercode"
    );
    // Sprint 41: append &daily=sunset so the existing Open-Meteo call also
    // returns today's local sunset time. Reused by computeSupplyDropMod for
    // the Ramadan Iftar ±30 min window — NO new network request.
    url.searchParams.set("daily", "sunset");
    // Open-Meteo aligns to whole hours; request hours+1 so windowing always covers the user's full block.
    url.searchParams.set("forecast_hours", String(hours + 1));
    url.searchParams.set("temperature_unit", "fahrenheit");
    url.searchParams.set("precipitation_unit", "inch");
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
        const snowfall = data.hourly?.snowfall || [];
        const weatherCodes = data.hourly?.weathercode || [];

        // Slice to exactly the user's selected window.
        const windowed = times.slice(0, hours + 1).map((t, i) => ({
          time: t,
          tempF: temps[i],
          precipChancePct: precipProb[i],
          precipInches: precip[i],
          snowfallInches: snowfall[i],
          weatherCode: weatherCodes[i],
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
function effectiveArrivalIso(flight) {
  return flight?.arrival?.actual || flight?.arrival?.estimated || flight?.arrival?.scheduled || null;
}

function normalizeFlightStatus(flight) {
  const raw = String(flight?.flight_status || flight?.status || "").trim();
  if (!raw) return "Scheduled";
  if (/cancel/i.test(raw)) return "Cancelled";
  if (/delay/i.test(raw)) return "Delayed";
  if (/on[_\s-]?time/i.test(raw)) return "On Time";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isoLocalTimeKey(iso) {
  const match = String(iso || "").match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : String(iso || "");
}

function flightIdentifier(flight) {
  return flight?.flight?.iata || flight?.flight?.number || flight?.flight?.icao || null;
}

function aggregateArrivalsByHour({ flights, localStart, localEnd, offsetMin, rideMod = 1.0, minutesToAirport = 0 }) {
  const rows = [];
  const seen = new Set();
  const driveMinutes =
    Number.isFinite(minutesToAirport) && minutesToAirport > 0
      ? minutesToAirport
      : DEFAULT_AIRPORT_DRIVE_MINUTES;
  for (const f of flights) {
    const status = normalizeFlightStatus(f);
    if (/cancel/i.test(status)) continue;
    const effectiveIso = effectiveArrivalIso(f);
    if (!effectiveIso) continue;

    const depIata = f.departure?.iata;
    if (!depIata || !HIGH_VALUE_HUBS.includes(depIata)) continue;

    // Sprint 68: relaxed fingerprint — `HH:MM_IATA` (local-hour:minute
    // portion of the ISO scheduled string + IATA). Replaces the Sprint 4.1
    // strict `scheduled|iata|airport-name` form so live + BYOD records for
    // the same physical plane dedupe even when their `departure.airport`
    // strings differ ("Orlando International" vs "Orlando").
    const ident = flightIdentifier(f);
    const fpTimeKey = isoLocalTimeKey(effectiveIso);
    const fingerprints = [`${fpTimeKey}_${depIata}`];
    if (ident) fingerprints.push(`${ident}_${depIata}_${fpTimeKey}`);
    if (fingerprints.some((fp) => seen.has(fp))) continue;
    for (const fp of fingerprints) seen.add(fp);

    const arrivalUtc = new Date(effectiveIso);
    if (Number.isNaN(arrivalUtc.getTime())) continue;

    // Sprint 87: +25 min curb shift BEFORE windowing. Passengers don't
    // hit the curb when the plane lands — they deplane, gather bags, and
    // walk out immediately. The driver should be dispatched to the curb,
    // not the runway.
    const shiftedUtc = new Date(arrivalUtc.getTime() + ALB_CURB_BUFFER_MINUTES * 60 * 1000);

    // Shift into the same "wall-clock-as-UTC" frame the rest of the file uses.
    const arrivalLocal = new Date(arrivalUtc.getTime() - offsetMin * 60 * 1000);
    const shiftedLocal = new Date(shiftedUtc.getTime() - offsetMin * 60 * 1000);
    if (shiftedLocal < localStart || shiftedLocal >= localEnd) continue;

    let h = shiftedLocal.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const label = `${h} ${ampm}`;

    // Sprint 29: compute per-flight fatigue; log every trigger so the PO
    // can spot each contributor; carry the MAX across the bucket so one
    // late-night delay marks the whole hour.
    const fatigueMod = computeFatigueMod(f);
    if (fatigueMod > 1.0) {
      const delayMin = Number(f.arrival?.delay) || 0;
      console.log(
        `AVIATION FATIGUE TRIGGERED: ${ident || depIata} | Delay: ${delayMin}m | Mod: ${fatigueMod}x`
      );
    }

    // Sprint 30: leisureMod fires only when origin hub AND airline both
    // belong to the leisure cohort. Log every trigger; bucket carries MAX.
    const airlineIata = f.airline?.iata;
    const leisureMod = computeLeisureMod(depIata, airlineIata);
    if (leisureMod > 1.0) {
      console.log(
        `LEISURE HUB TRIGGERED: ${ident || depIata} | Hub: ${depIata} | Mod: ${leisureMod}x`
      );
    }

    const scheduledIso = f.arrival?.scheduled || effectiveIso;
    const scheduledUtc = new Date(scheduledIso);
    const explicitDelay = Number(f.arrival?.delay);
    const delayMinutes =
      Number.isFinite(explicitDelay) && explicitDelay > 0
        ? explicitDelay
        : !Number.isNaN(scheduledUtc.getTime()) && scheduledIso !== effectiveIso
          ? Math.max(0, Math.round((arrivalUtc.getTime() - scheduledUtc.getTime()) / 60000))
          : null;
    const leaveByDate = new Date(shiftedLocal.getTime() - driveMinutes * 60 * 1000);
    const originLabel = HUB_IATA_TO_CITY[depIata] || f.departure?.airport || depIata;

    rows.push({
      type: "flight",
      hourBucket: label,
      volume: 1,
      flightNumber: ident,
      origin: depIata,
      origins: [depIata],
      originLabel,
      originLabels: [originLabel],
      status,
      arrivalTime: formatLeaveBy(arrivalLocal),
      curbTime: formatLeaveBy(shiftedLocal),
      leaveBy: formatLeaveBy(leaveByDate),
      driveMinutes,
      curbBufferMinutes: ALB_CURB_BUFFER_MINUTES,
      delayMinutes,
      arrivalConfidence: f.arrival?.actual ? "actual" : f.arrival?.estimated ? "estimated" : "displayed",
      hub: "ALB",
      fatigueMod,
      leisureMod,
      lat: ALB_COORDS.lat,
      lng: ALB_COORDS.lng,
    });
  }

  // Sprint 20: leaveBy = earliest shifted arrival in bucket − minutesToAirport.
  // Sprint 21: emit a strict array of objects so the frontend can .map() it.
  // Sprint 27: emit the RAW codes.length as volume. Multiplier application
  // lives exclusively inside buildItinerary now (kills the double-scaling
  // "squaring" bug from Sprint 23).
  return rows.sort((a, b) => parseTimeLabel(a.leaveBy) - parseTimeLabel(b.leaveBy));
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

// Sprint 53 parseAmtrakText now lives client-side in app/page.js
// (Sprint 59 — localStorage migration). The parsed trains array travels
// in the dispatch body as `byodTrains`, already lazy-wiped against
// today's local date by the client.

// Sprint 67: BYOD Bus Inbound parser. Identifies blocks containing
// `Arriving\n[TIME]` paired with the next `To\n[DESTINATION]`. STRICT
// FILTER drops any destination matching /SUNY/i so uptown drop-off buses
// are never re-routed downtown. Surviving entries are tagged with their
// operator ("Greyhound" | "Trailways"). Kept fully isolated from
// parseAmtrakText per Sprint 67 Anti-Goal (no shared regex / state).
// Validated by test-bus-parser.js (7/7) BEFORE wiring into the dispatch loop.
function parseBusSchedule(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const text = rawText.replace(/\r\n/g, "\n");
  const pattern =
    /Arriving\s*\n\s*(\d{1,2}:\d{2})\s*([ap])m[\s\S]*?To\s*\n\s*([^\n]+)/gi;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const timeDigits = match[1];
    const ampmLetter = match[2].toLowerCase();
    const destination = match[3].trim();
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

// Sprint 68: BYOD Flight Arrivals parser. Splits the pasted ALB live-board
// text by lines, finds a `H:MM AM/PM` time on each, looks up the longest
// matching dictionary city key (case-insensitive containment), and emits a
// synthetic flight record in the SAME shape AviationStack returns so the
// existing aggregator handles it without a branch. Cities NOT in
// HUB_CITY_PATTERNS are silently dropped (Sprint 68 §4 strict filter).
//
// The scheduled ISO embeds the airport-LOCAL offset (derived from offsetMin)
// so the existing `T(\d{2}):(\d{2})` extraction inside aggregateArrivalsByHour
// reads the same LOCAL hour for both live + BYOD records — that's what
// makes the relaxed `HH:MM_IATA` fingerprint dedupe overlapping planes.
//
// Validated by test-flight-byod.js (15/15) BEFORE wiring into the route.
function parseFlightText(rawText, offsetMin = 0) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];

  const now = new Date();
  const local = new Date(now.getTime() - offsetMin * 60 * 1000);
  const y = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const d = String(local.getUTCDate()).padStart(2, "0");
  const datePart = `${y}-${m}-${d}`;

  // offsetMin convention (per Sprint 3.1 / line 1941): positive for places
  // WEST of UTC (EDT = +240). ISO offset is the inverse → "-04:00" for EDT.
  const sign = offsetMin >= 0 ? "-" : "+";
  const absOff = Math.abs(offsetMin);
  const offH = String(Math.floor(absOff / 60)).padStart(2, "0");
  const offM = String(absOff % 60).padStart(2, "0");
  const isoOffset = `${sign}${offH}:${offM}`;

  // Sprint 68 Dictionary Scan Overhaul: chunk → scan → match → push.
  // Mobile ALB pastes drop one cell per line (Flight \n City \n Gate \n
  // Status \n Time). Buffer lines until a time line closes the block,
  // then run a dictionary scan against the whole buffered block. Desktop
  // horizontal pastes also work because the whole row is one line that
  // already contains the time.
  //
  // Time regex carries `\s*` before `[ap]m` so BOTH "10:07am" (mobile,
  // no space) and "3:45 PM" (desktop, space + uppercase + M) match
  // without breaking the spec's literal `\d{1,2}:\d{2}[ap]m` shape.
  // Two regexes kept apart: the non-global form is used for stateless
  // .test() during chunking, and a separate global form is used inside
  // each block to extract EVERY time (delay patch — pick the latest).
  const TIME_RE = /(\d{1,2}):(\d{2})\s*([ap])m/i;
  const TIME_RE_ALL = /(\d{1,2}):(\d{2})\s*([ap])m/gi;

  const blocks = [];
  let buf = [];
  for (const line of rawText.split(/\r?\n/)) {
    buf.push(line);
    if (TIME_RE.test(line)) {
      blocks.push(buf.join("\n"));
      buf = [];
    }
  }
  // Any trailing buffer without a time line is silently dropped.

  const flights = [];
  for (const block of blocks) {
    // Sprint 68 Delay-Flight Patch: ALB live boards show delayed flights
    // with two times in the same cell ("1:02pm 2:14pm"). Pull EVERY time
    // in the block via the global regex, then pick the LAST match so the
    // driver is dispatched to the delayed arrival, not the original
    // scheduled one. Single-time blocks still work (matches[length-1] is
    // the only match).
    const allTimes = [...block.matchAll(TIME_RE_ALL)];
    if (allTimes.length === 0) continue;
    const timeMatch = allTimes[allTimes.length - 1];
    const parsedTime = timeMatch[0];

    let matchedIata = null;
    let parsedCity = null;
    const blockLower = block.toLowerCase();
    const statusMatch = block.match(/\b(cancelled|canceled|delayed|on\s*time)\b/i);
    const parsedStatus = statusMatch
      ? statusMatch[1].toLowerCase().replace(/\s+/g, "_").replace("canceled", "cancelled")
      : "scheduled";
    for (const city of HUB_CITY_KEYS_LONGEST_FIRST) {
      if (blockLower.includes(city.toLowerCase())) {
        matchedIata = HUB_CITY_PATTERNS[city];
        parsedCity = city;
        break;
      }
    }
    if (!matchedIata) continue;

    // Sprint 68 Visibility Patch (retained per Dictionary Scan Overhaul
    // §2): surfaces the dictionary-key match + raw time substring so the
    // driver can confirm in the terminal that the block resolved.
    console.log("BYOD PARSE RESULT: ", { parsedCity, parsedTime });

    let hour = Number(timeMatch[1]);
    const min = timeMatch[2];
    const ampm = timeMatch[3].toLowerCase() === "p" ? "PM" : "AM";
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
    const hourStr = String(hour).padStart(2, "0");

    const scheduled = `${datePart}T${hourStr}:${min}:00${isoOffset}`;
    flights.push({
      flight_status: parsedStatus,
      arrival: { scheduled },
      departure: { iata: matchedIata, airport: parsedCity },
      airline: { iata: null },
      flight: { iata: null, number: null },
    });
  }
  return flights;
}

// Sprint 54: BYOD Time Gate. Returns true when a BYOD-parsed train's
// arrival falls in [localStart - 10 min, localEnd]. The -10 min buffer
// covers active unloading already underway when the driver hits
// dispatch. Cross-midnight rollover mirrors Sprint 32.1's time-decay
// convention. Validated in isolation by test-time-gate.js (21/21).
function isTrainInWindow(arrivalTimeStr, localStart, hoursNum) {
  const arrivalMin = parseTimeLabel(arrivalTimeStr);
  if (!Number.isFinite(arrivalMin)) return false;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const hours = Number(hoursNum);
  if (!Number.isFinite(hours) || hours <= 0) return false;

  const startMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  let delta = arrivalMin - startMin;
  if (delta < -360) delta += 1440;

  return delta >= -10 && delta <= hours * 60;
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
// Sprint 54: the Sprint 39 BYOD trainCapacity merge has been excised — the
// CSV uploader, its localStorage hydration, and computeCapacityMod are
// all gone. The live Amtraker bucket no longer carries a capacityMod
// field; downstream densityScore math reads the raw `volume` count.
function aggregateTrainArrivalsByHour({ trains, localStart, localEnd, offsetMin, rideMod = 1.0 }) {
  if (!Array.isArray(trains)) return [];
  const originsByHour = {};
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
  }

  // Sprint 22: emit a strict array of objects so the frontend can .map() it.
  // No leaveBy — train egress is instant (PO anti-goal).
  // Sprint 27: emit RAW codes.length as volume (parity with flight aggregator).
  // Sprint 65: stamp `relativeTime` on each bucket so the TrainCard can
  // render a precise countdown ("Arriving in 45 mins") without any
  // client-side clock math. Hour-bucket label resolves to its hour-boundary
  // minute via parseTimeLabel; localStart is already wall-clock-as-UTC
  // (Sprint 3.1) so getUTCHours/getUTCMinutes reads the driver's wall-clock.
  const startMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    buckets.push({
      type: "train",
      hourBucket: hour,
      volume: codes.length,
      origins: codes,
      hub: "Rensselaer",
      // Sprint 62: tag inbound live-Amtraker buckets so the Mapbox radar
      // can color them emerald via the categories check.
      categories: ["Inbound"],
      // Sprint 37: Amtrak coords so the Mapbox radar can pin each train bucket.
      lat: AMTRAK_COORDS.lat,
      lng: AMTRAK_COORDS.lng,
      relativeTime: computeRelativeTimeString(parseTimeLabel(hour), startMin, "arrival"),
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

// Sprint 63: Spatial join against POPULATION_GRID. Finds the nearest census
// node within POP_RADIUS_MILES (1.5) and returns its baseMultiplier — i.e.
// the strongest residential density signal a given coordinate can claim.
// Returns 1.0 (no boost) when nothing is in range OR when the grid failed
// to load. Output range: 1.0 (commercial wasteland) → 2.5 (hyper-dense
// student/residential).
const POP_RADIUS_MILES = 1.5;
function calculateSpatialPopulationBoost(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 1.0;
  if (!Array.isArray(POPULATION_GRID) || POPULATION_GRID.length === 0) return 1.0;
  let nearestMult = 1.0;
  let nearestDist = Infinity;
  for (const node of POPULATION_GRID) {
    const d = haversineMiles(lat, lng, node.lat, node.lng);
    if (d > POP_RADIUS_MILES) continue;
    if (d < nearestDist) {
      nearestDist = d;
      nearestMult = Number(node.baseMultiplier) || 1.0;
    }
  }
  return nearestMult;
}

// Sprint 63: Synthetic Residential Ride Hubs. Iterate POPULATION_GRID, keep
// nodes whose baseMultiplier >= POP_RIDE_THRESHOLD (2.0 — the math floor
// that exactly clears the Sprint 27 density gate), sort by multiplier desc,
// cap at POP_RIDE_MAX_HUBS (5) per the user-confirmed top-N decision so the
// radar isn't drowned in residential pins. Returns scoreable `type: "ride"`
// objects ready to flow into buildItinerary alongside flights / trains /
// food / events.
const POP_RIDE_THRESHOLD = 2.0;
const POP_RIDE_MAX_HUBS = 5;
function buildSyntheticRideHubs() {
  if (!Array.isArray(POPULATION_GRID) || POPULATION_GRID.length === 0) return [];
  const qualifying = POPULATION_GRID.filter(
    (n) => (Number(n.baseMultiplier) || 0) >= POP_RIDE_THRESHOLD
  );
  qualifying.sort((a, b) => (b.baseMultiplier || 0) - (a.baseMultiplier || 0));
  const topN = qualifying.slice(0, POP_RIDE_MAX_HUBS);
  return topN.map((n) => {
    console.log(
      `[Ride Boost] Synthetic Residential Hub at ${n.lat.toFixed(4)},${n.lng.toFixed(4)} generated with populationDensityMod=${n.baseMultiplier}x`
    );
    return {
      type: "ride",
      volume: 1,
      location: `Residential Hub @ ${n.lat.toFixed(3)}, ${n.lng.toFixed(3)}`,
      categories: ["Residential Node"],
      lat: n.lat,
      lng: n.lng,
      populationDensityMod: n.baseMultiplier,
    };
  });
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

function parseStaticPoiHHMM(value) {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function isStaticPoiActiveNow(poi, localStart) {
  if (!Array.isArray(poi?.activeWindows) || poi.activeWindows.length === 0) return true;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return true;

  const currentDay = localStart.getUTCDay();
  const currentMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  const prevDay = (currentDay + 6) % 7;

  for (const window of poi.activeWindows) {
    const days = Array.isArray(window?.days) ? window.days : [0, 1, 2, 3, 4, 5, 6];
    const start = parseStaticPoiHHMM(window?.start);
    const end = parseStaticPoiHHMM(window?.end);
    if (start == null || end == null) continue;

    if (start <= end) {
      if (days.includes(currentDay) && currentMin >= start && currentMin <= end) return true;
      continue;
    }

    if (days.includes(currentDay) && currentMin >= start) return true;
    if (days.includes(prevDay) && currentMin <= end) return true;
  }

  return false;
}

function normalizePoiName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(inc|llc|co|company)\b/g, "")
    .trim();
}

const DOORDASH_ENRICHMENT_BY_NAME = (() => {
  const out = new Map();
  for (const row of DOORDASH_POI_ENRICHMENT) {
    const key = normalizePoiName(row?.name);
    if (key) out.set(key, row);
  }
  return out;
})();

function findDoorDashEnrichment(name) {
  const key = normalizePoiName(name);
  if (!key) return null;
  if (DOORDASH_ENRICHMENT_BY_NAME.has(key)) return DOORDASH_ENRICHMENT_BY_NAME.get(key);

  for (const [candidateKey, row] of DOORDASH_ENRICHMENT_BY_NAME.entries()) {
    if (candidateKey.length < 6 || key.length < 6) continue;
    if (candidateKey.includes(key) || key.includes(candidateKey)) return row;
  }
  return null;
}

function normalizeStaticPoi(poi, type) {
  const normalized = {
    name: poi.name || "Unknown",
    lat: Number(poi.lat),
    lng: Number(poi.lng),
    price: poi.price || "",
    categories: Array.isArray(poi.categories) ? poi.categories : [type === "grocery" ? "Grocery" : "Mixed"],
    dayparts: Array.isArray(poi.dayparts) ? poi.dayparts : [],
    address1: poi.address1 || "",
    rating: Number(poi.rating) || 0,
    reviewCount: Number(poi.reviewCount) || 0,
  };
  const doordash = findDoorDashEnrichment(normalized.name);
  if (!doordash) return normalized;

  return {
    ...normalized,
    deliveryApps: ["DoorDash"],
    doordashRating: Number(doordash.rating) || 0,
    doordashReviewCount: Number(doordash.reviewCount) || 0,
    doordashCategories: Array.isArray(doordash.categories) ? doordash.categories : [],
    doordashEtaMinutes: Number(doordash.etaMinutes) || null,
    doordashDistanceMiles: Number(doordash.distanceMiles) || null,
  };
}

const FOOD_DAYPART_POLICIES = [
  {
    label: "morning breakfast filter",
    startMin: 6 * 60,
    endMin: 11 * 60,
    tags: ["breakfast", "morning", "brunch"],
    categories: [],
  },
  {
    label: "lunch filter",
    startMin: 11 * 60,
    endMin: 14 * 60,
    tags: ["lunch", "brunch"],
    categories: [
      "sandwiches",
      "salads",
      "fast food",
      "pizza",
      "american",
      "mexican",
      "chinese",
      "indian",
      "thai",
      "korean",
      "vietnamese",
      "japanese",
      "mediterranean",
      "halal",
      "wings",
      "burgers",
      "latin american",
    ],
  },
  {
    label: "dinner filter",
    startMin: 17 * 60,
    endMin: 21 * 60,
    tags: ["dinner"],
    categories: [
      "pizza",
      "italian",
      "american",
      "mexican",
      "chinese",
      "indian",
      "thai",
      "korean",
      "vietnamese",
      "japanese",
      "sushi",
      "seafood",
      "steakhouse",
      "mediterranean",
      "halal",
      "wings",
      "burgers",
      "latin american",
      "dominican",
      "colombian",
      "salvadoran",
      "caribbean",
      "jamaican",
      "southern",
      "barbecue",
    ],
  },
  {
    label: "late-night filter",
    startMin: 21 * 60,
    endMin: 2 * 60,
    tags: ["late-night", "late night"],
    categories: ["pizza", "fast food", "wings", "burgers", "halal", "sandwiches", "mexican", "american", "desserts"],
  },
];

function getFoodDaypartPolicy(localStart) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return false;
  const minutes = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  return FOOD_DAYPART_POLICIES.find((policy) => {
    if (policy.startMin < policy.endMin) {
      return minutes >= policy.startMin && minutes < policy.endMin;
    }
    return minutes >= policy.startMin || minutes < policy.endMin;
  });
}

function hasBreakfastDaypart(poi) {
  if (!Array.isArray(poi?.dayparts)) return false;
  return poi.dayparts.some((d) => {
    const tag = String(d).toLowerCase();
    return tag === "breakfast" || tag === "morning" || tag === "brunch";
  });
}

function matchesFoodDaypart(poi, policy) {
  if (!policy) return false;
  const dayparts = Array.isArray(poi?.dayparts) ? poi.dayparts : [];
  const categories = Array.isArray(poi?.categories) ? poi.categories : [];
  const haystack = [...dayparts, ...categories].map((v) => String(v).toLowerCase().trim());
  return haystack.some((value) =>
    [...policy.tags, ...policy.categories].some((needle) => value.includes(needle))
  );
}

function getStaticPoiBusinesses({ latitude, longitude, category, localStart }) {
  const type = category === "grocery" ? "grocery" : "food";
  const rows = Array.isArray(ALBANY_POI_DICTIONARY?.[type])
    ? ALBANY_POI_DICTIONARY[type]
    : [];

  const businessesAll = rows
    .filter((poi) => isStaticPoiActiveNow(poi, localStart))
    .map((poi) => normalizeStaticPoi(poi, type))
    .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng))
    .filter((b) => haversineMeters(latitude, longitude, b.lat, b.lng) <= 5000);
  const activeDaypartPolicy = type === "food" ? getFoodDaypartPolicy(localStart) : null;
  const businesses =
    activeDaypartPolicy && businessesAll.some((b) => matchesFoodDaypart(b, activeDaypartPolicy))
      ? businessesAll.filter((b) => matchesFoodDaypart(b, activeDaypartPolicy))
      : businessesAll;

  console.log(
    `STATIC POI DATA (${type}): ${businesses.length} eligible businesses within 5km${activeDaypartPolicy ? ` (${activeDaypartPolicy.label})` : ""}`
  );
  return businesses;
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

    const hasHighEnd = bestCluster.some((b) => (b.price || "").length >= 3);
    const midCount = bestCluster.filter((b) => b.price === "$$").length;
    let tier;
    if (hasHighEnd) tier = "High-Value ($$$)";
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

    const daypartCounts = {};
    for (const b of bestCluster) {
      for (const d of b.dayparts || []) {
        const key = String(d).trim();
        if (key) daypartCounts[key] = (daypartCounts[key] || 0) + 1;
      }
    }
    const topDayparts = Object.entries(daypartCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([d]) => d);

    // Sprint 28: Anchor pick + Additive Stack qualityMod.
    const popularityFor = (business) => {
      const rating = Number(business?.rating) || Number(business?.doordashRating) || 0;
      const reviewCount =
        Number(business?.reviewCount) || Number(business?.doordashReviewCount) || 0;
      return rating * reviewCount;
    };
    let anchor = bestCluster[0];
    let popularityScore = popularityFor(anchor);
    for (const b of bestCluster) {
      const score = popularityFor(b);
      if (score > popularityScore) {
        anchor = b;
        popularityScore = score;
      }
    }
    const nearbyNames = bestCluster
      .filter((b) => b !== anchor && b?.name)
      .sort((a, b) => popularityFor(b) - popularityFor(a))
      .slice(0, 3)
      .map((b) => b.name);
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
    // so the Mapbox radar can pin both families.
    const centroidLat =
      bestCluster.reduce((sum, b) => sum + b.lat, 0) / bestCluster.length;
    const centroidLng =
      bestCluster.reduce((sum, b) => sum + b.lng, 0) / bestCluster.length;

    // Sprint 63: Spatial population boost — only food gets the residential
    // density multiplier (per brief: applied "when looping through
    // foodHotspots from the Yelp API data"). Grocery is intentionally
    // excluded from this engine.
    let populationDensityMod = 1.0;
    if (type === "food") {
      populationDensityMod = calculateSpatialPopulationBoost(centroidLat, centroidLng);
      if (populationDensityMod > 1.0) {
        console.log(
          `[Food Boost] ${location} at ${centroidLat.toFixed(4)},${centroidLng.toFixed(4)} received populationDensityMod=${populationDensityMod}x`
        );
      }
    }

    hotspots.push({
      type,
      location,
      volume: bestCluster.length,
      tier,
      categories: topCats.length > 0 ? topCats : ["Mixed"],
      dayparts: topDayparts,
      qualityMod,
      // Sprint 28.1: surface the Anchor's name so the React HotspotCard can
      // render "Anchored by <name>" beneath the intersection header.
      anchorName: anchor?.name,
      nearbyNames,
      // Sprint 37: cluster centroid so the Mapbox radar can drop a pin
      // on the geographic middle of the cluster.
      lat: centroidLat,
      lng: centroidLng,
      // Sprint 63: spatial population boost (food only). Travels into
      // buildItinerary → yieldRateFor and is applied as a strict
      // multiplicative add-on to the baseline food yield rate. Grocery
      // hotspots never set it, so the read defaults to 1.0 there.
      populationDensityMod,
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

// Sprint 61: inverse of parseTimeLabel — minutes-since-midnight → "H:MM AM/PM".
// Wraps via mod-1440 so a sub-60 outbound shift that crosses backwards over
// midnight (e.g. 12:30 AM dep → -30 min raw → 11:30 PM prior day) still
// produces a valid wall-clock label.
function formatTimeLabel(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

// Sprint 65: Relative Time Indicator. Pure helper — given a target wall-
// clock minute and the driver's localStart wall-clock minute, returns the
// "Arriving in 45 mins" / "Departed 5 mins ago" string the cards render
// verbatim (no client clock math, no setInterval). Cross-midnight wrap
// mirrors Sprint 61's computeOutboundLeaveBy convention (delta < -360 →
// +1440 ; delta > 720 → -1440) so the same time-frame rules apply across
// every transit helper in this file. NOT clamped — zero and past deltas
// are stated explicitly per the brief's Precise Historian rule. Returns
// null on non-finite inputs so the renderer falls through cleanly to the
// absolute time when, e.g., parseTimeLabel returns Infinity.
function formatRelativeUnit(absMin) {
  if (absMin < 60) return `${absMin} mins`;
  const hrs = Math.floor(absMin / 60);
  const mins = absMin % 60;
  const hrLabel = hrs === 1 ? "1 hr" : `${hrs} hrs`;
  return mins === 0 ? hrLabel : `${hrLabel} ${mins} mins`;
}
function computeRelativeTimeString(targetMinutes, startMinutes, kind = "arrival") {
  if (!Number.isFinite(targetMinutes) || !Number.isFinite(startMinutes)) return null;
  let delta = targetMinutes - startMinutes;
  if (delta < -360) delta += 1440;
  else if (delta > 720) delta -= 1440;
  const futureVerb = kind === "departure" ? "Departing" : "Arriving";
  const pastVerb = kind === "departure" ? "Departed" : "Arrived";
  const unit = formatRelativeUnit(Math.abs(delta));
  if (delta < 0) return `${pastVerb} ${unit} ago`;
  return `${futureVerb} in ${unit}`;
}

// Sprint 61: BYOD Outbound time math. Driver targets ESP 60 min before the
// train leaves. Strict drop under 40 min (cannot make it); clamp leaveBy to
// "now" inside the 40–60 min band so it acts as an immediate surge without
// a past-timestamp time-decay penalty. Cross-midnight rollover mirrors the
// Sprint 54 isTrainInWindow convention. Returns null when the train must be
// dropped or when inputs are malformed.
function computeOutboundLeaveBy(departureTimeStr, localStart) {
  const depMin = parseTimeLabel(departureTimeStr);
  if (!Number.isFinite(depMin)) return null;
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return null;
  const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  let delta = depMin - nowMin;
  if (delta < -360) delta += 1440;
  if (delta < OUTBOUND_DROP_THRESHOLD) return null;
  if (delta < OUTBOUND_BUFFER_MINUTES) return formatTimeLabel(nowMin);
  return formatTimeLabel(depMin - OUTBOUND_BUFFER_MINUTES);
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

// Sprint 70: Raw Yield Engine. Replaces the Sprint 48 percentage-of-capacity
// formula with `volume × yield × mod`. Removes the cross-type comparability
// bug surfaced by the Sprint 68 simulator (a one-bar Last Call at density
// 87% out-ranked a stadium egress at 9%) AND the MVP-Arena yield/capacity
// mismatch (yield came from egressMod, capacity came from categories[0] —
// two different inputs for the same venue). Field name `densityScore`
// retained for surgical minimality — only the meaning changes from
// "% of venue capacity" to "expected riders". The 10.0 filter floor at
// buildItinerary still applies; transit baselines (flight 15, train 12)
// clear it at full mod, drop with time-decay 0.4 — matching prior behavior.
// All pre-Sprint-48 per-item multipliers (fatigueMod, leisureMod, qualityMod,
// egressMod) still travel on the items and remain visible in the merged
// payload — they're intentionally absent from the score formula because
// the multipliers were already baked into the upstream volume / yield
// numbers they were tuned against.
export function densityScore(item, finalRideMod, finalFoodMod, localStart = null) {
  const yieldRate = yieldRateFor(item, localStart);
  if (yieldRate <= 0) return 0;
  const mod =
    item.type === "food" || item.type === "grocery" ? finalFoodMod : finalRideMod;
  return (Number(item.volume) || 0) * yieldRate * mod;
}

function opportunityScoreFor(demandScore, driverSupplyPressureMod = 1.0) {
  const pressure = Number(driverSupplyPressureMod);
  if (!Number.isFinite(demandScore) || demandScore <= 0) return 0;
  if (!Number.isFinite(pressure) || pressure <= 1.0) return demandScore;
  return demandScore * pressure;
}

function isByodTrainEvent(item) {
  const catsAll = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  return /BYOD Train/i.test(catsAll);
}

function itineraryScoreFloorFor(item, localStart = null) {
  if (isByodTrainEvent(item)) return 4.0;
  if (item?.type === "food" && isMorningYieldWindow(localStart)) return 4.0;
  return 10.0;
}

function shouldApplyDeadheadRoiFilter(item) {
  if (isByodTrainEvent(item)) return false;
  return item?.type !== "food" && item?.type !== "grocery";
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
  // Sprint 63: synthetic residential ride hubs (type: "ride") emitted from
  // the population density engine. Scored / filtered / sorted alongside
  // every other surge type so they obey the same density floor + ROI rules.
  const rideHubs = Array.isArray(payload?.rideHubs) ? payload.rideHubs : [];
  const rawItems = [...flights, ...trains, ...food, ...grocery, ...events, ...rideHubs];

  const finalRideMod = Number.isFinite(payload?.finalRideMod) ? payload.finalRideMod : 1.0;
  const finalFoodMod = Number.isFinite(payload?.finalFoodMod) ? payload.finalFoodMod : 1.0;
  const driverSupplyPressureMod =
    Number.isFinite(payload?.driverSupplyPressureMod) && payload.driverSupplyPressureMod > 0
      ? payload.driverSupplyPressureMod
      : 1.0;

  const expectedDemand = (it) =>
    densityScore(it, finalRideMod, finalFoodMod, currentLocalStart);
  const timeAdjustedDemand = (it) =>
    expectedDemand(it) * computeTimeDecayMod(it.leaveBy || it.hourBucket, currentLocalStart);
  const opportunity = (it) =>
    Number(it?.opportunityScore) ||
    opportunityScoreFor(timeAdjustedDemand(it), driverSupplyPressureMod);

  // Sprint 27 + Sprint 48: strict density filter. With the Normalized
  // Density Engine the score lives on a 0-100+ percent-of-capacity scale,
  // so the dropout floor moves from <1.0 to <10.0 (i.e., drop anything
  // generating less than 10% of venue capacity in expected yield). Any
  // item below the floor is pruned entirely. Synthetic ripple objects +
  // items with no scoreable type pass through untouched.
  // Sprint 48 + Sprint 70: stamp expectedYield / densityScore on every
  // scoreable item so (a) the terminal merged-payload log surfaces the
  // math, and (b) the React UI can render "Expected Riders: N" without
  // re-deriving anything. estimatedCapacity is gone with the capacity
  // dictionary.
  // Sprint 60: Ghost Mode is permanently dead — the Sprint 27 strict
  // < 10.0 cutoff is now always enforced. isWeak is still stamped for
  // any future headless client that wants the signal, but the bypass
  // branch has been excised.
  const items = rawItems
    .map((it) => {
      const scoreable =
        it.type === "flight" ||
        it.type === "train" ||
        it.type === "food" ||
        it.type === "grocery" ||
        it.type === "event" ||
        it.type === "ride";
      if (!scoreable) return it;
      // Sprint 70: estimatedCapacity + Sprint 62.3 capacity clamp removed.
      // expectedYield stays — same value as `volume × yieldRate`, useful
      // for UI display alongside the headline densityScore.
      const expectedYield = (Number(it.volume) || 0) * yieldRateFor(it, currentLocalStart);
      const score = expectedDemand(it);
      const opportunityScore = opportunityScoreFor(
        timeAdjustedDemand(it),
        driverSupplyPressureMod
      );
      return {
        ...it,
        expectedYield,
        densityScore: score,
        opportunityScore,
        driverSupplyPressureMod,
        isWeak: score < itineraryScoreFloorFor(it, currentLocalStart),
      };
    })
    .filter((it) => {
      const scoreable =
        it.type === "flight" ||
        it.type === "train" ||
        it.type === "food" ||
        it.type === "grocery" ||
        it.type === "event" ||
        it.type === "ride";
      if (!scoreable) return true;
      return expectedDemand(it) >= itineraryScoreFloorFor(it, currentLocalStart);
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
        it.type === "event" ||
        it.type === "ride";
      if (!scoreable) return true;
      if (!shouldApplyDeadheadRoiFilter(it)) return true;
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
      const expectedValue = opportunity(it) * DOLLAR_PER_SURGE_POINT;
      if (deadheadCost > expectedValue) {
        console.log(
          `ROI FILTER DROPPED: ${it.location || it.hourBucket || it.type} | Cost: $${deadheadCost.toFixed(2)} | Value: $${expectedValue.toFixed(2)}`
        );
        return false;
      }
      return true;
    });

  if (strategy === "profitability") {
    return [...items].sort((a, b) => opportunity(b) - opportunity(a));
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
      .sort((a, b) => opportunity(b) - opportunity(a));
    out.push(...arr);
  }
  return out;
}

// Sprint 66: Peak Overlap Engine. Sweeps a 30-minute window in 15-minute
// increments across the already-scored itinerary, sums each block's
// densityScore, and returns the winning window + its top contributors.
// Pure observer — does NOT mutate items or re-run any scoring math. Items
// without a finite time (current/ongoing hotspots) ride the EARLIEST
// window only. Cross-midnight handled via the same +1440 wrap convention
// as the rest of the file (Sprint 54 / 61). Returns null when there is
// nothing scoreable so the frontend can hide the banner cleanly.
function peakSurgeContributorLabel(it) {
  return it?.location || it?.hub || it?.type || "Unknown";
}
function findPeakSurgeWindow(itinerary) {
  if (!Array.isArray(itinerary) || itinerary.length === 0) return null;

  const withTime = [];
  const noTime = [];
  for (const it of itinerary) {
    const ds = Number(it?.densityScore);
    if (!Number.isFinite(ds) || ds <= 0) continue;
    const label = it.leaveBy || it.hourBucket;
    const t = parseTimeLabel(label);
    if (Number.isFinite(t)) withTime.push({ item: it, t });
    else noTime.push(it);
  }

  if (withTime.length === 0 && noTime.length === 0) return null;

  if (withTime.length === 0) {
    const total = noTime.reduce((s, it) => s + (Number(it.densityScore) || 0), 0);
    const top = [...noTime]
      .sort((a, b) => (Number(b.densityScore) || 0) - (Number(a.densityScore) || 0))
      .slice(0, 3)
      .map(peakSurgeContributorLabel);
    return {
      timeWindow: "Current / Ongoing",
      totalDensity: Math.round(total),
      topContributors: top,
    };
  }

  const rawTimes = withTime.map((x) => x.t);
  const spans = Math.max(...rawTimes) - Math.min(...rawTimes) > 720;
  const norm = withTime.map(({ item, t }) => ({
    item,
    t: spans && t < 360 ? t + 1440 : t,
  }));

  const minT = Math.min(...norm.map((x) => x.t));
  const maxT = Math.max(...norm.map((x) => x.t));

  let best = null;
  for (let start = minT; start <= maxT; start += 15) {
    const end = start + 30;
    const inside = norm
      .filter((x) => x.t >= start && x.t < end)
      .map((x) => x.item);
    const items = start === minT ? [...noTime, ...inside] : inside;
    if (items.length === 0) continue;
    const total = items.reduce((s, it) => s + (Number(it.densityScore) || 0), 0);
    if (!best || total > best.total) {
      best = { start, end, total, items };
    }
  }
  if (!best) return null;

  const top = [...best.items]
    .sort((a, b) => (Number(b.densityScore) || 0) - (Number(a.densityScore) || 0))
    .slice(0, 3)
    .map(peakSurgeContributorLabel);

  return {
    timeWindow: `${formatTimeLabel(best.start)} - ${formatTimeLabel(best.end)}`,
    totalDensity: Math.round(best.total),
    topContributors: top,
  };
}

// Returns { foodHotspots, groceryHotspots } arrays. Sprint 74: dispatch-time
// food/grocery density is fully local now: static Albany POIs, enriched by
// DoorDash metadata during normalization. Yelp is no longer called here.
// Sprint 28: localStart threaded through for the late-night Anchor bonus.
async function getLocalDensityData(latitude, longitude, localStart) {
  const [foodBiz, groceryBiz] = await Promise.all([
    Promise.resolve(
      getStaticPoiBusinesses({ latitude, longitude, category: "restaurants", localStart })
    ),
    Promise.resolve(
      getStaticPoiBusinesses({ latitude, longitude, category: "grocery", localStart })
    ),
  ]);

  const foodHotspots = computeHotspots(foodBiz, "food", localStart);
  const groceryHotspots = computeHotspots(groceryBiz, "grocery", localStart);
  console.log(
    "=== HOTSPOT CLUSTERS ===\n" +
      JSON.stringify({ foodHotspots, groceryHotspots }, null, 2)
  );
  return { foodHotspots, groceryHotspots };
}

// Sprint 50: Last Call Egress math, ported verbatim from test-last-call-engine.js
// after 12/12 tests passed. A close time listed as < 06:00 belongs to the
// PREVIOUS operational day (e.g. Friday "02:00" = Saturday 02:00 wall-clock).
const LAST_CALL_EARLY_AM_THRESHOLD_MIN = 360;
const LAST_CALL_WINDOW_MIN = 30;
const LAST_CALL_WINDOW_MAX = 45;

function lastCallParseHHMMtoMin(str) {
  if (typeof str !== "string") return null;
  const m = str.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function minutesUntilLastCall(localStart, closingTimes) {
  if (!(localStart instanceof Date) || !closingTimes) return null;
  const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
  const dayIdx = localStart.getUTCDay();
  const prevIdx = (dayIdx + 6) % 7;
  const candidates = [];

  const todayMin = lastCallParseHHMMtoMin(closingTimes[String(dayIdx)]);
  if (todayMin !== null) {
    const offset =
      todayMin < LAST_CALL_EARLY_AM_THRESHOLD_MIN
        ? 1440 - nowMin + todayMin
        : todayMin - nowMin;
    if (offset >= 0) candidates.push(offset);
  }

  const prevMin = lastCallParseHHMMtoMin(closingTimes[String(prevIdx)]);
  if (prevMin !== null && prevMin < LAST_CALL_EARLY_AM_THRESHOLD_MIN) {
    const offset = prevMin - nowMin;
    if (offset >= 0) candidates.push(offset);
  }

  for (const offset of candidates) {
    if (offset >= LAST_CALL_WINDOW_MIN && offset <= LAST_CALL_WINDOW_MAX) {
      return offset;
    }
  }
  return null;
}

function computeLastCallEgressEvents(localStart, dictionary) {
  const events = [];
  if (!Array.isArray(dictionary)) return events;
  for (const venue of dictionary) {
    const offset = minutesUntilLastCall(localStart, venue.closingTimes);
    if (offset === null) continue;
    events.push({
      type: "event",
      location: `Last Call Egress: ${venue.name}`,
      volume: 1,
      egressMod: 3.5,
      categories: ["Last Call", "Nightlife Egress"],
      lat: venue.lat,
      lng: venue.lng,
    });
    console.log(
      `LAST CALL EGRESS INJECTED: ${venue.name} | ${offset} min before close | egressMod 3.5x`
    );
  }
  return events;
}

export async function POST(request) {
  try {
    // Sprint 64: split BYOD train payload. The body now carries
    // `inboundTrains` + `outboundTrains` (each lazy-wiped client-side
    // against today's date) instead of the Sprint 59 `byodTrains` array +
    // Sprint 61 `direction` flag. The pre-merge below stamps `direction`
    // per train so the single BYOD loop can route each entry without a
    // global flag — and a frontend payload missing either array no longer
    // 500s the dispatch.
    const body = (await request.json()) || {};
    const {
      latitude,
      longitude,
      hours,
      timezoneOffsetMinutes,
      platforms,
      includeAirport: includeAirportRaw,
      includeAmtrak: includeAmtrakRaw,
      routingStrategy: routingStrategyRaw,
      costPerMile: costPerMileRaw,
      eventConfig: eventConfigRaw,
      inboundTrains: inboundTrainsRaw = [],
      outboundTrains: outboundTrainsRaw = [],
      // Sprint 67: BYOD Bus Inbound. Raw pasted bus schedule text from the
      // frontend textarea (when the radio is "busInbound"). Parsed server-
      // side by parseBusSchedule which drops SUNY drop-off entries.
      inboundBuses: inboundBusesRaw = "",
      // Sprint 68: BYOD Flight Arrivals. Raw pasted ALB live-board text
      // from the same textarea (when the radio is "flightInbound"). Parsed
      // server-side by parseFlightText, merged with rawFlights before the
      // existing aggregator runs. Fault-tolerant: if either source is empty
      // the surviving one still drives the bucket math.
      inboundFlights: inboundFlightsRaw = "",
    } = body;

    // Sprint 59: client-owned persistence. eventConfig is the localStorage-
    // backed object (seeded from a static import on first mount). Defensive
    // guard at the boundary so a malformed payload can't crash the pipeline.
    const eventConfig =
      eventConfigRaw && typeof eventConfigRaw === "object" && !Array.isArray(eventConfigRaw)
        ? eventConfigRaw
        : {};

    // Sprint 64: belt-and-suspenders array coercion (per L1). The `= []`
    // default catches missing keys; this catches non-array garbage that
    // the default wouldn't (e.g., `inboundTrains: "oops"`).
    const inboundTrains = Array.isArray(inboundTrainsRaw) ? inboundTrainsRaw : [];
    const outboundTrains = Array.isArray(outboundTrainsRaw) ? outboundTrainsRaw : [];

    // Sprint 64: Pre-Merge. Stamp `direction` onto every BYOD train BEFORE
    // the injection loop so a single iteration can route each entry to its
    // own location/coords/time-math branch without consulting a global flag.
    const allByod = [
      ...inboundTrains.map((t) => ({ ...t, direction: "inbound" })),
      ...outboundTrains.map((t) => ({ ...t, direction: "outbound" })),
    ];

    // Sprint 67: BYOD Bus parse. Raw text comes through as a string; defensive
    // coercion (per L1) so a malformed payload can't crash the parser. The
    // strict /SUNY/i filter inside parseBusSchedule is the SOLE drop site —
    // every surviving entry is a downtown-terminal arrival.
    const inboundBuses =
      typeof inboundBusesRaw === "string" ? parseBusSchedule(inboundBusesRaw) : [];

    // Sprint 45: Mathematical ROI Filter. Driver-configurable vehicle cost
    // per mile (default 0.65 = the "Safe Sedan" baseline). Defended at the
    // boundary — non-numeric / negative values fall back to the default so a
    // malformed payload can't disable the filter by accident.
    const costPerMile =
      Number.isFinite(Number(costPerMileRaw)) && Number(costPerMileRaw) >= 0
        ? Number(costPerMileRaw)
        : 0.65;

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
      getLocalDensityData(latitude, longitude, localStart),
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
    const weatherSupplyPressureMod = Number(
      (1 / Math.max(Number(weatherModifiers.driverSupplyMod) || 1, 0.1)).toFixed(2)
    );
    const driverSupplyPressureMod = Math.max(1.0, weatherSupplyPressureMod, supplyDropMod);

    // Sprint 57: Unified Event Database. The Sprint 49 finalRideMod boost
    // tied to the BYOD activeHoliday payload has been removed. Holiday +
    // academic surges now fire exclusively as synthetic events injected in
    // PHASE 2 below (egressMod = entry.multiplier), driven by the
    // localStorage-owned eventConfig the client ships in the body
    // (Sprint 59). A Save in the UI takes effect on the very next
    // dispatch click since the next POST carries the updated object.
    // (eventConfig is destructured + type-guarded at the top of POST.)

    // Sprint 20: Zero-Prompt Math. Compute exact driving time to ALB from the
    // driver's current coords (Haversine miles ÷ 20 mph city assumption) so
    // the aggregator can pre-bake the "Leave current location by" minute
    // directly into each hour bucket. The LLM is forbidden from re-deriving.
    const milesToAirport = haversineMiles(latitude, longitude, ALB_COORDS.lat, ALB_COORDS.lng);
    const minutesToAirport = Math.ceil((milesToAirport / 20) * 60);

    // Sprint 68: BYOD Flight Arrivals merge. Parse the pasted ALB text into
    // a synthetic flight array matching the AviationStack shape, then merge
    // with rawFlights BEFORE the aggregator runs. The relaxed `HH:MM_IATA`
    // fingerprint inside aggregateArrivalsByHour de-dupes overlapping
    // records (one physical plane shows up exactly once even if both
    // sources reported it). Defensive `typeof === "string"` coercion at
    // the boundary (per L1) so a malformed payload can't crash the parser.
    const byodFlights =
      typeof inboundFlightsRaw === "string" ? parseFlightText(inboundFlightsRaw, offsetMin) : [];
    const mergedRawFlights = [...rawFlights, ...byodFlights];

    // Sprint 27: aggregators return RAW volumes (no rideMod scaling). The
    // finalRideMod / finalFoodMod multipliers ride alongside in mergedPayload
    // and are applied exclusively inside buildItinerary (hidden surgeScore
    // for sort + strict <1.0 filter). Kills the Sprint 23 squaring bug.
    let flightsByHour = aggregateArrivalsByHour({
      flights: mergedRawFlights,
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

        // Sprint 69: with Tourist Clustering deleted, this branch can revert
        // to a strict `continue` on egressMod <= 1.0. Kept as-is (if block)
        // for surgical minimality — behaviour is identical.
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
    // Current score uses the taper factor as volume, so state_worker yield
    // 100 becomes 100 / 75 / 50 / 25 expected riders by slot.
    const currentDay = localStart.getUTCDay();
    const stateWorkerTaper = computeStateWorkerCommuteTaper(localStart);
    if (
      activePlatforms.rideshare &&
      currentDay >= 1 &&
      currentDay <= 5 &&
      stateWorkerTaper.factor > 0
    ) {
      const displayMod = Number((1 + 1.5 * stateWorkerTaper.factor).toFixed(2));
      structuredEvents.push({
        type: "event",
        location: "Empire State Plaza & Harriman Campus",
        volume: stateWorkerTaper.factor,
        egressMod: displayMod,
        categories: ["State Worker Commute", stateWorkerTaper.label],
        // Sprint 37: ESP coords for the Mapbox radar pin.
        lat: ESP_COORDS.lat,
        lng: ESP_COORDS.lng,
      });
      console.log(
        `STATE COMMUTER INJECTED: Empire State Plaza & Harriman Campus | factor ${stateWorkerTaper.factor} | expected riders ${Math.round(stateWorkerTaper.factor * YIELD_RATES.state_worker)}`
      );
    }

    // Sprint 57: Unified Event Database injector. Single match path for both
    // holiday and academic surges — driven by event-config.json (read above).
    // On hit, push one synthetic event with egressMod = entry.multiplier
    // (default 3.5x — Parity Tier so it dominates the Profitability sort
    // above Mega-Venue 2.5x). ESP coords reuse the existing purple EventCard
    // + Mapbox pin path so no new UI component is required. Math validated
    // in isolation by test-academic-surge.js (23 assertions PASS).
    const eventDispatchHour =
      localStart.getUTCHours() + localStart.getUTCMinutes() / 60;
    const activeEvent = findActiveEvent(localStart, eventDispatchHour, eventConfig);
    if (activeEvent) {
      const mod = Number(activeEvent.multiplier) > 0 ? Number(activeEvent.multiplier) : 3.5;
      const category =
        activeEvent.type === "holiday" ? "Holiday Surge" : "Academic Calendar";
      structuredEvents.push({
        type: "event",
        location: `${activeEvent.name} Surge`,
        volume: 1,
        egressMod: mod,
        categories: [category, "High Demand"],
        lat: ESP_COORDS.lat,
        lng: ESP_COORDS.lng,
      });
      console.log(
        `EVENT SURGE INJECTED: ${activeEvent.name} | ${activeEvent.date} | type=${activeEvent.type} | egressMod ${mod}x`
      );
    }

    // Sprint 50: Last Call Egress Engine. For each venue in ALBANY_NIGHTLIFE_HOURS,
    // fire a synthetic event when localStart is 30–45 min before that venue's
    // mapped close (with cross-midnight day-rollback). egressMod 3.5 mirrors
    // Sprint 49's holiday surge so the Last Call card floats to the top of
    // Profitability sorts without touching buildItinerary math.
    const lastCallEvents = computeLastCallEgressEvents(localStart, ALBANY_NIGHTLIFE_HOURS);
    for (const ev of lastCallEvents) {
      structuredEvents.push(ev);
    }

    // Sprint 52: Crossgates Retail Egress Engine. Synthetic event when the
    // driver's wall-clock falls inside the ±30 minute window centered on
    // the day's posted close (CROSSGATES_HOURS lookup by getUTCDay()).
    // `wallMinutes` and `currentDay` are already in scope from Sprints 44/36.
    // Gated on rideshare so untoggling Rideshare fully disables the injection.
    // Math validated in isolation by test-crossgates-engine.js (30/30 PASS).
    const crossgatesCloseMinute = CROSSGATES_HOURS[currentDay];
    if (
      activePlatforms.rideshare &&
      typeof crossgatesCloseMinute === "number" &&
      wallMinutes >= crossgatesCloseMinute - 30 &&
      wallMinutes <= crossgatesCloseMinute + 30
    ) {
      structuredEvents.push({
        type: "event",
        location: "Crossgates Mall",
        volume: 1,
        egressMod: 3.0,
        categories: ["Retail Egress", "Closing Surge"],
        lat: CROSSGATES_COORDS.lat,
        lng: CROSSGATES_COORDS.lng,
      });
      console.log("CROSSGATES EGRESS INJECTED: Retail Egress | egressMod 3.0x");
    }

    if (activePlatforms.rideshare) {
      const localAnchorEvents = buildLocalAnchorEvents(localStart);
      for (const ev of localAnchorEvents) {
        structuredEvents.push(ev);
        console.log(
          `LOCAL ANCHOR INJECTED: ${ev.location} | ${ev.categories.join(" / ")} | expected riders ${ev.volume}`
        );
      }
    }

    // Sprint 53: BYOD Amtrak Pipeline. Run the regex parser over the
    // driver-pasted booking text and push one synthetic event per train
    // into structuredEvents (origin hardcoded NYP per spec). Reuses the
    // same purple EventCard + Mapbox pin path as Hospital / State
    // Commuter / Crossgates — no new UI component.
    // Sprint 54: Time Gate. Each parsed train passes through
    // isTrainInWindow before injection — only trains arriving in
    // [localStart - 10 min, localEnd] survive. Out-of-window trains
    // never reach the merged payload or the log.
    // Sprint 58: Persistence. The raw textarea string is no longer in
    // the request body; trains live in train-config.json.
    // Sprint 59: localStorage edition. The client lazy-wipes against
    // today's local date BEFORE shipping, so byodTrains is already
    // either today's saved trains or [].
    //
    // Sprint 62.1: Tear down the XOR gate. The Live Amtraker feed (called
    // in the Promise.all above + aggregated into `trainsByHour`) runs
    // UNCONDITIONALLY on every dispatch — it never reads `direction` and
    // its inbound hour-buckets always land in `mergedPayload.trainsByHour`
    // (gated only by the global rideshare + includeAmtrak flags via the
    // Sprint 11 / 17 sanitization below). This BYOD loop runs the same
    // way: `direction` ONLY selects per-train leaveBy math + Mapbox coords
    // (ESP for outbound, AMTRAK for inbound). The two feeds are fully
    // independent and flow into the merged payload simultaneously.
    //
    // Sprint 64: Dual-Direction. The single loop now iterates the pre-
    // merged `allByod` array (each entry stamped with its own `direction`
    // by the Pre-Merge above) and branches on `train.direction`. Inbound
    // and outbound trains coexist in the same dispatch — saving one
    // direction on the frontend no longer wipes the other.
    if (activePlatforms.rideshare && includeAmtrak) {
      // Sprint 65: driver's wall-clock minute, used by both branches as the
      // anchor for computeRelativeTimeString. localStart is wall-clock-as-UTC
      // per Sprint 3.1 so UTC getters return the driver's wall-clock.
      const byodStartMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
      for (const train of allByod) {
        if (train.direction === "outbound") {
          // Sprint 61: Outbound Ingress. train.time is the DEPARTS time
          // (client parser already captured the right block). Shift it
          // backwards by OUTBOUND_BUFFER_MINUTES (drop / clamp per the
          // 40-min rule), then re-gate against the dispatch window using
          // the shifted leaveBy so out-of-window outbound trains are still
          // suppressed.
          const leaveBy = computeOutboundLeaveBy(train.time, localStart);
          if (!leaveBy) continue;
          if (!isTrainInWindow(leaveBy, localStart, hoursNum)) continue;
          structuredEvents.push({
            type: "event",
            location: `Empire State Plaza — Outbound Train ${train.trainNumber}`,
            volume: 1,
            egressMod: 2.0,
            categories: ["BYOD Train", "Outbound", train.status],
            availability: train.availability,
            leaveBy,
            lat: ESP_COORDS.lat,
            lng: ESP_COORDS.lng,
            // Sprint 65: relativeTime tracks the TRAIN's actual departure
            // (train.time), not the driver's shifted leaveBy — the brief
            // calls for "Departed 5 mins ago" which describes the train.
            relativeTime: computeRelativeTimeString(
              parseTimeLabel(train.time),
              byodStartMin,
              "departure"
            ),
          });
          console.log(
            `BYOD OUTBOUND TRAIN PARSED: ${train.trainNumber} | Status: ${train.status} | Departs: ${train.time} | LeaveBy: ${leaveBy}`
          );
        } else {
          if (!isTrainInWindow(train.time, localStart, hoursNum)) continue;
          structuredEvents.push({
            type: "event",
            location: `Rensselaer Train ${train.trainNumber}`,
            volume: 1,
            egressMod: 2.0,
            // Sprint 62: tag per-train BYOD inbound entries so the unified
            // radar paints them emerald alongside the live-API buckets.
            categories: ["BYOD Train", "Inbound", train.status],
            availability: train.availability,
            origin: "NYP",
            leaveBy: train.time,
            arrivalTime: train.arrivalTime,
            lat: AMTRAK_COORDS.lat,
            lng: AMTRAK_COORDS.lng,
            // Sprint 65: BYOD inbound train arrives at Rensselaer at
            // train.time. Verb stays "Arriving / Arrived".
            relativeTime: computeRelativeTimeString(
              parseTimeLabel(train.time),
              byodStartMin,
              "arrival"
            ),
          });
          console.log(
            `BYOD TRAIN DATA PARSED: ${train.trainNumber} | Status: ${train.status} | Time: ${train.time}`
          );
        }
      }

      // Sprint 67: BYOD Bus injection. Same window gate as inbound trains
      // (isTrainInWindow accepts the "H:MM AM/PM" form). Surviving entries
      // pin to the hardcoded Downtown Bus Terminal — SUNY drop-offs are
      // never here because parseBusSchedule already dropped them. Push as
      // type:"event" with categories:["BYOD Bus","Inbound",operator] so
      // they inherit the scoreable branch, ROI filter, and the existing
      // emerald "Inbound" pin in DispatchMap (Sprint 62).
      for (const bus of inboundBuses) {
        if (!isTrainInWindow(bus.arrivalTime, localStart, hoursNum)) continue;
        structuredEvents.push({
          type: "event",
          location: `Downtown Bus Terminal — ${bus.operator} Arrival`,
          volume: 1,
          egressMod: 2.0,
          categories: ["BYOD Bus", "Inbound", bus.operator],
          origin: "NYC",
          leaveBy: bus.arrivalTime,
          arrivalTime: bus.arrivalTimeRaw,
          lat: DOWNTOWN_BUS_TERMINAL_COORDS.lat,
          lng: DOWNTOWN_BUS_TERMINAL_COORDS.lng,
          relativeTime: computeRelativeTimeString(
            parseTimeLabel(bus.arrivalTime),
            byodStartMin,
            "arrival"
          ),
        });
        console.log(
          `BYOD BUS DATA PARSED: ${bus.operator} | Dest: ${bus.destination} | Arrives: ${bus.arrivalTime}`
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

    // Sprint 63: Synthetic residential ride hubs — emits the [Ride Boost]
    // log lines as a side effect of building each hub. Up to 5 entries with
    // populationDensityMod >= 2.0.
    const rideHubs = buildSyntheticRideHubs();

    const mergedPayload = {
      location: { latitude, longitude },
      hours: hoursNum,
      includeAirport,
      includeAmtrak,
      routingStrategy,
      temporalModifiers,
      weatherModifiers,
      // Sprint 41 + 91: surface supply pressure separately from demand so
      // the terminal log explains opportunity ranking without fake riders.
      supplyDropMod,
      driverSupplyPressureMod,
      finalRideMod,
      finalFoodMod,
      events: structuredEvents,
      weather: weatherWindowed ?? "Weather data unavailable",
      flightsByHour,
      trainsByHour,
      gigDemand: gigDemand ?? "Density data unavailable",
      // Sprint 63: synthetic residential ride hubs (type: "ride"). Flow
      // through buildItinerary's rawItems alongside flights / trains / food.
      rideHubs,
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
      latitude,
      longitude,
      costPerMile
    );

    // Sprint 66: Peak Overlap Engine — pure observer over the already-scored
    // itinerary. The frontend gates rendering on totalDensity > 50, so the
    // helper is free to return low-total results without polluting the UI.
    mergedPayload.peakSurgeWindow = findPeakSurgeWindow(mergedPayload.itinerary);

    // Sprint 62: Unified Situational Radar verification log. Counts how many
    // items in the final itinerary carry "Inbound" vs "Outbound" categories
    // so the Test-Driven Scaffolding rule (confirm both directions co-exist
    // BEFORE touching the map) holds at runtime.
    //
    // Sprint 62.1: Surface each feed's pre-itinerary count too so XOR can
    // be ruled out without reading the full merged payload. `liveInbound`
    // is the live-Amtraker bucket count and `byod` is the BYOD-event count
    // pushed in Phase 2 — both numbers persist regardless of `direction`.
    const liveInboundCount = Array.isArray(mergedPayload.trainsByHour)
      ? mergedPayload.trainsByHour.length
      : 0;
    const byodEventCount = Array.isArray(mergedPayload.events)
      ? mergedPayload.events.filter(
          (e) => Array.isArray(e.categories) && e.categories.includes("BYOD Train")
        ).length
      : 0;
    // Sprint 67: BYOD Bus count surfaced alongside the train counts so the
    // terminal log makes it obvious when the SUNY filter dropped every entry.
    const byodBusEventCount = Array.isArray(mergedPayload.events)
      ? mergedPayload.events.filter(
          (e) => Array.isArray(e.categories) && e.categories.includes("BYOD Bus")
        ).length
      : 0;
    const inboundCount = mergedPayload.itinerary.filter(
      (it) => Array.isArray(it.categories) && it.categories.includes("Inbound")
    ).length;
    const outboundCount = mergedPayload.itinerary.filter(
      (it) => Array.isArray(it.categories) && it.categories.includes("Outbound")
    ).length;
    console.log(
      `=== SPRINT 62 RADAR CHECK === byodInbound: ${inboundTrains.length} | byodOutbound: ${outboundTrains.length} | byodBuses: ${inboundBuses.length} | liveInbound buckets: ${liveInboundCount} | BYOD events: ${byodEventCount} | BYOD bus events: ${byodBusEventCount} | itinerary Inbound: ${inboundCount} | itinerary Outbound: ${outboundCount}`
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
