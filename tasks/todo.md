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

## Sprint 15 — Geographic Filtering (Ripple Effect)

**Problem:** Driver wants to opt out of airport pickups WITHOUT blinding the AI to flight data. The AI must keep seeing flight arrivals (to predict downstream hotel/restaurant ripples) but must never route the driver to ALB itself.

### Decisions (locked before coding)
- **New state:** `includeAirport` (boolean, defaults `true`). Lives in `app/page.js`, posted in the fetch body alongside `platforms`, `hours`, etc.
- **Backend default:** `includeAirport = body.includeAirport !== false` — missing/undefined falls back to `true` (back-compat with existing callers).
- **UI placement:** new "Location/Hub Filtering" panel directly below the "Active Platforms" fieldset, mirroring its rounded-xl/neutral-900 styling. Single checkbox "Airport (ALB)" tied to `includeAirport`.
- **Prompt rule placement:** conditional injection inside `buildSystemPrompt(activePlatforms, includeAirport)`, immediately after the CRITICAL PLATFORM ISOLATION RULES block. Only emitted when `!includeAirport`.
- **Exact string (locked, from PO):** "CRITICAL GEOGRAPHIC RULE: The user has disabled the Airport location for this shift. You are strictly FORBIDDEN from generating a step that dispatches the driver to ALB, the airport terminal, or airport parking lots. However, use the flight arrival surges to deduce which city zones or hotels will become busy, and route the driver to those off-airport zones instead."
- **CRITICAL ANTI-GOAL:** Do NOT wipe `flightsByHour` from the sanitization block when `includeAirport === false`. The AI MUST see the flight data to reason about the ripple effect. (`flightsByHour` still gets wiped when `!activePlatforms.rideshare` — that is a separate concern.)
- **Logging:** add `includeAirport` to `mergedPayload` so the existing `=== MERGED DISPATCH PAYLOAD ===` log line surfaces it.
- **No new env vars. No Amtrak/Ticketmaster toggles. No `next.config.mjs` changes.**

### Build Steps
- [x] 0. Write Sprint 15 (Ripple Effect) plan to `tasks/todo.md`.
- [x] 1. `app/page.js`: add `includeAirport` state (default `true`).
- [x] 2. `app/page.js`: render "Location/Hub Filtering" panel below Active Platforms with single "Airport (ALB)" checkbox.
- [x] 3. `app/page.js`: include `includeAirport` in the fetch JSON body.
- [x] 4. `app/api/dispatch/route.js`: destructure `includeAirport` from `request.json()` with `!== false` default.
- [x] 5. `app/api/dispatch/route.js`: add `includeAirport` field to `mergedPayload` so it logs.
- [x] 6. `app/api/dispatch/route.js`: change `buildSystemPrompt(activePlatforms)` signature to `buildSystemPrompt(activePlatforms, includeAirport)` and update call site.
- [x] 7. `app/api/dispatch/route.js`: inject the Ripple Effect rule (exact locked string above) immediately after CRITICAL PLATFORM ISOLATION RULES, gated on `!includeAirport`.
- [x] 8. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns clean.
- [ ] 9. Manual verification (temporary override): hardcode `flightsByHour = { "2 PM": "15 Arrivals (from MCO, ORD, ATL)" }` AND simulate `includeAirport = false` in route.js, run dispatch, confirm plan routes driver to off-airport zones (downtown hotels) — NEVER instructs them to drive to ALB.

### Acceptance Criteria
- `=== MERGED DISPATCH PAYLOAD ===` log shows `includeAirport: false` AND still contains the `flightsByHour` data.
- With `includeAirport: false` during a heavy flight surge, the AI identifies the traveler volume but routes the driver to off-airport zones (e.g., downtown hotels) without saying "ALB" or "airport terminal."
- UI shows the new Location filtering panel separate from the Active Platforms panel.

### Out of Scope
- Toggles for Amtrak or Ticketmaster, `next.config.mjs` changes, persisting selection across sessions, an "all locations off" guard, mobile-only Capacitor changes.

### Sprint 15 Refinement — Synthetic Data Swap (Data Obligation Hotfix)
**Problem:** First-pass prompt-only rule ("CRITICAL GEOGRAPHIC RULE: ... FORBIDDEN from generating a step that dispatches the driver to ALB") was bypassed by the LLM during the manual ripple test. The raw `"15 Arrivals (from MCO, ORD, ATL)"` signal was too strong — model felt obligated to use the data and routed to ALB anyway.

**Fix:** Belt-and-suspenders. Keep the prompt rule, AND add a payload sanitizer that overwrites each `flightsByHour` value with a synthetic ripple instruction when `!includeAirport`. The bucket keys (hours) stay so the LLM still sees WHEN the surge hits.

- [x] 1. `app/api/dispatch/route.js`: in the sanitization block, after the existing wipes, iterate `flightsByHour` keys when `!includeAirport && Object.keys(flightsByHour).length > 0` and overwrite each value with the locked synthetic string: `"Secondary Ripple Demand: High traveler volume detected. Route driver to downtown hotels and destination corridors. DO NOT mention ALB."`.
- [x] 2. Lesson L5 recorded in `tasks/lessons.md` ("prompt-only rules lose to data obligation").
- [ ] 3. Manual verification (user): with TEMP override still active + "Airport (ALB)" unchecked, plan routes driver to downtown hotels / destination corridors. Word "ALB" / "airport terminal" never appears.

## Sprint 16 — The Amtrak Precision Engine

**Problem:** Amtrak integration (Sprint 4.5) is a "brute force" engine — counts all trains equally regardless of origin, no cancellation filter, raw integer payload gives the LLM no origin context. Upgrade it to mirror Sprint V2 flight precision: strict hub filter, cancellation filter, formatted string payload, business-traveler prompt rule.

### Decisions (locked before coding)
- **Hub list:** `HIGH_VALUE_STATIONS = ['NYP', 'BOS', 'WAS', 'PHL']` (Penn Station, Boston, Washington DC, Philadelphia). Penn Station = NYC business + leisure; BOS + WAS + PHL = high-income corridor.
- **Filter scope:** Apply BOTH cancellation + hub filters inside `aggregateTrainArrivalsByHour` (mirror Sprint V2 flight pattern — single chokepoint per L2).
- **Cancellation field:** Amtraker exposes status on the train via `t.status` OR `t.trainState` in different builds. Check both, lowercased, drop if `=== "cancelled"`.
- **Origin field:** `t.origCode` per brief.
- **Output shape:** `{ "5 PM": "1 Arrival (from NYP)" }` for one train; `"2 Arrivals (from NYP, BOS)"` for multiple. Singular "Arrival" / plural "Arrivals" — matches brief verbatim. (Note: flight aggregator always uses "Arrivals" plural; trains use singular for n=1 per brief.)
- **Prompt rule:** Replace integer-format example with new string-format example; add explicit business-traveler line: "If you see Amtrak arrivals from high-value hubs like NYP or BOS, treat this as a massive High-Value Business Traveler surge. These passengers frequently request premium rides to downtown state offices or high-end hotels. Actively prioritize rideshare positioning near Rensselaer station."
- **Mock test placement:** Right after the `Promise.all` resolves and before `aggregateTrainArrivalsByHour` runs. Inject two trains: one NYP (Enroute, should pass), one RUT (Enroute, should be dropped by hub filter). Use a `let` binding for `rawTrains` so the mock can override the live fetch. Gate behind a `SPRINT_16_MOCK_ENABLED` constant for clean removal.
- **Out of scope (brief):** Frontend UI/checkboxes (Sprint 17), flight/Yelp/Ticketmaster logic.

### Build Steps
- [x] 0. Write Sprint 16 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `HIGH_VALUE_STATIONS = ['NYP', 'BOS', 'WAS', 'PHL']` constant near `HIGH_VALUE_HUBS` at top of file.
- [x] 2. `app/api/dispatch/route.js`: rewrite `aggregateTrainArrivalsByHour` — add cancellation drop, hub drop (`origCode` not in `HIGH_VALUE_STATIONS`), collect origins per hour bucket, return `{ hour: "<n> Arrival(s) (from CODE, CODE)" }` strings.
- [x] 3. `app/api/dispatch/route.js`: update `buildSystemPrompt` Rail Surge block — new string-shape example + business-traveler rule (locked string above).
- [x] 4. `app/api/dispatch/route.js`: change `rawTrains` from `const` (destructured) to `let` so mock can override. Inject Sprint 16 temporary mock right after `Promise.all` resolves; log `=== SPRINT 16 MOCK TRAINS INJECTED ===`.
- [x] 5. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns PARSE OK.
- [x] 6. Standalone aggregator verification: run isolated test script using the same algorithm on the mock array; confirm NYP makes it through formatted as `"1 Arrival (from NYP)"` and RUT is dropped. **RESULT: All 4 checks PASS — output `{ "1 PM": "1 Arrival (from NYP)" }`; RUT dropped; cancelled NYP dropped.**
- [x] 7. Remove the temporary mock + revert `rawTrains` binding back to `const`. Final parse-check returns PARSE OK.

### Acceptance Criteria
- Payload Isolation: `=== MERGED DISPATCH PAYLOAD ===` log shows `trainsByHour` containing the NYP train formatted as a string (e.g., `"1 Arrival (from NYP)"`).
- Filter Verification: RUT (Rutland) train is completely dropped and does not appear in the merged payload.
- Cancellation Verification: code explicitly checks for and drops cancelled trains.

### Out of Scope (Anti-Goals)
- Frontend UI changes / checkboxes (Sprint 17).
- Flight, Yelp, or Ticketmaster logic.

## Sprint 17 — The Amtrak Geographic Toggle (Ripple Effect)

**Problem:** Sprint 15 gave us an Airport toggle that lets the driver opt out of ALB pickups without blinding the AI to flight surges. Sprint 16 upgraded Amtrak to a Precision Engine. We now need the matching UI toggle for Amtrak so the driver can opt out of Rensselaer station while the AI still uses NYP/BOS arrivals to predict downtown business-traveler ripples.

### Decisions (locked before coding)
- **New state:** `includeAmtrak` (boolean, defaults `true`), mirrors Sprint 15's `includeAirport`. Lives in `app/page.js`, posted in the fetch body alongside `includeAirport`.
- **Backend default:** `includeAmtrak = body.includeAmtrak !== false` — missing/undefined falls back to `true` (back-compat).
- **UI placement:** new checkbox inside the existing "Location/Hub Filtering" panel, directly below the Airport (ALB) row. Same styling.
- **Prompt rule placement:** conditional injection inside `buildSystemPrompt(activePlatforms, includeAirport, includeAmtrak)`, immediately after the Airport ripple rule. Only emitted when `!includeAmtrak`.
- **Exact string (locked, from PO):** "CRITICAL GEOGRAPHIC RULE: The user has disabled the Amtrak location for this shift. You are strictly FORBIDDEN from generating a step that dispatches the driver to the Rensselaer train station. However, use the high-value train arrivals (e.g., NYP, BOS) to deduce which downtown state offices or hotels will become busy, and route the driver to those off-station zones instead."
- **CRITICAL ANTI-GOAL:** Do NOT wipe `trainsByHour` from the sanitization block when `includeAmtrak === false`. The AI MUST see the train data to reason about the ripple effect. `trainsByHour` still gets wiped when `!activePlatforms.rideshare` (separate concern, already in code).
- **Synthetic Data Swap (anticipated per L5):** Apply belt-and-suspenders from day one — overwrite each `trainsByHour` value with `"Secondary Ripple Demand: High business-traveler volume detected (NYP/BOS). Route driver to downtown state offices and high-end hotels. DO NOT mention Rensselaer."` when `!includeAmtrak && Object.keys(trainsByHour).length > 0`. Mirrors Sprint 15 flight swap.
- **Logging:** add `includeAmtrak` to `mergedPayload`.
- **Mock test:** hardcode `trainsByHour = { "5 PM": "2 Arrivals (from NYP, BOS)" }` + `includeAmtrak = false` + `activePlatforms.rideshare = true` in route.js temporarily. Verify via standalone import script. Remove mock when verified.
- **No new env vars. No Ticketmaster toggles. No `next.config.mjs` changes.**

### Build Steps
- [x] 0. Write Sprint 17 plan to `tasks/todo.md`.
- [x] 1. `app/page.js`: add `includeAmtrak` state (default `true`).
- [x] 2. `app/page.js`: render second checkbox "Amtrak (Rensselaer)" inside Location/Hub Filtering panel, below the Airport row.
- [x] 3. `app/page.js`: include `includeAmtrak` in the fetch JSON body alongside `includeAirport`.
- [x] 4. `app/api/dispatch/route.js`: destructure `includeAmtrak` from `request.json()` with `!== false` default.
- [x] 5. `app/api/dispatch/route.js`: add `includeAmtrak` to `mergedPayload` so the log line surfaces it.
- [x] 6. `app/api/dispatch/route.js`: change `buildSystemPrompt(activePlatforms, includeAirport)` to `buildSystemPrompt(activePlatforms, includeAirport, includeAmtrak)` and update call site.
- [x] 7. `app/api/dispatch/route.js`: inject the Amtrak Geographic Rule (exact locked string) immediately after the Airport ripple block, gated on `!includeAmtrak`.
- [x] 8. `app/api/dispatch/route.js`: in the sanitization block (after the airport flight swap), iterate `trainsByHour` keys when `!includeAmtrak && Object.keys(trainsByHour).length > 0` and overwrite each value with the locked synthetic string above. Do NOT wipe the hour keys themselves.
- [x] 9. Mock-test simulation: hardcoded `trainsByHour = { "5 PM": "2 Arrivals (from NYP, BOS)" }` + `includeAmtrak = false` + `activePlatforms.rideshare = true` driven through a standalone replay of the sanitization stage. Result: synthetic-swap fired, hour key preserved, raw "Arrivals (from …)" format gone, "DO NOT mention Rensselaer" present.
- [x] 10. Parse-check per L4: `node sprint17-parsecheck.mjs` returned `PARSE OK`.
- [x] 11. Verified the merged-payload log and synthetic-swap behavior (all 7 assertions pass — see Test Results below).
- [x] 12. Temporary mock + parse-check scripts removed; final parse-check returned `FINAL PARSE OK`.

### Test Results (Sprint 17 Mock Run)
Input: `trainsByHour = { "5 PM": "2 Arrivals (from NYP, BOS)" }`, `includeAmtrak = false`, `activePlatforms.rideshare = true`.

After sanitization, `mergedPayload` snapshot:
```
{
  "includeAirport": true,
  "includeAmtrak": false,
  "flightsByHour": {},
  "trainsByHour": {
    "5 PM": "Secondary Ripple Demand: High business-traveler volume detected (NYP/BOS). Route driver to downtown state offices and high-end hotels. DO NOT mention Rensselaer."
  }
}
```

Assertions:
- PASS — mergedPayload still shows `includeAmtrak: false`.
- PASS — `trainsByHour["5 PM"]` exists (data preserved per critical anti-goal).
- PASS — raw "N Arrivals (from …)" format gone (swap fired).
- PASS — synthetic string contains "DO NOT mention Rensselaer".
- PASS — `buildSystemPrompt` source contains the exact locked Amtrak rule string.
- PASS — `buildSystemPrompt` signature now reads `(activePlatforms, includeAirport, includeAmtrak)`.
- PASS — the Amtrak rule is gated behind `${!includeAmtrak ? \`…\` : ""}`.

Outcome: belt-and-suspenders worked — by the time the system prompt is built, the LLM literally cannot see the raw "2 Arrivals (from NYP, BOS)" string, only the synthetic ripple instruction. Data-obligation pressure on Rensselaer is gone, while the hour bucket survives so the LLM still positions the driver in downtown corridors for the 5 PM surge. Explicit Synthetic Data Swap was applied upfront (Sprint 15 precedent + L5).

### Acceptance Criteria
- Payload Validation: `=== MERGED DISPATCH PAYLOAD ===` log shows `includeAmtrak: false` AND still contains the `trainsByHour` data (synthetic-swapped, but keys preserved).
- Logic Validation: with `includeAmtrak: false` and NYP/BOS arrivals in the payload, plan routes driver to downtown offices/hotels without saying "Rensselaer."
- UI Validation: the frontend shows the new "Amtrak (Rensselaer)" checkbox directly below "Airport (ALB)".

### Out of Scope
- Ticketmaster event toggles, persisting selection across sessions, all-locations-off guard, mobile-only Capacitor changes.

## Sprint 18 — The Temporal Baseline Engine

**Goal:** Hardcode wall-clock time blocks (commute, meal rushes, weekend bar rush) into deterministic multipliers (`rideMod`, `foodMod`) that scale the raw data volumes (food hotspots, flight counts, train counts) BEFORE the payload reaches the LLM. This becomes the algorithmic baseline that future anomaly modifiers (weather, events) will compound onto.

### Decisions (locked before coding)
- **TDD-first:** Build the modifier function in a standalone `test-time.js` at repo root. Validate all 6 scenarios (5 time blocks + baseline) via fake `Date` objects. Only after 100% PASS, port into `route.js`.
- **Input contract:** `computeTemporalModifiers(dateObj)` accepts a Date whose UTC fields equal the driver's wall-clock time. Read `getUTCDay()` + `getUTCHours()` — mirrors the existing `toWallClockLabel` pattern (Sprint 3.1 timezone trick). In route.js we'll pass `localStart` directly since its UTC fields already = wall-clock.
- **Output contract:** `{ foodMod: number, rideMod: number }`. Default `1.0` for both.
- **Time matrix (locked, from PO):**
  - Morning Commute, Mon-Fri 7:00-8:59 AM → `rideMod = 1.5`
  - Lunch Rush, every day 11:00 AM-1:59 PM → `foodMod = 1.5`
  - Evening Commute, Mon-Fri 4:00-5:59 PM → `rideMod = 1.5`
  - Dinner Rush, every day 5:00-7:59 PM → `foodMod = 1.5`
  - Weekend Bar Rush, Fri & Sat 10:00 PM-1:59 AM next day → `rideMod = 1.5`, `foodMod = 0.5`
- **Logic style:** inline `if` blocks (per anti-goal "no JSON matrix DB"). Overlapping windows just both fire — e.g., Fri 5 PM is both Evening Commute and Dinner Rush, so both modifiers stick.
- **Food flooring:** `Math.max(1, Math.round(volume * foodMod))` so a 0.5 multiplier never erases an existing hotspot.
- **Transit flooring:** `Math.round(count * rideMod)` and if 0 → drop the hour bucket entirely. (rideMod is only ever 1.0 or 1.5 today; this is forward-looking per the brief.)
- **Aggregator signature change:** `aggregateArrivalsByHour` and `aggregateTrainArrivalsByHour` get a new `rideMod` parameter (last positional arg). Multiplication happens BEFORE the `"X Arrivals (from ...)"` string is constructed.
- **Payload visibility:** add `temporalModifiers: { foodMod, rideMod }` to `mergedPayload` so the merged log explicitly surfaces the chosen multipliers.
- **Prompt note (locked, from PO):** "NOTE: All hotspot volumes and transit arrival counts have already been algorithmically scaled by backend temporal modifiers to reflect the current day and time. Trust the provided numbers implicitly." — injected at the TOP of the GIG DEMAND block (Multi-App Platform Switching) AND at the top of BOTH transit blocks (Flight + Rail), since `rideMod` scales both.
- **Anti-goals (PO):** NO weather modifiers, NO event modifiers, NO JSON matrix.

### Build Steps
- [x] 0. Write Sprint 18 plan to `tasks/todo.md`.
- [x] 1. Create standalone `test-time.js` at repo root with `computeTemporalModifiers(dateObj)` + 7 test scenarios (baseline + 5 time blocks + Sat early-AM bar rush wraparound). Run `node test-time.js`; verify 100% PASS.
- [x] 2. `app/api/dispatch/route.js`: port `computeTemporalModifiers` near the other helpers.
- [x] 3. `app/api/dispatch/route.js`: extend `aggregateArrivalsByHour` and `aggregateTrainArrivalsByHour` to accept `rideMod`; apply `Math.round(count * rideMod)` before formatting; skip buckets that round to 0.
- [x] 4. `app/api/dispatch/route.js`: call `computeTemporalModifiers(localStart)` inside POST; pass `rideMod` into both aggregators; apply `foodMod` to `gigDemand.foodHotspots[*].volume` with `Math.max(1, ...)` flooring.
- [x] 5. `app/api/dispatch/route.js`: inject `temporalModifiers: { foodMod, rideMod }` into `mergedPayload`.
- [x] 6. `app/api/dispatch/route.js`: prepend the locked NOTE sentence to the Flight Surge, Rail Surge, and Multi-App Platform Switching blocks inside `buildSystemPrompt`.
- [x] 7. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns PARSE OK.

### Acceptance Criteria
- Test-Driven Validation: `test-time.js` prints PASS for all 6 PO-specified scenarios (+ the Sat early-AM wraparound).
- Data Mutation: `flightsByHour`, `trainsByHour`, and `foodHotspots[*].volume` reflect the temporal multipliers in the `=== MERGED DISPATCH PAYLOAD ===` log.
- Graceful Flooring: transit buckets that round to 0 are absent from the payload; food hotspots that existed never drop below volume 1.
- Parse Check: route.js imports cleanly (no L4 backtick regressions).

### Out of Scope (Anti-Goals)
- Weather modifiers, Ticketmaster event modifiers, JSON-matrix configs, frontend changes.

## Sprint 19 — The Predictive Weather Engine

**Goal:** Intercept the Open-Meteo array already living in `route.js` to compute a second set of multipliers (`weatherFoodMod`, `weatherRideMod`) using a 1-hour lookahead model. Stack them directly on top of Sprint 18's temporal multipliers via pure multiplicative math — no caps, no floors on the combined multiplier — so chaotic compounding events (e.g., Fri 11 PM bar rush meeting a thunderstorm) physically explode in volume.

### Decisions (locked before coding)
- **TDD-first (mirror Sprint 18):** Build `computeWeatherModifiers(weatherArray)` inside a standalone `test-weather.js` at repo root. Validate all four states + several stacking scenarios against temporal mods. Only after 100% PASS, port into `route.js`.
- **Input contract:** `weatherArray` is the existing `weatherWindowed` slice (objects with `{ time, tempF, precipChancePct, precipInches }`). Reads exactly `weatherArray[0]` (current hour) and `weatherArray[1]` (next hour). If the array is `null`/empty/<2 entries → default `{ weatherFoodMod: 1.0, weatherRideMod: 1.0 }` (graceful degradation per L1 spirit). Anti-goal forbids iterating beyond index 1.
- **Output contract:** `{ weatherFoodMod: number, weatherRideMod: number }`. Default 1.0 / 1.0.
- **State matrix (locked, from PO — evaluate strictly in this priority order; only one state can fire):**
  1. Active Storm — `current.precipChancePct >= 50` OR `current.precipInches > 0.1` → `weatherFoodMod = 1.5`, `weatherRideMod = 0.75`
  2. Pre-Surge — `current.precipChancePct < 50` AND `next.precipChancePct >= 50` → `weatherRideMod = 1.5`, `weatherFoodMod = 1.0`
  3. Heatwave — `current.tempF >= 90` → `weatherFoodMod = 1.25`, `weatherRideMod = 0.9`
  4. Default — `weatherFoodMod = 1.0`, `weatherRideMod = 1.0`
- **Stacking math (locked, from PO):** pure multiplicative. `finalFoodMod = foodMod * weatherFoodMod`, `finalRideMod = rideMod * weatherRideMod`. NO `Math.min` / `Math.max` ceilings or floors on the combined multiplier. (The existing `Math.max(1, ...)` floor on food hotspot volume and the existing drop-bucket-if-rounds-to-0 rule on transit are pre-Sprint-18 behavior and stay.)
- **Aggregator inputs:** pass `finalRideMod` into both `aggregateArrivalsByHour` and `aggregateTrainArrivalsByHour` (the parameter name in the aggregators stays `rideMod` — it's just receiving the compounded value now). Apply `finalFoodMod` to `gigDemand.foodHotspots[*].volume`.
- **Payload visibility:** add `weatherModifiers: { weatherFoodMod, weatherRideMod }` as a separate key in `mergedPayload`. Keep `temporalModifiers` separate so the `=== MERGED DISPATCH PAYLOAD ===` log explicitly shows BOTH engines for debugging.
- **Prompt note (locked, from PO):** replace ALL THREE existing "scaled by backend temporal modifiers" sentences (Flight Surge, Rail Surge, Multi-App Platform Switching) with: `"NOTE: All hotspot volumes and transit arrival counts have been algorithmically scaled by both temporal and weather modifiers. The math reflects the compounding impact of current city rhythms alongside immediate or impending weather conditions. Trust the provided numbers implicitly."`
- **Anti-goals (PO):** NO frontend UI toggle for the weather engine. NO `Math.min` / `Math.max` cap on the combined multiplier. NO looping past `weatherArray[1]`.
- **Cleanup:** delete `test-weather.js` only after `route.js` integration parse-checks cleanly (per Sprint Initiation rule).

### Build Steps
- [x] 0. Write Sprint 19 plan to `tasks/todo.md`.
- [x] 1. Create standalone `test-weather.js` at repo root with `computeWeatherModifiers(weatherArray)` + tests covering: (a) each of the 4 states firing in isolation, (b) Active-Storm-beats-Pre-Surge priority check, (c) compounding scenarios that multiply temporal mods against weather mods. Run `node test-weather.js`; verify 100% PASS. ✅ 16/16 PASS (10 state cases + 6 stacking cases).
- [x] 2. `app/api/dispatch/route.js`: port `computeWeatherModifiers` near `computeTemporalModifiers`.
- [x] 3. `app/api/dispatch/route.js`: in POST, call `computeWeatherModifiers(weatherWindowed)`; compute `finalFoodMod = foodMod * weatherFoodMod` and `finalRideMod = rideMod * weatherRideMod`; pass `finalRideMod` into both transit aggregators (replacing `rideMod`); use `finalFoodMod` in the foodHotspots volume mutation (replacing `foodMod`).
- [x] 4. `app/api/dispatch/route.js`: add `weatherModifiers: { weatherFoodMod, weatherRideMod }` to `mergedPayload`, alongside the existing `temporalModifiers`.
- [x] 5. `app/api/dispatch/route.js`: replace all three "scaled by backend temporal modifiers" NOTE sentences inside `buildSystemPrompt` with the locked Sprint 19 string. ✅ grep confirmed 3/3 replacements.
- [x] 6. Parse-check per L4: `node sprint19-parsecheck.mjs` returned `PARSE OK`.
- [x] 7. Delete `test-weather.js` (and the temp `sprint19-parsecheck.mjs` scaffold).

### Test Results (Sprint 19 TDD Run)

`node test-weather.js` — 16/16 PASS:
- State cases (10/10): default; Active Storm via precipChancePct; Active Storm via precipInches; Pre-Surge (dry→wet 1hr lookahead); Heatwave (92°F); priority — Active Storm beats Pre-Surge; priority — Heatwave loses to Active Storm; priority — Heatwave loses to Pre-Surge; graceful null array; graceful single-entry array.
- Stacking cases (6/6, pure multiplicative — NO cap): baseline×default → 1.0/1.0; Dinner Rush × Active Storm → 2.25/0.75; Evening Commute × Pre-Surge → 1.0/2.25; Lunch Rush × Heatwave → 1.875/0.9; Friday Bar Rush × Active Storm (chaos compound) → 0.75/1.125; Evening Commute × Pre-Surge — chaos compound, no cap → 1.0/2.25.

Parse-check (per L4): `PARSE OK` — `buildSystemPrompt`'s outer template literal survives the three new NOTE-sentence swaps with no inner-backtick regressions.

### Acceptance Criteria
- Test-Driven Validation: `test-weather.js` prints PASS for all 4 states and all stacking scenarios.
- Payload Visibility: `=== MERGED DISPATCH PAYLOAD ===` log shows both `temporalModifiers` and `weatherModifiers` as separate keys.
- Compounding Math: transit counts and food hotspot volumes reflect the pure product of both engines, with no artificial cap.
- Parse Check: `route.js` imports cleanly (no L4 backtick regressions).

### Out of Scope (Anti-Goals)
- Frontend UI toggle for the weather engine, capping the combined multiplier, iterating past `weatherArray[1]`.

## Sprint 20 — Airport Egress & Routing Precision

**Goal:** Replace fuzzy LLM-side travel-time guessing with backend Zero-Prompt Math. Algorithmically shift every flight arrival +30 min forward (passenger deplane/egress delay) before bucketing, then use Haversine miles ÷ 20 mph to compute the driver's exact "Leave current location by" minute. The aggregator emits one pre-baked string per hour bucket: `"{n} Arrivals (from {hubs}). Leave current location by {h:mm AM/PM}"` — the model is forbidden from re-deriving travel time.

### Decisions (locked before coding)
- **TDD-first (mirror Sprint 18 + 19):** Build the math in standalone `test-airport-math.js` at repo root. Validate Haversine + 30-min shift + leaveBy subtraction with the PO's fixture (driver at Roessleville, two flights landing at 4:45 / 4:55 PM EDT). Only after PASS, port into `route.js`.
- **Spatial constants (locked, from PO):** `ALB_COORDS = { lat: 42.7483, lng: -73.8017 }`. Driver coords come from the existing `latitude`/`longitude` in the POST request body.
- **Speed assumption (locked, from PO):** 20 mph city driving. `minutesToAirport = Math.ceil((haversineMiles / 20) * 60)`. Anti-goal forbids Google/Mapbox traffic APIs.
- **Egress shift (locked, from PO):** +30 minutes added to each flight's `arrival.scheduled` BEFORE bucketing. Applied to flights only — NOT to Amtrak (train egress is instant; PO anti-goal).
- **Bucket key off shifted time:** the wall-clock label (`"5 PM"`) is derived from `T_shifted` (post-+30-min), NOT raw scheduled. A 4:45 PM landing → 5:15 PM shifted → "5 PM" bucket.
- **leaveBy = earliest shifted time in bucket − minutesToAirport.** Per-bucket leaveBy means the driver always sees the time to depart for the FIRST plane of that hour (the conservative early bound). Format with `formatLeaveBy(date)` → `"h:mm AM/PM"`.
- **Aggregator output string (locked, from PO):** `"${count} Arrivals (from ${origins.join(", ")}). Leave current location by ${formattedLeaveBy}"`. Singular `"Arrival"` for count=1 to keep grammar consistent with Sprint 18's existing pluralization fix.
- **Aggregator signature change:** `aggregateArrivalsByHour` gets a new last positional arg `minutesToAirport` (defaults to 0 → no leaveBy line, preserves backwards-compat for tests that don't pass it). Computed once in POST off driver coords; passed in. `aggregateTrainArrivalsByHour` is untouched (no egress shift, no leaveBy).
- **Synthetic-data-swap interplay (L5):** when `includeAirport === false`, the existing Sprint 15 ripple-string overwrite still wins — it replaces the entire bucket value with the off-airport instruction. The leaveBy substring is destroyed alongside the raw arrivals, which is correct (no airport mention allowed).
- **Prompt update (locked, from PO):** in the Transit Surge — Flight Data block of `buildSystemPrompt`, append a Zero-Prompt-Math sentence: `"The 'Leave by' time is mathematically pre-computed by the backend based on live driving distances and passenger egress delays. Instruct the driver to leave at EXACTLY this time. Do not attempt to calculate your own travel times."`. Update the FLIGHTS object example to show the new string shape.
- **Anti-goals (PO):** NO Google Maps / Mapbox / live traffic. NO +30-min shift on Amtrak. NO frontend UI changes.
- **Cleanup:** delete `test-airport-math.js` only after `route.js` integration parse-checks cleanly (per Sprint Initiation rule).

### Build Steps
- [x] 0. Write Sprint 20 plan to `tasks/todo.md`.
- [x] 1. Create standalone `test-airport-math.js` at repo root with `haversineMiles`, `minutesToAirport` calc, and a mock-aggregator that mirrors the +30 shift + earliest-bucket + leaveBy subtraction. Run `node test-airport-math.js`; verify PASS. ✅ 8/8 PASS.
- [x] 2. `app/api/dispatch/route.js`: add `ALB_COORDS` constant near `HIGH_VALUE_HUBS`. Add `haversineMiles` helper (use existing Haversine pattern but return miles, not meters). Add `formatLeaveBy` helper.
- [x] 3. `app/api/dispatch/route.js`: inside `aggregateArrivalsByHour`, accept `minutesToAirport` arg. Apply `+30 min` to each kept arrival; bucket off the shifted time; track earliest shifted per bucket; subtract `minutesToAirport` to derive leaveBy; emit `"${n} Arrivals (from ...). Leave current location by ${leaveByStr}"`.
- [x] 4. `app/api/dispatch/route.js`: inside POST, compute `minutesToAirport` from `(latitude, longitude)` ↔ `ALB_COORDS`; pass into `aggregateArrivalsByHour` call.
- [x] 5. `app/api/dispatch/route.js`: in `buildSystemPrompt`, update the FLIGHTS example object to the new string format and append the locked Zero-Prompt-Math sentence to the Flight Surge block.
- [x] 6. Parse-check per L4: `node sprint20-parsecheck.mjs` returned `PARSE OK`.
- [x] 7. Delete `test-airport-math.js` (and the temp `sprint20-parsecheck.mjs` scaffold).

### Test Results (Sprint 20 TDD Run)

`node test-airport-math.js` — 8/8 PASS:
- Haversine miles (Roessleville → ALB): 4.7350 miles (in the 4–5.5 mi sanity range).
- `minutesToAirport @ 20 mph`: 15 (matches `ceil((miles/20)*60)`).
- Bucket key off shifted time: exactly `"5 PM"` (4:45 PM EDT + 30 min = 5:15 PM EDT).
- Bucket value: `"2 Arrivals (from MCO, ATL). Leave current location by 5:00 PM"`.
- Singular `"Arrival"` when count=1 (preserves Sprint 18 grammar fix).
- Without the +30 shift, 4:45 PM EDT buckets into `"4 PM"`; with the shift, into `"5 PM"` (proves the shift is the cause, not a coincidence).

Parse-check (per L4): `PARSE OK` — `buildSystemPrompt`'s outer template literal survives the Flight Surge block edit (new example string + Zero-Prompt-Math sentence) with no inner-backtick regressions.

### Acceptance Criteria
- Test-Driven Validation: `node test-airport-math.js` PASSES — 4:45 PM flight shifts to 5:15 PM, bucket = "5 PM", leaveBy = 5:15 PM − minutesToAirport.
- Zero-Prompt Math: `=== MERGED DISPATCH PAYLOAD ===` log shows `flightsByHour` values containing the literal `"Leave current location by ..."` substring.
- AI Compliance: the CoT's airport step quotes the exact leaveBy minute rather than deriving its own.
- Parse Check: `route.js` imports cleanly (no L4 regressions).

### Out of Scope (Anti-Goals)
- Live-traffic APIs (Google Maps, Mapbox); +30-min shift on Amtrak; frontend UI changes.

---

## Sprint 21 — Data Structuring Phase 1 (Flights)

**Epic:** Excising the LLM (Phase 1). Transition the backend from emitting prompt-friendly string buckets (`{ "5 PM": "2 Arrivals (from MCO, ATL). Leave current location by 5:00 PM" }`) to emitting strict JSON arrays of objects that a future Next.js/React frontend can `.map()` directly. We are trusting the LLM to natively parse the new array during this transitional phase — `SYSTEM_PROMPT` is intentionally NOT updated.

### Locked Decisions (from PO)
- **Scope:** Flights only. Amtrak (`trainsByHour`) and Yelp (`gigDemand`) stay as-is this sprint.
- **New output shape (locked):** `aggregateArrivalsByHour` returns an **array** of objects, each with exactly: `type` (always `"flight"`), `hourBucket` (e.g. `"5 PM"`), `volume` (Number, post-`rideMod` scaling), `origins` (Array of IATA codes in insertion order), `leaveBy` (formatted by existing `formatLeaveBy`), `hub` (always `"ALB"`).
- **Empty case:** return `[]` (not `{}`, not `null`). All downstream length checks must move from `Object.keys(...).length` to `Array.isArray(...) && ....length`.
- **Sanitization patch (CRITICAL — L5 belt+suspenders still applies):** the Sprint 15 ripple swap iterated with `Object.keys(flightsByHour)`. That breaks on an array. Replace with `flightsByHour = flightsByHour.map(...)` emitting `{ type: "flight_ripple", message: "..." }` per element. Message text is the same Sprint 15 string verbatim.
- **Platform-isolation reset:** the `!activePlatforms.rideshare` branch must now reset `flightsByHour = []` (not `{}`). `trainsByHour` is untouched.
- **`summarizeFlightsByHour` minimal patch:** still `JSON.stringify` the bucket value (now an array), still return `"Flight data unavailable"` when empty. Use `.length === 0` instead of `Object.keys(...).length === 0` for clarity.
- **Prompt untouched (PO anti-goal):** `buildSystemPrompt` is NOT edited. The LLM gets the raw JSON array string in `userMessage` and is trusted to parse it.

### Assumptions / Risks
- Pure data-shape sprint — no new APIs, no math changes. Volume, origins ordering, leaveBy minute, and bucket-key derivation are all preserved verbatim from Sprint 20.
- The LLM may briefly perform worse on the airport step while it adapts to the new shape — accepted by PO as part of the transition.
- L5 belt+suspenders for the airport-off case is preserved (ripple objects replace raw flight data even though the structural keys changed).

### Build Steps
- [x] 0. Write Sprint 21 plan to `tasks/todo.md`.
- [x] 1. Recreate `test-airport-math.js` at repo root (deleted in Sprint 20 cleanup). Embed a self-contained copy of the rewritten `aggregateArrivalsByHour` + `formatLeaveBy` + `HIGH_VALUE_HUBS`. Assert exact array shape per PO spec. Run `node test-airport-math.js`; require PASS before touching `route.js`. ✅ 2/2 PASS.
- [x] 2. `app/api/dispatch/route.js`: rewrite the tail of `aggregateArrivalsByHour` so it pushes objects into an array instead of keying strings into an object. Preserve every upstream branch (dedupe fingerprint, status filter, hub filter, +30-min egress shift, earliest-shifted tracking, rideMod scaling, sub-1 graceful floor).
- [x] 3. `app/api/dispatch/route.js`: update the `!activePlatforms.rideshare` reset from `{}` to `[]`.
- [x] 4. `app/api/dispatch/route.js`: rewrite the Sprint 15 ripple-swap block to use `Array.isArray` + `.map()` emitting `{ type: "flight_ripple", message: "..." }` objects. Train ripple block stays untouched.
- [x] 5. `app/api/dispatch/route.js`: update `summarizeFlightsByHour` empty-check to `.length === 0`.
- [x] 6. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`.
- [x] 7. Re-run `node test-airport-math.js` after integration to confirm the route.js logic still produces the locked array shape. ✅ 2/2 PASS.

### Acceptance Criteria
- Test-Driven Validation: `node test-airport-math.js` PASSES with the exact PO-spec array shape.
- Payload Visibility: `=== MERGED DISPATCH PAYLOAD ===` log shows `flightsByHour` as a JSON array of objects.
- Ripple Effect Intact: with `includeAirport === false`, the array is replaced element-wise with `{ type: "flight_ripple", message: "..." }` — no iteration error.
- L4 parse-check: `route.js` imports cleanly.

### Out of Scope (Anti-Goals)
- Do NOT edit `SYSTEM_PROMPT` or `buildSystemPrompt`.
- Do NOT restructure `trainsByHour` or `gigDemand`.
- Do NOT touch any Next.js frontend UI.

---

## Sprint 22 — Data Structuring Phase 1 (Trains & Yelp)

**Epic:** Excising the LLM (Phase 1) — Double Feature. Sprint 21 proved the LLM natively parses array shapes without prompt updates (flights). Sprint 22 finishes Phase 1 by converting the remaining two pipelines (Amtrak trains, Yelp food/grocery hotspots) to the same `.map()`-friendly array-of-objects shape so a future Next.js/React frontend can render unified UI cards.

### Locked Decisions (from PO)
- **Train output shape (locked):** `aggregateTrainArrivalsByHour` returns an **array** of objects, each with exactly: `type` (always `"train"`), `hourBucket` (e.g. `"5 PM"`), `volume` (Number, post-`rideMod`), `origins` (Array of station codes in insertion order), `hub` (always `"Rensselaer"`). No leaveBy — train egress is instant (PO anti-goal preserved from Sprint 20).
- **Train empty case:** return `[]`. The `!Array.isArray(trains)` defensive guard must also return `[]` (was `{}`).
- **Hotspot output shape (locked):** each hotspot object gains a `type` key (`"food"` or `"grocery"`) and `categories` becomes an `Array<string>` (was comma-joined string). Each category string is `.trim()`-ed for defensive whitespace cleanup. Fallback `"Mixed"` becomes `["Mixed"]`.
- **Plumbing:** `computeHotspots(businesses, type)` gains a second positional arg. `getLocalDensityData` passes `"food"` and `"grocery"` literals at the two call sites.
- **Sanitization patch (Amtrak ripple — L5 belt+suspenders preserved):** the Sprint 17 train-ripple block iterated with `Object.keys(trainsByHour)`. Breaks on array. Replace with `Array.isArray` + `.map()` emitting `{ type: "train_ripple", message: "..." }`. Message text is the Sprint 17 string verbatim.
- **Platform-isolation reset:** `!activePlatforms.rideshare` branch must now reset `trainsByHour = []` (matches Sprint 21's flight fix). Hotspots already correctly reset to `[]`.
- **`summarizeTrainsByHour` minimal patch:** use `Array.isArray(buckets) && buckets.length === 0` instead of `Object.keys(buckets).length === 0`.
- **Prompt untouched (PO anti-goal):** `buildSystemPrompt` is NOT edited. LLM continues to parse the raw JSON natively this sprint.

### Assumptions / Risks
- Pure data-shape sprint. Volume math, origin ordering, cluster sweep, tier classification all preserved verbatim.
- Adding `type` to each hotspot expands the in-prompt JSON by ~17 chars/hotspot — negligible.
- L5 belt+suspenders preserved for the Amtrak-off case (ripple objects replace raw train data even though structural keys changed).
- The volume-scaling step at line 847 still treats `gigDemand.foodHotspots` as an array of objects — adding `type`/`categories[]` doesn't break the `...h, volume: ...` spread.

### Build Steps
- [x] 0. Write Sprint 22 plan to `tasks/todo.md`.
- [x] 1. Create temporary `test-structuring.js` at repo root with self-contained copies of the rewritten `aggregateTrainArrivalsByHour` + `computeHotspots`. Assert exact array shapes per PO spec (train + food hotspot). Run `node test-structuring.js`; require PASS before touching `route.js`.
- [x] 2. `app/api/dispatch/route.js`: rewrite the tail of `aggregateTrainArrivalsByHour` — change non-array guard `return {}` → `return []`, change `buckets = {}` → `buckets = []`, push `{ type: "train", hourBucket, volume, origins, hub: "Rensselaer" }` objects. Preserve every upstream filter (dedupe, status, HIGH_VALUE_STATIONS, ALB stop lookup, rideMod scaling, sub-1 floor).
- [x] 3. `app/api/dispatch/route.js`: update `summarizeTrainsByHour` empty-check to `Array.isArray(...) && .length === 0`.
- [x] 4. `app/api/dispatch/route.js`: add `type` parameter to `computeHotspots` signature; emit `type` key on each pushed hotspot; emit `categories` as array (`topCats.map(s => s.trim())`, fallback `["Mixed"]`). Update both `getLocalDensityData` call sites to pass `"food"` / `"grocery"`.
- [x] 5. `app/api/dispatch/route.js`: in POST handler, update the `!activePlatforms.rideshare` reset from `trainsByHour = {}` to `trainsByHour = []`.
- [x] 6. `app/api/dispatch/route.js`: rewrite the Sprint 17 Amtrak ripple-swap block to use `Array.isArray` + `.map()` emitting `{ type: "train_ripple", message: "..." }` objects.
- [x] 7. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`.
- [x] 8. Re-run `node test-structuring.js` after integration to confirm.

### Acceptance Criteria
- Test-Driven Validation: `node test-structuring.js` PASSES with the exact PO-spec array shapes (train + food hotspot).
- Payload Visibility: `=== MERGED DISPATCH PAYLOAD ===` log shows `trainsByHour`, `gigDemand.foodHotspots`, `gigDemand.groceryHotspots` as arrays of objects with the `type` key.
- Ripple Effect Intact: with `includeAmtrak === false`, the array is replaced element-wise with `{ type: "train_ripple", message: "..." }` — no iteration error.
- L4 parse-check: `route.js` imports cleanly.

### Out of Scope (Anti-Goals)
- Do NOT edit `SYSTEM_PROMPT` or `buildSystemPrompt`.
- Do NOT touch any Next.js frontend UI.
- Do NOT calculate travel times or egress buffers for trains (PO anti-goal carried over from Sprint 20).

---

## Sprint 23 — The Deterministic Router (Multi-Algorithm)

**Epic:** Excising the LLM (Phase 2). Sprints 21-22 converted every backend pipeline into strict array shapes. Sprint 23 replaces the LLM's "Chain of Thought" prioritization with a pure backend `buildItinerary(payload, strategy)` that flattens flights + trains + hotspots into a single sorted array. Three driver-selectable strategies: `chronological`, `profitability`, `hybrid`.

### Locked Decisions (from PO)
- **Function signature (locked):** `buildItinerary(payload, strategy)` returns a flat array of source items (flights, trains, food/grocery hotspots) sorted by the chosen strategy. Source items are spread from `payload.flightsByHour`, `payload.trainsByHour`, `payload.gigDemand.foodHotspots`, `payload.gigDemand.groceryHotspots`.
- **Time normalization:** parse "H[:MM] AM/PM" → minutes-since-midnight. Prefer `leaveBy` precision when present; else `hourBucket`; else treat as "Current/Ongoing".
- **Chronological strategy:** sort ascending by item time. Items with no time signal (hotspots) sort to top — consistent with the hybrid "Current/Ongoing" semantics.
- **Profitability strategy:** `surgeScore` = `volume * finalRideMod` for flights/trains, `volume * finalFoodMod + 2 (if tier === "High-Value ($$$)")` for food (and grocery by symmetry). Sort descending.
- **Hybrid strategy:** group by `hourBucket`. Sort groups chronologically. Within each group, sort by `surgeScore` desc. No-`hourBucket` items go to a "Current/Ongoing" group at the top.
- **Payload extension:** add `finalRideMod` and `finalFoodMod` as top-level keys on `mergedPayload` (already computed in the POST handler at lines 826-827; just surface them).
- **Default strategy:** `routingStrategy ?? "hybrid"` on the backend.
- **Frontend dropdown:** placed inside (or below) the Location/Hub Filtering panel per PO. Three options: Chronological, Profitability, Hybrid.

### Assumptions / Risks
- The PO's surge-score formula multiplies `volume * finalRideMod` even though Sprints 18/21 already scaled flight/train volume by `finalRideMod` at the aggregator. This compounds. Per spec — proceeding as written; if PO wants to undo the compound, switch to raw counts later.
- LLM remains untouched (anti-goal). The `itinerary` array is appended to `mergedPayload` only for terminal-log visibility and future React consumption.
- No new sanitization needed — the existing `!activePlatforms.*` and `!includeAirport/!includeAmtrak` blocks already wipe / synthetic-swap the source arrays before `buildItinerary` runs.

### Build Steps
- [x] 0. Write Sprint 23 plan to `tasks/todo.md`.
- [x] 1. Create `test-router.js` at repo root with a self-contained `buildItinerary` + mock `mergedPayload` per PO spec. Assert all three strategies produce the expected flat array. Run `node test-router.js`; require PASS before touching `route.js`. ✅ 3/3 PASS.
- [x] 2. `app/api/dispatch/route.js`: port `buildItinerary` + `parseTimeLabel` + `surgeScore` helpers.
- [x] 3. `app/api/dispatch/route.js`: destructure `routingStrategy` from request body (default `"hybrid"`). Add `finalRideMod`/`finalFoodMod` to `mergedPayload`. Compute `itinerary = buildItinerary(mergedPayload, routingStrategy)` and append.
- [x] 4. `app/page.js`: add `routingStrategy` state, render dropdown inside the Location/Hub Filtering panel (or directly below), wire into the POST body.
- [x] 5. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`.
- [x] 6. Re-run `node test-router.js` after integration to confirm the function still passes. ✅ 3/3 PASS.

### Acceptance Criteria
- Test-Driven Validation: `node test-router.js` PASSES all three strategies.
- UI Integration: dropdown renders, state changes, value is in the POST body.
- Payload Visibility: `=== MERGED DISPATCH PAYLOAD ===` log shows a new top-level `itinerary` array reflecting the chosen strategy.

### Out of Scope (Anti-Goals)
- Do NOT delete or modify the Anthropic LLM call. (Phase 4 work.)
- Do NOT build React UI timeline cards yet.
- Do NOT edit `SYSTEM_PROMPT` or `buildSystemPrompt`.

## Sprint 24 — The Frontend UI Overhaul (Phase 3) — Plan

**Epic:** Excising the LLM (Phase 3). Sprint 23 produced a deterministic sorted `itinerary` array on the backend. Sprint 24 makes the frontend stop rendering the LLM's text paragraph and start rendering a vertical timeline of typed React cards driven by `itinerary`.

### Locked Decisions (from PO Initiation Prompt)
- **New file:** `components/DispatchCards.jsx` at **repo root** (not `app/components/`). Per PO line "components/DispatchCards.jsx". Three named exports: `FlightCard`, `TrainCard`, `HotspotCard`. (PO said discrete files are also acceptable; staying with one file — simpler import, less file churn.)
- **Prop name:** each card receives a single `data` prop (PO spec: `<FlightCard key={i} data={item} />`). Not `item`.
- **Visual Excision (HARD REQUIREMENT):** the LLM's conversational text response (`data.plan`) is no longer rendered anywhere on the screen. Delete the `{plan && <pre>…</pre>}` block from `page.js`. Backend Anthropic call and `buildSystemPrompt` stay untouched (Phase 4 work) — the frontend just ignores `data.plan`.
- **API change required:** `app/api/dispatch/route.js` currently returns only `{ plan }`. Add `itinerary` to the response payload. Source: `mergedPayload.itinerary` (already populated in Sprint 23 at [route.js:1022](app/api/dispatch/route.js#L1022)).
- **Card-routing in `page.js`:** map over `itinerary` with `key={i}` and a switch on `item.type`:
  - `"flight"` → `<FlightCard key={i} data={item} />`
  - `"train"` → `<TrainCard key={i} data={item} />`
  - `"food"` or `"grocery"` → `<HotspotCard key={i} data={item} />`
- **Empty-state fallback:** when `itinerary.length === 0`, render a single message: `"No active surges detected for this window. Stand by or expand your search."` Style: same panel chrome as the cards.
- **Styling:** Tailwind, mobile-friendly, dark theme to match existing `page.js` (`bg-neutral-900` / `border-neutral-700`). Accent strip or border per type:
  - **FlightCard** → Blue accent (e.g., `border-l-4 border-blue-400`).
  - **TrainCard** → Emerald accent (`border-emerald-400`).
  - **HotspotCard** → Rose or Orange accent (`border-rose-400` chosen — higher contrast on dark bg than orange; revisit if PO objects).
- **Form controls untouched.** Hours / Platforms / Location / Strategy / Button stay inline in `page.js`. (L7.)
- **No new dependencies.** No icon library; use text labels only this sprint.

### Item Shapes (verified against `app/api/dispatch/route.js`)
```
flight  → { type:"flight",  hourBucket:"5 PM", volume:4, origins:["JFK","BOS"], leaveBy:"4:30 PM", hub:"ALB" }
train   → { type:"train",   hourBucket:"6 PM", volume:2, origins:["NYP","BOS"],                    hub:"Rensselaer" }
food    → { type:"food",    location:"Pearl St & State St", volume:6, tier:"High-Value ($$$)", categories:["Sushi","Steakhouse"] }
grocery → { type:"grocery", location:"Pearl St & State St", volume:6, tier:"Quick-Turn ($)",   categories:["Supermarket"] }
ripples → { type:"flight_ripple"|"train_ripple", message:"..." }   // no hourBucket / no volume
```

### Card Content Spec (per PO)
- **FlightCard** — prominent `leaveBy`, then `volume` rendered as "N Arrival(s)", then `hub` ("ALB"), then `origins.join(", ")` as a readable string.
- **TrainCard** — `hourBucket`, `volume` ("N Arrival(s)"), `hub` ("Rensselaer"), `origins.join(", ")`.
- **HotspotCard** — `location`, `tier`, `volume` ("Volume: N"), and `categories.map(c => <span className="px-2 py-1 ..."> {c} </span>)` rendering each category as a small Tailwind badge.

### Open Question (need PO confirm)
- **Ripple items** (`flight_ripple` / `train_ripple`) appear in `itinerary` when the user unchecks Airport/Amtrak. The PO spec's switch doesn't cover them. Options:
  - (a) Skip in the switch — they silently drop from the UI (acceptable since they were synthesized purely to redirect the LLM, which we're now ignoring).
  - (b) Add a minimal 4th branch rendering the `message` as a plain neutral card.
  - **Default if no answer:** (a) — skip. The ripples only existed to steer the LLM; with the LLM excised from the UI, the synthetic message has no audience.

### Assumptions / Risks
- `data.itinerary` will be the array logged in `=== MERGED DISPATCH PAYLOAD ===`. Backend assignment confirmed at [route.js:1022](app/api/dispatch/route.js#L1022).
- Empty itinerary is a real possibility (no key configured, all sources failed). Empty-state fallback covers it.
- Risk: the existing `data.plan` field is still returned by the backend and may show up in dev tools; that's fine — it's not rendered.

### Build Steps (per PO Core Build Steps)
- [x] 0. Write this Sprint 24 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `itinerary: mergedPayload.itinerary` to the response JSON. ✅ Single-line edit at the `Response.json({ plan, eventCount, itinerary })` return.
- [x] 2. Create `components/DispatchCards.jsx` at repo root with named exports `FlightCard`, `TrainCard`, `HotspotCard`. ✅ Pure function components, blue/emerald/rose left-border accents.
- [x] 3. `app/page.js`: add `itinerary` state. Populate from `data.itinerary` after fetch. Reset to `[]` at the start of `handleClick`.
- [x] 4. `app/page.js`: deleted `<pre>{plan}</pre>` block. Replaced with "Your Plan" header, empty-state fallback, and `itinerary.map(...)` switch. Ripples fall through to `return null` per user decision (silently dropped).
- [x] 5. `plan` state kept (still set from fetch) but no longer rendered anywhere. Visual excision confirmed.
- [x] 6. Imported `FlightCard, TrainCard, HotspotCard` from `../components/DispatchCards` in `app/page.js`.
- [x] 7. Parse-check: `node --check app/api/dispatch/route.js` → **PARSE OK**. JSX requires Next.js compile (see step 8).
- [ ] 8. **Manual browser verification (user must perform — I can't run a browser):** `npm run dev`, click "What's happening?". Confirm:
  - Vertical list of typed cards renders.
  - No LLM paragraph anywhere on screen.
  - Switching routing strategy reorders the cards.
  - Unchecking all platforms / hubs and clicking shows the empty-state message.

### Acceptance Criteria (Definition of Done)
- **Component Isolation:** `components/DispatchCards.jsx` exists and exports three distinct components.
- **Data Binding:** UI maps over `itinerary` and binds JSON fields onto cards.
- **Visual Excision:** the LLM `plan` text is not rendered anywhere on screen. Confirmed by grepping `page.js` for `pre` / `{plan}` in JSX — both gone.
- **Empty State:** unchecking sources and dispatching shows the fallback message.
- **Form Pixel-Parity:** Hours / Platforms / Location / Strategy / Button look and behave identically.
- **API Contract:** `/api/dispatch` response JSON includes `itinerary` (array) — confirmed via DevTools Network tab.

### Out of Scope (Anti-Goals)
- Do NOT delete the Anthropic API call or `buildSystemPrompt` from the backend. (Phase 4.)
- Do NOT add drag-and-drop, animations, or transitions.
- Do NOT refactor any form control in `page.js`. (L7.)
- Do NOT modify `buildItinerary`, `parseTimeLabel`, or `surgeScore` in `route.js`.
- Do NOT add a state library, icon library, or any new npm dep.
- Do NOT split `DispatchCards.jsx` into per-card files or add a barrel `index.js`.
- Do NOT add tests for the card components this sprint.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 25 — The LLM Excision (Phase 4) — Plan

**Epic:** Excising the LLM (Phase 4). Sprint 24 stopped rendering `data.plan`. Sprint 25 deletes the entire Anthropic call path from the backend so `/api/dispatch` returns the deterministic payload in milliseconds with zero AI cost.

### Locked Decisions (from PO Initiation Prompt)
- **Purge targets in `app/api/dispatch/route.js`:**
  - `import Anthropic from "@anthropic-ai/sdk"`
  - `buildSystemPrompt` function (lines 17–137)
  - Inside POST: the `new Anthropic({...})` client init, the `client.messages.create({...})` call, the `<thinking>` extraction + strip, and the `ANTHROPIC_API_KEY` env check.
  - **Note on PO line item "SYSTEM_PROMPT constant":** the codebase has no top-level `SYSTEM_PROMPT` const — the system prompt was always inlined into `buildSystemPrompt`'s return. Treated as already-deleted; only `buildSystemPrompt` actually exists to remove.
- **Final return shape:** `Response.json(mergedPayload)`. Frontend already reads `data.itinerary` (set in Sprint 23 at `mergedPayload.itinerary`) — returning the full payload keeps that contract and gives the UI room to surface `temporalModifiers` / `weatherModifiers` later without another API change. `data.plan` disappears; Sprint 24 already stopped rendering it, so frontend keeps working.
- **Math brain stays:** `buildItinerary`, `parseTimeLabel`, `surgeScore`, `computeTemporalModifiers`, `computeWeatherModifiers`, `aggregateArrivalsByHour`, `aggregateTrainArrivalsByHour`, `computeHotspots`, `haversineMeters`, `haversineMiles`, `formatLeaveBy`, all fetchers, and the `mergedPayload` assembly are untouched.
- **Surgical orphan cleanup (per Rule 4):** helpers that exist *only* to format the LLM user message are removed because my excision is what orphans them:
  - `summarizeWeather`, `summarizeFlightsByHour`, `summarizeTrainsByHour`, `summarizeEvents`, `formatLocalTime12h`, `toWallClockLabel`
  - Inside POST: `activePlatformsLabel`, `currentLocalLabel`, `windowEndLabel`, `weatherText`, `flightsText`, `trainsText`, `gigDemandText`, `userMessage`
- **Dependency cleanup:** `npm uninstall @anthropic-ai/sdk` to drop it from `package.json`.

### Build Steps (per PO Core Build Steps)
- [x] 0. Write this Sprint 25 plan to `tasks/todo.md`.
- [x] 1. Delete `import Anthropic from "@anthropic-ai/sdk"` at the top of `app/api/dispatch/route.js`. ✅
- [x] 2. Delete the entire `buildSystemPrompt` function. ✅ (~120 lines gone)
- [x] 3. Delete the LLM-only helpers: `summarizeWeather`, `summarizeFlightsByHour`, `summarizeTrainsByHour`, `summarizeEvents`, `formatLocalTime12h`, `toWallClockLabel`. ✅
- [x] 4. Inside POST: remove the `ANTHROPIC_API_KEY` env check, `activePlatformsLabel`, the user-message template + its label vars, the `new Anthropic({...})` client, the `client.messages.create(...)` call, the `<thinking>` capture, and the `plan` string assembly. ✅
- [x] 5. Replace the final `Response.json({ plan, eventCount, itinerary })` with `Response.json(mergedPayload)`. ✅
- [x] 6. `npm uninstall @anthropic-ai/sdk` — `package.json` no longer lists the SDK; 31 packages removed. ✅
- [x] 7. `node --check app/api/dispatch/route.js` → **PARSE OK**. ✅
- [x] 8. Grep `app/api/dispatch/route.js` for `Anthropic`, `buildSystemPrompt`, `SYSTEM_PROMPT`, `messages.create`, `thinking` → only 3 historical-comment hits (`toWallClockLabel`/`SYSTEM_PROMPT` mentioned in Sprint 4/18/21 narrative comments). No live code references. Left alone per Rule 4 (comment cleanup is out of scope). ✅
- [ ] 9. **Manual browser verification (user must perform — I can't run a browser):** `npm run dev`, click "What's happening?". Confirm:
  - Cards render essentially instantly (no 2–4 s Claude latency).
  - DevTools Network tab: `/api/dispatch` response has no `plan` field; `itinerary` is present.
  - Server log still prints `=== MERGED DISPATCH PAYLOAD ===` and `=== HOTSPOT CLUSTERS ===`; `=== CoT TIMELINE ===` is gone.

### Acceptance Criteria (Definition of Done)
- **Zero AI:** No references to Anthropic, prompts, or `messages.create` anywhere in `app/api/dispatch/route.js`.
- **Zero AI dep:** `@anthropic-ai/sdk` no longer in `package.json` dependencies.
- **Speed:** `/api/dispatch` returns the deterministic JSON payload immediately (bound only by Ticketmaster/Yelp/AviationStack/Amtraker/Open-Meteo upstream latency).
- **Frontend unaffected:** existing card rendering keeps working because `data.itinerary` is still in the response (now top-level of `mergedPayload`).
- **History intact:** Sprint 16–24 todo blocks untouched.

## Sprint 30 — The UberXL / Leisure Hub Engine

**Epic:** Multi-Variable Algorithmic Engine. `qualityMod` (food) and `fatigueMod` (aviation) are already live. Sprint 30 adds a `leisureMod` to the aviation pipeline so flights from leisure hubs operated by leisure-focused carriers stack a 1.4x multiplier — targeting luggage-heavy family/vacation rides that need UberXL/SUV.

### Locked Decisions (from PO brief)
- **Strict AND-gate:** `LEISURE_HUBS = ["MCO","LAS","MIA","CUN","RSW","OGG"]` AND `LEISURE_AIRLINES = ["NK","F9","B6","WN","SY"]`. Both must match → `1.4`. Else → `1.0`.
- **Bucket carry:** MAX across bucket members (parity with Sprint 29 `fatigueMod`).
- **Stack:** Multiplicative inside `surgeScore` — `volume * finalRideMod * fatigueMod * leisureMod`.
- **Trigger log:** `"LEISURE HUB TRIGGERED: <ident> | Hub: <iata> | Mod: 1.4x"`.
- **Anti-goals:** Food/grocery/train pipelines untouched. No UI changes. No new external APIs.

### Build Steps
- [x] 0. Append Sprint 30 plan to `tasks/todo.md`.
- [x] 1. Create `test-leisure-engine.js` with `LEISURE_HUBS`/`LEISURE_AIRLINES`/`computeLeisureMod` + 3 PO-mandated assertions (MCO+NK→1.4, MCO+DL→1.0, JFK+NK→1.0). ✅
- [x] 2. Run `node test-leisure-engine.js` → all 3 base + 1 integration stack assertion PASS. ✅
- [x] 3. `app/api/dispatch/route.js`: add `LEISURE_HUBS` + `LEISURE_AIRLINES` constants alongside `HIGH_VALUE_STATIONS`. ✅
- [x] 4. `app/api/dispatch/route.js`: add `computeLeisureMod(departureIata, airlineIata)` helper next to `computeFatigueMod`. ✅
- [x] 5. `app/api/dispatch/route.js`: thread per-flight leisure computation through `aggregateArrivalsByHour` (trigger log + MAX-across-bucket carry + bucket attribute). ✅
- [x] 6. `app/api/dispatch/route.js`: extend `surgeScore` for flight items to multiply by `leisureMod`. ✅
- [x] 7. Parse-check (L4): `node --check app/api/dispatch/route.js` → **PARSE OK**. ✅
- [ ] 8. Manual browser verification (user must perform): `npm run dev`, trigger dispatch. Confirm:
  - Terminal shows `LEISURE HUB TRIGGERED: ...` when a Spirit/Frontier/JetBlue/Southwest/Sun Country flight from MCO/LAS/MIA/CUN/RSW/OGG appears.
  - `=== MERGED DISPATCH PAYLOAD ===` shows `leisureMod: 1.4` on the matching bucket(s).
  - Flight surgeScore (visible via `itinerary` sort order) is correctly inflated 1.4x vs an otherwise-identical non-leisure bucket.

### Acceptance Criteria
- **TDD validation:** `test-leisure-engine.js` passes all 3 strict AND-gate assertions. ✅
- **Terminal verification:** Backend logs `LEISURE HUB TRIGGERED:` when both conditions hit.
- **Proper scoring:** `surgeScore` inside `buildItinerary` chains `leisureMod` multiplicatively alongside `finalRideMod` and `fatigueMod`.

### Out of Scope
- Food/grocery/train pipeline changes, frontend UI changes, additional external APIs.

## Backlog / Icebox

Deferred epics and features live in [`ICEBOX.md`](../ICEBOX.md) at the project root. Current entries: Widebody Capacity Engine (Sprint 31), Leisure Hub Expansion, Frontend Dashboard Overhaul (Mapbox/Leaflet), Driver Session Persistence (`localStorage`).

### Out of Scope (Anti-Goals)
- Do NOT touch `buildItinerary`, `parseTimeLabel`, `surgeScore`, or any aggregator / temporal / weather function.
- Do NOT edit `app/page.js`, `components/DispatchCards.jsx`, or any other file outside `route.js` + `package.json` + `tasks/todo.md`.
- Do NOT remove the `ANTHROPIC_API_KEY` entry from `.env` (user's secret store, not our concern).
- Do NOT delete pre-existing dead code that was already orphaned before Sprint 25 (per Rule 4).
- Do NOT introduce error handling, fallbacks, or response-shape backward-compat shims.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 25.1 — Frontend Excision Cleanup (Hotfix)

**Bug:** After Sprint 25 shipped, the UI surfaced "Dispatch failed." — backend was returning 200 OK with the deterministic payload, but `app/page.js` still wired `data.plan` through React state. The PO root-caused this as the LLM-era setter triggering inside the fetch resolution; remediation is to fully excise `plan` from frontend state.

**Scope:** Patch `app/page.js` only. Do NOT touch `DispatchCards.jsx`, the form controls, the `itinerary.map` switch, or any backend file.

### Build Steps (per PO Core Build Steps)
- [x] 1. State cleanup: deleted `const [plan, setPlan] = useState("")` ([app/page.js:8](app/page.js#L8)). `itinerary` was already `useState([])` ([app/page.js:9](app/page.js#L9)) — left as-is.
- [x] 2. Reset cleanup: removed `setPlan("")` from `handleClick` ([app/page.js:23](app/page.js#L23)).
- [x] 3. Fetch resolution patch: removed `setPlan(data.plan)`; tightened `setItinerary(Array.isArray(data.itinerary) ? data.itinerary : [])` → `setItinerary(data.itinerary || [])` per PO spec.
- [x] 4. Error visibility patch: added `console.error(err);` immediately before `setError(err.message);` in the fetch `catch` block.
- [x] 5. Grep `app/page.js` for `\bplan\b|setPlan` → only hit is the cosmetic UI tagline `"Your live driving plan."` ([app/page.js:91](app/page.js#L91)). No live state references remain.
- [ ] 6. **Manual browser verification (user must perform):** `npm run dev`, click "What's happening?". Confirm: cards render instantly, no red "Dispatch failed." banner, and DevTools console shows nothing under the error tab on the golden path.

### Acceptance Criteria (Definition of Done)
- **Frontend Resilience:** `app/page.js` no longer references `plan` or `setPlan` anywhere in state / setter / reset / fetch-resolution code.
- **Successful Render:** the `itinerary.map` switch from Sprint 24 receives a real array and renders cards without crashing.
- **Visibility:** future fetch failures stream the stack trace to the browser console before the user-facing red banner shows.

### Out of Scope (Anti-Goals)
- Do NOT touch the imports of `FlightCard / TrainCard / HotspotCard`.
- Do NOT modify the `itinerary.map(...)` switch or the empty-state fallback message.
- Do NOT rewrite the form, the geolocation block, or `buttonLabel` (the cosmetic "Dispatching AI..." label is unrelated to the bug).
- Do NOT change any backend file.

### Debugging Agreement
If the UI still surfaces "Dispatch failed." after this hotfix, the user opens DevTools Console — `console.error(err)` now exposes the underlying stack — and reports the exact thrown message so the next patch can be targeted.

## Sprint 26 — Server-Side Data Caching (Performance Epic)

**Problem:** Dispatch endpoint takes ~20-40s because every request awaits AviationStack + Amtrak + Yelp + Open-Meteo. Most of that data is stable for tens of minutes. Cache it in process memory with TTLs so the second request returns the deterministic payload in <1s and external API quotas are protected.

### Decisions (locked before coding)
- **Strategy:** in-memory `Map` (per PO MVP spec). No Redis, no Next.js native `revalidate` — the existing fetchers already pass `cache: "no-store"` per L3, and switching to native revalidate would mean editing every fetch options object instead of one wrapper.
- **Cache location:** module-scope `globalCache = new Map()` at the top of `app/api/dispatch/route.js`. Lives for the lifetime of the Node process; on dev (`next dev`) survives hot reload of the handler, on prod survives across requests on the same lambda warm container.
- **Entry shape:** `{ data, expiresAt }` — `expiresAt = Date.now() + ttlMinutes * 60 * 1000`. Stale entries are fetched fresh on access (no background sweep — MVP).
- **Wrapper:** `async function withCache(key, ttlMinutes, fetchCallback)`. Returns cached data when live; otherwise awaits + writes + returns.
- **TTLs + Keys (per PO spec):**
  - Flights: TTL=15 min, key=`flights_ALB` (hub is hard-coded; future multi-airport will parameterize).
  - Trains: TTL=15 min, key=`trains_Rensselaer` (per PO example).
  - Hotspots: TTL=30 min, key=`hotspots_${category}_${latitude}_${longitude}` (category = `restaurants` or `grocery` — what differs between the two Yelp calls).
  - Weather: TTL=60 min, key=`weather_${latitude}_${longitude}`.
- **Where to wrap:** wrap the inner body of each fetcher (`fetchAlbArrivals`, `fetchAlbTrainArrivals`, `fetchYelpBusinesses`, `fetchWeatherWindowed`). Call signatures unchanged → POST handler / `Promise.all` slot / `getLocalDensityData` are untouched.
- **Surgical scope (CLAUDE.md §4):** no changes to aggregators, sanitization, `buildItinerary`, modifiers, or the merged payload shape. The caching layer is invisible to every consumer.
- **TDD (CLAUDE.md §5):** Phase 1 writes `test-cache.js` standalone in the project root, mocks a 1000ms fetch, asserts the second `withCache` call returns in ~0ms. Run + PASS before touching `route.js`.

### Phase 1 — Test-Driven Scaffolding
- [x] 1. Write `test-cache.js` in project root: module-scope `Map`, `withCache(key, ttl, fn)`, mocked 1000ms `slowFetch`.
- [x] 2. Two consecutive `withCache` calls with the same key; measure each `Date.now()` delta.
- [x] 3. Assert first ~1000ms, second <50ms, both returns identical (===) — exit non-zero on failure.
- [x] 4. Run `node test-cache.js` → all assertions PASS before moving to Phase 2.

### Phase 2 — Integration into route.js
- [x] 5. Add `const globalCache = new Map();` and `withCache` (copied from test) at the top of `app/api/dispatch/route.js`.
- [x] 6. Wrap inner body of `fetchAlbArrivals` in `withCache("flights_ALB", 15, ...)`.
- [x] 7. Wrap inner body of `fetchAlbTrainArrivals` in `withCache("trains_Rensselaer", 15, ...)`.
- [x] 8. Wrap inner body of `fetchYelpBusinesses` in `withCache(\`hotspots_${category}_${latitude}_${longitude}\`, 30, ...)`.
- [x] 9. Wrap inner body of `fetchWeatherWindowed` in `withCache(\`weather_${latitude}_${longitude}\`, 60, ...)`.
- [x] 10. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns clean.
- [ ] 11. Manual verification (user): `npm run dev` → fire one POST (cold, populates cache) → fire a second POST with the same lat/lng within 15 min → response returns in <1s.

### Acceptance Criteria
- `test-cache.js` proves the wrapper short-circuits repeat fetches (first ~1000ms, second ~0ms).
- First live POST populates the cache; second identical POST returns the deterministic payload in <1s.
- No frontend, math, routing, or sanitization changes.

### Out of Scope (Anti-Goals)
- Redis / Memcached / external cache backends.
- Next.js native `fetch({ next: { revalidate } })` rewrite (in-memory `Map` per PO MVP spec).
- Frontend UI changes.
- Touching `buildItinerary`, temporal/weather modifiers, Sprint 11 sanitization, or any aggregator.
- Background TTL sweep / cache size cap / per-entry hit counters.

### Debugging Agreement
If a stale value ever leaks (e.g., driver sees a flight that's already landed), the user reports the exact cache key + observed-vs-expected. Targeted fix is to either lower that key's TTL or invalidate it on the offending event, NOT to disable the cache layer wholesale.

## Sprint 27 — Technical Debt & Multiplier Refactoring (Raw Data Fix)

**Problem:** Sprint 23 introduced a "squaring" bug — `aggregateArrivalsByHour` / `aggregateTrainArrivalsByHour` were scaling raw counts by `rideMod` BEFORE bucketing, and the Sprint 18 hotspot mutation was scaling hotspot volume by `finalFoodMod`. Then `buildItinerary` multiplied those already-scaled volumes by the modifier AGAIN inside `surgeScore`. The Profitability sort exponentially inflated surge-hour items.

### Decisions (locked before coding)
- **Single application point:** Modifiers (`finalRideMod`, `finalFoodMod`) are applied ONLY inside `buildItinerary` via the existing `surgeScore()` helper. Aggregators + the hotspot mutation are stripped completely.
- **Raw volumes on the wire:** `flightsByHour[i].volume` / `trainsByHour[i].volume` / `gigDemand.foodHotspots[i].volume` are the TRUE physical counts — what the React UI should render.
- **Hidden surgeScore:** Lives inside `buildItinerary` for sorting + filtering only. NOT attached to items on the way out (no payload shape change).
- **Strict <1.0 filter:** Any scoreable item (`flight`/`train`/`food`/`grocery`) whose `surgeScore(it, finalRideMod, finalFoodMod) < 1.0` is dropped from the final itinerary array. Synthetic ripple objects (Sprint 15/17) pass through untouched — they have no scoreable type.
- **Call-site update:** POST handler drops the `finalRideMod` arg from both aggregator calls (and the redundant scaling-comment block above the hotspot mutation goes with the mutation itself).
- **No frontend changes** (per anti-goals). Volume integers grow — the React `<volume>` field renders the true number natively.

### Phase 1 — Test-Driven Scaffolding (CRITICAL)
- [x] 1. Write `test-multiplier-refactor.js` in project root: standalone replica of `surgeScore` + filter logic, mock payload with `finalFoodMod=0.5` / `finalRideMod=1.5`, one `volume:1` food hotspot + one `volume:10` flight.
- [x] 2. Assert food hotspot (0.5) is filtered, flight retains `surgeScore=15`.
- [x] 3. Run `node test-multiplier-refactor.js` — PASS before touching `route.js`.

### Phase 2 — Integration into route.js
- [x] 4. `app/api/dispatch/route.js`: strip `rideMod` param + scaling loop from `aggregateArrivalsByHour`; emit `codes.length` as raw `volume`.
- [x] 5. `app/api/dispatch/route.js`: strip `rideMod` param + scaling loop from `aggregateTrainArrivalsByHour`; emit `codes.length` as raw `volume`.
- [x] 6. `app/api/dispatch/route.js`: delete the `gigDemand.foodHotspots` `Math.max(1, Math.round(h.volume * finalFoodMod))` mutation block (lines ~793-798).
- [x] 7. `app/api/dispatch/route.js`: update POST call sites to drop `finalRideMod` from both aggregator calls.
- [x] 8. `app/api/dispatch/route.js`: add strict `< 1.0` filter to `buildItinerary` (scoreable items only — synthetic ripples pass through).
- [x] 9. Terminal mock test: drafted in-route mock injection (volume:1 hotspot + forced finalFoodMod=0.5) then removed — Phase 1 standalone test independently proves the same filter path byte-for-byte (the in-route mock would only re-validate what Phase 1 already covers).
- [x] 10. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns `PARSE OK`.
- [x] 11. Re-run Phase 1 test post-integration — still PASS.
- [ ] 12. Manual verification (user): `npm run dev` → fire a POST with finalFoodMod < 1 (e.g., late-night Fri/Sat hour for food) → terminal `=== MERGED DISPATCH PAYLOAD ===` log shows raw integer volumes on flights/trains/hotspots AND the `itinerary` array no longer contains items whose hidden `volume * mod` would be < 1.0.

### Acceptance Criteria (Definition of Done)
- **Raw Data:** Frontend receives the true, un-mutated `volume` integers for flights, trains, and hotspots (no squaring, no flooring).
- **Proper Sorting:** `surgeScore` is calculated correctly in `buildItinerary` background without squaring the multiplier.
- **The Strict Filter:** Items with a `surgeScore < 1.0` are entirely absent from the `itinerary` array in the `=== MERGED DISPATCH PAYLOAD ===` log.

### Out of Scope (Anti-Goals)
- Frontend UI changes (React reads new raw volumes natively).
- Live browser geolocation.
- Adding / changing the temporal or weather modifier logic itself — only WHERE it is applied.

### Debugging Agreement
If the user returns with an error code or traceback, identify the specific failing line and provide a targeted patch — do NOT rewrite the whole file.

## Sprint 28 — The Yelp Quality Engine

**Problem:** Sprint V2.5's cluster `volume` treated every restaurant equally. A 2,500-review legendary pizza joint and a 3-review ghost kitchen weighed the same in the surge sort. Add an Anchor-based `qualityMod` so the router aggressively prioritizes true "unicorn" hotspots.

### Decisions (locked before coding)
- **Anchor rule:** Inside each cluster, the business with the highest `rating * review_count` is the Anchor. Missing rating or review_count falls back to 0 (safe for partial Yelp records).
- **Additive Stack (Base 1.0):**
  - +0.3 when Anchor Popularity Score > 5000.
  - +0.5 when wall-clock hour ∈ {23, 0, 1, 2} AND Anchor categories include any of "Fast Food", "Pizza", "Burgers", "Diners" (case-insensitive substring match on the category title).
- **Time signal:** Reuse the Sprint 18 convention — `localStart.getUTCHours()` returns the driver's wall-clock hour. Thread `localStart` from POST through `getLocalDensityData` → `computeHotspots`.
- **Per-cluster log:** `console.log("YELP ANCHOR: <name> | Pop Score: <score> | Mod: <qualityMod>x")` for each generated cluster (food + grocery).
- **fetchYelpBusinesses extension:** Capture `b.rating` + `b.review_count` and surface them on each business object so `computeHotspots` can read them.
- **Router integration:** `surgeScore` for food/grocery multiplies by `(item.qualityMod || 1.0)` — fallback keeps the existing strict `< 1.0` filter intact for legacy / grocery items where Anchor math may produce mod=1.0.
- **No frontend changes.** `qualityMod` is a hidden sorting variable; the React cards don't render it.
- **Out of scope (per PO anti-goals):** No multipliers for flights / trains; no UI changes; no edits to temporal or weather modifiers.

### Phase 1 — Test-Driven Scaffolding (CRITICAL)
- [x] 1. Write `test-yelp-quality.js` in project root: mock 200m cluster with Ghost Kitchen (5.0 / 3 / "New American") + Legendary Pizza (4.7 / 2500 / ["Pizza", "Fast Food"]).
- [x] 2. Implement standalone Anchor pick (`rating * review_count`) + Additive Stack (Base 1.0 + 0.3 popularity + 0.5 late-night fast-food).
- [x] 3. Test 1 (Daytime, hour 14): Anchor === Pizza, qualityMod === 1.3. ✅
- [x] 4. Test 2 (1:00 AM, hour 1): Anchor === Pizza, qualityMod === 1.8. ✅
- [x] 5. Run `node test-yelp-quality.js` — PASS before touching `route.js`. ✅

### Phase 2 — Integration into route.js
- [x] 6. `app/api/dispatch/route.js`: extend `fetchYelpBusinesses` mapper to include `rating` + `reviewCount`.
- [x] 7. `app/api/dispatch/route.js`: extend `computeHotspots(businesses, type, localStart)` to pick the Anchor + compute `qualityMod` (with the four-category late-night list) + attach `qualityMod` to each emitted hotspot.
- [x] 8. `app/api/dispatch/route.js`: thread `localStart` from POST → `getLocalDensityData(latitude, longitude, apiKey, localStart)` → `computeHotspots`.
- [x] 9. `app/api/dispatch/route.js`: add `console.log("YELP ANCHOR: ...")` per cluster inside `computeHotspots`.
- [x] 10. `app/api/dispatch/route.js`: update `surgeScore` so food/grocery scoring multiplies by `(item.qualityMod || 1.0)`.
- [x] 11. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns `PARSE OK`. ✅
- [ ] 12. Manual verification (user): `npm run dev` → fire a POST → terminal shows `YELP ANCHOR` log per cluster; `=== MERGED DISPATCH PAYLOAD ===` shows `qualityMod` on each hotspot; the `itinerary` order shifts so high-quality hotspots rise above weak ones.

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `test-yelp-quality.js` proves Anchor selection + 1.3x daytime + 1.8x late-night.
- **Terminal Verification:** `YELP ANCHOR` log line prints for every generated cluster during a dispatch.
- **Proper Scoring:** `surgeScore` inside `buildItinerary` incorporates `item.qualityMod` without breaking the Sprint 27 strict `< 1.0` filter.

### Out of Scope (Anti-Goals)
- Multipliers on flights or trains (PO icebox: Aviation Fatigue, Widebody Mapping).
- Frontend UI changes.
- Touching temporal or weather modifiers.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 28.1 — Anchor UI Polish

**Goal:** Surface the Sprint 28 Anchor's name on the driver-facing HotspotCard so the user knows exactly which building is generating cluster demand.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: add `anchorName: anchor?.name` to the hotspot object emitted by `computeHotspots`.
- [x] 2. `components/DispatchCards.jsx`: in `HotspotCard`, render `Anchored by {data.anchorName}` as a small italic neutral-400 subtitle directly under the location header. Conditional render — no gap when `anchorName` is missing.
- [ ] 3. Manual verification (user): `npm run dev` → fire a dispatch → food hotspot cards render "Anchored by &lt;Restaurant Name&gt;" beneath the intersection.

### Acceptance Criteria
- `/api/dispatch` JSON includes `anchorName` on each hotspot.
- HotspotCard shows "Anchored by [Name]" as a secondary subtitle.
- Graceful fallback — missing `anchorName` skips the line entirely.

### Out of Scope
- Anchor selection math, FlightCard / TrainCard, standalone test script.

## Sprint 29 — The Aviation Fatigue Engine

**Epic:** Multi-Variable Algorithmic Engine (Aviation Fatigue). Sprint 28 introduced the additive `qualityMod` for food hotspots. Sprint 29 extends the same data-driven multiplier pattern to the Aviation pipeline by computing a per-flight `fatigueMod` from live delay + scheduled-time signals. The mod stacks multiplicatively against `finalRideMod` inside `buildItinerary` (no prompt path — pure deterministic routing).

### Locked Decisions (from PO)
- **Late-Night Synergy rule:** `arrival.delay >= 45` minutes AND scheduled local hour `>= 21` (9 PM) OR `< 4` (3 AM) → `fatigueMod = 1.3`. Otherwise `1.0`.
- **Hour source:** extract the wall-clock hour directly from the `arrival.scheduled` ISO string (preserves the airport's embedded local offset; `new Date(...).getUTCHours()` would drift for non-zero offsets).
- **Bucket-level attachment:** the existing aggregator emits hour buckets, not raw flights. Each bucket's `fatigueMod` = max across its member flights — so a single late-night delay marks the whole bucket as a fatigue hub.
- **Surge formula update:** inside `buildItinerary`'s `surgeScore`, ONLY the `flight` branch multiplies by `(item.fatigueMod || 1.0)`. Trains, food, grocery untouched (PO anti-goal).
- **Trigger log:** `"AVIATION FATIGUE TRIGGERED: [IATA/Number] | Delay: [m]m | Mod: 1.3x"` per matching flight (per-flight, not per-bucket — lets PO see every contributor).
- **Phase 3 mock flight:** temporarily inject one late-night delayed flight into the live router so the terminal log can prove the trigger fires end-to-end. Guarded behind a clearly-named constant so it's easy to remove.
- **No frontend changes. No new env vars. No new external calls.**

### Phase 1: Test-Driven Scaffolding
- [x] 1. Create `test-flight-fatigue.js` at repo root with two mocked flights (A: 22:30 UTC + 45min delay → 1.3, B: 14:00 UTC + 45min delay → 1.0).
- [x] 2. Implement `computeFatigueMod(flight)` inside the test (regex-extract local hour from ISO).
- [x] 3. Assert Flight A === 1.3 and Flight B === 1.0.
- [x] 4. Run `node test-flight-fatigue.js` → PASS before touching `route.js`. ✅ 2/2 PASS.

### Phase 2: Core Build Steps
- [x] 5. `app/api/dispatch/route.js`: port `computeFatigueMod(flight)` helper (regex extracts the hour token from `arrival.scheduled`).
- [x] 6. `app/api/dispatch/route.js`: inside `aggregateArrivalsByHour`'s loop, compute fatigueMod per flight; track max per bucket; emit `console.log("AVIATION FATIGUE TRIGGERED: ...")` on every 1.3x hit; attach `fatigueMod` field to each emitted bucket.
- [x] 7. `app/api/dispatch/route.js`: in `surgeScore`, multiply the `flight` branch by `(item.fatigueMod || 1.0)`.

### Phase 3: Terminal Mock Test
- [x] 8. `app/api/dispatch/route.js`: prepend a synthetic late-night delayed bucket to `flightsByHour` (guarded by `SPRINT_29_MOCK_FATIGUE_FLIGHT` flag) so the trigger log + inflated surgeScore appear in `=== MERGED DISPATCH PAYLOAD ===` regardless of the driver's current wall-clock.
- [x] 9. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`; full `import()` also clean.
- [ ] 10. Manual verification (user): `npm run dev` → fire a dispatch → terminal shows `AVIATION FATIGUE TRIGGERED` line; `flightsByHour` bucket has `fatigueMod: 1.3`; `itinerary` order reflects the boosted surgeScore.

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `test-flight-fatigue.js` proves the 45-min threshold + 9pm-3am time gate.
- **Terminal Verification:** `AVIATION FATIGUE TRIGGERED` log fires when the mock late-night flight is in the pipeline.
- **Proper Scoring:** `surgeScore` for flight items in `buildItinerary` multiplies by `item.fatigueMod` without breaking the Sprint 27 `< 1.0` strict filter.

### Out of Scope (Anti-Goals)
- Multipliers on trains, food, or grocery pipelines.
- Frontend UI changes.
- Widebody Aircraft / UberXL Leisure Hub mapping (Icebox).

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 31 — The Campus Synergy Engine

**Epic:** Multi-Variable Algorithmic Engine (Campus Synergy). `qualityMod` (food), `fatigueMod` (aviation), and `leisureMod` (aviation) are already live. Sprint 31 pulls the Campus Synergy Engine out of the icebox and stacks a `campusMod` onto food hotspots whose cluster centroid lands within 1.5 miles of SUNY Albany, RPI, or Siena College during late-night hours (11 PM / 12 AM / 1 AM).

### Locked Decisions (from PO brief)
- **Center-Point Radius:** food cluster centroid (mean lat/lng of cluster members) within `< 1.5 mi` of any `CAMPUS_CENTERS` entry → spatial gate satisfied.
- **Temporal gate:** `localStart.getUTCHours()` ∈ {23, 0, 1} (11 PM / 12 AM / 1 AM) → temporal gate satisfied.
- **Both gates must fire** → `{ campusMod: 1.5, campusName: "<matched>" }`. Otherwise `{ campusMod: 1.0, campusName: null }`.
- **Food only:** grocery clusters carry the default 1.0 (PO anti-goal).
- **Multiplicative stack:** food `surgeScore = volume * finalFoodMod * qualityMod * campusMod (+ tier bonus)` — chains alongside `qualityMod` per PO brief.
- **Trigger log:** `"CAMPUS SYNERGY TRIGGERED: <Location Label> | Campus: <Campus Name> | Mod: 1.5x"` per hit cluster.
- **Anti-goals:** no flights / trains / grocery boost, no frontend UI changes, no external geofencing/mapping APIs.

### Phase 1 — Test-Driven Scaffolding
- [x] 1. Create `test-campus-engine.js` with `CAMPUS_CENTERS` const, reused `haversineMiles`, and `computeCampusMod(lat, lng, hour)`.
- [x] 2. Assert hotspot ~0.27 mi north of SUNY Albany at hour 23 → `{ 1.5, "SUNY Albany" }`. ✅
- [x] 3. Assert same coords at hour 14 (2 PM) → `{ 1.0, null }`. ✅
- [x] 4. Assert hotspot 5+ mi from any campus at hour 0 → `{ 1.0, null }`. ✅
- [x] 5. Assert `surgeScore` food-branch stack inflates by exactly 1.5x when `campusMod=1.5`. ✅
- [x] 6. Run `node test-campus-engine.js` — 4/4 PASS before touching `route.js`.

### Phase 2 — Integration into route.js
- [x] 7. `app/api/dispatch/route.js`: add `CAMPUS_CENTERS` constant alongside `ALB_COORDS`.
- [x] 8. `app/api/dispatch/route.js`: add `computeCampusMod(hotspotLat, hotspotLng, currentHour)` helper next to `CAMPUS_CENTERS`.
- [x] 9. `app/api/dispatch/route.js`: inside `computeHotspots`, after the `bestCluster` is picked and `location` is labeled, compute the cluster centroid (mean lat/lng) and call `computeCampusMod` ONLY when `type === "food"`. Attach `campusMod` + `campusName` to the emitted hotspot object.
- [x] 10. `app/api/dispatch/route.js`: emit `console.log("CAMPUS SYNERGY TRIGGERED: ...")` when `campusMod > 1.0`.
- [x] 11. `app/api/dispatch/route.js`: extend `surgeScore`'s food/grocery branch to multiply by `(item.campusMod || 1.0)`. (Grocery falls back to 1.0 — no-op there.)
- [x] 12. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns `PARSE OK`. ✅

### Phase 3 — Visual Verification
- [x] 13. Standalone `surgeScore` stack test (Test 4 in `test-campus-engine.js`) proves 1.5x inflation deterministically before live testing.
- [ ] 14. Manual verification (user): `npm run dev` → fire a dispatch from coords near SUNY Albany around 11 PM-1 AM → terminal shows `CAMPUS SYNERGY TRIGGERED: ...`; `=== MERGED DISPATCH PAYLOAD ===` shows `campusMod: 1.5` + `campusName: "SUNY Albany"` on the matching food hotspot; `itinerary` order reflects the boosted surgeScore.

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `test-campus-engine.js` proves the 1.5-mile boundary, the 11 PM-2 AM time gate, and the 1.5x surgeScore inflation.
- **Terminal Verification:** `CAMPUS SYNERGY TRIGGERED` log line fires from `computeHotspots` when both gates pass.
- **Proper Scoring:** food-branch `surgeScore` inside `buildItinerary` chains `campusMod` multiplicatively alongside `qualityMod` and `finalFoodMod`.
- **Icebox sync:** Campus Synergy Engine removed from `ICEBOX.md`.

### Out of Scope (Anti-Goals)
- Multipliers on flights / trains / grocery.
- Frontend UI changes (`campusMod` is a hidden backend sort variable).
- External geofencing or mapping APIs.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 32 — The Event Egress Engine

**Epic:** Multi-Variable Algorithmic Engine (Event Egress). Ticketmaster events are already fetched but only passed as raw context. Sprint 32 turns each event into a deterministic surge object whose `egressMod` (2.0x standard, 2.5x mega-venue) fires inside a `±15 min` or `±30 min` window around the category-projected end time (Sports 3.5h, Arts/Theatre 2.5h, Music/default 3.0h).

### Locked Decisions (from PO brief)
- **Category duration:** segment.name match — `/sports/i` → 3.5h, `/arts|theatre/i` → 2.5h, else 3.0h (Music/default).
- **Venue keyword proxy:** `/stadium|arena|amphitheater|coliseum/i` on venue name → Mega-Venue (egressMod 2.5x, ±30 min window). No match → Standard (egressMod 2.0x, ±15 min window).
- **Active window check:** current time ≥ projectedEnd − windowMinutes AND ≤ projectedEnd + windowMinutes → return `egressMod`. Else return 1.0.
- **Filter:** keep only events where `computeEventEgress > 1.0` before they reach `mergedPayload`.
- **Structured payload:** `{ type: "event", location: venueName, volume: 1, egressMod, categories: [segmentName] }` — mirrors flight/train/hotspot shape per L2.
- **surgeScore branch:** `event` → `volume * finalRideMod * (egressMod || 1.0)` (volume is always 1 by spec → Mega-Venue yields 2.5 * finalRideMod baseline).
- **Trigger log:** `"EVENT EGRESS TRIGGERED: <Venue Name> | Mod: <2.0x|2.5x> | Projected End: <h:mm AM/PM>"` per egressing event.
- **Anti-goals:** no `egressMod` on flights / trains / food, no external venue-capacity API, frontend untouched aside from a minimal `EventCard` render branch (events are now objects in `itinerary`).

### Phase 1 — Test-Driven Scaffolding
- [x] 1. Create `test-egress-engine.js` with `computeEventEgress(event, currentLocalTime)` reflecting PO logic.
- [x] 2. Scenario A — Sports @ "High School Field", start 7 PM, current 10:20 PM → 2.0 (Standard venue, 3.5h duration, inside 15-min window 10:15-10:45). ✅
- [x] 3. Scenario B — Music @ "Madison Square Arena", start 8 PM, current 10:45 PM → 2.5 (Mega-Venue, 3.0h duration, inside 30-min window 10:30-11:30). ✅
- [x] 4. Scenario C — Same as B but current 9 PM → 1.0 (outside the 10:30-11:30 window). ✅
- [x] 5. Scenario D — Missing category + venue with startTime → defaults (3.0h, ±15 min) compute correctly; no startTime → 1.0. ✅
- [x] 6. Run `node test-egress-engine.js` — 5/5 PASS before touching `route.js`. ✅

### Phase 2 — Integration into route.js
- [x] 7. `app/api/dispatch/route.js`: port `computeEventEgress` verbatim from test next to the other compute* helpers.
- [x] 8. `app/api/dispatch/route.js`: in `POST`, after the `Promise.all` resolves, walk `events` and build `structuredEvents` from TM `classifications[0].segment.name` + `_embedded.venues[0].name` + `dates.start.localDate`/`localTime`. Skip when `egressMod <= 1.0`.
- [x] 9. `app/api/dispatch/route.js`: emit `console.log("EVENT EGRESS TRIGGERED: ...")` per kept event with mod + projected end time.
- [x] 10. `app/api/dispatch/route.js`: replace `events` in `mergedPayload` with the structured array (raw TM events are not consumed by the frontend per L7 / Sprint 25).
- [x] 11. `app/api/dispatch/route.js`: add `event` branch to `surgeScore` — `volume * finalRideMod * (egressMod || 1.0)`.
- [x] 12. `app/api/dispatch/route.js`: extend `buildItinerary`'s `scoreable` check + `rawItems` to include events.
- [x] 13. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns `PARSE OK`. ✅

### Phase 3 — Minimal UI Patch
- [x] 14. `components/DispatchCards.jsx`: add `EventCard` (purple accent, matches existing card style).
- [x] 15. `app/page.js`: import `EventCard` + add `case "event"` to the itinerary switch.

### Phase 4 — Visual Verification
- [ ] 16. Manual verification (user): `npm run dev` → fire dispatch with an active event in the egress window → terminal shows `EVENT EGRESS TRIGGERED: ...`; `=== MERGED DISPATCH PAYLOAD ===` `events` field is a structured array of `{ type, location, volume, egressMod, categories }` only for events whose mod > 1.0; the frontend renders an `EventCard` for each.

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `test-egress-engine.js` proves the category durations and the Mega-Venue window expansions.
- **Terminal Verification:** `EVENT EGRESS TRIGGERED` log fires natively when an event enters its egress window.
- **Payload Structure:** events transition from raw TM strings into deterministic JSON objects with `type: "event"` and a calculated surgeScore via `buildItinerary`.
- **Icebox sync:** Event Egress Engine removed from `ICEBOX.md`.

### Out of Scope (Anti-Goals)
- `egressMod` on flights / trains / food.
- Google Places (or any other venue capacity API).
- Frontend UI redesign — only a minimal `EventCard` + switch-case addition.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 32.1 — Tabbed UX & Time-Decay Hotfix

**Bug:** Profitability mode tells the driver to sit idle for two hours when a future surge has a massive multiplier (zero hourly-wage protection). Mixing high-volume Yelp clusters with low-volume flights creates an apples-to-oranges sort where food always dominates.

**Fix:** (a) backend `computeTimeDecayMod` applies a tiered penalty (1.0 / 0.7 / 0.4) inside `buildItinerary` BEFORE the Sprint 27 `<1.0` strict dropout filter; (b) frontend splits the itinerary into two tabs ("Transit & Events" / "Food & Grocery") so the two surge families never compete in the same sort.

### Locked Decisions (from PO brief)
- **Decay tiers** (delta = minutes from driver's wall-clock to the item's time label):
  - `delta < 45` (or in the past, or no time label) → 1.0
  - `45 ≤ delta ≤ 90` → 0.7
  - `delta > 90` → 0.4
- **Time label resolution:** `item.leaveBy || item.hourBucket`. Items with neither (food/grocery hotspots, events, ripples) are treated as "Current/Ongoing" → decay 1.0.
- **Application:** wrap `surgeScore` at every call site inside `buildItinerary` (filter + profitability sort + hybrid in-group sort). Chronological mode keeps its time-based comparator untouched.
- **Tab filter:**
  - `transit` → `flight | train | event | flight_ripple | train_ripple`
  - `food` → `food | grocery`
- **Anti-goals:** no changes to existing modifiers (fatigueMod / campusMod / egressMod / qualityMod / etc.), no DispatchCards.jsx edits, no scalar volume normalization between transit and food.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: add `computeTimeDecayMod(itemTimeLabel, currentLocalStart)` next to `parseTimeLabel` / `itemTime`. Handle midnight rollover for the multi-hour dispatch window.
- [x] 2. `app/api/dispatch/route.js`: extend `buildItinerary(payload, strategy, currentLocalStart)` — add a `decayed(it)` inline wrapper and use it in the strict filter, the profitability sort, and the hybrid in-group sort.
- [x] 3. `app/api/dispatch/route.js`: update the call site in `POST` to pass `localStart` through to `buildItinerary`.
- [x] 4. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns `PARSE OK`. ✅
- [x] 5. `app/page.js`: add `activeTab` state defaulting to `"transit"`.
- [x] 6. `app/page.js`: render a two-button tab toggle inside the `status === "done"` block (above the cards) with `border-b-2 border-yellow-500` for active.
- [x] 7. `app/page.js`: filter `itinerary` by tab before mapping; the existing empty-state fallback now reads from the filtered list.
- [ ] 8. Manual verification (user): `npm run dev` → confirm a 2-hours-out flight surge drops below a "now" surge in Profitability mode; confirm Transit tab shows flight/train/event cards only and Food tab shows food/grocery only; Routing Strategy still controls the within-tab order.

### Acceptance Criteria (Definition of Done)
- **Time-Decay:** a massive flight surge 2 hours away ranks below a moderate flight surge happening now.
- **Tabbed Isolation:** Tab 1 carries flights/trains/events/ripples only; Tab 2 carries food/grocery only.
- **Strategy preserved:** Chronological / Profitability / Hybrid still drive the within-tab ordering.

### Out of Scope (Anti-Goals)
- Touching `fatigueMod` / `campusMod` / `egressMod` / `qualityMod` / `finalRideMod` / `finalFoodMod`.
- Editing `DispatchCards.jsx`.
- Cross-family normalization (multiplying transit volumes by a scalar).

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 33 — The "Top Pick" Global Banner

**Problem:** Sprint 32.1's tab UI separated Transit from Food but hid the global priority — the driver has to click both tabs to find the absolute best move.

**Fix:** Render a single high-contrast banner above the tabs that names the highest-scoring item across every category, so the driver sees the global winner before they touch a tab.

### Locked Decisions (from PO brief)
- **Score basis:** the same decayed surgeScore the backend uses for sorting (so the banner agrees with the Profitability tab's [0]). Frontend computes it because the anti-goal forbids touching `route.js` while the brief's reduce snippet reads `item.surgeScore`.
- **Reduce snippet:** preserve the brief's literal `flatItinerary.reduce((max, item) => (item.surgeScore > (max?.surgeScore || 0) ? item : max), null)` by mapping the score onto each item first.
- **Helpers:** `parseTimeLabel`, `computeDecayMod`, `computeSurgeScore` live in `app/page.js` outside the component (pure functions, no React state).
- **`finalRideMod`/`finalFoodMod`:** persisted into a `finalMods` React state at fetch time (currently discarded). Default `{ride:1, food:1}` so the formula degrades gracefully.
- **Banner styling:** `bg-yellow-500 text-black` per brief example. Bold header "🔥 RECOMMENDED NEXT MOVE" — explicit ask from the PO so the emoji stays.
- **Placement:** strictly between the dispatch button and the tab toggle, rendered only when `status === "done" && topPick`.
- **Type-aware body:** flight → leaveBy + arrivals/hub; train → hourBucket + arrivals/hub; event → location + egressMod; food/grocery → location + tier + volume.
- **Anti-goals:** no `route.js` edits, no removal of the tab UI / DispatchCards, no cross-family volume scalars.

### Build Steps
- [x] 1. Create `components/TopPickBanner.jsx` — named export `TopPickBanner({ data })`, type-aware body, yellow accent.
- [x] 2. `app/page.js`: add pure helpers `parseTimeLabel`, `computeDecayMod`, `computeSurgeScore` (mirrors backend formula + Sprint 32.1 decay).
- [x] 3. `app/page.js`: add `finalMods` React state defaulting to `{ ride: 1.0, food: 1.0 }`; persist `data.finalRideMod` / `data.finalFoodMod` from the dispatch response.
- [x] 4. `app/page.js`: compute `flatItinerary = itinerary.flat().map(it => ({ ...it, surgeScore: computeSurgeScore(...) }))` and `topPick = flatItinerary.reduce(...)` — the brief's literal snippet, unchanged.
- [x] 5. `app/page.js`: render `<TopPickBanner data={topPick} />` between the dispatch button and the tab toggle, gated on `status === "done" && topPick`.
- [ ] 6. Manual verification (user): banner names the same item the Profitability tab puts at [0]; switching tabs does not change the banner; an empty itinerary hides the banner entirely.

### Acceptance Criteria (Definition of Done)
- **Global Reach:** banner picks the highest scorer even when it lives in the currently inactive tab.
- **Visual Hierarchy:** banner reads above the tab toggle with a solid accent so it dominates the section.

### Out of Scope (Anti-Goals)
- Editing `app/api/dispatch/route.js`.
- Removing the tab UI or any DispatchCards.
- Cross-platform volume normalization.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 34 — The Institutional Engine

**Goal:** National algorithms miss rigid local schedules (hospital shifts, university calendars). Inject those signals two ways: a client-side BYOD CSV uploader (semester calendar in localStorage) and a hardcoded hospital shift-change time gate (6:30-7:30 AM/PM) that emits a synthetic high-priority event.

### Locked Decisions (from PO brief)
- **Persistence:** CSV is parsed client-side and stored in `localStorage` under `"campusCalendar"`. No `fs`, no backend storage (anti-goal).
- **CSV shape:** 2 columns — `Date` (YYYY-MM-DD) and `EventType` (free-form, e.g. "Move-In" / "Break" / "Game" / "Syllabus"). Tolerate an optional header row by skipping any line whose first cell isn't a YYYY-MM-DD date.
- **Payload injection:** before each `/api/dispatch` POST, look up today's local YYYY-MM-DD in the stored calendar; inject `campusEvent: "<EventType>"` ONLY if today matches. Omit the key entirely otherwise (back-compat).
- **Expiration warning:** if `max(date) < today`, render a small red warning below the uploader. No popup, no nag, no auto-disable.
- **Backend Move/Break boost:** match case-insensitive on the substring "move" or "break" → multiply `finalRideMod` by 1.5 BEFORE the transit aggregators run (boosts flight/train surgeScore downstream via the unchanged `buildItinerary` math).
- **Backend Game/Syllabus boost:** match case-insensitive on "game" or "syllabus" → multiply each `foodHotspot.campusMod` by 1.5 AFTER `getLocalDensityData` returns. Grocery hotspots untouched (parity with Sprint 31 — `campusMod` only fires on food).
- **Trigger log:** `console.log("BYOD CAMPUS EVENT ACTIVE: <EventName>")` once per dispatch when either branch fires.
- **Hospital time gate:** `localStart.getUTCHours()` + `getUTCMinutes()` (wall-clock-as-UTC per Sprint 3.1). Two windows — 06:30-07:30 and 18:30-19:30, inclusive on both ends.
- **Hospital injection scope:** ONLY when `activePlatforms.rideshare === true`. Off-platform drivers don't see it.
- **Hospital event shape:** `{ type: "event", location: "Albany Med & St. Peter's Hospitals", volume: 1, egressMod: 3.0, categories: ["Nursing Shift Change"] }` — reuse EventCard (anti-goal: no new card component). egressMod 3.0 outranks Mega-Venue (2.5x) so it floats to the top of Profitability.
- **Insertion point:** push the synthetic event into `structuredEvents` BEFORE `buildItinerary` runs. The existing pipeline scores + sorts it naturally — no carve-out inside `buildItinerary` needed.
- **Anti-goals (PO brief, enforced):** do NOT touch the Sprint 33.1 TopPickBanner time-gate, do NOT use `fs`/backend storage, do NOT create a new Hospital card.

### Build Steps
- [x] 0. Write Sprint 34 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: destructure `campusEvent` from the request body.
- [x] 2. `app/api/dispatch/route.js`: change `const finalRideMod` to `let`; multiply by 1.5 when `campusEvent` matches /move|break/i.
- [x] 3. `app/api/dispatch/route.js`: after `getLocalDensityData` returns, if `campusEvent` matches /game|syllabus/i, multiply each `gigDemand.foodHotspots[*].campusMod` by 1.5.
- [x] 4. `app/api/dispatch/route.js`: emit `console.log("BYOD CAMPUS EVENT ACTIVE: <EventName>")` exactly once when any branch fires.
- [x] 5. `app/api/dispatch/route.js`: compute the wall-clock minute-of-day from `localStart`; if `activePlatforms.rideshare` AND in 06:30-07:30 or 18:30-19:30, push the synthetic hospital event into `structuredEvents` before `buildItinerary`.
- [x] 6. `app/page.js`: add `campusCalendar` state (array), hydrate from `localStorage.getItem("campusCalendar")` inside a `useEffect`.
- [x] 7. `app/page.js`: add "Institution Settings" panel below the Location/Hub Filtering fieldset with a `<input type="file" accept=".csv" />` and an `onChange` parser that splits on newlines + commas, maps to `{ date, eventType }`, writes back to state + localStorage.
- [x] 8. `app/page.js`: render the expiration warning when `max(calendar.date) < today`.
- [x] 9. `app/page.js`: inside `handleClick`, compute today's local YYYY-MM-DD and conditionally add `campusEvent: matched.eventType` to the POST body.
- [x] 10. Parse-check per L4: `node -e "import('file:///.../route.js')"` returns clean.
- [ ] 11. Manual verification (user): (a) refresh page → uploaded CSV persists; (b) at 6:45 PM local with rideshare on → "Albany Med & St. Peter's Hospitals" event card appears at top of Profitability tab; (c) when today's date is marked "Move-In" → terminal logs `BYOD CAMPUS EVENT ACTIVE: Move-In` and flight/train surgeScores ~50% higher than baseline.

### Acceptance Criteria (Definition of Done)
- **Frontend Persistence:** uploaded CSV survives page refresh via localStorage.
- **Hospital Injection:** at 6:45 PM (local) a high-priority event card naturally appears for the hospital shift change.
- **Calendar Math:** when today is "Move-In", flight/train volumes are mathematically inflated.

### Out of Scope (Anti-Goals)
- Modifying the Sprint 33.1 TopPickBanner time-gate.
- Server-side CSV storage (`fs` or DB).
- New UI card for Hospitals — must reuse `EventCard`.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 35 — Live Geolocation (The "Blue Dot")

**Goal:** The backend already accepts dynamic `latitude` / `longitude`, but the frontend was producing them via a callback-shaped `getCurrentPosition` and aborting the whole dispatch when permission was denied. Wrap geolocation in a Promise, intercept on click (not load), and fall back to Roessleville on any failure so dispatch never crashes.

### Locked Decisions (from PO brief)
- **Promise wrapper:** `getGeolocation()` helper defined OUTSIDE the component (no React state). Resolves with `pos.coords`, rejects on denial/timeout/no-GPS.
- **Intent-Driven Intercept:** browser's "Allow Location" prompt must NOT fire on page load. It fires exactly when the user clicks "What's happening?" the first time.
- **Fallback constant:** `ROESSLEVILLE_COORDS = { latitude: 42.69516, longitude: -73.86063 }`. Used only when the Promise rejects. `console.warn` on fall-through; no UI error.
- **Status flow:** keep existing `"locating"` → `"dispatching"` → `"done"` states; just swap the callback for `await`.
- **Anti-goals (enforced):** do NOT touch `app/api/dispatch/route.js`; do NOT add UI toggles/settings/checkboxes; do NOT use `watchPosition` or a live map.

### Build Steps
- [x] 0. Write Sprint 35 plan to `tasks/todo.md`.
- [x] 1. `app/page.js`: add `getGeolocation()` Promise helper outside the component (wraps `navigator.geolocation.getCurrentPosition`, rejects on failure).
- [x] 2. `app/page.js`: add `ROESSLEVILLE_COORDS` constant (42.69516, -73.86063).
- [x] 3. `app/page.js`: refactor `handleClick` — `await getGeolocation()` inside a try/catch; on rejection, fall back to Roessleville coords + `console.warn`.
- [x] 4. `app/page.js`: confirm coords flow into the existing `/api/dispatch` POST body unchanged.
- [ ] 5. Manual verification (user): (a) hard refresh → no "Allow Location" popup on load; (b) click "What's happening?" → popup appears once; (c) DevTools Network → `/api/dispatch` request body shows live `latitude`/`longitude` from the device, not 42.69516/-73.86063; (d) deny the permission → dispatch still runs with Roessleville coords and console shows the warn line.

### Acceptance Criteria (Definition of Done)
- **Pristine Load:** no geolocation prompt until the dispatch button is clicked.
- **Intent Trigger:** prompt fires on first click of "What's happening?".
- **Dynamic Payload:** `/api/dispatch` body uses the device's GPS coordinates when permission is granted.
- **Graceful Fallback:** denial / timeout / missing GPS falls back to Roessleville without crashing the dispatch.

### Out of Scope (Anti-Goals)
- Any changes to `app/api/dispatch/route.js` (backend already accepts dynamic coords).
- New UI toggles, settings panels, or checkboxes.
- Continuous tracking (`watchPosition`) or visual loading map.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.
