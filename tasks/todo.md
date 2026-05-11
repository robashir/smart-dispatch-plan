# Sprint 4: Flight Data Integration (ALB) — Plan

## Decisions (locked before coding)
- **API:** AviationStack — `https://api.aviationstack.com/v1/flights?access_key=KEY&arr_iata=ALB&limit=100`
  - Free tier uses `http://`; we'll use `https://` and fall back if needed.
  - Filter on `arr_iata=ALB`. Each flight has `arrival.scheduled` (ISO with offset).
- **Window filter:** Keep only flights whose `arrival.scheduled` is between `localStart` and `localEnd` and whose status is NOT `cancelled`.
- **Hourly bucket key format:** `"5 PM"`, `"6 PM"` — derived using the same `timezoneOffsetMinutes` trick already used elsewhere (read UTC fields after offset shift).
- **Surge threshold for prompt:** > 5 arrivals in a single hour bucket = "high transit surge".
- **No frontend changes.** No new env vars (FLIGHT_API_KEY already in .env).
- **Failure handling:** If the flight call fails or key is missing, set `flightsByHour = {}` and let the prompt say "Flight data unavailable" — don't break the dispatch.

## Build Steps
- [x] 0. Write Sprint 4 plan to `tasks/todo.md`
- [x] 1. `app/api/dispatch/route.js`: add `fetchAlbArrivals({ apiKey })` — single GET, returns raw flight array or `[]` on error.
- [x] 2. `app/api/dispatch/route.js`: add `aggregateArrivalsByHour(flights, localStart, localEnd, offsetMin)` — filters to window, buckets by local hour label, returns object like `{ "5 PM": 4, "6 PM": 12 }`.
- [x] 3. `app/api/dispatch/route.js`: call flight fetch in the existing `Promise.all` alongside events + weather. Tolerate missing `FLIGHT_API_KEY` (warn + skip, don't 500).
- [x] 4. `app/api/dispatch/route.js`: include `flightsByHour` in `mergedPayload` so the `=== MERGED DISPATCH PAYLOAD ===` log shows it.
- [x] 5. `app/api/dispatch/route.js`: extend `SYSTEM_PROMPT` with a "TRANSIT SURGE" rule — instruct AI to prioritize ALB airport when any hour bucket > 5 arrivals, weave naturally into a step.
- [x] 6. `app/api/dispatch/route.js`: pass aggregated flight data into the user message (both STATE A and STATE B branches) as `Flight arrivals (ALB) by hour:`.
- [ ] 7. Manual verification: `npm run dev`, click button, confirm terminal shows `flightsByHour` object with sane counts; LLM mentions airport when counts are high.

## Acceptance Criteria
- Terminal: `=== MERGED DISPATCH PAYLOAD ===` log includes `flightsByHour` with hourly counts.
- UI: 3-step plan mentions ALB airport surges when arrivals are high (> 5/hr).
- Sprint 3.1/3.2 chronological + timezone behavior unchanged.

## Out of Scope (Icebox)
- UI changes, multi-airport support, caching, advanced status filtering, retry/backoff on flight fetch.

## Sprint 4.1 Hotfix — Codeshare De-duplication
**Problem:** AviationStack returns one record per codeshare partner, so a single physical plane shows up 3-5 times. Result: "17 arrivals at ALB in one hour" when only 3 planes actually land.

**Fix:** In `aggregateArrivalsByHour`, build a fingerprint = `scheduled + departure_iata + departure_airport` and track a `Set` of seen fingerprints. Skip duplicates before bucketing.

- [x] 1. Add `seen` Set + fingerprint check in `aggregateArrivalsByHour`.
- [x] 2. Confirm cancelled-status filter still in place (already there).
- [x] 3. Verify: `=== MERGED DISPATCH PAYLOAD ===` log still shows `flightsByHour` with realistic counts (1-5/hr for ALB).
- [x] 4. Regression: 15-min travel buffer + chronological rules live in SYSTEM_PROMPT — untouched by this hotfix.

## Sprint 4.5 — Live Train Data (Amtrak ALB)

### Decisions (locked before coding)
- **API:** `https://api-v3.amtraker.com/v3/stations/ALB` — keyless, community-run.
- **Response parse:** Defensive — accept `{ ALB: [...] }` or top-level array. Each train has a `stations` array; find stop where `code === "ALB"` and read `arr` (estimated/actual) with `schArr` fallback.
- **Surge threshold:** `>= 1` arrival per hour (even one Amtrak train = massive surge).
- **De-dupe:** fingerprint = `trainNum + arrival_time` (Set of seen).
- **Failure handling:** If fetch fails, return `[]` → `trainsByHour = {}` → prompt sees "Train data unavailable" and ignores.
- **No frontend changes. No new env vars.**

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: add `fetchAlbTrainArrivals()` — returns raw train array or `[]` on error.
- [x] 2. `app/api/dispatch/route.js`: add `aggregateTrainArrivalsByHour(trains, localStart, localEnd, offsetMin)` — buckets by local hour label.
- [x] 3. `app/api/dispatch/route.js`: add `summarizeTrainsByHour(buckets)` — mirrors flight summarizer.
- [x] 4. `app/api/dispatch/route.js`: call train fetch in the existing `Promise.all` alongside events + weather + flights.
- [x] 5. `app/api/dispatch/route.js`: include `trainsByHour` in `mergedPayload` so `=== MERGED DISPATCH PAYLOAD ===` log shows it.
- [x] 6. `app/api/dispatch/route.js`: extend `SYSTEM_PROMPT` with a "Rail Surge" rule — prioritize Rensselaer when any hour has >= 1 train arrival.
- [x] 7. `app/api/dispatch/route.js`: pass aggregated train data into the user message (both STATE A and STATE B branches) as `Train arrivals (Rensselaer/ALB) by hour:`.
- [ ] 8. Manual verification: terminal log shows `trainsByHour`; LLM mentions Rensselaer when a train is in the window.

### Acceptance Criteria
- Terminal: `=== MERGED DISPATCH PAYLOAD ===` includes `trainsByHour`.
- UI: 3-step plan mentions Rensselaer/Amtrak when arrivals are present.
- Graceful failure: API down → `{}`, dispatch continues.

### Out of Scope
- UI changes, multi-station support, caching, multiple Amtrak APIs.

## Sprint 4.5 Hotfix — Inspector + Ironclad Fallback
**Problem:** Amtraker `data.ALB` came back as an object (keyed by trainId), not an array. Aggregator's `for...of` threw `TypeError: trains is not iterable`, 500'ing the whole dispatch.

**Fix:** Inspector log + defensive extraction (Array → ALB array → ALB object via Object.values → top-level Object.values) + inner try/catch returning `[]` with the warning string from the brief. Belt-and-suspenders `Array.isArray` guard at top of aggregator.

- [x] 1. Add `console.log("RAW AMTRAK DATA:", data)` immediately after `response.json()`.
- [x] 2. Replace one-liner extraction with a defensive ladder covering all known/possible shapes.
- [x] 3. Wrap extraction in try/catch; on any failure → `console.warn("Amtrak Parse Failed, falling back to empty array")` + `return []`.
- [x] 4. Add `Array.isArray(trains)` guard at top of `aggregateTrainArrivalsByHour`.
- [x] 5. Capture the lesson in `tasks/lessons.md` (L1).
- [ ] 6. Manual verification: hit the dispatch endpoint, confirm (a) backend does NOT crash, (b) terminal prints `RAW AMTRAK DATA:` showing the true shape, (c) `=== MERGED DISPATCH PAYLOAD ===` includes a valid `trainsByHour` object (possibly `{}`).

## Sprint V2 — Origin Hub Filtering & Context

### Decisions (locked before coding)
- **Filter:** `HIGH_VALUE_HUBS = ['MCO','ATL','ORD','DFW','DEN','LAX','LAS','JFK','LGA']`. Departure IATA not in array → drop the flight.
- **Bucket format:** Aggregator returns `{ "8 PM": "3 Arrivals (from MCO, ATL, ORD)" }` (string, not int) so the LLM sees count + origins inline.
- **Surge threshold shift:** Any high-value hub arrival in an hour = surge. (Old `>5` threshold made sense for all flights; high-value hubs are rarer + more valuable, mirrors train logic.)
- **XL advisory:** Prompt must tell driver to enable UberXL / Lyft XL when MCO or LAS arrivals appear (luggage-heavy leisure hubs).

### Build Steps
- [x] 1. Add `HIGH_VALUE_HUBS` constant at top of `app/api/dispatch/route.js`.
- [x] 2. `aggregateArrivalsByHour`: skip flights whose `departure.iata` isn't in `HIGH_VALUE_HUBS`; collect origins per hour bucket; return `{ hour: "<n> Arrivals (from CODE, CODE)" }`.
- [x] 3. Update `SYSTEM_PROMPT` FLIGHTS block: describe new string format, lower surge threshold, add XL-when-MCO/LAS rule.
- [x] 4. Update user-message tail lines (STATE A + STATE B) to match new surge logic.
- [ ] 5. Manual verification: `npm run dev` → `=== MERGED DISPATCH PAYLOAD ===` shows `flightsByHour` with string values containing IATA codes; plan output mentions XL when MCO/LAS present.

### Acceptance Criteria
- Terminal: `flightsByHour` log entries are strings like `"3 Arrivals (from MCO, ATL, ORD)"`.
- UI plan: mentions XL rides when MCO or LAS appears in payload.
- Non-hub flights (EWR, PHL, etc.) silently dropped — they never reach the LLM.

### Out of Scope
- UI changes, hub list configurability, per-airline weighting, separate STATE A/B bucket formats.

## Sprint V2.1 — Next.js Cache Busting
**Problem:** Next.js App Router caches `fetch()` by default → AviationStack (and others) returned stale data, so LLM saw past arrivals instead of live ones.

**Fix:** Add `cache: "no-store"` to every `fetch()` in `app/api/dispatch/route.js`.

- [x] 1. Ticketmaster fetch — add `{ cache: "no-store" }`.
- [x] 2. Open-Meteo weather fetch — extend existing options with `cache: "no-store"` (keep `signal`).
- [x] 3. AviationStack flight fetch — add `{ cache: "no-store" }`.
- [x] 4. Amtraker train fetch — add `{ cache: "no-store" }`.
- [x] 5. Record lesson in `tasks/lessons.md` (L3).
- [ ] 6. Manual verification: trigger dispatch → `=== MERGED DISPATCH PAYLOAD ===` flights match Flightradar24 live arrivals at ALB.

## Sprint 5 — Albany Airport Scraper (No More Ghost Flights)

**Problem:** AviationStack returns flights that don't actually land at ALB (ghost flights from ATL/DEN). Replace with a scrape of the official airport board at `albanyairport.com/flights`.

### Decisions (locked before coding)
- **Library:** `cheerio` (page is server-rendered per WebFetch inspection — confirmed static HTML).
- **Columns scraped:** Time, From (city), Status. Other columns (Airline, Flight #, Gate) ignored — not needed.
- **Status whitelist:** `"Scheduled"`, `"On Time"`, `"Arrived"` (case-insensitive). Anything else (`"Delayed"`, `"Cancelled"`, blank) is dropped.
- **City → IATA mapping:** Hard-coded `HUB_CITY_PATTERNS` table keyed only on the 9 codes in `HIGH_VALUE_HUBS`. Match case-insensitive on the "From" cell. Non-matches drop silently (mirrors how AviationStack non-hubs were filtered).
- **Output shape:** Scraper returns objects in AviationStack's shape — `{ flight_status, arrival: { scheduled }, departure: { iata, airport } }` — so `aggregateArrivalsByHour` stays UNCHANGED (per L2).
- **Date for `scheduled`:** Today in the user's local TZ (derived from `localStart` UTC fields), combined with the scraped time, converted back to a real UTC ISO so the existing aggregator's `-offsetMin` math still works.
- **FLIGHT_API_KEY:** Remove the env var check — no longer needed.
- **Inspector log (per L1):** `console.log("RAW SCRAPER SAMPLE:", firstRow.text())` on the first parsed row so future shape changes are debuggable.
- **Failure handling:** Any fetch/parse failure → `return []` with a `console.warn`. Aggregator already handles empty arrays.

### Build Steps
- [x] 1. `npm install cheerio`.
- [x] 2. `app/api/dispatch/route.js`: add `HUB_CITY_PATTERNS` constant (city-name regex → IATA) for the 9 HIGH_VALUE_HUBS.
- [x] 3. `app/api/dispatch/route.js`: add `parseScrapedTimeToUtcIso(timeStr, localStart, offsetMin)` helper — converts "7:50am" + today's wall-clock date → real UTC ISO string.
- [x] 4. `app/api/dispatch/route.js`: add `fetchAlbArrivalsViaScraper({ localStart, offsetMin })` — fetches HTML, loads with cheerio, walks the Arrivals table, applies status whitelist, maps city → IATA via patterns, returns array in AviationStack shape.
- [x] 5. `app/api/dispatch/route.js`: delete old `fetchAlbArrivals` (AviationStack version).
- [x] 6. `app/api/dispatch/route.js`: swap the `Promise.all` slot — call the new scraper instead, drop the `flightApiKey` ternary.
- [x] 7. `app/api/dispatch/route.js`: remove `flightApiKey`/`FLIGHT_API_KEY` warning block (dead code).
- [ ] 8. Manual verification: `npm run dev` → trigger dispatch → `=== MERGED DISPATCH PAYLOAD ===` `flightsByHour` matches what `albanyairport.com/flights` shows for the next 1-4 hours, no ghost ATL/DEN flights when they aren't on the board.

### Acceptance Criteria
- Terminal `flightsByHour` log matches the live airport board for the user's selected window.
- Status filter excludes Delayed/Cancelled flights.
- HIGH_VALUE_HUBS filter still applied (non-hub origins silently dropped before reaching the LLM).
- AviationStack call is gone — no more API key, no more ghost flights.

### Out of Scope
- Departures (only arrivals matter for rideshare).
- Multi-airport support, configurable hub list, caching the scrape, headless browser fallback.

## Sprint 6 — Puppeteer Headless Scraper (kill "table not found")

**Problem:** `albanyairport.com/flights` renders the arrivals table client-side via JS. Cheerio sees an empty shell → `arrivals table not found` warn → `flightsByHour = {}` → LLM blind to the airport surge.

### Decisions (locked before coding)
- **Library:** standard `puppeteer` (bundles Chromium). Fine for local dev per brief.
- **Wait strategy:** `page.goto(..., { waitUntil: 'networkidle0' })` THEN `page.waitForSelector('table tbody tr', { timeout: 15000 })`. Belt-and-suspenders — JS frameworks sometimes hydrate after network goes idle.
- **Extraction:** `page.evaluate()` returns `{ colIdx, rows }` (header-driven indexes + `[[cell, cell, ...]]`) so all string/regex logic stays in Node, not in the browser context.
- **Cleanup:** `browser.close()` in `finally` block. Always. No leaks.
- **Output shape:** unchanged — same `{ flight_status, arrival: { scheduled }, departure: { iata, airport } }` so `aggregateArrivalsByHour` is untouched (per L2).
- **Status whitelist / city→IATA / inspector log:** unchanged.
- **Cheerio import:** removed — this fetcher was the only consumer. `cheerio` left in `package.json` (not asked to uninstall).

### Build Steps
- [x] 1. `npm install puppeteer`.
- [x] 2. `app/api/dispatch/route.js`: replace cheerio-based `fetchAlbArrivalsViaScraper` with a Puppeteer implementation. Launch headless → `goto` with `networkidle0` → `waitForSelector` → `page.evaluate` extracts the arrivals table → reuse existing `cityToHubIata` + `parseScrapedTimeToUtcIso` + status whitelist → close browser in `finally`.
- [x] 3. `app/api/dispatch/route.js`: drop `import { load as cheerioLoad } from "cheerio"` (now dead).
- [ ] 4. Manual verification: `npm run dev` → trigger dispatch → terminal shows `RAW SCRAPER SAMPLE` line, no `arrivals table not found` warning, `flightsByHour` matches the live board.

### Acceptance Criteria
- `=== MERGED DISPATCH PAYLOAD ===` logs `flightsByHour` populated from JS-rendered table.
- No "arrivals table not found" warning when the live board has flights.
- `browser.close()` runs even on parse failure (verify by inducing a failure path in dev).

### Out of Scope
- Serverless Chromium (Vercel/AWS) — local-testing first; switch to `puppeteer-core` + `@sparticuz/chromium` only when deploying.
- Caching the scrape, multi-airport support.

## Sprint 7 — Revert to AviationStack (kill Puppeteer)
**Problem:** Puppeteer scrape of `albanyairport.com/flights` times out under bot protection. Heavy dependency, unreliable. Abandon scraping → revert to AviationStack API.

### Decisions (locked before coding)
- **API:** `http://api.aviationstack.com/v1/flights?access_key=KEY&arr_iata=ALB&limit=100` (per brief — keep `http://`).
- **Env var:** `FLIGHT_API_KEY` (matches the original Sprint 4 name). If missing → warn + return `[]`, do not 500 (preserves graceful degradation).
- **Cache-bust:** `{ cache: "no-store" }` retained (L3).
- **Origin filter:** `HIGH_VALUE_HUBS` filter stays — already applied inside `aggregateArrivalsByHour`. No change needed.
- **Output format:** `{ "7 PM": "2 Arrivals (from ORD, MCO)" }` already produced by aggregator. Unchanged.
- **Dead code to remove:** `puppeteer` import, `HUB_CITY_PATTERNS`, `cityToHubIata`, `parseScrapedTimeToUtcIso`, `ALB_ARRIVALS_STATUS_WHITELIST`, `fetchAlbArrivalsViaScraper`. They only existed to bridge scraped city names + wall-clock times back to AviationStack's shape — no longer needed.
- **Keep:** `aggregateArrivalsByHour` (cancellation filter, hub filter, de-dupe, bucket logic). AviationStack returns `flight_status` + `arrival.scheduled` + `departure.iata` directly — matches what the aggregator expects.

### Build Steps
- [x] 1. `npm uninstall puppeteer`.
- [x] 2. `app/api/dispatch/route.js`: remove `import puppeteer from "puppeteer"`.
- [x] 3. `app/api/dispatch/route.js`: delete `HUB_CITY_PATTERNS`, `ALB_ARRIVALS_STATUS_WHITELIST`, `cityToHubIata`, `parseScrapedTimeToUtcIso`, `fetchAlbArrivalsViaScraper`.
- [x] 4. `app/api/dispatch/route.js`: add `fetchAlbArrivals({ apiKey })` — single GET to AviationStack with `cache: "no-store"`, returns `data.data` array or `[]` on error.
- [x] 5. `app/api/dispatch/route.js`: swap the `Promise.all` slot to call `fetchAlbArrivals` with `process.env.FLIGHT_API_KEY` (skip when missing).
- [ ] 6. Manual verification: `npm run dev` → trigger dispatch → backend compiles without puppeteer, `=== MERGED DISPATCH PAYLOAD ===` logs `flightsByHour` without timing out.

### Acceptance Criteria
- Backend compiles without Puppeteer.
- `=== MERGED DISPATCH PAYLOAD ===` logs the API response without crashing or timing out.

### Out of Scope
- Removing the `puppeteer` lockfile residue beyond `npm uninstall`. Reintroducing the scraper later.

## Sprint 4.5 Hotfix 2 — Ticketmaster Time Swap (UTC → localTime)
**Problem:** `summarizeEvents` was passing `e.dates.start.dateTime` (UTC ISO ending in `Z`, e.g. `2026-05-09T23:00:00Z`) to the LLM. A 7 PM local event read as 11 PM, producing a 1 AM hallucination in the driver's plan.

**Fix:** Use `e.dates.start.localTime` (`"19:00:00"`), format as `"7:00 PM"`, fall back to `"Time TBA"` on missing/malformed.

- [x] 1. Add `formatLocalTime12h(localTime)` helper — handles null/undefined/malformed → "Time TBA", `"00:00:00"` → "12:00 AM", `"12:00:00"` → "12:00 PM".
- [x] 2. Swap `summarizeEvents` from `e.dates?.start?.dateTime` to `e.dates?.start?.localTime` via the new helper.
- [ ] 3. Manual verification: `npm run dev` → click button → terminal `=== MERGED DISPATCH PAYLOAD ===` shows event lines ending in `"7:00 PM"` style, not `"...T23:00:00Z"`.
- [ ] 4. CoT verification: `=== CoT TIMELINE ===` block computes step end-times from local AM/PM (e.g., starts 7:00 PM → step ends 9:00 PM, not 1:00 AM).
- [ ] 5. UI verification: driver-facing plan no longer shows post-midnight times for standard evening events.

## Sprint 8 — Multi-App Density Engine (Yelp Fusion)

### Decisions (locked before coding)
- **API:** Yelp Fusion — `GET https://api.yelp.com/v3/businesses/search`. Bearer auth via `YELP_API_KEY` env.
- **Two calls per dispatch:** `categories=restaurants` AND `categories=grocery`, both with `radius=5000`, `open_now=true`, `limit=50`.
- **Thresholds:** Low <5, Medium 5-15, High >15 (based on `businesses.length`).
- **Env var:** `YELP_API_KEY` optional. Missing → warn + skip → `gigDemand = null` → prompt sees "Density data unavailable".
- **Output:** `{ foodDeliveryDensity: "High (42 open restaurants nearby)", groceryDensity: "Low (3 open supermarkets nearby)" }`.
- **Inspector log (L1):** `console.log("RAW YELP DATA:", { restaurants, grocery })` before extraction.
- **Cache-bust (L3):** `cache: "no-store"` on both fetches.
- **Defensive extraction (L1):** `Array.isArray(data?.businesses)` guard; return `0` (count) on parse failure.
- **No frontend changes.**

### Build Steps
- [x] 0. Write Sprint 8 plan to `tasks/todo.md`
- [x] 1. Add `densityLabel(count)` helper → "Low"/"Medium"/"High".
- [x] 2. Add `fetchYelpOpenCount({ latitude, longitude, category, apiKey })` — single GET, defensive parse, returns count.
- [x] 3. Add `getLocalDensityData(latitude, longitude, apiKey)` — two parallel Yelp calls; returns `{ foodDeliveryDensity, groceryDensity }` or `null` on missing key.
- [x] 4. Wire into the existing `Promise.all` alongside events/weather/flights/trains.
- [x] 5. Include `gigDemand` in `mergedPayload` so `=== MERGED DISPATCH PAYLOAD ===` shows it.
- [x] 6. Update `SYSTEM_PROMPT`: relabel as Multi-App Dispatcher, FOUR→FIVE data sources, add "Platform Switching" block (low flights + High food density during 11am-2pm / 5pm-8pm → switch to DoorDash/UberEats).
- [x] 7. Add `Gig demand:` lines into both STATE A and STATE B user messages.
- [ ] 8. Manual verification: `npm run dev` → trigger dispatch → terminal shows `gigDemand` in merged payload; LLM mentions platform switch when food density is High during meal hours and flights are low.

### Acceptance Criteria
- Backend fetches Yelp data without crashing (or warns + skips on missing key).
- `=== MERGED DISPATCH PAYLOAD ===` includes `gigDemand` with both density strings.
- AI plan switches to DoorDash/UberEats when food density is High during meal hours AND flight arrivals are low.

### Out of Scope
- UI changes, configurable thresholds, additional categories (alcohol/pharmacy), caching the density calls, per-category radius tuning.

## Sprint 9 — Multi-Platform UI Toggles

### Decisions (locked before coding)
- **State shape:** `{ rideshare: true, food: false, grocery: false }`. Rideshare defaults checked; user can still uncheck it.
- **Payload field:** `platforms` (object) sent alongside `hours`/`latitude`/`longitude`/`timezoneOffsetMinutes`.
- **Backend default (back-compat):** missing/malformed `platforms` → `{ rideshare: true, food: false, grocery: false }`.
- **System prompt rule:** ONE new CRITICAL rule near the top instructing AI to ignore demand for platforms not in the active list. The actual active-list string is injected per request via the user message (mirrors how events/flights are injected — static rule, dynamic data).
- **UI placement:** new "Active Platforms" section directly below "Time window" dropdown. Styling matches the existing rounded-xl/neutral-900 panel look.
- **Out of scope:** persisting selection across sessions, all-unchecked guard, per-platform sub-options.

### Build Steps
- [x] 1. `app/page.js`: add `platforms` state with `{ rideshare: true, food: false, grocery: false }`.
- [x] 2. `app/page.js`: render 3 checkboxes below the time-window dropdown.
- [x] 3. `app/page.js`: include `platforms` in the fetch body.
- [x] 4. `app/api/dispatch/route.js`: destructure `platforms` from the request, normalize with defaults.
- [x] 5. `app/api/dispatch/route.js`: build a human-readable active-platforms string + inject into BOTH user-message branches.
- [x] 6. `app/api/dispatch/route.js`: add CRITICAL platform-restriction rule to `SYSTEM_PROMPT`.
- [ ] 7. Manual verification: uncheck Food + Grocery → plan never recommends DoorDash/UberEats/Instacart even when food density is High. Check all three → plan can switch between them based on density/flight logic.

### Acceptance Criteria
- UI displays 3 checkboxes; toggling them updates state.
- Network payload (DevTools) shows `platforms: { rideshare, food, grocery }` matching UI state.
- AI plan only recommends platforms in the active list, regardless of density signals.

## Sprint 11 — Payload Sanitization (Hard Guardrails)

**Problem:** Sprint 10's strict prompt rules still aren't enough — LLM hallucinates flight/food/grocery plans for disabled platforms. Stop trying to control via prompt; sanitize the payload itself.

### Decisions (locked before coding)
- **Where to wipe:** AFTER `aggregateArrivalsByHour` / `aggregateTrainArrivalsByHour` produce their buckets, BEFORE `mergedPayload` is built and logged. This way the `=== MERGED DISPATCH PAYLOAD ===` log shows the sanitized state (acceptance criterion).
- **Rideshare wipe:** `!platforms.rideshare` → `flightsByHour = {}` and `trainsByHour = {}`. (Brief specifies only these two — do NOT also wipe events; brief didn't ask.)
- **Food wipe:** `!platforms.food` → if `gigDemand` is the object shape, set `gigDemand.foodDeliveryDensity = "N/A"`. If `gigDemand` is null/string, no-op (nothing to wipe).
- **Grocery wipe:** `!platforms.grocery` → if `gigDemand` is the object shape, set `gigDemand.groceryDensity = "N/A"`. Same null/string guard.
- **Binding change:** `flightsByHour` / `trainsByHour` switch from `const` to `let` so the wipe can reassign. `gigDemand` already comes from `Promise.all` as a `let` candidate but is destructured `const`; mutating its properties in place is fine (it's a fresh object from `getLocalDensityData`).
- **Downstream effect:** `flightsText`, `trainsText`, `gigDemandText` automatically reflect the sanitized state because they're built from the same variables. No prompt changes needed — the LLM can't hallucinate what isn't in its context.

### Build Steps
- [x] 0. Write Sprint 11 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: change `const flightsByHour` and `const trainsByHour` to `let`.
- [x] 2. `app/api/dispatch/route.js`: change `gigDemand` destructuring so it's reassignable (or mutate fields in place — mutate is simpler).
- [x] 3. `app/api/dispatch/route.js`: add sanitization block immediately after the aggregator calls, before `mergedPayload` construction.
- [ ] 4. Manual verification: uncheck Rideshare → terminal `=== MERGED DISPATCH PAYLOAD ===` shows `flightsByHour: {}` and `trainsByHour: {}` even when AviationStack/Amtraker returned data.
- [ ] 5. Manual verification: uncheck Food → `gigDemand.foodDeliveryDensity` reads `"N/A"` in the log.
- [ ] 6. Manual verification: uncheck Grocery → `gigDemand.groceryDensity` reads `"N/A"` in the log.
- [ ] 7. End-to-end: with only Grocery on + Low local supermarkets, plan never mentions airports, flights, ALB, Rensselaer, DoorDash, or UberEats — because none of that data is in the payload anymore.

### Acceptance Criteria
- Unchecking a platform on the frontend successfully deletes its corresponding data from the backend payload (visible in the log).
- AI generates a 100% pure, platform-specific plan without hallucinations because the irrelevant data no longer exists in its context window.

### Out of Scope
- Wiping `events` when rideshare is off (brief did not request).
- Frontend changes, new env vars, prompt rewrites.

## Sprint 10 — Strict Platform Guardrails (Prompt Engineering)

**Problem:** LLM has "Data Obligation" — it combines irrelevant data sources with active platforms (e.g., suggesting Instacart grocery pickups at the airport for arriving flight passengers). Existing CRITICAL block is too soft and even tells the model to route drivers to airport/Amtrak when rideshare is off.

### Decisions (locked before coding)
- **Inject True/False state via system prompt:** Convert `SYSTEM_PROMPT` constant to `buildSystemPrompt(activePlatforms)` function. Renders the three boolean states inline immediately above the new rules block so the LLM sees the exact state per request.
- **Replace, not append:** Remove the existing soft "CRITICAL — ACTIVE PLATFORMS" block. The new "CRITICAL PLATFORM ISOLATION RULES" section is the single source of truth — the old block contradicts the new behavior (it said "route the driver to airport/Amtrak even if rideshare is off").
- **Four sub-rules:** Rideshare / Food Delivery / Grocery / Anti-Mashing — each names the specific terms to NEVER mention when the platform is FALSE.
- **No frontend changes. No new env vars. No new data flow.** Pure prompt engineering.

### Build Steps
- [x] 0. Write Sprint 10 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: convert `SYSTEM_PROMPT` constant to `buildSystemPrompt(activePlatforms)` function.
- [x] 2. `app/api/dispatch/route.js`: replace old "CRITICAL — ACTIVE PLATFORMS" block with new "CRITICAL PLATFORM ISOLATION RULES" section, with True/False state injected directly above it.
- [x] 3. `app/api/dispatch/route.js`: update the `client.messages.create` call site to use `buildSystemPrompt(activePlatforms)`.
- [ ] 4. Manual verification: uncheck Rideshare + Food, leave Grocery on. With no supermarkets nearby, plan must NOT mention airport, flights, ALB, Rensselaer, DoorDash, or UberEats — should tell driver to wait or relocate.
- [ ] 5. Manual verification: uncheck everything except Grocery. Word "Airport" and "Flights" must never appear in the plan.

### Acceptance Criteria
- When only "Grocery" is checked, "Airport" / "Flights" / "ALB" never appear in the plan.
- LLM provides logical, platform-specific advice without hallucinating crossover events.
- System prompt visibly states each platform's True/False right above the isolation rules.

## Sprint V2.5 — Precision Food Dispatch (Spatial Hotspots)

**Problem:** "Density Counts" (Low/Medium/High) tell the AI WHETHER to switch apps but not WHERE to position. Replace counts with spatial hotspot data so the AI can name specific intersections and reason about tip quality vs. turn speed.

### Decisions (locked before coding)
- **Two Yelp calls, top 10 each** — keep the existing restaurants + grocery split. Each call returns full business records (name, lat/lng, price, categories, address1).
- **Replace `foodDeliveryDensity`/`groceryDensity` strings with `foodHotspots`/`groceryHotspots` arrays** in `gigDemand`. Each entry: `{ location, volume, tier, categories }` exactly matching the brief's example.
- **Cluster algorithm (greedy 200m):** For each business in the pool, count neighbors within 200m. Pick the business with the largest neighborhood as cluster #1, remove its members, repeat. Up to 3 clusters per category.
- **Distance:** Haversine helper inline — no library.
- **Location label:** Strip leading street number from each cluster member's `address1`, count street names, take top 2. Two streets → `"Pearl St & State St"`. One street → `"near Pearl St"`. Zero usable → `"Unnamed area"`.
- **Tier label:** Any business with `$$$` or `$$$$` → `"High-Value ($$$)"`. Else majority `$$` → `"Mid-Tier ($$)"`. Else → `"Quick-Turn ($)"`.
- **Categories label:** Top 2 distinct category titles across the cluster, comma-joined (string, matches brief example).
- **Sprint 11 sanitization swap:** `!food` → `gigDemand.foodHotspots = []`; `!grocery` → `gigDemand.groceryHotspots = []`. Drop the old `"N/A"` density-string assignments.
- **Prompt rewrite — Multi-App Platform Switching block:** New trigger is `foodHotspots.length > 0` (not "starts with 'High'"). MUST name a specific intersection. MUST explain WHY using tier (high-tier = better tips) or volume (fast food = quick turns).
- **Inspector log (L1):** Replace the count-only RAW YELP DATA log with one that prints full business records (name, price, coords, address, categories) for each of the 10. Add a separate `=== HOTSPOT CLUSTERS ===` log so derivation is debuggable.
- **Cache bust (L3):** Already in place — preserved.
- **Mirror existing pattern (L2):** Fetcher → builder → sanitizer slot → mergedPayload key → SYSTEM_PROMPT block → user-message lines in BOTH STATE A and STATE B. Same shape as flights/trains.
- **Orphan cleanup:** `densityLabel` and `fetchYelpOpenCount` become unreachable after this change. Remove them.

### Build Steps
- [x] 0. Write Sprint V2.5 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `haversineMeters(lat1, lng1, lat2, lng2)` helper.
- [x] 2. `app/api/dispatch/route.js`: replace `fetchYelpOpenCount` with `fetchYelpBusinesses` that returns `[{ name, lat, lng, price, categories, address1 }]` (top 10) instead of a count. Keep defensive parse + inspector log.
- [x] 3. `app/api/dispatch/route.js`: add `computeHotspots(businesses)` — greedy 200m cluster sweep, up to 3 clusters, each labeled per the rules above.
- [x] 4. `app/api/dispatch/route.js`: rewrite `getLocalDensityData` to return `{ foodHotspots, groceryHotspots }` and log the derived clusters.
- [x] 5. `app/api/dispatch/route.js`: delete now-orphaned `densityLabel`.
- [x] 6. `app/api/dispatch/route.js`: update Sprint 11 sanitization — wipe `foodHotspots`/`groceryHotspots` arrays instead of setting density strings to `"N/A"`.
- [x] 7. `app/api/dispatch/route.js`: rewrite `buildSystemPrompt`'s Multi-App Platform Switching block (new shape + intersection requirement + tier-vs-volume reasoning).
- [x] 8. `app/api/dispatch/route.js`: update STATE A and STATE B user-message tail lines to reference the new hotspot trigger and intersection-naming requirement.
- [ ] 9. Manual verification: `npm run dev` → trigger dispatch → terminal shows `RAW YELP DATA` with top 10 businesses incl. prices/coordinates, then `=== HOTSPOT CLUSTERS ===`, then `=== MERGED DISPATCH PAYLOAD ===` with `gigDemand.foodHotspots` array shape. AI plan names a specific intersection (e.g. "Position at Pearl St & Pine St; 4 high-end restaurants ($$$) are active") instead of "Go Downtown."

### Acceptance Criteria
- Backend terminal prints a detailed list of the top 10 nearby restaurants with prices and coordinates.
- `gigDemand` in merged payload is `{ foodHotspots: [...], groceryHotspots: [...] }`, each hotspot matching `{ location, volume, tier, categories }`.
- AI plan replaces "Go Downtown" with a specific intersection and a why-reason tied to tier or volume.

### Out of Scope
- UI changes, reverse geocoding (we derive intersections from Yelp `address1` only), more than 3 clusters per category, configurable cluster radius, persisting Yelp results across requests.

## Sprint 12 — Deadhead Audit & ROI Logic

**Problem:** AI suggests far-away hotspots without weighing fuel cost. Drivers chase volume across town and burn margin on the pavement. Add a "Profitability Auditor" filter: compute travel distance to each hotspot, label the driver's local density, and instruct the LLM to stay put when the math doesn't pencil out.

### Decisions (locked before coding)
- **Cost constant:** `COST_PER_MILE = 0.65`. Used inside the system prompt as the dollar weight per deadhead mile.
- **Distance scope:** Only Yelp hotspots get `distanceMiles`. ALB / Rensselaer not in scope — brief says "hotspots (Yelp data)".
- **Distance unit:** Miles, rounded to 1 decimal. `metersToMiles` helper.
- **Cluster centroid:** Mean of cluster members' lat/lng. Haversine from driver → centroid.
- **Local density formula:** Look at the closest food hotspot. If `distanceMiles ≤ 0.5` and `volume ≥ 5` → "High". `volume 3-4` → "Medium". Else (or nothing within 0.5 mi) → "Low".
- **Stay-put trigger (in prompt):** closest food hotspot > 8 mi AND localDensity in {"Medium","High"} → tell driver "Stay and maximize" instead of chasing.
- **Distance-justification trigger (in prompt):** any hotspot the driver IS asked to relocate to with `distanceMiles > 5` (~15 min @ 20 mph city) → must say "This is a [X] mile drive; the volume here justifies the fuel cost."
- **Where to compute:** Inside `computeHotspots` (centroid + distance) and a new `computeLocalDensity` called by `getLocalDensityData`. localDensity travels in `gigDemand` alongside hotspots.
- **Sanitization (Sprint 11):** Wipe hotspots as before; leave `localDensity` alone. After food wipe, foodHotspots is empty → next request to `computeLocalDensity` wouldn't see data, but we compute once before sanitization so the value reflects the real area (still useful for rideshare).
- **No frontend changes. No new env vars. No new external calls.**

### Build Steps
- [x] 0. Write Sprint 12 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `COST_PER_MILE = 0.65` and `metersToMiles(m)` helper.
- [x] 2. `app/api/dispatch/route.js`: modify `computeHotspots(businesses, driverLat, driverLng)` to compute cluster centroid + `distanceMiles` per hotspot.
- [x] 3. `app/api/dispatch/route.js`: add `computeLocalDensity(foodHotspots)` → "Low" | "Medium" | "High".
- [x] 4. `app/api/dispatch/route.js`: thread driver coords through `getLocalDensityData`; include `localDensity` in returned object.
- [x] 5. `app/api/dispatch/route.js`: update `SYSTEM_PROMPT` Multi-App Platform Switching block — add PROFITABILITY AUDITOR rules (stay-put + distance justification + High-density override).
- [x] 6. `app/api/dispatch/route.js`: update STATE A and STATE B user-message tails to reference the deadhead rules.
- [ ] 7. Manual verification: `npm run dev` → trigger dispatch → terminal shows `gigDemand.localDensity` + `distanceMiles` on each hotspot; plan mentions mile-drive justification on far moves and "Stay and maximize" when localDensity is High.

### Acceptance Criteria
- The AI plan explicitly mentions travel distance (`distanceMiles`) and justifies the move when a hotspot is >5 mi.
- If driver is in a "High Density" area, plan says "Stay and maximize" instead of chasing a far hotspot.
- `=== MERGED DISPATCH PAYLOAD ===` log shows `gigDemand.localDensity` and `distanceMiles` per hotspot.

### Out of Scope
- ALB / Rensselaer distance calculation, dynamic `COST_PER_MILE` (env var), per-mile dollar math shown to the driver, distance to events, frontend changes.

## Sprint 12 Hotfix — Backtick Inside Template Literal
**Problem:** Sprint 12 added `` `localDensity` `` (backticks as inline-code emphasis) inside `buildSystemPrompt`'s backtick template literal. The inner backtick silently closed the outer template, causing Next.js "Failed to Compile" with `Unexpected identifier 'localDensity'`. `node --check` reported clean — only a full `import()` surfaced the parse error.

- [x] 1. Replace `` `localDensity` `` with `"localDensity"` on the GIG DEMAND description line in `buildSystemPrompt`.
- [x] 2. Verify `node -e "import('file:///.../route.js')"` prints `PARSE OK`.
- [x] 3. Record lesson L4 in `tasks/lessons.md`.

## Sprint 13 — 1:2 ROI Auditor Calibration

**Problem:** Sprint 12's "Profitability Auditor" used soft heuristics (>8 mi + Medium = stay put; >5 mi = justification line). Replace with a strict 1:2 ROI ratio: `Deadhead_Cost = miles * 0.65`, `Required_Value_Threshold = Deadhead_Cost * 2`. AI must reason as an ROI Auditor and surface the math in its plan. Apply to hotspots AND airport/Amtrak relocations (user-confirmed scope).

### Decisions (locked before coding)
- **ROI math computed in code, not by LLM.** Each Yelp hotspot gets `deadheadCost` + `requiredValueThreshold` fields. ALB and Amtrak get a parallel `transitROI` object computed from fixed station coords.
- **Station coordinates:** `ALB_COORDS = { lat: 42.7483, lng: -73.8017 }`, `AMTRAK_COORDS = { lat: 42.6463, lng: -73.7392 }`. Static — known landmarks, no API needed.
- **Dollar values are PERCEIVED, not actual.** AI uses qualitative bucketing from the prompt:
  - 1 ALB arrival ≈ $8, 2 ≈ $16, 3+ ≈ $25+. MCO/LAS bonus +$5 (luggage = XL fare).
  - 1 Amtrak arrival ≈ $12 (concentrated drop), 2+ ≈ $25+.
  - Hotspot volume: 1-2 ≈ $6, 3-4 ≈ $12, 5+ ≈ $20. High-Value tier +$5 (better tips).
- **Decision rule:** If `perceivedValue < requiredValueThreshold` → Stay put or find closer alternative. AI must literally say "ROI" or "Profitability" in the reasoning.
- **Sanitization:** `!rideshare` wipes `transitROI` too (mirrors Sprint 11 flight/train wipe). Hotspots already handled.
- **Replace, not append:** The old PROFITABILITY AUDITOR block in `buildSystemPrompt` contradicts the new strict ratio (it says "Stay" at >8mi + Medium; new logic uses the math directly). Replace the whole block.
- **No frontend changes. No new env vars. No new external calls.**

### Build Steps
- [x] 0. Write Sprint 13 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `ALB_COORDS` + `AMTRAK_COORDS` constants near `COST_PER_MILE`.
- [x] 2. `app/api/dispatch/route.js`: extend `computeHotspots` so each hotspot returns `deadheadCost` + `requiredValueThreshold` alongside `distanceMiles`.
- [x] 3. `app/api/dispatch/route.js`: add `computeTransitROI(driverLat, driverLng)` returning `{ alb: { distanceMiles, deadheadCost, requiredValueThreshold }, amtrak: {...} }`.
- [x] 4. `app/api/dispatch/route.js`: call `computeTransitROI` in `POST`; surface as top-level `transitROI` in `mergedPayload`.
- [x] 5. `app/api/dispatch/route.js`: wipe `transitROI = null` inside the Sprint 11 sanitization block when `!activePlatforms.rideshare`.
- [x] 6. `app/api/dispatch/route.js`: replace the old PROFITABILITY AUDITOR block in `buildSystemPrompt` with strict 1:2 ROI Auditor rules + perceived-value bucketing + math-transparency requirement.
- [x] 7. `app/api/dispatch/route.js`: update STATE A + STATE B user-message tails — replace old stay-put/justification language with explicit ROI-threshold language; include `transitROI` line in payload.
- [x] 8. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns clean.
- [ ] 9. Manual verification: `npm run dev` → trigger dispatch → `=== MERGED DISPATCH PAYLOAD ===` shows `transitROI` + `deadheadCost`/`requiredValueThreshold` per hotspot; plan references "ROI" or "Profitability" and quotes the dollar math when declining a far move.

### Acceptance Criteria
- AI's plan explicitly references "ROI" or "Profitability" when deciding whether to move.
- Driver no longer gets "chase" instructions for low-value, high-distance targets (e.g., 10 mi to airport with 1 Medium arrival).
- Merged payload log shows the math: `deadheadCost`, `requiredValueThreshold` on each hotspot + `transitROI.alb`/`transitROI.amtrak`.

### Out of Scope
- Dynamic `COST_PER_MILE` (env var), distance to Ticketmaster event venues, frontend changes, additional transit hubs.

## Sprint 14 — Revert ROI Auditor (Sprint 12 + Sprint 13)

**Problem:** Auditor too restrictive for current phase. Revert to traditional volume-based dispatch (pre-Sprint-12 state). Keep Sprint 11 platform sanitization (still useful).

### Decisions (locked before coding)
- **Full revert, not partial.** Acceptance criterion #1 says "plan no longer mentions ROI, Profitability, or Deadhead Costs" — Sprint 12's prompt block uses "Profitability Auditor" + "deadhead miles," so it must go too, not just Sprint 13. Once that block is removed, `distanceMiles`/`localDensity` have no consumer → revert them as well per "Restore Traditional Dispatch."
- **Keep:** Sprint 11 sanitization (rideshare/food/grocery wipes), hotspots structure `{ location, volume, tier, categories }` from Sprint V2.5, all other live-data streams.
- **Delete:** `COST_PER_MILE`, `ALB_COORDS`, `AMTRAK_COORDS`, `metersToMiles`, `computeTransitROI`, `computeLocalDensity`. Strip driver-coord threading from `computeHotspots` / `getLocalDensityData`. Strip `deadheadCost`, `requiredValueThreshold`, `distanceMiles`, `localDensity` fields.
- **System prompt:** remove 1:2 ROI AUDITOR block, Sprint 12 PROFITABILITY AUDITOR block, all "ROI"/"Profitability"/"deadhead" references in food/grocery rules + example string. GIG DEMAND description drops `distanceMiles` + `localDensity` keys.
- **User-message tails:** drop `Transit ROI` line + ROI Auditor instruction sentence.
- **No frontend changes.**

### Build Steps
- [x] 0. Write Sprint 14 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: delete `1:2 ROI AUDITOR` block + `PROFITABILITY AUDITOR` block from `buildSystemPrompt`.
- [x] 2. `app/api/dispatch/route.js`: revert GIG DEMAND description in `buildSystemPrompt` (drop `distanceMiles` + `localDensity` keys, drop sentences describing them). Update food/grocery rules to drop ROI references. Replace example string with non-ROI version.
- [x] 3. `app/api/dispatch/route.js`: delete `COST_PER_MILE`, `ALB_COORDS`, `AMTRAK_COORDS` constants.
- [x] 4. `app/api/dispatch/route.js`: delete `metersToMiles`, `computeTransitROI`, `computeLocalDensity` functions.
- [x] 5. `app/api/dispatch/route.js`: revert `computeHotspots(businesses)` — drop `driverLat`/`driverLng` params, drop centroid/distance/ROI math, return `{ location, volume, tier, categories }` only.
- [x] 6. `app/api/dispatch/route.js`: revert `getLocalDensityData(latitude, longitude, apiKey)` — drop `localDensity` computation/return; pass businesses only to `computeHotspots`.
- [x] 7. `app/api/dispatch/route.js`: remove `transitROI` + `transitROIText` from POST handler; drop `transitROI` from `mergedPayload` and sanitization block.
- [x] 8. `app/api/dispatch/route.js`: remove `Transit ROI` block + ROI Auditor sentence from STATE A and STATE B user-message tails.
- [x] 9. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns clean.
- [ ] 10. Manual verification: `npm run dev` → trigger dispatch → plan output never contains "ROI", "Profitability", "deadhead", or dollar-cost math; merged payload log has no `transitROI` key and hotspots have no `distanceMiles`/`deadheadCost`/`requiredValueThreshold` fields.

### Acceptance Criteria
- AI plan no longer mentions "ROI," "Profitability," or "Deadhead Costs."
- Code no longer calculates distances for the purpose of a financial filter.

### Out of Scope
- Re-introducing distance as a non-financial dispatch signal (e.g., tie-breaker between equally-dense hotspots). Frontend changes. Sprint 11 sanitization changes.

## Sprint 15 — Netlify Backend Deployment (Cloud Split)

**Goal:** Deploy the Next.js backend (incl. `/api/dispatch`) to a live Netlify URL so the upcoming Capacitor native shell can call it. Static export is incompatible with API routes — Netlify's Next.js runtime keeps the dynamic server alive.

### Decisions (locked before coding)
- **No `next.config.mjs` change.** Currently `const nextConfig = {}; export default nextConfig;` — already clean, no `output: 'export'` ever applied. AC #1 satisfied without editing.
- **No `package.json` change.** `"build": "next build"` already present.
- **`netlify.toml` minimal + explicit.** Declare build command + pin the Next.js plugin. Skip Node-version pin (Netlify default LTS is fine).
- **Env vars NOT in source control.** User adds them to Netlify Dashboard after first deploy creates the site. Actual vars: `ANTHROPIC_API_KEY`, `TICKETMASTER_API_KEY`, `FLIGHT_API_KEY`, `YELP_API_KEY`. (Brief mentioned "OpenAI" — codebase actually uses Anthropic SDK; corrected.)
- **CLI over Git-based deploy.** Brief specified `npx netlify deploy --build --prod`. Faster iteration than wiring up GitHub.

### Build Steps
- [x] 0. Write Sprint 15 plan to `tasks/todo.md`.
- [x] 1. Create root `netlify.toml` with `[build] command = "npm run build"` + `[[plugins]] package = "@netlify/plugin-nextjs"`.
- [ ] 2. User runs `npx netlify login`.
- [ ] 3. User runs `npx netlify init` (choose "Create & configure a new site", accept defaults).
- [ ] 4. User runs `npx netlify deploy --build --prod` — first deploy produces the live URL.
- [ ] 5. User adds the four env vars in Netlify Dashboard → Site settings → Environment variables.
- [ ] 6. User redeploys: `npx netlify deploy --build --prod` (env vars only take effect after a rebuild).
- [ ] 7. Manual verification: `curl -X POST <live-url>/api/dispatch -H "Content-Type: application/json" -d '{"latitude":42.65,"longitude":-73.75,"hours":2,"timezoneOffsetMinutes":240,"platforms":{"rideshare":true,"food":false,"grocery":false}}'` returns a JSON `{ plan: "..." }`.

### Acceptance Criteria
- `next.config.mjs` contains no static-export directive. ✓ (already true)
- User has exact CLI commands to push the backend to a live Netlify URL. ✓ (provided in chat output)
- Live URL responds to POST `/api/dispatch` with a valid plan once env vars are set.

### Out of Scope
- GitHub auto-deploy wiring, custom domain, branch deploys, Capacitor frontend changes (next sprint), removing the four API keys from `.env.local`.
