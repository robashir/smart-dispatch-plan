import Anthropic from "@anthropic-ai/sdk";

// Sprint V2: only count arrivals from major leisure/business hubs — these
// riders are more likely to need rideshare (and XL for luggage). Short
// commuter hops (EWR, PHL, etc.) are dropped before bucketing.
const HIGH_VALUE_HUBS = ["MCO", "ATL", "ORD", "DFW", "DEN", "LAX", "LAS", "JFK", "LGA"];

// Sprint 16: Amtrak precision filter. Penn Station NYC, Boston, Washington
// DC, Philadelphia — high-income business + leisure hubs. Locals (Rutland,
// Schenectady commuter hops, etc.) are dropped before bucketing.
const HIGH_VALUE_STATIONS = ["NYP", "BOS", "WAS", "PHL"];

function buildSystemPrompt(activePlatforms, includeAirport, includeAmtrak) {
  const tf = (v) => (v ? "TRUE" : "FALSE");
  return `You are an Elite Multi-App Dispatcher with deep knowledge of urban gig-economy dynamics.

Your job: tell the driver where to be AND which app to drive on, in chronological order, for the time window the user gave.

ACTIVE PLATFORMS STATE (from the driver's current toggle selection):
- Rideshare: ${tf(activePlatforms.rideshare)}
- Food Delivery: ${tf(activePlatforms.food)}
- Grocery: ${tf(activePlatforms.grocery)}

CRITICAL PLATFORM ISOLATION RULES (HARDEST CONSTRAINT — OVERRIDES EVERY OTHER RULE BELOW):
- Rideshare Rules: If Rideshare is FALSE, you MUST completely ignore all flight data, train data, and event data. Do NOT mention airports, ALB, Albany International, Rensselaer, Amtrak, trains, luggage, UberXL, Lyft XL, Uber, Lyft, or passenger pickups under any circumstances.
- Food Delivery Rules: If Food Delivery is FALSE, you MUST completely ignore restaurant density data. Do NOT mention lunch rushes, dinner rushes, restaurant districts, DoorDash, or UberEats.
- Grocery Rules: If Grocery is FALSE, you MUST completely ignore supermarket density data. Do NOT mention Instacart, Spark, or grocery corridors.
- Anti-Mashing Rule: NEVER invent scenarios to force data to fit an active platform. Passengers do not order Instacart from the airport runway. Event attendees do not need groceries delivered to the venue. If the only active platform is Grocery and supermarket density is Low (or there are no supermarkets nearby), tell the driver to wait, relocate to a denser area, or end the shift early. Do NOT send them to the airport, Amtrak station, or event venues to bridge the gap.
${!includeAirport ? `
CRITICAL GEOGRAPHIC RULE: The user has disabled the Airport location for this shift. You are strictly FORBIDDEN from generating a step that dispatches the driver to ALB, the airport terminal, or airport parking lots. However, use the flight arrival surges to deduce which city zones or hotels will become busy, and route the driver to those off-airport zones instead.
` : ""}${!includeAmtrak ? `
CRITICAL GEOGRAPHIC RULE: The user has disabled the Amtrak location for this shift. You are strictly FORBIDDEN from generating a step that dispatches the driver to the Rensselaer train station. However, use the high-value train arrivals (e.g., NYP, BOS) to deduce which downtown state offices or hotels will become busy, and route the driver to those off-station zones instead.
` : ""}
You will receive a payload with FIVE data sources:
  1. EVENTS — a list of live Ticketmaster events with start times (or "NO_EVENTS_FOUND").
  2. WEATHER — a windowed hourly forecast (or "Weather data unavailable").
  3. FLIGHTS — hourly arrival counts at Albany International (ALB) inside the window (or "Flight data unavailable").
  4. TRAINS — hourly Amtrak arrival counts at Albany-Rensselaer Station (ALB) inside the window (or "Train data unavailable").
  5. GIG DEMAND — labeled food-delivery + grocery density nearby (or "Density data unavailable").

CHAIN OF THOUGHT — MANDATORY (applies to BOTH states):
Before writing the final plan, you MUST output a <thinking> block that does the timeline math. Format exactly:

<thinking>
Current local time: HH:MM AM/PM
Window ends at: HH:MM AM/PM
Step 1: HH:MM AM/PM – HH:MM AM/PM @ <place>
Step 2: HH:MM AM/PM – HH:MM AM/PM @ <place>
Step 3: HH:MM AM/PM – HH:MM AM/PM @ <place>
</thinking>

Chronological rules — NON-NEGOTIABLE:
- Step 2's START time MUST be greater than or equal to Step 1's END time. Step 3's START time MUST be greater than or equal to Step 2's END time. ZERO overlap allowed.
- If two consecutive steps are at DIFFERENT geographic locations, leave at least a 15-minute gap between them for travel.
- Every time in the final plan must fall inside the user's window (Current local time → Window ends at).

After the </thinking> tag, output the final plan using the rules below. Do NOT mention the thinking step in the final plan.

Rules for STATE A (Events Found):
- Hunt EVENT END TIMES — that's when surges hit.
- Output exactly 3 numbered steps in chronological order.
- Output 4-5 lines TOTAL. No preamble. No sign-off. No fluff.
- Plain text only (no markdown, no bullets — just "1.", "2.", "3.").
- Each step must include a specific TIME and a specific PLACE.
- Position the driver 10-15 minutes BEFORE an event end time, not after.

Rules for STATE B (Zero Events Found):
- Lead with one short line: "No major events ending in this window."
- Give Baseline City Advice: 2-3 numbered steps directing the driver to evergreen demand zones (airport, downtown hotel district, hospital, university, late-night bar strip — whichever fits the city).
- 4-5 lines TOTAL. Plain text. Same numbered format.

Weather Integration (INVISIBLE BRAIN — applies to both states):
- Digest the WEATHER block silently. Do NOT add a weather header, weather section, or weather summary line.
- If incoming rain/snow/storms intersect a step's timing, weave it INTO that step naturally (e.g., "rain hits at 4:15 PM — surge from the early-arriving crowd").
- If weather is calm or unavailable, IGNORE it completely. Do not mention it.
- Weather context must read as part of the dispatcher's reasoning, never as a forecast report.
- The 4-5 line cap is absolute. Weather does NOT earn extra lines.

Transit Surge — Flight Data (INVISIBLE BRAIN — applies to both states):
NOTE: All hotspot volumes and transit arrival counts have been algorithmically scaled by both temporal and weather modifiers. The math reflects the compounding impact of current city rhythms alongside immediate or impending weather conditions. Trust the provided numbers implicitly.
- The FLIGHTS block is an object like { "8 PM": "3 Arrivals (from MCO, ATL, ORD)" }. Each value names the count AND the origin IATA codes for high-value hub arrivals at ALB during that local hour. Short commuter hops are already filtered out — every flight you see is a high-value passenger wave.
- If any hour bucket inside the window has one or more arrivals, treat ALB airport as a HIGH-PRIORITY surge zone for that hour and prioritize positioning the driver there 10-15 minutes before the wave.
- If the block is empty or "Flight data unavailable", do NOT mention flights or the airport unless STATE B baseline advice naturally includes it.
- When you see flight arrivals from major leisure hubs (like MCO or LAS), explicitly advise the driver to turn on UberXL / Lyft XL to accommodate heavy luggage.
- Weave airport timing INTO an existing step (e.g., "by 6:45 PM, swing to ALB — MCO + LAS land at 7 PM, flip on UberXL for luggage"). Do NOT add an extra step or a flight summary line.
- The 4-5 line cap is still absolute. Flights do NOT earn extra lines.

Rail Surge — Train Data (INVISIBLE BRAIN — applies to both states):
NOTE: All hotspot volumes and transit arrival counts have been algorithmically scaled by both temporal and weather modifiers. The math reflects the compounding impact of current city rhythms alongside immediate or impending weather conditions. Trust the provided numbers implicitly.
- The TRAINS block is an object like { "8 PM": "2 Arrivals (from NYP, BOS)" }. Each value names the count AND the origin station codes for high-value hub arrivals at Albany-Rensselaer Station that local hour. Short commuter hops are already filtered out — every train you see is a high-value passenger wave.
- Even ONE arriving train creates a massive localized surge. If any hour bucket inside the window has >= 1 train arrival, treat Rensselaer Amtrak as a HIGH-PRIORITY surge zone for that hour and position the driver there 10-15 minutes before the train arrives.
- If you see Amtrak arrivals from high-value hubs like NYP or BOS, treat this as a massive High-Value Business Traveler surge. These passengers frequently request premium rides to downtown state offices or high-end hotels. Actively prioritize rideshare positioning near Rensselaer station.
- If no hour has any train arrivals, do NOT mention trains or Rensselaer.
- Weave train timing INTO an existing step (e.g., "by 7:50 PM, swing to Rensselaer Amtrak — NYP train arrives at 8 PM, expect business riders to downtown hotels"). Do NOT add an extra step or a train summary line.
- The 4-5 line cap is still absolute. Trains do NOT earn extra lines.

Multi-App Platform Switching (INVISIBLE BRAIN — applies to both states):
NOTE: All hotspot volumes and transit arrival counts have been algorithmically scaled by both temporal and weather modifiers. The math reflects the compounding impact of current city rhythms alongside immediate or impending weather conditions. Trust the provided numbers implicitly.
- The GIG DEMAND block is an object: { "foodHotspots": [ { "location": "Pearl St & State St", "volume": 6, "tier": "High-Value ($$$)", "categories": "Sushi, Steakhouse" }, ... ], "groceryHotspots": [ ... ] }. Each hotspot names a specific intersection/corner, cluster volume, price tier, and dominant cuisines.
- When recommending Food Delivery, you MUST position the driver at a specific intersection or street corner taken directly from foodHotspots — never say "Go Downtown" or name a vague neighborhood. Pick the top hotspot by volume.
- You MUST explain WHY using the hotspot data: if tier is "High-Value ($$$)" mention that expensive restaurants mean better tips; if tier is "Quick-Turn ($)" or volume is high with cheaper categories, mention fast turns / quick back-to-back deliveries.
- Trigger food switch: foodHotspots is non-empty AND current local time falls inside a meal window (11 AM–2 PM lunch OR 5 PM–8 PM dinner) AND flight arrivals are sparse or unavailable.
- For grocery, when suggesting Instacart, name the top groceryHotspots intersection the same way.
- If foodHotspots / groceryHotspots is empty or GIG DEMAND is "Density data unavailable", do NOT mention platform switching for that category.
- Weave the app switch INTO an existing step (e.g., "6:30–7:30 PM — flip to DoorDash, position at Pearl St & State St; 4 high-end restaurants ($$$) are active = strong dinner tips."). Do NOT add an extra step or a gig-demand summary line.
- The 4-5 line cap is still absolute. Platform switching does NOT earn extra lines.

Example STATE A (with CoT and weather):
<thinking>
Current local time: 7:30 PM
Window ends at: 11:30 PM
Step 1: 7:30 PM – 8:45 PM @ Center Square
Step 2: 8:45 PM – 10:00 PM @ Palace Theatre
Step 3: 10:15 PM – 11:30 PM @ MVP Arena
</thinking>
1. Stay in Center Square until 8:45 PM — steady airport runs.
2. By 8:45 PM, head to Palace Theatre — show ends 9:00 PM and rain starts 9:05 PM, expect heavy surge.
3. By 10:15 PM, reposition to MVP Arena for the 10:30 PM concert release.

Example STATE B (with CoT):
<thinking>
Current local time: 9:00 PM
Window ends at: 12:00 AM
Step 1: 9:00 PM – 10:00 PM @ Airport
Step 2: 10:15 PM – 11:00 PM @ Downtown Hotel District
Step 3: 11:15 PM – 12:00 AM @ University Bar Strip
</thinking>
No major events ending in this window.
1. Head to the airport — steady inbound flights drive baseline demand.
2. Circle the downtown hotel district for late check-ins and dinner runs.
3. Swing past the university bar strip after 10 PM for closing-time pickups.`;
}

function toTicketmasterDateTime(date) {
  // Ticketmaster requires YYYY-MM-DDTHH:mm:ssZ (UTC, no milliseconds)
  return date.toISOString().split(".")[0] + "Z";
}

// `localStart`/`localEnd` are Date objects whose UTC fields equal the user's
// wall-clock time (see Sprint 3.1 hotfix). Read the UTC fields to render an
// "H:MM AM/PM" string for the LLM's chain-of-thought anchor.
function toWallClockLabel(date) {
  let h = date.getUTCHours();
  const m = date.getUTCMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
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
}

function summarizeWeather(windowed) {
  if (!windowed || windowed.length === 0) return "Weather data unavailable";
  return windowed
    .map(
      (h) =>
        `${h.time}: ${Math.round(h.tempF)}°F, ${h.precipChancePct}% precip chance, ${h.precipInches} in`
    )
    .join("\n");
}

// Sprint 4.5 Hotfix 2: Ticketmaster's `dateTime` is UTC (e.g. "23:00:00Z"),
// which made the LLM read a 7 PM local event as 11 PM. Use `localTime`
// ("19:00:00") instead and render as "7:00 PM" so the AI's math matches the
// driver's wall-clock reality.
function formatLocalTime12h(localTime) {
  if (!localTime || typeof localTime !== "string") return "Time TBA";
  const match = localTime.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "Time TBA";
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return "Time TBA";
  }
  const ampm = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

function summarizeEvents(events) {
  return events
    .map((e, i) => {
      const venue = e._embedded?.venues?.[0];
      const venueName = venue?.name || "Unknown venue";
      const city = venue?.city?.name || "";
      const start = formatLocalTime12h(e.dates?.start?.localTime);
      return `${i + 1}. ${e.name} at ${venueName}${city ? ", " + city : ""} — starts ${start}.`;
    })
    .join("\n");
}

// Sprint 7: revert from Puppeteer scrape to AviationStack API. Heavy browser
// dependency + bot protection on albanyairport.com made the scrape unreliable.
// AviationStack returns flights in the shape `aggregateArrivalsByHour` already
// expects: `{ flight_status, arrival: { scheduled }, departure: { iata } }`.
async function fetchAlbArrivals({ apiKey }) {
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
}

// Bucket arrivals into local-hour labels ("5 PM", "6 PM") for the window.
// Mirrors the timezone trick in toWallClockLabel: shift by offsetMin then read UTC fields.
// Sprint 4.1: de-duplicate codeshares — one physical plane often appears as 3-5 records.
// Sprint V2: drop flights whose departure IATA isn't in HIGH_VALUE_HUBS, and
// emit values as "<count> Arrivals (from CODE, CODE)" strings instead of ints
// so the LLM sees origin context inline.
function aggregateArrivalsByHour(flights, localStart, localEnd, offsetMin, rideMod = 1.0) {
  const originsByHour = {};
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

    // Shift into the same "wall-clock-as-UTC" frame the rest of the file uses.
    const arrivalLocal = new Date(arrivalUtc.getTime() - offsetMin * 60 * 1000);
    if (arrivalLocal < localStart || arrivalLocal >= localEnd) continue;

    let h = arrivalLocal.getUTCHours();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const label = `${h} ${ampm}`;
    if (!originsByHour[label]) originsByHour[label] = [];
    originsByHour[label].push(depIata);
  }

  // Sprint 18: scale raw count by temporal rideMod BEFORE formatting. If the
  // rounded count drops to 0, omit the bucket entirely (per PO graceful
  // flooring rule).
  const buckets = {};
  for (const [hour, codes] of Object.entries(originsByHour)) {
    const scaled = Math.round(codes.length * rideMod);
    if (scaled <= 0) continue;
    buckets[hour] = `${scaled} Arrivals (from ${codes.join(", ")})`;
  }
  return buckets;
}

function summarizeFlightsByHour(buckets) {
  const keys = Object.keys(buckets);
  if (keys.length === 0) return "Flight data unavailable";
  return JSON.stringify(buckets);
}

// Sprint 4.5 + Hotfix: live Amtrak arrivals for Albany-Rensselaer (station code ALB).
// Amtraker v3 has shipped multiple response shapes:
//   - top-level array of trains
//   - { ALB: [...trains] }
//   - { ALB: { trainId: {...}, ... } }   <-- this shape caused "trains is not iterable"
// Inspector log + ironclad fallback guarantee this function ALWAYS returns an array.
async function fetchAlbTrainArrivals() {
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
}

// Bucket train arrivals at ALB into local-hour labels for the window.
// Use estimated/actual arrival (`arr`) when present; fall back to scheduled (`schArr`).
// Sprint 16: drop cancelled trains AND drop trains whose origCode isn't in
// HIGH_VALUE_STATIONS. Emit values as "<count> Arrival(s) (from CODE, CODE)"
// strings so the LLM sees origin context inline (mirrors flight aggregator).
function aggregateTrainArrivalsByHour(trains, localStart, localEnd, offsetMin, rideMod = 1.0) {
  if (!Array.isArray(trains)) return {};
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

  // Sprint 18: scale raw count by temporal rideMod BEFORE formatting. If the
  // rounded count drops to 0, omit the bucket entirely.
  const buckets = {};
  for (const [hour, codes] of Object.entries(originsByHour)) {
    const scaled = Math.round(codes.length * rideMod);
    if (scaled <= 0) continue;
    const word = scaled === 1 ? "Arrival" : "Arrivals";
    buckets[hour] = `${scaled} ${word} (from ${codes.join(", ")})`;
  }
  return buckets;
}

function summarizeTrainsByHour(buckets) {
  const keys = Object.keys(buckets);
  if (keys.length === 0) return "Train data unavailable";
  return JSON.stringify(buckets);
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

// Sprint V2.5: fetch top 10 open businesses for one category with full
// spatial detail (name, coords, price, categories, address) so we can
// cluster them downstream. Defensive per L1: inspector-log the raw shape,
// Array.isArray guard, return [] on any failure.
async function fetchYelpBusinesses({ latitude, longitude, category, apiKey }) {
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
      }))
      .filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lng));
  } catch (err) {
    console.warn(`Yelp fetch failed (${category}):`, err.message);
    return [];
  }
}

// Sprint V2.5: greedy 200m cluster sweep. Pick the business with the most
// neighbors-within-200m as the next cluster center, label it with the
// dominant cross-streets / tier / categories, remove its members, repeat.
// Up to 3 clusters returned.
function computeHotspots(businesses) {
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
    const topCats = Object.entries(catCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([c]) => c);

    hotspots.push({
      location,
      volume: bestCluster.length,
      tier,
      categories: topCats.join(", ") || "Mixed",
    });

    const clusterSet = new Set(bestCluster);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (clusterSet.has(remaining[i])) remaining.splice(i, 1);
    }
  }

  return hotspots;
}

// Returns { foodHotspots, groceryHotspots } arrays, or null when no API key
// is configured (so dispatch can run degraded).
async function getLocalDensityData(latitude, longitude, apiKey) {
  if (!apiKey) return null;
  const [foodBiz, groceryBiz] = await Promise.all([
    fetchYelpBusinesses({ latitude, longitude, category: "restaurants", apiKey }),
    fetchYelpBusinesses({ latitude, longitude, category: "grocery", apiKey }),
  ]);
  const foodHotspots = computeHotspots(foodBiz);
  const groceryHotspots = computeHotspots(groceryBiz);
  console.log(
    "=== HOTSPOT CLUSTERS ===\n" +
      JSON.stringify({ foodHotspots, groceryHotspots }, null, 2)
  );
  return { foodHotspots, groceryHotspots };
}

export async function POST(request) {
  try {
    const { latitude, longitude, hours, timezoneOffsetMinutes, platforms, includeAirport: includeAirportRaw, includeAmtrak: includeAmtrakRaw } =
      await request.json();

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
    const activePlatformsLabel =
      [
        activePlatforms.rideshare ? "Rideshare (Uber/Lyft)" : null,
        activePlatforms.food ? "Food Delivery (DoorDash/UberEats)" : null,
        activePlatforms.grocery ? "Grocery (Instacart/Spark)" : null,
      ]
        .filter(Boolean)
        .join(", ") || "NONE";

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

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json(
        { error: "ANTHROPIC_API_KEY is not set in .env" },
        { status: 500 }
      );
    }
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
      getLocalDensityData(latitude, longitude, yelpApiKey),
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

    let flightsByHour = aggregateArrivalsByHour(
      rawFlights,
      localStart,
      localEnd,
      offsetMin,
      finalRideMod
    );

    let trainsByHour = aggregateTrainArrivalsByHour(
      rawTrains,
      localStart,
      localEnd,
      offsetMin,
      finalRideMod
    );

    // Sprint 18: apply finalFoodMod to each existing hotspot's volume. Floor
    // at 1 so a sub-1.0 multiplier never erases a hotspot that originally
    // existed. Sprint 19: finalFoodMod = temporal foodMod * weather mod.
    if (gigDemand && Array.isArray(gigDemand.foodHotspots)) {
      gigDemand.foodHotspots = gigDemand.foodHotspots.map((h) => ({
        ...h,
        volume: Math.max(1, Math.round(h.volume * finalFoodMod)),
      }));
    }

    // Sprint 11: Payload sanitization. Prompt-only platform isolation kept
    // failing on the LLM's "data obligation". Erase inactive-platform data
    // BEFORE building/logging the payload so it never reaches the LLM.
    if (!activePlatforms.rideshare) {
      flightsByHour = {};
      trainsByHour = {};
    }
    if (gigDemand && typeof gigDemand === "object") {
      if (!activePlatforms.food) gigDemand.foodHotspots = [];
      if (!activePlatforms.grocery) gigDemand.groceryHotspots = [];
    }

    // Sprint 15 refinement — Synthetic Data Swap. Prompt-only "do not route
    // to ALB" lost to data obligation when the raw arrival string was strong.
    // Keep the time bucket so the AI still sees WHEN the ripple hits, but
    // replace the raw value with an off-airport instruction.
    if (!includeAirport && Object.keys(flightsByHour).length > 0) {
      const ripple =
        "Secondary Ripple Demand: High traveler volume detected. Route driver to downtown hotels and destination corridors. DO NOT mention ALB.";
      for (const hour of Object.keys(flightsByHour)) {
        flightsByHour[hour] = ripple;
      }
    }

    // Sprint 17 — Amtrak Synthetic Data Swap (belt + suspenders per L5).
    // Same pattern as the airport swap: preserve the hour keys so the AI
    // still sees WHEN the business-traveler ripple hits, but overwrite the
    // raw arrival string so the model can't be tempted to route to Rensselaer.
    if (!includeAmtrak && Object.keys(trainsByHour).length > 0) {
      const trainRipple =
        "Secondary Ripple Demand: High business-traveler volume detected (NYP/BOS). Route driver to downtown state offices and high-end hotels. DO NOT mention Rensselaer.";
      for (const hour of Object.keys(trainsByHour)) {
        trainsByHour[hour] = trainRipple;
      }
    }

    const mergedPayload = {
      location: { latitude, longitude },
      hours: hoursNum,
      includeAirport,
      includeAmtrak,
      temporalModifiers,
      weatherModifiers,
      events,
      weather: weatherWindowed ?? "Weather data unavailable",
      flightsByHour,
      trainsByHour,
      gigDemand: gigDemand ?? "Density data unavailable",
    };

    // Acceptance Criteria: log the fully merged payload BEFORE the LLM call.
    console.log(
      "=== MERGED DISPATCH PAYLOAD ===\n" +
        JSON.stringify(mergedPayload, null, 2)
    );

    const weatherText = summarizeWeather(weatherWindowed);
    const flightsText = summarizeFlightsByHour(flightsByHour);
    const trainsText = summarizeTrainsByHour(trainsByHour);
    const gigDemandText = gigDemand ? JSON.stringify(gigDemand) : "Density data unavailable";

    const currentLocalLabel = toWallClockLabel(localStart);
    const windowEndLabel = toWallClockLabel(localEnd);

    const userMessage =
      events.length === 0
        ? `Driver location: ${latitude}, ${longitude}
Current local time: ${currentLocalLabel}
Window ends at: ${windowEndLabel}
Time window: next ${hoursNum} hour(s)
Active platforms: ${activePlatformsLabel}
Ticketmaster result: NO_EVENTS_FOUND

Weather (windowed forecast):
${weatherText}

Flight arrivals (ALB) by hour:
${flightsText}

Train arrivals (Rensselaer/ALB) by hour:
${trainsText}

Gig demand (local density):
${gigDemandText}

Produce STATE B (Baseline City Advice). Weave weather only if it materially changes the advice. If any hour has high-value hub arrivals at ALB, prioritize the airport for that hour and advise UberXL / Lyft XL when MCO or LAS is in the origins. If any hour has >= 1 Amtrak arrival, prioritize Rensselaer station for that hour. If foodHotspots is non-empty during lunch (11 AM–2 PM) or dinner (5 PM–8 PM) AND flight arrivals are sparse, switch to DoorDash / UberEats AND position the driver at the top foodHotspots intersection — name the exact corner and justify with the tier (high-tier = better tips) or volume (fast food = quick turns). Remember: <thinking> block first with non-overlapping times inside the window above, then the final plan.`
        : `Driver location: ${latitude}, ${longitude}
Current local time: ${currentLocalLabel}
Window ends at: ${windowEndLabel}
Time window: next ${hoursNum} hour(s)
Active platforms: ${activePlatformsLabel}
Ticketmaster events:
${summarizeEvents(events)}

Weather (windowed forecast):
${weatherText}

Flight arrivals (ALB) by hour:
${flightsText}

Train arrivals (Rensselaer/ALB) by hour:
${trainsText}

Gig demand (local density):
${gigDemandText}

Produce STATE A (3-step chronological play-by-play). Weave weather invisibly into the steps when it intersects timing. If any hour has high-value hub arrivals at ALB, prioritize the airport for that hour and advise UberXL / Lyft XL when MCO or LAS is in the origins. If any hour has >= 1 Amtrak arrival, prioritize Rensselaer station for that hour. If foodHotspots is non-empty during lunch (11 AM–2 PM) or dinner (5 PM–8 PM) AND flight arrivals are sparse, switch to DoorDash / UberEats AND position the driver at the top foodHotspots intersection — name the exact corner and justify with the tier (high-tier = better tips) or volume (fast food = quick turns). Remember: <thinking> block first with non-overlapping times inside the window above, then the final plan.`;

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: buildSystemPrompt(activePlatforms, includeAirport, includeAmtrak),
      messages: [{ role: "user", content: userMessage }],
    });

    const rawPlan = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Capture the LLM's chain-of-thought timeline math, log it for debugging,
    // then strip it (tags + content) so the user only sees the clean 3-step plan.
    const thinkingMatch = rawPlan.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    const thinkingText = thinkingMatch ? thinkingMatch[1].trim() : "(no <thinking> tag returned)";
    console.log("=== CoT TIMELINE ===\n" + thinkingText);

    const plan = rawPlan.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();

    return Response.json({ plan, eventCount: events.length });
  } catch (err) {
    console.error("Dispatch error:", err);
    return Response.json(
      { error: err.message || "Unknown server error" },
      { status: 500 }
    );
  }
}
