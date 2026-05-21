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

        return windowed;
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
    return null;
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
function aggregateArrivalsByHour(flights, localStart, localEnd, offsetMin, minutesToAirport = 0) {
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
function aggregateTrainArrivalsByHour(trains, localStart, localEnd, offsetMin) {
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
  const buckets = [];
  for (const [hour, codes] of Object.entries(originsByHour)) {
    buckets.push({
      type: "train",
      hourBucket: hour,
      volume: codes.length,
      origins: codes,
      hub: "Rensselaer",
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

    // Sprint 31: Campus Synergy. Compute cluster centroid (mean lat/lng of
    // members), then run the spatial+temporal gate against CAMPUS_CENTERS.
    // Only food hotspots qualify — grocery clusters are out of scope.
    let campusMod = 1.0;
    let campusName = null;
    if (type === "food") {
      const centroidLat =
        bestCluster.reduce((sum, b) => sum + b.lat, 0) / bestCluster.length;
      const centroidLng =
        bestCluster.reduce((sum, b) => sum + b.lng, 0) / bestCluster.length;
      const campusResult = computeCampusMod(centroidLat, centroidLng, hour);
      campusMod = campusResult.campusMod;
      campusName = campusResult.campusName;
      if (campusMod > 1.0) {
        console.log(
          `CAMPUS SYNERGY TRIGGERED: ${location} | Campus: ${campusName} | Mod: ${campusMod}x`
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

function surgeScore(item, finalRideMod, finalFoodMod) {
  // Sprint 32: Event Egress branch. Base volume is always 1 per PO spec, so
  // a Mega-Venue (egressMod 2.5) yields a 2.5 * finalRideMod baseline before
  // the Sprint 27 strict <1.0 filter inside buildItinerary.
  if (item.type === "event") {
    return (Number(item.volume) || 0) * finalRideMod * (Number(item.egressMod) || 1.0);
  }
  if (item.type === "flight") {
    // Sprint 29: fatigueMod stacks multiplicatively on top of finalRideMod
    // (1.0 default, 1.3x when the bucket holds a late-night delayed flight).
    // Sprint 30: leisureMod stacks on top of fatigueMod (1.0 default, 1.4x
    // when the bucket holds a leisure-hub + leisure-airline match).
    return (
      (Number(item.volume) || 0) *
      finalRideMod *
      (Number(item.fatigueMod) || 1.0) *
      (Number(item.leisureMod) || 1.0)
    );
  }
  if (item.type === "train") {
    return (Number(item.volume) || 0) * finalRideMod;
  }
  if (item.type === "food" || item.type === "grocery") {
    // Sprint 28: Anchor's qualityMod (1.0 base, up to 1.8x) multiplies the
    // raw volume alongside the temporal/weather finalFoodMod. Tier bonus
    // stays additive on top — Quick-Turn unicorns shouldn't lose to weak $$$.
    // Sprint 31: campusMod (1.0 default, 1.5x for late-night campus-adjacent
    // food clusters) chains multiplicatively. Grocery hotspots carry the
    // default 1.0 so the math is a no-op there.
    const qualityMod = Number(item.qualityMod) || 1.0;
    const campusMod = Number(item.campusMod) || 1.0;
    const base = (Number(item.volume) || 0) * finalFoodMod * qualityMod * campusMod;
    const bonus = item.tier === "High-Value ($$$)" ? 2 : 0;
    return base + bonus;
  }
  return 0;
}

// Sprint 23: deterministic router. Flattens flights + trains + hotspots
// into a single sorted array. Three driver-selectable strategies:
//   chronological — ascending by time; no-time items (hotspots) sort to top
//   profitability — surgeScore descending
//   hybrid        — group by hourBucket (chronological), within group by
//                   surgeScore desc; no-hourBucket items go to a
//                   "Current/Ongoing" group at the top.
function buildItinerary(payload, strategy, currentLocalStart) {
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

  // Sprint 32.1: wrap surgeScore with the Time-Decay multiplier. Applied at
  // every call site below (strict filter + profitability sort + hybrid in-
  // group sort) so a 2-hours-out surge can no longer outrank a "now" surge.
  const decayed = (it) =>
    surgeScore(it, finalRideMod, finalFoodMod) *
    computeTimeDecayMod(it.leaveBy || it.hourBucket, currentLocalStart);

  // Sprint 27: strict <1.0 filter. Aggregators now emit RAW volume, so this
  // is the single place finalRideMod / finalFoodMod get applied. Any item
  // whose modifier-scaled surgeScore is below 1.0 is dropped entirely. Synthetic
  // ripple objects + items with no scoreable type pass through untouched (score 0
  // on the synthetic shape would otherwise wipe them — they're informational).
  // Sprint 32.1: decay is applied BEFORE the cutoff so a 0.4x-decayed item
  // can fall below 1.0 and get pruned alongside the natively-weak items.
  const items = rawItems.filter((it) => {
    const scoreable =
      it.type === "flight" ||
      it.type === "train" ||
      it.type === "food" ||
      it.type === "grocery" ||
      it.type === "event";
    if (!scoreable) return true;
    return decayed(it) >= 1.0;
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
    const { latitude, longitude, hours, timezoneOffsetMinutes, platforms, includeAirport: includeAirportRaw, includeAmtrak: includeAmtrakRaw, routingStrategy: routingStrategyRaw } =
      await request.json();

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

    const [events, weatherWindowed, rawFlights, rawTrains, gigDemand] = await Promise.all([
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
    const finalFoodMod = foodMod * weatherFoodMod;
    const finalRideMod = rideMod * weatherRideMod;

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
    let flightsByHour = aggregateArrivalsByHour(
      rawFlights,
      localStart,
      localEnd,
      offsetMin,
      minutesToAirport
    );

    let trainsByHour = aggregateTrainArrivalsByHour(
      rawTrains,
      localStart,
      localEnd,
      offsetMin
    );

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
        if (egressMod <= 1.0) continue;

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
        });
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

    const mergedPayload = {
      location: { latitude, longitude },
      hours: hoursNum,
      includeAirport,
      includeAmtrak,
      routingStrategy,
      temporalModifiers,
      weatherModifiers,
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
    mergedPayload.itinerary = buildItinerary(mergedPayload, routingStrategy, localStart);

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
