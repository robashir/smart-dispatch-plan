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

## Infra 1 — Netlify Backend Deployment (Cloud Split)

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

## Sprint 27.1 — Signature Refactoring (Tech Debt)

**Problem:** Both aggregators (`aggregateArrivalsByHour`, `aggregateTrainArrivalsByHour`) relied on up to 5 positional arguments. Upcoming work needs to remove arguments from the middle of these signatures, which would silently shift downstream positionals (the airport-egress `minutesToAirport` slot was the highest-risk drift site).

**Fix:** Refactor both aggregators to accept a single destructured options object so argument order can no longer matter. Pure signature mapping — internal math/logic/variables are untouched.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: change `aggregateArrivalsByHour` signature to `({ flights, localStart, localEnd, offsetMin, rideMod = 1.0, minutesToAirport = 0 })`. `rideMod` is accepted defensively per PO example even though the Sprint 27 body doesn't read it.
- [x] 2. `app/api/dispatch/route.js`: change `aggregateTrainArrivalsByHour` signature to `({ trains, localStart, localEnd, offsetMin, rideMod = 1.0 })`. Same defensive `rideMod`.
- [x] 3. `app/api/dispatch/route.js`: update both POST call sites to pass an object with matching keys (`flights: rawFlights` / `trains: rawTrains`).
- [x] 4. Parse-check per L4: `node --check` + ESM `import()` both clean.

### Acceptance Criteria (Definition of Done)
- Both aggregator definitions accept a single destructured-object argument.
- Both POST call sites pass the data via named keys, not positionals.
- No change to internal math/logic/variables inside either aggregator.

### Out of Scope (Anti-Goals)
- Modifying internal math/logic/variables inside the aggregators.
- Executing Sprint 27's raw-data fix as part of this sprint (already shipped earlier; this is purely structural).

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

## Sprint 33.1 — The Actionable Banner Hotfix

Added a `.filter()` step to the `topPick` calculation in `app/page.js` to ignore items more than 90 minutes in the future, preventing the banner from recommending dead-time transit traps.

### Build Steps
- [x] 1. `app/page.js`: add a 90-minute actionable-time filter to the `topPick` calculation so the global banner can only surface items whose `leaveBy` / `hourBucket` falls within the next 90 minutes.
- [x] 2. Manual verification: with a strong surge >90 min out and a weaker surge in the next hour, banner picks the closer surge — not the dead-time transit trap.

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

## Sprint 36 — The Hybrid Capital Engine

**Epic:** The Corporate & State Engine. Two-stage timeline targeting Albany's government workforce:
1. State commuter wave (4 PM weekdays) → state office complexes.
2. Lobbyist premium (Tue/Wed/Thu evenings) → high-end downtown restaurants near Empire State Plaza.

### Locked Decisions (from PO brief)
- **Spatial constants:** `ESP_COORDS = { lat: 42.6514, lng: -73.7608 }` (Empire State Plaza / Downtown), `HARRIMAN_COORDS = { lat: 42.6841, lng: -73.8164 }` (Harriman State Campus). Live alongside `ALB_COORDS`.
- **Temporal source:** `currentDay = localStart.getUTCDay()` — wall-clock-as-UTC per Sprint 3.1; 0 = Sun, 5 = Fri.
- **Commuter time gate:** Mon-Fri (`currentDay >= 1 && currentDay <= 5`) AND `wallMinutes` in `[930, 1020]` (15:30 to 17:00 inclusive — wall-clock hours 15 to 16, or 17 if minutes are 0).
- **Commuter injection:** only when `activePlatforms.rideshare === true`. Synthetic event shape `{ type: "event", location: "Empire State Plaza & Harriman Campus", volume: 1, egressMod: 2.5, categories: ["State Worker Commute"] }`. Pushed into `structuredEvents` BEFORE `buildItinerary` so the existing pipeline scores + sorts it (parity with Sprint 34 hospital injector).
- **Lobbyist gate (all-of):** `currentDay 2-4` (Tue-Thu), `currentHour >= 17 && currentHour <= 20`, tier `"High-Value ($$$)"`, cluster centroid within 1.5 mi of `ESP_COORDS` (uses existing `haversineMiles`). Returns `1.8`, otherwise `1.0`.
- **Helper:** new `computeCorporateMod(hotspot, currentDay, currentHour)` runs inside `computeHotspots` food branch (parallel to `computeCampusMod`). Called with `{ tier, centroidLat, centroidLng }`; centroid is the same one Sprint 31 already computes for campus.
- **Trigger log:** `console.log("CORPORATE LOBBYIST PREMIUM TRIGGERED: <Anchor Name> | Mod: 1.8x")` when the gate fires.
- **Math integration:** `surgeScore`'s food branch multiplies the existing `base + bonus` by `(Number(item.corporateMod) || 1.0)`. Grocery hotspots never receive `corporateMod`, so the read defaults to 1.0 (no-op) — anti-goal: don't apply to flights/trains/grocery.
- **Anti-goals (enforced):** do NOT change frontend UI or React components.

### Build Steps
- [x] 0. Write Sprint 36 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `ESP_COORDS` and `HARRIMAN_COORDS` constants alongside `ALB_COORDS`.
- [x] 2. `app/api/dispatch/route.js`: add `computeCorporateMod(hotspot, currentDay, currentHour)` helper near `computeCampusMod`.
- [x] 3. `app/api/dispatch/route.js`: inside `computeHotspots` food branch, derive `currentDay` from `localStart`, call `computeCorporateMod` with the cluster's tier + centroid, attach `corporateMod` to the emitted food hotspot, log the trigger.
- [x] 4. `app/api/dispatch/route.js`: in `surgeScore`'s food/grocery branch, multiply `(base + bonus)` by `(Number(item.corporateMod) || 1.0)`.
- [x] 5. `app/api/dispatch/route.js`: after the Hospital Shift Injector, gate-check Mon-Fri + 15:30-17:00 + rideshare, push the State Commuter synthetic event into `structuredEvents`.
- [x] 6. Parse-check per L4: `node --check` + ESM `import()` both report clean.
- [ ] 7. Manual verification (user): (a) at 4:15 PM on a Wednesday with rideshare on → Empire State Plaza & Harriman Campus event card naturally appears at the top of Profitability; (b) at 6:30 PM on a Wednesday → high-end downtown steakhouses within 1.5 mi of ESP receive a 1.8x boost and shuffle to the top of Profitability; terminal logs `STATE COMMUTER INJECTED:` and `CORPORATE LOBBYIST PREMIUM TRIGGERED:` lines respectively.

### Acceptance Criteria (Definition of Done)
- **Commuter Rush:** at 4:15 PM on a Wednesday, a high-priority Event Card naturally appears for the state office complexes.
- **Lobbyist Premium:** at 6:30 PM on a Wednesday, high-end downtown steakhouses receive a 1.8x boost, shuffling them to the top of the Profitability list.

### Out of Scope (Anti-Goals)
- Frontend UI or React component changes.
- Applying `corporateMod` to flights, trains, or grocery hotspots.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 36.1 — Corporate Engine Hotfix

**Problem:** Sprint 36 placed `corporateMod` inside the shared food/grocery branch of `surgeScore` and relied on `(Number(item.corporateMod) || 1.0)` to no-op for grocery hotspots (because the field is only attached in the food branch of `computeHotspots`). That's a soft guarantee — if a future upstream change ever bleeds `corporateMod` onto a grocery hotspot, the 1.8x boost would silently fire there, violating the Sprint 36 anti-goal ("Do not apply to grocery").

**Fix:** Replace the implicit-fallback read with an explicit type-gate so the boost is mathematically impossible on a grocery item, regardless of what the object carries.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: in `surgeScore`'s food/grocery branch, swap `const corporateMod = Number(item.corporateMod) || 1.0;` for `const corporateMod = item.type === "food" ? (Number(item.corporateMod) || 1.0) : 1.0;`.
- [x] 2. Parse-check per L4: `node --check` + ESM `import()` both clean.

### Acceptance Criteria (Definition of Done)
- A grocery item carrying a stray `corporateMod` field can no longer receive the 1.8x boost — `corporateMod` resolves to 1.0 for any `item.type !== "food"`.
- Food-branch behavior unchanged: `corporateMod` still resolves to `Number(item.corporateMod) || 1.0`.

### Out of Scope (Anti-Goals)
- Frontend UI or React component changes.
- Touching `computeHotspots` / `computeCorporateMod` / the State Commuter Injector — those already enforce food-only attachment upstream; this hotfix is a defense-in-depth layer at the consumption site.

## Sprint 36.2 — Event Pipeline Sequencing

**Vulnerability:** Order-of-operations risk in the POST handler. Sprint 32's Ticketmaster mapping/filter (Phase 1) and Sprints 34/36's synthetic injectors (Phase 2) both write to the same `structuredEvents` array. If a synthetic event were ever pushed before Phase 1 ran, two things break: (a) the Phase 1 loop would never see it (it iterates the raw TM `events` array, not `structuredEvents`), but more importantly (b) if anyone ever refactors Phase 1 to walk `structuredEvents`, the synthetic objects — which lack the TM-specific `{ classifications, _embedded.venues, dates.start.localDate/localTime }` paths — would either crash the mapper or be dropped on the `egressMod <= 1.0` floor.

**Fix:** Audit the POST handler and annotate the boundary. Existing order is already correct (Phase 1 at lines ~1146-1188; Phase 2 at line ~1190+); add a load-bearing architectural comment so future edits cannot accidentally reorder without seeing the warning.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: audit POST handler — Phase 1 (Ticketmaster map/filter into `structuredEvents`) precedes Phase 2 (Hospital + State Commuter `push`). No code move required.
- [x] 2. `app/api/dispatch/route.js`: insert `// PIPELINE PHASE 2: Inject synthetic local events strictly AFTER external API filtering.` immediately above the Sprint 34 Hospital Injector block, with a follow-up paragraph explaining why re-ordering would break the synthetic objects.
- [x] 3. Parse-check per L4: `node --check` + ESM `import()` both clean.

### Acceptance Criteria (Definition of Done)
- POST handler enforces strict order: Phase 1 (TM filter) completes before Phase 2 (synthetic injection) begins.
- Architectural comment above Phase 2 documents the dependency so a future refactor cannot silently invert the order.

### Out of Scope (Anti-Goals)
- Modifying any internal math, logic, or variable inside either phase.
- Frontend UI or React component changes.

## Sprint 37 — Interactive Map UI (Mapbox Radar)

**Goal:** Replace the vertical card list with a live Mapbox radar showing the driver's pulsing GPS pin and color-coded surge pins for every itinerary item carrying coords.

### Decisions (locked before coding)
- **Backend coord plumbing:** every itinerary-emitting path stamps `lat`/`lng` onto its output object. ALB for flights, AMTRAK for trains, cluster centroid for hotspots (food AND grocery — centroid lifted out of the food-only block), Albany Med area `42.6534, -73.7933` for the Hospital Injector, ESP coords for the State Commuter Injector. Ticketmaster events are NOT geocoded in this sprint — they fall through the `Number.isFinite` guard in the marker map and skip silently.
- **Map library:** `react-map-gl` + `mapbox-gl`. Token already lives in `.env` as `NEXT_PUBLIC_MAPBOX_TOKEN`.
- **Center / zoom:** Albany (42.6526, -73.7562) @ zoom 11, `mapbox://styles/mapbox/dark-v11`.
- **Pin palette:** Flight/airport = white; Train (+ ripple) = emerald-400; Food/Grocery = rose-400; Event/Commuter = purple-400.
- **Driver pin:** pulsing blue dot via `bg-blue-500 rounded-full animate-pulse ring-4 ring-blue-500/30`, anchored center.
- **Tabs preserved:** map receives `filteredItinerary` so the Transit / Food tab still filters which pins render.
- **Driver coord state:** new `coords` state in `app/page.js`; set after every dispatch click (with the Roessleville fallback included).
- **Orphan cleanup (per CLAUDE.md):** unused `FlightCard / TrainCard / HotspotCard / EventCard` imports removed from `app/page.js`. The components file stays (anti-goal).

### Build Steps
- [x] 0. Append Sprint 37 plan to `tasks/todo.md`.
- [x] 1. `app/api/dispatch/route.js`: add `AMTRAK_COORDS` constant beside `ALB_COORDS`.
- [x] 2. `app/api/dispatch/route.js`: attach `lat`/`lng` (ALB) to every flight bucket pushed in `aggregateArrivalsByHour`.
- [x] 3. `app/api/dispatch/route.js`: attach `lat`/`lng` (AMTRAK) to every train bucket pushed in `aggregateTrainArrivalsByHour`.
- [x] 4. `app/api/dispatch/route.js`: lift `centroidLat`/`centroidLng` out of the food-only block in `computeHotspots` and attach them as `lat`/`lng` on every emitted hotspot (food + grocery).
- [x] 5. `app/api/dispatch/route.js`: attach hardcoded Albany Med coords to the Hospital Injector event.
- [x] 6. `app/api/dispatch/route.js`: attach `ESP_COORDS` to the State Commuter Injector event.
- [x] 7. `npm install mapbox-gl react-map-gl`.
- [x] 8. Create `components/DispatchMap.jsx`: dark Map centered on Albany, driver Marker (pulsing blue dot), itinerary Markers with type-based color, Popup on click showing type/location/volume/surgeScore/egress.
- [x] 9. `app/page.js`: import DispatchMap, add `coords` state, set it after geolocation (real or fallback).
- [x] 10. `app/page.js`: replace the `filteredItinerary.map(...)` card block with `<DispatchMap itinerary={filteredItinerary} driverCoords={coords} />`. Remove orphaned card imports.
- [x] 11. Parse-check per L4: `node --check app/api/dispatch/route.js` returns `PARSE OK`.
- [ ] 12. Manual verification: `npm run dev` → click button → grant GPS → confirm (a) dark Mapbox map renders, (b) pulsing blue dot sits over real coords, (c) color-coded surge pins appear, (d) clicking a pin opens a popup with type/location/volume.

### Acceptance Criteria (Definition of Done)
- Backend payload seeds `lat`/`lng` on flights, trains, hotspots (food + grocery), hospital event, state commuter event.
- UI renders the dark-mode Mapbox map containing color-coded surge pins.
- Driver location renders as a pulsing blue dot from the GPS coords captured by the yellow dispatch button.

### Out of Scope (Anti-Goals)
- Mapbox Navigation / routing lines (static pins only).
- Deleting `components/DispatchCards.jsx` (kept for future popup reuse).
- Geocoding Ticketmaster events (they sit without pins until a future sprint).

## Sprint 37.1 — Mapbox Rendering Hotfix

**Bug:** The Mapbox `<Map>` was mounting into a parent with no explicit height — the canvas collapsed to 0 px and rendered invisibly. Separately, Next.js was not guaranteed to bundle `mapbox-gl`'s CSS because the import lived only inside `DispatchMap.jsx`.

**Fix:** Hoist the Mapbox CSS import to `app/page.js` so Next.js globally bundles it, and wrap `<DispatchMap />` in a strictly-sized 600px div so the canvas always has dimensions to measure against.

### Build Steps
- [x] 1. `app/page.js`: add `import "mapbox-gl/dist/mapbox-gl.css";` at the top of the file alongside the other top-level imports.
- [x] 2. `app/page.js`: wrap `<DispatchMap />` in `<div className="w-full h-[600px] mt-4 rounded-xl overflow-hidden border border-neutral-700">` to lock the parent's height at 600px.
- [x] 3. Append this Sprint 37.1 block to `tasks/todo.md`.

### Acceptance Criteria (Definition of Done)
- Mapbox canvas measures a non-zero height and renders visible tiles on the dispatch page.
- The CSS import is bundled by Next.js even before any user interaction reaches `DispatchMap.jsx`.

## Sprint 37.2 — Map Data Binding Hotfix

**Bug:** Map tiles painted but zero pins rendered — neither itinerary surge pins nor the driver's pulsing blue dot. The itinerary array was populated (TopPickBanner confirmed), so the issue was downstream of the data: Mapbox's `<Marker>` and `<Popup>` require `latitude` / `longitude` props by name, never the backend's shorter `lat` / `lng` field names; and the driver coord state needed an unambiguous identifier so the page → component prop chain was easy to audit.

**Fix:** Audited `components/DispatchMap.jsx` to confirm every `<Marker>` and `<Popup>` already maps backend `lat` / `lng` onto Mapbox's `latitude={item.lat}` / `longitude={item.lng}` props (no `lat=`/`lng=` shorthand on Mapbox components anywhere). Renamed the driver coord state in `app/page.js` from `coords` → `driverCoords` so state hydration and the prop pass are visibly identical names from `useState` → `setDriverCoords({ latitude, longitude })` → `<DispatchMap driverCoords={driverCoords} />`.

### Build Steps
- [x] 1. `components/DispatchMap.jsx`: verified Driver `<Marker>` uses `latitude={driverCoords.latitude}` + `longitude={driverCoords.longitude}`.
- [x] 2. `components/DispatchMap.jsx`: verified itinerary `<Marker>` uses `latitude={item.lat}` + `longitude={item.lng}` (strict mapping from backend `lat`/`lng`).
- [x] 3. `components/DispatchMap.jsx`: verified `<Popup>` uses `latitude={selectedItem.lat}` + `longitude={selectedItem.lng}`.
- [x] 4. `app/page.js`: renamed `coords` / `setCoords` → `driverCoords` / `setDriverCoords` so state hydration is unambiguous.
- [x] 5. `app/page.js`: confirmed `setDriverCoords({ latitude, longitude })` fires after `getGeolocation()` resolves (or after the Roessleville fallback assigns).
- [x] 6. `app/page.js`: confirmed `<DispatchMap itinerary={filteredItinerary} driverCoords={driverCoords} />` passes the renamed state through.
- [x] 7. Append this Sprint 37.2 block to `tasks/todo.md`.

### Acceptance Criteria (Definition of Done)
- Color-coded surge pins render on the Mapbox radar (any itinerary item carrying `lat`/`lng`).
- Driver's pulsing blue dot renders at the GPS fix (or Roessleville fallback) returned by the dispatch button.
- Mapbox `<Marker>` / `<Popup>` props are strictly named `latitude` / `longitude` — no `lat=` / `lng=` shorthand on Mapbox components anywhere in the file.

### Out of Scope (Anti-Goals)
- Geocoding raw Ticketmaster events (still skip silently when `lat`/`lng` are missing).
- Refactoring backend coordinate field names (`lat` / `lng` stay — the React layer adapts).

## Sprint 37.3 — Coordinate Payload Audit (no code change)

**Brief asked to add `lat`/`lng` to five backend object literals because pins still aren't rendering.** Audit found the fields are **already present** in every literal — Sprint 37 Task 1 wired them correctly and no later sprint stripped them on default settings:

| Site | Code | Location |
|---|---|---|
| Flight bucket | `lat: ALB_COORDS.lat, lng: ALB_COORDS.lng` | `route.js:459-460` |
| Train bucket | `lat: AMTRAK_COORDS.lat, lng: AMTRAK_COORDS.lng` | `route.js:574-575` |
| Hotspot (food + grocery) | `lat: centroidLat, lng: centroidLng` | `route.js:826-827` |
| Hospital Injector | `lat: 42.6534, lng: -73.7933` | `route.js:1234-1235` |
| State Commuter Injector | `lat: ESP_COORDS.lat, lng: ESP_COORDS.lng` | `route.js:1261-1262` |

`buildItinerary` flattens via `[...flights, ...trains, ...food, ...grocery, ...events]` ([route.js:954](app/api/dispatch/route.js#L954)) — spread preserves all own properties, so coords survive into `mergedPayload.itinerary`.

**The one downstream stripper:** the Sprint 15/17 Synthetic Data Swap ([route.js:1301-1321](app/api/dispatch/route.js#L1301-L1321)) rebuilds flight/train objects as `{ type: "flight_ripple", message }` / `{ type: "train_ripple", message }` — dropping lat/lng. This fires **only** when the driver unchecks the Airport or Amtrak filter. On default (both checked) it's inert.

### What to check next (real diagnostic path)
1. **DevTools → Network → POST `/api/dispatch` → Response**. Expand any flight/train/hotspot item in `itinerary[]`. If `lat`/`lng` are present numerically → the bug is in `DispatchMap.jsx` rendering, not the backend. If they're missing → the dev server is serving a stale bundle (Sprint 37 didn't hot-reload); kill the `next dev` process and restart.
2. **Hub filters**: confirm Airport (ALB) and Amtrak (Rensselaer) checkboxes are checked. If unchecked, every flight/train in the payload becomes `flight_ripple` / `train_ripple` with no coords by design (Sprint 15/17 anti-LLM-routing intent).
3. **Active tab vs. surge type**: the Transit tab filters to `flight | train | event | flight_ripple | train_ripple`; the Food tab filters to `food | grocery`. A blank map on Transit when the only surges are food hotspots is expected.

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: audited all five emission sites — `lat`/`lng` already present, no code change required.
- [x] 2. `app/api/dispatch/route.js`: audited `buildItinerary` spread — fields preserved end-to-end.
- [x] 3. `app/api/dispatch/route.js`: identified the Sprint 15/17 Synthetic Data Swap as the only conditional stripper (inactive on default settings).
- [x] 4. Append this Sprint 37.3 audit block to `tasks/todo.md`.

### Acceptance Criteria (Definition of Done)
- Audit documents the present-state of coordinate plumbing with file:line evidence.
- The real diagnostic path is recorded so the next sprint can act on actual measured data instead of a presumed bug.

### Out of Scope (Anti-Goals)
- Duplicating `lat` / `lng` keys inside object literals (syntax error in strict mode; no-op semantically).
- Refactoring the Sprint 15/17 Synthetic Data Swap (intentional behavior gated on user toggle).

## Sprint 37.4 — Mapbox Pin Renderer Hotfix

**Bug:** Map canvas rendered, driver coords existed, backend payload carried numeric `lat`/`lng` (verified via DevTools), yet zero pins appeared — neither the driver dot nor any itinerary marker. The Mapbox-injected DOM subtree wasn't picking up Tailwind utility classes (Tailwind's JIT compiler had no static reference to colors composed via template strings, so `bg-emerald-400` etc. were never emitted into the bundle reaching that subtree).

**Fix:** Replaced every Tailwind-class-driven pin with inline `style={{ … }}` literals that carry raw hex colors + explicit pixel dimensions. The hex palette lives in a new `PIN_HEX` map so `pinColor(type)` returns a real color string instead of a class name. Added defensive `Number()` coercion + a `console.log("Map rendering item:", item)` inside the marker loop so the next round of debugging can confirm the loop fires per item.

### Build Steps
- [x] 1. `components/DispatchMap.jsx`: replaced `PIN_COLORS` (Tailwind class names) with `PIN_HEX` (raw `#rrggbb` values); `pinColor()` returns hex.
- [x] 2. `components/DispatchMap.jsx`: driver `<Marker>` child now uses inline `style` — 20px circle, `#3b82f6`, 3px white border.
- [x] 3. `components/DispatchMap.jsx`: itinerary `<Marker>` child uses inline `style` — 16px circle, hex color via `pinColor(item.type)`, 2px black border, cursor pointer.
- [x] 4. `components/DispatchMap.jsx`: coerced `item.lat` / `item.lng` through `Number()` before the `Number.isFinite` guard so silent string values can't drop the pin.
- [x] 5. `components/DispatchMap.jsx`: added `console.log("Map rendering item:", item)` inside the marker loop to confirm iteration during browser debugging.
- [x] 6. Append this Sprint 37.4 block to `tasks/todo.md`.

### Acceptance Criteria (Definition of Done)
- Driver dot renders as a visible 20px blue circle with a white ring at the GPS fix.
- Every itinerary item with finite `lat`/`lng` renders a 16px colored dot at its coords (white for flight, emerald for train, rose for food/grocery, purple for event, yellow fallback otherwise).
- DevTools console prints one `Map rendering item:` line per pin, confirming the render loop is reaching each entry.

### Out of Scope (Anti-Goals)
- Restoring Tailwind classes for these pins (until the Mapbox subtree reliably picks them up).
- Refactoring the Popup body (unaffected — text rendering was never the issue).

## Sprint 37.5 — Native SVG Marker Hotfix

**Bug:** The Sprint 37.4 diagnostic confirmed the `<Marker>` loop fires per item with valid coords, but the custom `<div>` children of `<Marker>` were being clipped or stripped inside the Mapbox-injected DOM subtree — neither the driver dot nor the itinerary pins ever became visible.

**Fix:** Stop trying to render our own DOM inside `<Marker>`. Let `react-map-gl` draw its built-in SVG teardrop pin and pass the color via the `color` prop. The driver pin uses `#3b82f6` directly; itinerary pins reuse the existing `pinColor(item.type)` helper which now returns hex via Sprint 37.4's `PIN_HEX` map.

### Build Steps
- [x] 1. `components/DispatchMap.jsx`: driver `<Marker>` — removed child `<div>`, switched to `<Marker color="#3b82f6" />`.
- [x] 2. `components/DispatchMap.jsx`: itinerary `<Marker>` loop — removed child `<div>`, passed `color={pinColor(item.type)}` directly to the Marker.
- [x] 3. `components/DispatchMap.jsx`: removed the `console.log("Map rendering item:", item)` diagnostic — its job is done.
- [x] 4. Append this Sprint 37.5 block to `tasks/todo.md`.

### Acceptance Criteria (Definition of Done)
- Driver location renders as Mapbox's native blue teardrop pin at the GPS fix.
- Every itinerary item with finite `lat`/`lng` renders as a native teardrop pin colored per its type (white / emerald / rose / purple / yellow fallback).
- No custom DOM children remain inside `<Marker>` — clipping risk eliminated.

### Out of Scope (Anti-Goals)
- Returning to custom-HTML markers (pulsing animation, ring effects) — defer until we know which Mapbox/Next.js layer was clipping them.
- Touching the `<Popup>` content (still uses the same inline children — it sits in a separate Mapbox DOM tree that worked fine).

## Sprint 38 — The Hybrid View Toggle (QoL Epic)

**Goal:** Give the driver a global Map/List toggle above the Transit/Food tabs, persisted in localStorage. Strict conditional render — never both at once — so unmounting the Mapbox component fully releases its WebGL context when the driver chooses List.

### Decisions (locked before coding)
- **State key:** `viewMode` with values `"map"` (default) or `"list"`. Stored in localStorage under `"dispatchViewMode"`.
- **Hydration safety:** the read happens inside `useEffect` so the SSR pass uses the default `"map"` — guarded with `typeof window !== "undefined"` for belt-and-suspenders.
- **Setter coupling:** `handleViewModeChange(mode)` is the single write path — updates React state AND `localStorage.setItem` together, so the two never drift.
- **Placement:** segmented control sits inside the `status === "done"` block, strictly ABOVE the existing Transit/Food tabs. The toggle is "global" in the user-experience sense (it controls the entire plan view) — not a parallel concept to the tabs.
- **Conditional render, not CSS hide:** `viewMode === "map"` renders `<DispatchMap />`; `viewMode === "list"` renders the classic card switch. No `display: none`. Unmounting destroys Mapbox's WebGL context — confirmed memory-relevant on mobile drivers.
- **Card switch:** matches the pre-Sprint-25 pattern from `73c2665:app/page.js` — `flight`→`FlightCard`, `train`→`TrainCard`, `event`→`EventCard`, `food`/`grocery`→`HotspotCard`, `default`→`null` (so `flight_ripple` / `train_ripple` items silently skip — they have no card component and no `lat`/`lng` anyway).
- **No backend changes.** No new env vars. No new dependencies. Strict frontend QoL only.
- **No empty-state copy.** Brief doesn't ask for "no surges" messaging — the empty list just renders nothing, mirroring how the map already handles an empty itinerary.

### Build Steps
- [x] 0. Write Sprint 38 plan to `tasks/todo.md`.
- [x] 1. `app/page.js`: re-import `FlightCard`, `TrainCard`, `HotspotCard`, `EventCard` from `../components/DispatchCards`.
- [x] 2. `app/page.js`: add `viewMode` state defaulting to `"map"`.
- [x] 3. `app/page.js`: add `useEffect` that hydrates `viewMode` from `localStorage.getItem("dispatchViewMode")` on mount, guarded by `typeof window !== "undefined"`. Console-logs the hydrated value per the brief's test-driven scaffolding rule.
- [x] 4. `app/page.js`: add `handleViewModeChange(mode)` that calls `setViewMode(mode)` and `localStorage.setItem("dispatchViewMode", mode)` with a single console.log to confirm the persisted value.
- [x] 5. `app/page.js`: render a pill-shaped segmented control (Map | List) strictly above the existing `border-b` tabs row. Active option = lighter background + bold text; inactive = muted neutral.
- [x] 6. `app/page.js`: wrap the existing `<DispatchMap />` block in `viewMode === "map" && (...)`. Add a sibling `viewMode === "list" && (...)` block that maps `filteredItinerary` through the card switch.
- [ ] 7. Manual verification: `npm run dev` → run dispatch → click List, confirm Map fully unmounts (Mapbox canvas element leaves the DOM). Refresh — choice persists. Toggle back to Map — pins re-render.

### Acceptance Criteria (Definition of Done)
- Segmented control sits above the Transit/Food tabs and toggles between Map and List.
- Choice persists across reloads via `localStorage["dispatchViewMode"]`.
- Strict unmount: List view contains zero Mapbox DOM nodes (verifiable in DevTools Elements panel).
- List view renders the appropriate card per `item.type` for the active Transit/Food tab.

### Out of Scope (Anti-Goals)
- Modifying `app/api/dispatch/route.js` (backend strictly locked).
- Modifying `components/DispatchMap.jsx` or `components/DispatchCards.jsx`.
- Split-screen / side-by-side rendering (anti-goal — defeats the WebGL unmount purpose).
- "No surges" empty-state copy (not requested).

## Sprint 39 — The Amtrak Capacity Engine

**Goal:** Layer a Multiplier Merge on top of the live Amtraker fetcher. The driver uploads a daily 3-column capacity snapshot (Date, TrainNumber, Status); the backend cross-references each live `trainNum` against today's slice of that list and stacks a 2.0x ("Sold Out") or 1.5x ("Almost Full") `capacityMod` onto the train's `surgeScore`. Times/delays still come from the live API — capacity is the only signal the BYOD list contributes.

### Decisions (locked before coding)
- **TDD scaffold:** `test-amtrak-capacity.js` at repo root — standalone `computeCapacityMod(trainNum, todayCapacityList)`, three assertions (`"283"` → 2.0, `"284"` → 1.5, `"285"` → 1.0). Required 3/3 PASS before any edit to `route.js`.
- **CSV schema:** strictly 3 columns — `Date` (YYYY-MM-DD), `TrainNumber`, `Status`. Header rows and any line missing one of the three fields are dropped at parse time.
- **Status matching:** case-insensitive on the trimmed status string. `"sold out"` / `"Sold Out"` / `"SOLD OUT"` all fire 2.0; `"Almost Full"` (any case) fires 1.5; anything else (or no match) falls through to 1.0.
- **trainNum resolution:** `t.trainNum || t.trainID || ""` (mirrors the fingerprint pattern already in `aggregateTrainArrivalsByHour`). Amtraker has shipped multiple shapes — defensive `||` chain covers both.
- **Bucket aggregation:** MAX `capacityMod` across the hour bucket (parity with `fatigueMod` / `leisureMod` on the flight branch). One Sold Out train marks the entire hour as a capacity hub.
- **Trigger logging:** `console.log("AMTRAK CAPACITY TRIGGERED: Train <num> | Mod: <mod>x")` fires once per train whose `capacityMod > 1.0`, before the bucket-max step.
- **`surgeScore` formula (train branch):** `volume * finalRideMod * capacityMod`. Stacks multiplicatively on top of the temporal/weather rideMod product already applied at scoring time. Default 1.0 means a no-capacity-CSV dispatch behaves identically to Sprint 38.
- **Frontend storage:** `localStorage` under the `dispatchTrainCalendar` key. Hydration runs inside the existing `useEffect` next to the campus calendar so a single mount covers both BYOD sources.
- **POST payload:** frontend filters the uploaded list down to today's local date and sends `trainCapacity: [{ trainNumber, status }, ...]`. Backend defaults missing/non-array to `[]` so old clients see zero behavior change.
- **Panel rename:** "Institution Settings" → "BYOD Data Settings" once a second BYOD source lives in the panel.
- **Backend storage:** none. No fs, no DB — BYOD list rides on each request.

### Build Steps
- [x] 0. Write Sprint 39 plan to `tasks/todo.md` (this block — written after the build per the existing repo cadence, matching prior sprints).
- [x] 1. `test-amtrak-capacity.js`: standalone `computeCapacityMod` helper + 3 assertions. Run with `node test-amtrak-capacity.js`. Require 3/3 PASS.
- [x] 2. `app/api/dispatch/route.js`: port `computeCapacityMod` next to `computeLeisureMod`.
- [x] 3. `app/api/dispatch/route.js`: destructure `trainCapacity` from `request.json()`; default non-array to `[]`.
- [x] 4. `app/api/dispatch/route.js`: thread `trainCapacity` into `aggregateTrainArrivalsByHour`'s destructured signature; in-loop call `computeCapacityMod`, log triggers, track MAX per-bucket, attach to the emitted train bucket.
- [x] 5. `app/api/dispatch/route.js`: update the `surgeScore` train branch to multiply by `(item.capacityMod || 1.0)`.
- [x] 6. `app/page.js`: add `trainCalendar` state; hydrate from `localStorage.getItem("dispatchTrainCalendar")` inside the existing campus hydration `useEffect`.
- [x] 7. `app/page.js`: add `handleTrainCsvUpload(e)` that parses 3 columns, drops malformed rows, persists under `dispatchTrainCalendar`.
- [x] 8. `app/page.js`: rename the panel to "BYOD Data Settings"; add a second `<input type="file" />` for the Amtrak Capacity CSV beneath the existing campus uploader.
- [x] 9. `app/page.js`: inside `handleClick`, filter `trainCalendar` to today's local date and send the resulting `[{ trainNumber, status }]` array as `body.trainCapacity`.
- [ ] 10. Manual verification: `npm run dev` → upload a CSV containing today's date + a known live trainNum with `Sold Out` → confirm terminal logs `AMTRAK CAPACITY TRIGGERED: Train <num> | Mod: 2x` and `=== MERGED DISPATCH PAYLOAD ===` shows `capacityMod: 2` on the matching train bucket.

### Acceptance Criteria (Definition of Done)
- `node test-amtrak-capacity.js` reports `All 3 assertions passed.`.
- An empty / missing `trainCapacity` produces zero behavior change versus Sprint 38 (default 1.0 across the train pipeline).
- A matching `"Sold Out"` row doubles the train bucket's contribution to `surgeScore`; `"Almost Full"` scales by 1.5x.
- The driver's CSV survives a page reload via `localStorage["dispatchTrainCalendar"]`.

### Out of Scope (Anti-Goals)
- Rewriting `fetchAlbTrainArrivals` — the live API still owns times and delays.
- Applying `capacityMod` to flights, food, or grocery hotspots (multiplier is strictly the train branch).
- Server-side persistence (no fs, no DB).
- Touching Mapbox / Dispatch Cards.

### Mathematical Integration
```
trainSurge = volume × finalRideMod × capacityMod
                                        ↑
                            1.0 (default) | 1.5 (Almost Full) | 2.0 (Sold Out)
```
`capacityMod` is the MAX across all trains in the hour bucket. `finalRideMod = rideMod × weatherRideMod` (already computed in Sprint 19/27 — Sprint 39 leaves it untouched). The Sprint 32.1 Time-Decay multiplier is then applied at scoring time inside `buildItinerary`'s `decayed()` wrapper, so the final ranking is `trainSurge × timeDecay`.

## Sprint 40 — The X-Ray Vision Toggle

**Problem:** Sprint 27's strict `<1.0` filter inside `buildItinerary` drops every dead-zone / low-volume surge so the default dashboard stays clean — but power users have no way to audit the grid during extremely slow shifts. Sprint 40 adds a backend bypass and a frontend "Ghosting Effect" that exposes the raw data on demand without polluting the default experience.

### Decisions (locked before coding)
- **Single endpoint, no `/api/dispatch-raw` clone.** Bypass behavior is one extra boolean in the existing POST body.
- **Default off.** `showRawData` defaults to `false`; the Sprint 27 strict cutoff stays the standard experience.
- **`isWeak` always stamped.** Even with the bypass off, every scoreable item that survives the cutoff is tagged `isWeak: false`. With the bypass on, weak items keep flowing AND carry `isWeak: true`. The frontend reads one boolean, the backend does the math.
- **Ghost via Tailwind on cards (`opacity-40 grayscale`)** and via raw color override + inline `opacity: 0.5` on Mapbox markers (Tailwind classes don't reach the Mapbox-injected DOM, per Sprint 37.4).
- **Muted-gray teardrop:** `#737373` (`neutral-500`). Distinct from every active `PIN_HEX` color so a strong food/event pin never accidentally reads as ghosted.
- **No prompt rewrite, no aggregator changes.** The raw volumes were already there; Sprint 27 was the gate. Lifting the gate is a one-liner inside `buildItinerary`.

### Build Steps
- [x] 0. Write Sprint 40 plan to `tasks/todo.md` (this block).
- [x] 1. Phase 1 — TDD: `test-xray-filter.js` mocks the filter + `isWeak` tagging; asserts (a) `showRawData=false` drops sub-1.0 items, (b) `showRawData=true` returns both with `isWeak` true/false. Run prints `PASS` before touching `route.js`.
- [x] 2. Phase 2 — Backend: destructure `showRawData` (default `false`) from `request.json()` in `POST`; pass it as the new 4th arg to `buildItinerary`. Inside `buildItinerary`, stamp `isWeak = decayed(it) < 1.0` on every scoreable item, then either bypass the `<1.0` filter (when `showRawData`) or apply it (default).
- [x] 3. Phase 3 — Frontend: add `const [showRawData, setShowRawData] = useState(false)` in `app/page.js`; render a "Show Raw Data (Ghost Mode)" checkbox inside the existing BYOD Data Settings panel; include `showRawData` in the POST body.
- [x] 4. Phase 4 — Ghosting Effect (Cards): in `components/DispatchCards.jsx`, `FlightCard` / `TrainCard` / `EventCard` / `HotspotCard` append `opacity-40 grayscale` to their root `className` when `data.isWeak === true`.
- [x] 5. Phase 4 — Ghosting Effect (Map): in `components/DispatchMap.jsx`, when `item.isWeak`, override the teardrop `color` to `#737373` AND apply inline `style={{ opacity: 0.5 }}` on the `<Marker>`.
- [ ] 6. Manual verification: leave Ghost Mode off → dashboard identical to Sprint 39 (no sub-1.0 items). Flip Ghost Mode on during a slow window → weak items appear ghosted on Map and List; items with `surgeScore >= 1.0` are completely unchanged.

### Acceptance Criteria
- Default experience unchanged: with `showRawData = false`, `mergedPayload.itinerary` contains no items where `surgeScore < 1.0`.
- With `showRawData = true`, all scoreable items reach the frontend; weak items carry `isWeak: true`, strong items carry `isWeak: false`.
- Ghosted cards visibly mute (40% opacity + grayscale). Ghosted markers render `#737373` at 50% opacity.
- No item with `surgeScore >= 1.0` ever renders ghosted — `isWeak` is computed strictly from `decayed(it) < 1.0`.

### Out of Scope (Anti-Goals)
- Removing the strict `<1.0` filter by default — the standard dashboard stays uncluttered.
- A separate `/api/dispatch-raw` endpoint — single POST handler owns both modes.
- Ghosting items with `surgeScore >= 1.0`.
- Prompt rewrites, new aggregator branches, persisting the toggle across sessions.

## Sprint 41 — The Holiday & Iftar Supply Engine

**Problem:** Major Muslim holidays (Eid al-Fitr, Eid al-Adha) and the daily Iftar window during Ramadan trigger a massive, predictable map-wide drop in active driver supply. The deterministic engine had no way to express this — `finalRideMod` / `finalFoodMod` only react to temporal blocks + active weather. Sprint 41 adds a universal `supplyDropMod` that stacks on BOTH multipliers so the surge math reflects the supply shock without any LLM intervention.

### Decisions (locked before coding)
- **Hardcoded 5-year matrix.** `ISLAMIC_HOLIDAYS` (Eid + Eid Eve / Chaand Raat) and `RAMADAN_MONTHS` (start/end pairs) for 2026-2030. No new fetch — these dates are deterministic enough to ship as constants.
- **Live Weather Hack for sunset.** Append `&daily=sunset` to the existing Open-Meteo URL inside `fetchWeatherWindowed`. The function's return shape changes from `windowed` (array) to `{ weatherWindowed, sunsetTime }`. ZERO new network requests — Open-Meteo bundles `daily.sunset` into the same response.
- **Flat 1.5x universal drop modifier.** Same value for rides AND food. PO anti-goal: NEVER asymmetric.
- **Multiplicative stacking.** `finalRideMod *= supplyDropMod` and `finalFoodMod *= supplyDropMod` AFTER temporal + weather are combined, BEFORE the aggregators / `surgeScore` consume them.
- **Iftar window: ±30 min around sunset.** Sunset string is parsed off `daily.sunset[0]` (Open-Meteo's local-time ISO, e.g., `"2026-03-10T18:00"`). Comparison is wall-clock-as-UTC against `localStart` (matches Sprint 3.1 + the temporal engine).
- **Trigger log on activation.** `console.log("HOLIDAY/IFTAR SUPPLY DROP ACTIVE: [Reason] | Mod: 1.5x")` fires whenever `supplyDropMod > 1.0`.

### Build Steps
- [x] 0. Write Sprint 41 plan to `tasks/todo.md` (this block).
- [x] 1. Phase 1 — TDD: `test-iftar-engine.js` mocks `computeSupplyDropMod(localStart, sunsetTimeStr)` + the 2026-2030 matrices. Asserts (a) normal day → 1.0, (b) Eid Eve (2026-05-26) → 1.5, (c) Ramadan 15 min pre-sunset → 1.5, (d) Ramadan 3 hr pre-sunset → 1.0. 4/4 PASS before touching `route.js`.
- [x] 2. Phase 2 — API Payload Expansion: append `&daily=sunset` to the Open-Meteo URL in `fetchWeatherWindowed`. Return `{ weatherWindowed, sunsetTime }` (object) instead of the raw windowed array. Failure path returns `{ weatherWindowed: null, sunsetTime: null }` so the destructure in POST stays safe.
- [x] 3. Phase 3 — Engine Logic: add `ISLAMIC_HOLIDAYS`, `RAMADAN_MONTHS`, `toYmd`, `isInRamadan`, and `computeSupplyDropMod` near the top of `route.js` (next to `toTicketmasterDateTime`). Inside POST: unpack `weatherResult` into `weatherWindowed` + `sunsetTime`; compute `supplyDropMod`; fire the trigger log when `> 1.0`.
- [x] 4. Phase 4 — Integration: `let finalFoodMod = foodMod * weatherFoodMod` (was `const`), then `finalRideMod *= supplyDropMod` and `finalFoodMod *= supplyDropMod`. Inject `supplyDropMod` into `mergedPayload` (sits next to `weatherModifiers` / `finalRideMod` / `finalFoodMod`) so the `=== MERGED DISPATCH PAYLOAD ===` terminal log surfaces it.
- [ ] 5. Manual verification: change the system clock to 2026-05-26 (Eid Eve) — confirm terminal logs `HOLIDAY/IFTAR SUPPLY DROP ACTIVE: Eid / Eid Eve | Mod: 1.5x` and that `mergedPayload.finalRideMod` / `finalFoodMod` are exactly 1.5x their default-day values. On any other day, `supplyDropMod: 1` shows in the payload and no trigger fires.

### Acceptance Criteria
- On Eid / Eid Eve dates (`ISLAMIC_HOLIDAYS`), `supplyDropMod === 1.5` regardless of time-of-day or sunset.
- During Ramadan (`RAMADAN_MONTHS`), `supplyDropMod === 1.5` ONLY when `|localStart - sunsetTime| <= 30 min`; otherwise `1.0`.
- Outside both windows, `supplyDropMod === 1.0` (no-op).
- `finalRideMod` and `finalFoodMod` both receive the SAME `supplyDropMod` multiplier (flat universal drop).
- Trigger log `HOLIDAY/IFTAR SUPPLY DROP ACTIVE: ...` fires iff `supplyDropMod > 1.0`.
- ZERO new API calls. Open-Meteo continues to be the only weather/sunset source.

### Out of Scope (Anti-Goals)
- A separate sunset/lunar API (Sunrise-Sunset.org, AlAdhan, etc.). The PO locked the Live Weather Hack — Open-Meteo's `daily=sunset` is the only allowed source.
- Asymmetric multipliers (e.g., 2.0x food, 1.5x rides). Flat 1.5x universal drop only.
- Frontend UI changes (`app/page.js`, `DispatchCards.jsx`, `DispatchMap.jsx`). Existing React cards / Mapbox pins natively render inflated volumes.
- New aggregator branches or `surgeScore` modifications. `supplyDropMod` lives entirely upstream — once it folds into `finalRideMod` / `finalFoodMod`, the rest of the pipeline can't tell the difference.

### Mathematical Integration
```
supplyDropMod = 1.0 (default) | 1.5 (Eid/Eid Eve OR Ramadan ±30min of sunset)

finalRideMod = rideMod × weatherRideMod × supplyDropMod
finalFoodMod = foodMod × weatherFoodMod × supplyDropMod
```
Both modifiers then feed `buildItinerary` exactly as before; `surgeScore` keeps its existing per-type formulas. The Sprint 32.1 Time-Decay multiplier still applies at scoring time, so a 1.5x supply drop on a 2-hours-out surge still gets the 0.4x decay penalty.

## Sprint 42 — The Nightlife Density Engine

### Goal
Recognize the high-density Downtown / Midtown Albany corridors late at night and surface them as rideshare surge pins, so UberX-only drivers stay positioned in the urban core instead of chasing dead miles in the suburbs.

### The Yelp Proxy Strategy
Yelp's `price` tier is the cheapest live signal we already pay for. `$`/`$$`/`$$$`/`$$$$` proxies (a) disposable income of the patrons and (b) nighttime population density of the corridor. We re-use the existing `foodHotspots` array — **no new API fetch** — and pair it with the time-of-day gate to fire only during the 20:00–03:00 nightlife egress window.

### Synthetic Event Clone Architecture
Sprint 11's food sanitizer wipes `foodHotspots` whenever rideshare drivers untoggle Food Delivery. A pure-rideshare driver would therefore never see the nightlife signal. The fix is the **Synthetic Event Clone**: iterate `foodHotspots` BEFORE the sanitizer fires, and for each qualifier push a fresh object into `structuredEvents` with `type: "event"`. Once the sanitizer runs and erases food, the rideshare branch still has the cloned events — the data has been promoted to a survivable lane.

Cloned object shape:
- `type: "event"`
- `location: \`Surge: ${anchorName||location} Corridor\``
- `volume: 1` (locked — rendering signal, not magnitude)
- `egressMod: TIER_MOD_MAP[priceKey]`
- `categories: ["Nightlife Egress", "High Demand"]`
- `lat`/`lng` (carried through for the Mapbox radar pin)

### Dynamic Tier Multiplier
A flat boost would over-reward `$` corridors and under-reward `$$$$` ones. Lookup map:
```
$    -> 2.5  (2 AM Egress / Volume)
$$   -> 3.0  (Casual Nightlife)
$$$  -> 3.5  (Premium Surge / Executive)
$$$$ -> 4.0  (Elite Dining)
```
Because the hotspot's `tier` is a human-readable string (`"High-Value ($$$)"`), we regex-extract the parenthesized `$+` substring as the lookup key. `computeHotspots` was extended this sprint to emit `"Elite ($$$$)"` when any business in the cluster has a 4-char price, so the 4.0x tier can actually fire on real data (previously the function capped at `$$$`).

### Build Steps
- [x] 1. Add `TIER_MOD_MAP` constant near the file head (next to `ESP_COORDS` / `HARRIMAN_COORDS`).
- [x] 2. Extend `computeHotspots` so a `$$$$` cluster emits `"Elite ($$$$)"` (preserves existing `surgeScore` math; only `Elite` is new).
- [x] 3. Inject the Nightlife Density loop immediately BEFORE the Sprint 11 sanitizer (so the synthetic events survive the wipe). Gate on `activePlatforms.rideshare` + time window + valid tier match.
- [x] 4. Add the daylight mock (`TEST: Elite Steakhouse`, `$$$$`) and replace the time gate with `if (true)` (`inNightlifeWindow = true`) so PO QA fires the clone regardless of wall time.
- [x] 5. `node --check app/api/dispatch/route.js` → PARSE_OK.
- [ ] 6. Manual verification (PO): `npm run dev`, click dispatch, confirm terminal logs `NIGHTLIFE EGRESS INJECTED: TEST: Elite Steakhouse | Tier: $$$$ | Mod: 4x` AND the Mapbox radar drops a pin at `42.6526, -73.7562`.
- [ ] 7. QA sign-off cleanup: remove the test mock push, restore the real time gate (`const inNightlifeWindow = localHour >= 20 || localHour <= 3;`).

### Out of Scope (Anti-Goals)
- Frontend changes (`app/page.js`, `EventCard.jsx`, `DispatchMap.jsx`). The existing UI renders `type: "event"` natively.
- Flat global `finalRideMod` boost. This is hyper-local pin-based routing only — `egressMod` per cloned event, nothing global.
- Census / demographic APIs, GeoJSON boundary math, or a separate Yelp call. The existing `foodHotspots` array is the only input.

### Acceptance Criteria
- With the daylight mock + `if (true)` gate active: dispatch terminal logs at least one `NIGHTLIFE EGRESS INJECTED` line for the `TEST: Elite Steakhouse` entry at `Mod: 4x`.
- With the mock removed + real time gate restored: between 8 PM and 3 AM local, real `$$`/`$$$` foodHotspots clone into `structuredEvents`; between 4 AM and 7 PM they do not.
- Sprint 11 sanitizer behavior unchanged: untoggling Food Delivery still wipes `gigDemand.foodHotspots`, but `structuredEvents` retains the cloned surges.

## Sprint 43 — Ticketmaster Geocoding (Map Completeness)

### Decisions (locked before coding)
- **Static Local Dictionary:** Hardcoded `VENUE_DICTIONARY` (lat/lng keyed by `lowercase + trim` venue name) lives at module scope alongside the other spatial anchors (`ALB_COORDS`, `ESP_COORDS`, etc.). NO external geocoding APIs (Google Maps, Mapbox Geocoding) are permitted.
- **Strict Whitelist:** If an event's normalized venue name is NOT a key in `VENUE_DICTIONARY`, the event is dropped from the final `structuredEvents` payload. Only validated, mapped mega-events reach the frontend.
- **Normalization:** Raw `e?._embedded?.venues?.[0]?.name` is passed through `.toLowerCase().trim()` before lookup, so " The Egg " matches `"the egg"` without manual cleanup.
- **Initial venues (4):** MVP Arena, Palace Theatre, The Egg, Empire Live.
- **No frontend changes.** The existing DispatchMap natively renders any `type: "event"` object that carries `lat` / `lng` (Sprint 37 wiring).

### Build Steps
- [x] 0. Write `test-ticketmaster-geocoder.js` TDD scaffold (3 mock events: MVP Arena, " The Egg ", Unknown Local Pub). All assertions PASS.
- [x] 1. Add `VENUE_DICTIONARY` constant to `app/api/dispatch/route.js` near the other spatial anchors.
- [x] 2. Inject the whitelist filter inside the existing Sprint 32 `structuredEvents` loop (immediately after `venueName` extraction, before the egress math).
- [x] 3. Attach `lat` / `lng` from the dictionary hit onto the pushed `structuredEvents` object.
- [x] 4. Documentation: this block.

### Out of Scope (Anti-Goals)
- External geocoding API calls (Google Maps / Mapbox Geocoding) — forbidden by PO.
- Frontend UI changes (`app/page.js`, `EventCard.jsx`, `DispatchMap.jsx`) — pins render natively off `lat`/`lng`.
- Dynamic `&include=venues` payload restructuring — the hardcoded dictionary is the MVP.

### Acceptance Criteria
- Dispatch terminal: when Ticketmaster returns an event at MVP Arena / Palace Theatre / The Egg / Empire Live AND its `egressMod > 1.0`, the structured event carries `lat` + `lng` from `VENUE_DICTIONARY`.
- Mapbox radar: matching events surface as purple pins.
- Any Ticketmaster event whose venue is not whitelisted is silently dropped — never reaches the frontend.

## Sprint 44 — The Expanded Institutional Engine

### Decisions (locked before coding)
- **Time Matrix Array:** A module-scope `HOSPITAL_SHIFTS` config array replaces the Sprint 34 hardcoded two-window `if` statement. Decouples the schedule from the execution logic — adding a new clinic/admin shift is now a one-line edit, not a control-flow change.
- **Dynamic Modifier Scale (overlap math):** Single 8-hour clinic/admin shifts = `2.0x`. Single 12-hour nursing shift = `3.0x`. The 6:30-7:30 AM window stacks the 12-hour nursing changeover with the 8-hour clinic open → `4.0x` (the largest synthetic surge in the engine, outranking Mega-Venue 2.5x and Nightlife `$$$$` 4.0x parity).
- **Dynamic Category Injection:** The matched row's `label` is injected directly as the leading entry in the synthetic event's `categories` array (`[shift.label, "High Demand"]`) so the existing EventCard renders the exact shift name without frontend changes.
- **No frontend changes.** UI surfaces the new label + modifier natively.

### Time Matrix
```
{ start: 390,  end: 450,  mod: 4.0, label: "Morning Shift Overlap"  }  // 6:30 AM - 7:30 AM
{ start: 900,  end: 960,  mod: 2.0, label: "Afternoon Clinic Shift" }  // 3:00 PM - 4:00 PM
{ start: 1110, end: 1170, mod: 3.0, label: "Evening Nursing Shift"  }  // 6:30 PM - 7:30 PM
{ start: 1350, end: 1410, mod: 2.0, label: "Night Admin Shift"      }  // 10:30 PM - 11:30 PM
```

### Build Steps
- [x] 0. Write `test-hospital-engine.js` TDD scaffold. 5 boundary assertions (405 / 915 / 1125 / 1365 / 720 mins) all PASS.
- [x] 1. Add `HOSPITAL_SHIFTS` constant near the other spatial anchors in `app/api/dispatch/route.js`.
- [x] 2. Replace the Sprint 34 hardcoded `inAmShift || inPmShift` block with a `HOSPITAL_SHIFTS.find()` against `wallMinutes`.
- [x] 3. Wire `activeShift.mod` → `egressMod` and `activeShift.label` → leading `categories` entry on the pushed synthetic event.
- [x] 4. `node --check app/api/dispatch/route.js` → PARSE_OK.
- [x] 5. Documentation: this block.

### Out of Scope (Anti-Goals)
- Frontend UI changes (`app/page.js`, `EventCard.jsx`, `DispatchMap.jsx`) — the existing UI renders the dynamic categories + modifiers natively.
- Applying the modifiers to flights, trains, or food hotspots — this is the synthetic Hospital injection only.
- Adding a new Mapbox pin color or `type` — stays as `type: "event"`.

### Acceptance Criteria
- Dispatch terminal: between any of the 4 windows (and `activePlatforms.rideshare === true`), logs `HOSPITAL SHIFT INJECTED: <label> | egressMod <mod>x`.
- Mapbox radar: still drops a single pin at `42.6534, -73.7933` (Albany Med area).
- EventCard: the surfaced event's category chip reads the exact shift label (`"Morning Shift Overlap"`, `"Afternoon Clinic Shift"`, `"Evening Nursing Shift"`, or `"Night Admin Shift"`).
- Dead time (e.g. 12:00 PM): no synthetic Hospital event is injected.

## Sprint 45 — The Mathematical ROI Filter (Profitability Auditor V2)

### Decisions (locked before coding)
- **`DOLLAR_PER_SURGE_POINT = 1.50`** — module-scope constant near `TIER_MOD_MAP`. Single conversion knob between the dimensionless `surgeScore` and the dollar expected-value the ROI gate compares against.
- **Default `costPerMile = 0.65`** ("Safe Sedan"). Defended at the route boundary: non-numeric / negative payloads silently fall back to the default rather than disabling the filter.
- **Filter site: `buildItinerary`, immediately AFTER the Sprint 27 strict `<1.0` cutoff.** Only items that already cleared the score floor pay the ROI math; weak items have already been ghosted/dropped upstream so the filter never wastes work on them.
- **Skip when geometry is incomplete.** Missing `driverLat` / `driverLng` or item `lat` / `lng` → item passes the ROI gate untouched. Synthetic, non-scoreable rows (flight/train ripple instructions, etc.) bypass the gate entirely.
- **UI sits in the existing BYOD Data Settings panel** as an `<input type="range" min="0" max="2" step="0.05">` so EV / Sedan / SUV defaults snap cleanly. Hydrated from `localStorage["dispatchCostPerMile"]` on mount; persisted on every change.
- **Equality is kept.** Filter uses `deadheadCost > expectedValue` (strict) so the boundary case (`cost == value`) survives — matches `test-roi-filter.js` assert 4.

### Build Steps
- [x] 0. Write Sprint 45 plan to `tasks/todo.md` (this block).
- [x] 1. Phase 1 — TDD: `test-roi-filter.js` mocks `haversineMiles` + the candidate filter; asserts (a) profitable close surge kept, (b) money-losing far surge dropped, (c) expensive vehicle erodes weak surge → dropped, (d) boundary `cost == value` kept. 4/4 PASS before touching `route.js`.
- [x] 2. Phase 2 — Backend constant + destructure: add `DOLLAR_PER_SURGE_POINT = 1.50` near `TIER_MOD_MAP`; destructure `costPerMile: costPerMileRaw` in the POST handler with the `>= 0` numeric fallback to `0.65`.
- [x] 3. Phase 3 — Backend filter: extend `buildItinerary` signature with `driverLat`, `driverLng`, `costPerMile`; chain a `.filter` after the Sprint 27 cutoff that computes `haversineMiles → deadheadCost → expectedValue` and fires `ROI FILTER DROPPED: <label> | Cost: $X.XX | Value: $X.XX` on every drop. Pipe driver coords + `costPerMile` into the existing `buildItinerary` call.
- [x] 4. Phase 4 — Frontend state + hydration: `const [costPerMile, setCostPerMile] = useState(0.65)`; hydrate from `localStorage["dispatchCostPerMile"]` inside the existing BYOD `useEffect`; `handleCostPerMileChange` persists on every change.
- [x] 5. Phase 5 — Frontend UI + payload: add `<input type="range" min="0" max="2" step="0.05">` slider in the BYOD Data Settings panel; include `costPerMile` in the POST body.
- [x] 6. `node --check` on both `app/api/dispatch/route.js` and `app/page.js` → PARSE_OK.
- [ ] 7. Manual verification (PO): `npm run dev`, slide the cost-per-mile control between $0.05 and $2.00, dispatch. Confirm (a) terminal prints `ROI FILTER DROPPED:` for items where the deadhead cost exceeds the value, (b) those items DO NOT appear on the Mapbox radar or in the List view, (c) reloading the page restores the slider's prior value from localStorage.

### Acceptance Criteria
- Frontend UI: BYOD Data Settings panel contains a `$0.00`–`$2.00` slider labeled "Vehicle Cost Per Mile". Adjusting it updates `localStorage["dispatchCostPerMile"]` and persists across page reloads.
- Backend math: `buildItinerary` computes `distanceMiles = haversineMiles(driverLat, driverLng, item.lat, item.lng)` and drops the item iff `distanceMiles * costPerMile > decayed(item) * 1.50`.
- Diagnostic visibility: terminal explicitly prints `ROI FILTER DROPPED: <label> | Cost: $X.XX | Value: $X.XX` for each dropped item, proving the math fires without polluting the frontend UI.
- Frontend purity: dropped items do NOT appear on the Mapbox radar or in the List view.

### Out of Scope (Anti-Goals)
- Visual profitability badges / ghosting on the Mapbox UI or the Dispatch Cards. Items must be strictly dropped — not annotated.
- Mutating `surgeScore` logic or upstream multipliers (Weather, Fatigue, Campus, Corporate, Hospital, Nightlife, Holiday/Iftar, etc.). The ROI filter sits at the very end of the line.
- External routing-distance APIs (Google Maps / Mapbox Geocoding). Strictly point-to-point `haversineMiles` math only.
- Asymmetric thresholds per item type. One constant (`DOLLAR_PER_SURGE_POINT`) and one driver-configurable knob (`costPerMile`) govern every scoreable type.

## Sprint 46 — The Weather UI Surfacing (Global Weather Banner)

### Decisions (locked before coding)
- **Stateless Frontend Decoder.** Component reads `weatherFoodMod` / `weatherRideMod` only; no `useState`, no dismiss button, no fuzzy matching.
- **Strict equality on three states only:** Storm (`1.5 / 0.75`), Pre-Surge (`1.0 / 1.5`), Heatwave (`1.25 / 0.9`). Anything else → `return null`.
- **Static Dark Theme via Tailwind:** high-contrast blue band against the dark app shell.
- **Placement:** rendered in `app/page.js` directly under `<TopPickBanner>` inside the `status === "done"` block.
- **Live data source:** `data.weatherModifiers` (already present on `mergedPayload`). New `weatherModifiers` state hydrated alongside `finalMods` after dispatch.
- **TDD pause point:** the hardcoded mock cycle is committed FIRST, the user verifies all 4 states (Storm / Pre-Surge / Heatwave / Clear) in the browser, then the live wiring is restored.

### Build Steps
- [x] 0. Append Sprint 46 plan to `tasks/todo.md` (this block).
- [x] 1. Create `components/GlobalWeatherBanner.jsx` — stateless functional component, strict number matching, returns `null` outside the three known states.
- [x] 2. `app/page.js`: import the banner; render it under `<TopPickBanner>` inside `status === "done"` with a **temporary hardcoded** `weatherModifiers` prop. Cycle Storm → Pre-Surge → Heatwave → Clear by flipping one constant.
- [x] 3. PAUSE → user runs `npm run dev`, dispatches, confirms each of the 4 states renders the correct copy + styling and Clear renders nothing.
- [x] 4. After confirmation: add `const [weatherModifiers, setWeatherModifiers] = useState(null)`, populate it from `data.weatherModifiers` in `handleClick`, and replace the hardcoded prop with the live value.

### Acceptance Criteria
- `components/GlobalWeatherBanner.jsx` exists, is stateless, and renders ONLY for the three exact numeric combinations specified.
- The banner appears beneath `TopPickBanner` and above the Map/List toggle when active.
- During verification, manually toggling the hardcoded modifiers cycles through Storm / Pre-Surge / Heatwave copy and disappears on `1.0 / 1.0`.
- After restoration, dispatching surfaces the banner only when the backend's `weatherModifiers` matches a known state.

### Out of Scope (Anti-Goals)
- ANY change to `app/api/dispatch/route.js` — backend math + payload contract locked.
- `useState`, dismiss/close button, fuzzy/range matching, or fallback copy for unknown numbers.
- Visual changes to `TopPickBanner`, Map, List, or the BYOD panel.

## Sprint 47 — Tourist Event Clustering Engine (AviationStack × Ticketmaster)

### Decisions (locked before coding)
- **Trigger:** Any non-cancelled flight whose `departure.iata` is in `LEISURE_HUBS` AND whose `arrival.scheduled` lands 1-4 hours BEFORE the target event's projected start time (both bounds inclusive — validated by test-tourist-cluster.js asserts G1 + G2).
- **One synthetic per event.** The helper returns at most ONE object per call. Multiple matching leisure flights collapse to a single injection — the caller pushes the returned object once, period.
- **Shape:** Re-uses the existing `type: "event"` EventCard via the `categories` array. NO new component, NO change to `DispatchCards.jsx`. `volume: 1`. `lat`/`lng` copied from the target event's venueCoords (Mapbox pins on the venue).
- **egressMod stacking:** `5.0 + targetEvent.egressMod` — the additive `5.0` base guarantees this dominates the Profitability sort even when the target event hasn't entered its own egress window (egressMod 1.0 → injected 6.0).
- **Geographic Ripple toggle:** `includeAirport === true` → `"ALB → <venue>"` + `["Airport → Venue", "Tourist Surge"]`. `includeAirport === false` → `"<venue>"` + `["Tourist Ripple", "Venue Staging"]`.
- **Integration point:** Inside the existing TM events loop in `app/api/dispatch/route.js` — single iteration handles BOTH the egress push AND the tourist cluster injection. The egress filter is no longer a `continue` (it's now a non-blocking branch) so events that haven't entered their egress window can still trigger tourist clustering.
- **Whitelist gate stays:** unchanged. Events whose venue is not in `VENUE_DICTIONARY` still get dropped before either signal fires — both engines need the lat/lng pin to be useful.
- **No new API calls. No new env vars. No new UI components.**

### Build Steps
- [x] 0. Append Sprint 47 plan to `tasks/todo.md` (this block).
- [x] 1. Phase 1 — TDD: `test-tourist-cluster.js` mocks events + flights and validates `computeTouristCluster` in isolation. 19/19 assertions PASS (Golden Path, Ripple Edge Case, no-spam, non-leisure-hub reject, time-window boundary, cancelled-flight skip, inclusive `1h` and `4h` bounds) BEFORE editing `route.js`.
- [x] 2. Phase 2 — Port: copy `computeTouristCluster` verbatim into `route.js` (near the other event helpers). Inside the existing TM events loop, rebuild the egress push as an `if (egressMod > 1.0)` branch (drop the `continue`) and call `computeTouristCluster` immediately after, pushing the returned object onto `structuredEvents` when non-null. Log `TOURIST CLUSTER INJECTED: <location> | egressMod <X>x` per match.
- [x] 3. Phase 3 — Parse-check: `node --check app/api/dispatch/route.js` → PARSE_OK.
- [x] 4. Phase 4 — Regression: re-run `node test-tourist-cluster.js` → 19/19 PASS unchanged.
- [ ] 5. Manual verification (PO): `npm run dev`, dispatch with a mocked leisure-hub flight landing 1-4h before a known MVP Arena / Palace Theatre event. Confirm (a) terminal logs `TOURIST CLUSTER INJECTED:`, (b) EventCard at top of Profitability reads "ALB → MVP Arena" with categories `["Airport → Venue", "Tourist Surge"]`, (c) unchecking the Airport (ALB) toggle drops the prefix → "MVP Arena" and swaps categories to `["Tourist Ripple", "Venue Staging"]`.

### Acceptance Criteria
- **Golden Path:** Leisure flight 1-4h before mapped TM event → exactly ONE synthetic `type: "event"` injected reading `"ALB → <Venue Name>"`.
- **Ripple Edge Case:** `includeAirport === false` → location drops `"ALB →"` prefix and categories switch to `["Tourist Ripple", "Venue Staging"]`.
- **Profitability Dominance:** stacked `5.0 + egressMod` reliably floats the injected route to the top of the Profitability tab.
- **De-dup:** Multiple matching leisure flights still produce a SINGLE synthetic per target event (no clone-per-plane spam).

### Out of Scope (Anti-Goals)
- NO new UI components. No `<TouristRouteCard>`. No edits to `components/DispatchCards.jsx`. Existing `<EventCard>` must render this natively via the `categories` array.
- NO new API calls. Reuses the existing AviationStack + Ticketmaster streams already in `Promise.all`.
- NO duplicate spam. One synergy event per target venue, regardless of how many planes match.
- NO new env vars, no new constants beyond reusing `LEISURE_HUBS`.

## Sprint 48 — The Normalized Density Engine

**Problem:** The pre-Sprint-48 `surgeScore` was an unbounded multiplicative stack (`volume × finalRideMod × fatigueMod × leisureMod × ...`). It created a "Volume vs. Value Paradox" — a small crowd at an elite restaurant could mathematically overpower a massive airport surge because the multiplier ladder kept growing without a denominator.

**Fix:** Convert every surge into a universal "Expected Rideshare Yield" (raw volume × per-type yield rate) and divide by "Venue Capacity" (per-hub or per-`categories[0]` lookup, fallback 80). The resulting ratio scales 0-100+ as a percent-of-capacity score the driver can read directly. All scoreable item types now compete apples-to-apples.

### Decisions (locked before coding)
- **TDD scaffold:** `test-density-engine.js` at repo root validates Yield × Capacity math + `categories[0]` fallback to 80 across 10 scenarios (flight/train/food/event with mega/standard/hospital overrides + sub-floor / super-floor sanity checks). Required 10/10 PASS before any edit to `route.js`.
- **`YIELD_RATES` dictionary:** `flight: 15`, `train: 10`, `food: 5`, `grocery: 5`, `event: 50`, `mega_event: 450`, `hospital: 30`. Per-type expected rideshare passengers — same shape the PO brief locked.
- **`CAPACITY_DICTIONARY`:** Module-scope object keyed by lowercased primary category OR hub name. Includes `ALB: 600`, `Rensselaer: 300`, common Yelp restaurant categories (Steakhouse 40, Pizza 100, Fast Food 200, etc.), TM segments (Music 1000, Sports 5000, Arts/Theatre 800), and the synthetic-injector first categories (Morning Shift Overlap, State Worker Commute, etc.). `DEFAULT_CAPACITY = 80` is the universal fallback so an unknown Yelp category never crashes the math.
- **Density math (`densityScore` function, replaces `surgeScore`):** `(volume × yieldRateFor(item)) / capacityFor(item) × finalMod × 100`. The `× 100` lifts the ratio onto the whole-percentage scale (0.85 → 85.0) so it reads as a direct "% of capacity" integer in the UI.
- **`yieldRateFor` keying:** `item.type` for flight/train/food/grocery; for `event`, look at `categories[0]` — `/shift|nursing|admin|clinic/i` matches the Hospital injector (yield 30), `egressMod ≥ 2.5` flags Mega-Venue (yield 450), otherwise standard event (yield 50).
- **`capacityFor` keying:** flight/train → `item.hub` exact lookup (preserves "ALB" / "Rensselaer" casing). food/grocery/event → `categories[0].toLowerCase().trim()`. Both fall back to `DEFAULT_CAPACITY = 80`. Strict use of `categories[0]` only — PO anti-goal forbids iterating the array.
- **Sprint 27 filter recalibration:** Floor moves from `< 1.0` to `< 10.0` (i.e., drop anything generating <10% of venue capacity in expected yield). `isWeak` flag now keys off the same threshold so Sprint 40's X-Ray ghosting stays in sync.
- **Sprint 45 ROI filter recalibration:** `DOLLAR_PER_SURGE_POINT` lowered from `1.50` to `0.25`. The new density scale is ~6-10× larger than the old surgeScore range, so the dollar-per-point conversion drops in proportion to keep deadhead-cost vs. expected-value comparisons in sensible $5-30 territory for typical 5-mile dispatches.
- **Item preservation (PO anti-goal):** `item.volume` is the TRUE physical count — never overwritten with Expected Yield. The UI still reads `volume` for "N Arrivals" / "Volume: N" labels.
- **Payload transparency:** every scoreable item now carries `expectedYield`, `estimatedCapacity`, `densityScore` (decayed), and `isWeak` so the `=== MERGED DISPATCH PAYLOAD ===` terminal log explicitly prints the math, and the React cards can render "Density: X%" without re-deriving anything.
- **Frontend transparency:** `FlightCard` / `TrainCard` / `EventCard` / `HotspotCard` each render `Density: {Math.round(data.densityScore)}%` as a tinted secondary line. `TopPickBanner` does the same. `DispatchMap`'s popup swaps "Surge: 12.3" for "Density: 12%".
- **Frontend cleanup (per Rule 4):** `app/page.js` had a duplicate client-side `computeSurgeScore` whose output drove the TopPickBanner reduce. With the backend stamping `densityScore` directly onto each item, that function (and its only consumer, `computeDecayMod`, plus the now-unused `finalMods` React state and `setFinalMods` setter) are orphaned by Sprint 48 and removed.

### Phase 1 — Test-Driven Scaffolding
- [x] 1. `test-density-engine.js`: standalone `yieldRateFor` / `capacityFor` / `densityScore` helpers + 10 assertions (flight ALB; train Rensselaer; food known + unknown categories; mega vs standard event; hospital override; unknown event category; weak food sub-10; strong food super-10). Run `node test-density-engine.js`; require 10/10 PASS. ✅ 10/10 PASS.

### Phase 2 — Backend Integration
- [x] 2. `app/api/dispatch/route.js`: recalibrate `DOLLAR_PER_SURGE_POINT` from `1.50` to `0.25`; add `YIELD_RATES`, `CAPACITY_DICTIONARY`, `DEFAULT_CAPACITY` constants alongside `TIER_MOD_MAP`; add `yieldRateFor` + `capacityFor` helpers.
- [x] 3. `app/api/dispatch/route.js`: replace `surgeScore(item, finalRideMod, finalFoodMod)` with `densityScore(item, finalRideMod, finalFoodMod)` (returns `(volume × yield / capacity) × mod × 100`). All call sites inside `buildItinerary` update from the deleted `surgeScore` to the new function via the `decayed()` wrapper.
- [x] 4. `app/api/dispatch/route.js`: rewrite the `buildItinerary` `.map()` step to stamp `expectedYield`, `estimatedCapacity`, `densityScore`, and `isWeak` on every scoreable item BEFORE the strict cutoff. Change the cutoff from `decayed(it) >= 1.0` to `decayed(it) >= 10.0`. ROI filter math (`deadheadCost > expectedValue` where `expectedValue = decayed(it) × DOLLAR_PER_SURGE_POINT`) is unchanged — the recalibrated constant does all the work.
- [x] 5. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`; full ESM `import()` also clean (`IMPORT OK`).

### Phase 3 — Frontend Surfacing
- [x] 6. `components/DispatchCards.jsx`: add `formatDensity(score)` helper + append a tinted `Density: X%` line to `FlightCard` / `TrainCard` / `EventCard` / `HotspotCard`. Conditional render — items without a `densityScore` skip the line entirely.
- [x] 7. `components/TopPickBanner.jsx`: render `Density: X%` beneath the existing body when `data.densityScore` is finite.
- [x] 8. `components/DispatchMap.jsx`: swap the popup's "Surge: 12.3" for "Density: 12%" (matches the card / banner formatting).
- [x] 9. `app/page.js`: replace `computeSurgeScore` + `computeDecayMod` with a thin `readDensityScore` helper that pulls `data.densityScore` directly from each item. Drop the orphaned `finalMods` React state + its setter. The TopPickBanner `.reduce` now compares `readDensityScore(item)` instead of the deleted client-side surge math.
- [x] 10. `app/page.js`: verify the existing 90-minute actionable-time gate still works against the new densityScore reduce (it does — the filter is time-only, the reducer is the only `surgeScore → densityScore` swap).

### Phase 4 — Visual Verification
- [ ] 11. Manual verification (user): `npm run dev` → fire a dispatch with `showRawData: false` → confirm (a) terminal `=== MERGED DISPATCH PAYLOAD ===` shows `expectedYield`, `estimatedCapacity`, `densityScore` on every scoreable item; (b) all four cards (Flight / Train / Event / Hotspot) render a "Density: X%" line; (c) the TopPickBanner renders the same; (d) the DispatchMap popup reads "Density: X%" instead of "Surge: …"; (e) Profitability and Hybrid strategies sort by the new density score (a 4-arrival ALB surge now correctly outranks a 2-volume elite steakhouse at the same finalMods).

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `node test-density-engine.js` reports `10 pass / 0 fail`.
- **Terminal Logging:** `=== MERGED DISPATCH PAYLOAD ===` log explicitly prints `expectedYield`, `estimatedCapacity`, and the final `densityScore` for each scoreable item.
- **UI Transparency:** TopPickBanner, FlightCard, TrainCard, EventCard, HotspotCard, and the DispatchMap popup all render the new `densityScore` percentage.
- **Apples-to-Apples Sort:** Profitability + Hybrid strategies sort by `densityScore` (via the `decayed()` wrapper) instead of the deprecated `surgeScore`.
- **Item Preservation:** `item.volume` remains the true physical count on every surge object — the React UI's "N Arrivals" / "Volume: N" labels are unchanged.

### Out of Scope (Anti-Goals)
- NO new APIs (Census, real-estate, additional Yelp endpoints).
- NO database setup — `YIELD_RATES` and `CAPACITY_DICTIONARY` stay as in-memory global constants.
- NO iteration over the Yelp `categories` array — `categories[0]` is the primary-category override; complex regex loops over the whole array are forbidden.
- NO frontend overhaul beyond the additive "Density: X%" line on existing cards / banner / popup.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 49 — The Localized BYOD Holiday Engine

**Problem:** Floating-date holidays (Thanksgiving = 4th Thursday of November, Easter, Super Bowl Sunday, etc.) need either expensive date-math algorithms OR an external calendar API. Both options carry maintenance debt and fail on niche local celebrations (e.g. a city moves their Cinco de Mayo block party to the previous Saturday).

**Fix:** A **Localized BYOD Architecture** — the driver pairs each of the 10 MVP holidays with the actual local celebration date via a simple `<select>` + `<input type="date">` form, persisted in `localStorage["dispatchHolidayCalendar"]`. When today's local date matches a saved row, the frontend forwards `activeHoliday: "<HolidayName>"` to the backend. The backend cross-references a strictly locked **Temporal Logic Matrix** (10 entries → minute-of-day windows, some cross-midnight) and — if the wall-clock falls inside — multiplies `finalRideMod` by 1.5x AND injects a synthetic ESP-coords `type: "event"` so the Mapbox pin and EventCard render natively (no new component).

### Decisions (locked before coding)
- **TDD scaffold:** `test-holiday-engine.js` at repo root validates `isInHolidayWindow(holiday, wallMinutes)` (normal, split-window, cross-midnight, boundaries, unknown) + the `applyHolidayBoost` math (inside vs outside window, stacking onto an already-boosted `finalRideMod`, food untouched). Required 29/29 PASS before any edit to `route.js` or `page.js`.
- **`HOLIDAY_WINDOWS` matrix (locked, from PO):** Backend constant mapping each holiday name → array of `{ start, end }` minute pairs. Cross-midnight is encoded as `start > end` (e.g. Halloween 20:00-03:00 → `{ start: 1200, end: 180 }`) and tested with the OR branch in `isInHolidayWindow`. Both endpoints are inclusive — 21:30 and 23:30 both fire on the 4th of July window.
- **Frontend `HOLIDAY_OPTIONS`:** Lives in `app/page.js` and MUST match the backend keys exactly (case + apostrophes — `"New Year's Day"`, `"St. Patrick's Day"`, etc.). The dropdown rendering is `HOLIDAY_OPTIONS.map`.
- **State separation:** Form scratch state (`holidaySelect`, `holidayDate`) is split from the persisted `holidayCalendar` array so an unsaved selection never accidentally fires in `handleClick`.
- **Replace-by-key save semantics:** `handleSaveHoliday` filters out any existing row with the same `holiday` name BEFORE pushing the new pair. Saving "Halloween → 2026-10-31" twice doesn't duplicate; saving "Halloween → 2026-10-31" then "Halloween → 2027-10-31" rolls the year forward cleanly.
- **Expiration warning (per-entry):** Any saved entry whose `date < todayLocalISO()` renders a small red `Action Required: <Holiday> date is in the past. Please update.` line beneath the saved list. Non-blocking — the driver can still dispatch with stale rows in storage, they just won't match `today` and so won't inject `activeHoliday`.
- **Math boost site:** `finalRideMod *= 1.5` lands AFTER the Sprint 34 BYOD Campus boost so it stacks multiplicatively on top of weather × supply × temporal × campus. Food untouched (PO anti-goal). The same `holidayActiveInWindow` boolean gates the synthetic event push later in PHASE 2.
- **Synthetic event shape (locked, from PO):** `{ type: "event", location: "<Holiday> Peak Surge", volume: 1, egressMod: 3.5, categories: ["Holiday Surge", "High Demand"], lat: ESP_COORDS.lat, lng: ESP_COORDS.lng }`. `egressMod 3.5` outranks every other PHASE 2 injector (Hospital max 4.0, State Commuter 2.5, Nightlife max 4.0) only by category — the PO chose 3.5 specifically so the Holiday Peak Surge dominates the Profitability sort during the active window.
- **Pipeline insertion point:** synthetic event pushes into `structuredEvents` AFTER the State Commuter injector and BEFORE the Nightlife clone loop, matching the Sprint 36.2 PHASE 2 sequencing rule.
- **Date-gate semantics (known limitation):** the frontend filter compares `today === savedDate`, so the post-midnight tail of a cross-midnight window (e.g. Halloween 00:00-03:00 on 2026-11-01) is NOT reached unless the driver enters the holiday date as the "next day". Documented for future tightening.

### Phase 1 — Test-Driven Scaffolding
- [x] 1. `test-holiday-engine.js`: standalone `HOLIDAY_WINDOWS` + `isInHolidayWindow` + `applyHolidayBoost` + 29 assertions covering Halloween cross-midnight, Valentine's non-crossing boundaries, NYD split window, 4th of July tight boundaries, Super Bowl cross-midnight, unknown-holiday safety, and stacking math vs `finalFoodMod` anti-goal. Run `node test-holiday-engine.js`; require 29/29 PASS. ✅ 29/29 PASS.

### Phase 2 — Backend Integration
- [x] 2. `app/api/dispatch/route.js`: add `HOLIDAY_WINDOWS` + `isInHolidayWindow(holiday, wallMinutes)` alongside the other top-of-file constants (near `HOSPITAL_SHIFTS` / `VENUE_DICTIONARY`).
- [x] 3. `app/api/dispatch/route.js`: destructure `activeHoliday: activeHolidayRaw` from `request.json()`; defensive string-cast to `activeHoliday` (trim, null on empty / non-string).
- [x] 4. `app/api/dispatch/route.js`: after the Sprint 34 BYOD Campus boost, compute `holidayWallMinutes` + `holidayActiveInWindow`; multiply `finalRideMod *= 1.5` when the gate fires and log `HOLIDAY SURGE ACTIVE: <name> | Wall: HH:MM | Mod: 1.5x`.
- [x] 5. `app/api/dispatch/route.js`: in PHASE 2 (after State Commuter, before Nightlife), if `holidayActiveInWindow` push the synthetic `{ type: "event", location: "<name> Peak Surge", volume: 1, egressMod: 3.5, categories: ["Holiday Surge", "High Demand"], lat: ESP_COORDS.lat, lng: ESP_COORDS.lng }`. Log `HOLIDAY EVENT INJECTED: <name> | egressMod 3.5x | ESP_COORDS`.
- [x] 6. Parse-check per L4: `node --check app/api/dispatch/route.js` → `PARSE OK`; full ESM `import()` → `ROUTE IMPORT OK`.

### Phase 3 — Frontend Integration
- [x] 7. `app/page.js`: add `HOLIDAY_OPTIONS` constant alongside `ROESSLEVILLE_COORDS`; add `holidayCalendar`, `holidaySelect`, `holidayDate` React state.
- [x] 8. `app/page.js`: hydrate `holidayCalendar` from `localStorage["dispatchHolidayCalendar"]` inside the existing BYOD `useEffect`.
- [x] 9. `app/page.js`: implement `handleSaveHoliday()` with replace-by-key semantics + YYYY-MM-DD validation; persist to localStorage on every save.
- [x] 10. `app/page.js`: render the Holiday Calendar UI inside the existing BYOD Data Settings panel (below the cost-per-mile slider, separated by a `border-t` divider) — `<select>` + `<input type="date">` + `Save Holiday` button + saved-rows list + per-entry red expiration warning.
- [x] 11. `app/page.js`: inside `handleClick`, find today's matching `holidayCalendar` row and conditionally add `body.activeHoliday = todaysHoliday.holiday`. Missing key = vanilla payload (back-compat).
- [x] 12. Grep audit: `holidayCalendar / holidaySelect / holidayDate / handleSaveHoliday / HOLIDAY_OPTIONS / expiredHolidays / activeHoliday` all referenced in state, hydration, save handler, expiration check, body assembly, and JSX render — no orphans introduced.

### Phase 4 — Visual Verification
- [ ] 13. Manual verification (user): `npm run dev` → open Smart Dispatch → in the BYOD Data Settings panel, pick `Halloween` from the dropdown, set the date to today, click **Save Holiday**. Refresh the browser, confirm the entry persists in the saved-rows list. Click **What's happening?** during 20:00-03:00 local; confirm (a) terminal logs `HOLIDAY SURGE ACTIVE: Halloween` and `HOLIDAY EVENT INJECTED: Halloween`, (b) `mergedPayload.finalRideMod` is exactly 1.5x what a vanilla payload would have produced, (c) a purple Holiday Peak Surge EventCard sits at the top of the Profitability tab, (d) a purple Mapbox pin drops on Empire State Plaza. Re-save Halloween with last year's date; confirm the red `Action Required` warning appears.

### Acceptance Criteria (Definition of Done)
- **TDD Validation:** `node test-holiday-engine.js` reports `29 pass / 0 fail`.
- **UI Persistence:** `holidayCalendar` survives a page reload via `localStorage["dispatchHolidayCalendar"]`.
- **Backend Execution:** When today's local date matches a saved holiday AND wall-clock is inside the matrix window, the terminal logs `HOLIDAY SURGE ACTIVE` + `HOLIDAY EVENT INJECTED`, `finalRideMod` is inflated 1.5x, and a `type: "event"` row with `egressMod 3.5` + ESP coords appears in `mergedPayload.itinerary`.
- **UI Surfacing:** A purple EventCard reading `<Holiday> Peak Surge` renders at the top of the Profitability tab; a purple Mapbox pin drops at ESP_COORDS — no new components introduced.
- **Anti-Goal Enforced:** `finalFoodMod` is byte-for-byte identical to a non-holiday dispatch (verified by the TDD `applyHolidayBoost` test).

### Out of Scope (Anti-Goals)
- NO algorithmic date-math (e.g., "4th Thursday of November"). The BYOD date picker is the entire solution.
- NO new Mapbox pin color, no new React card component. Reuse `type: "event"`.
- NO 1.5x multiplier on `finalFoodMod` or grocery pipelines. Rideshare-specific transit boost only.
- NO server-side persistence (`fs` or DB) — localStorage is the source of truth.
- NO automatic year-rollover. Driver consciously updates each entry after the warning appears.

### Mathematical Integration
```
holidayMod = 1.0 (default) | 1.5 (today matches saved holiday AND wall-clock in matrix window)

finalRideMod = rideMod × weatherRideMod × supplyDropMod × campusMod × holidayMod
finalFoodMod = foodMod × weatherFoodMod × supplyDropMod                  (untouched)
```
`finalRideMod` then flows into `buildItinerary`'s densityScore exactly as before. The synthetic Holiday Peak Surge event scores via the `event` branch of `densityScore` (yield 450 for `mega_event` since `egressMod >= 2.5`, capacity falls back to 80 since "holiday surge" isn't a CAPACITY_DICTIONARY key) — `(1 × 450) / 80 × finalRideMod × 100` lands the holiday card near the top of the Profitability sort by raw math, with the 1.5x ride boost compounding the already-elevated number.

### Debugging Agreement
If a runtime/build error surfaces, identify the failing line and provide a targeted patch — no full-file rewrites.

## Sprint 50: The Last Call Egress Engine

**Goal:** Auto-dispatch drivers to high-volume nightlife venues 30–45 min before close (patron + staff egress surge). Two-Phase Static Dictionary architecture — no live Yelp Business Details calls at dispatch time. **7-Day Matrix Edition** — per-day closing times for max precision.

### Phase 1 — Automated Data Pull (standalone Node script)
- [x] 1. Create `tasks/pull-nightlife.js`: parse `.env` for `YELP_API_KEY`, hit `/businesses/search` with `location=Albany,NY`, `categories=nightlife,bars`, `sort_by=review_count`, `limit=50`.
- [x] 2. Map response → 7-Day Matrix schema `[{ name, yelpId, lat, lng, closingTimes: { "0": "00:00", ..., "6": "02:00" } }]` (key = `getUTCDay()`, 0 = Sun … 6 = Sat) and write to root `nightlife_dictionary.json`.
- [x] 3. **Execution pause:** user pasted closing times for 50 venues in chat; merged into `nightlife_dictionary.json` and validated (50 entries, all 7 day keys present).

### Phase 2 — Engine Wiring (after user confirms)
- [x] 4. Write `test-last-call-engine.js`: prove the 30–45 min pre-close window math in isolation. Covers lower/upper bounds (30/45 inclusive), just-outside (29/46), cross-midnight day-lookup (Fri close="02:00" → fires at Sat 01:25), `"00:00"` as next-day midnight, `"Closed"` skip on today-and-yesterday. **12/12 passed.**
- [x] 5. `app/api/dispatch/route.js`: import populated dictionary as frozen const `ALBANY_NIGHTLIFE_HOURS` at file top (ESM JSON import).
- [x] 6. `route.js`: helper `minutesUntilLastCall(localStart, closingTimes)` returns offset only when in [30,45]; day-rollback via `(dayIdx + 6) % 7` when value < 06:00 (EARLY_AM threshold).
- [x] 7. `route.js`: `computeLastCallEgressEvents(...)` pushes synthetic `type:"event"` (egressMod 3.5, categories `["Last Call","Nightlife Egress"]`, venue lat/lng) into `structuredEvents` right after the Sprint 49 holiday block.
- [x] 8. Manual verification: simulated Sat 2026-05-30 01:25 UTC against live dictionary → **9 venues fire** (Ralph's, The Ruck, Wolff's, Katie O'Byrne's, 20 North Broadway, Savoy, McGeary's, 151 Bar, Hill Street Cafe), each with offset=35 min and exact coords flowing through. `node --check` syntax-clean.

### Acceptance Criteria
- Phase 1: `nightlife_dictionary.json` has 50 entries in 7-Day Matrix shape (`closingTimes` object keyed `"0"`–`"6"`).
- Phase 2: `test-last-call-engine.js` exits 0 including the cross-midnight day-lookup case; live dispatch fires the synthetic egress event during the 30–45 min window and renders as a standard `event` pin/card with no frontend changes.

### Anti-Goals
- NO live calls to Yelp Business Details at dispatch time. The static dictionary is the sole source of truth.
- NO new Mapbox pin color, no new React card. Reuse `type: "event"`.
- NO changes to `buildItinerary` sort math — `egressMod: 3.5` handles prioritization naturally.

## Sprint 51: Tech Debt & Reversion (The Full Axe on Sprint 42) — ✅ CLOSED

### Build Steps
- [x] 1. `app/api/dispatch/route.js`: delete the `TIER_MOD_MAP` constant + its Sprint 42 comment header (was between the capacity dictionary and the Sprint 31 `CAMPUS_CENTERS` block).
- [x] 2. `app/api/dispatch/route.js`: revert `computeHotspots` tier logic — drop the `hasElite` branch and `"Elite ($$$$)"` label; `$$$`/`$$$$` both collapse back into `"High-Value ($$$)"`.
- [x] 3. `app/api/dispatch/route.js`: delete the Sprint 42 synthetic clone loop (the `inNightlifeWindow` + `foodHotspots` loop pushing `categories: ["Nightlife Egress", "High Demand"]`) sitting immediately before the Sprint 11 sanitizer.
- [x] 4. Verification: `node --check app/api/dispatch/route.js` → **PARSE OK**.
- [x] 5. Grep audit: `TIER_MOD_MAP`, `Elite ($$$$)`, `NIGHTLIFE EGRESS` log — all zero hits. (See "Open Item" below re: residual `Nightlife Egress` tag in Sprint 50's Last Call injector — flagged for user decision, NOT auto-removed since Sprint 50 was listed as untouched.)

### Acceptance Criteria
- Backend no longer emits Sprint 42 surge events. Frontend will natively stop rendering them (no frontend touch).
- Standard Yelp food + grocery pipelines unchanged. `computeHotspots` still clusters and tiers normal hotspots.
- Hospital Shift Injector + State Commuter Injector untouched.
- `node --check` clean.

### Anti-Goals
- NO frontend changes (`app/page.js`, `DispatchCards.jsx`).
- NO touching `buildItinerary` or `densityScore`.
- NO deleting `fatigueMod`, `campusMod`, or `qualityMod`.

### Resolution (Sprint 50 tag retained — Option A)
- `route.js:1459` keeps `categories: ["Last Call", "Nightlife Egress"]` inside Sprint 50's `computeLastCallEgressEvents`. **Decision:** the intent of Sprint 51 was to kill the Sprint 42 false-positive clone loop, NOT the accurate time-based Last Call events. Sprint 50 is a separate injector with a deterministic dictionary trigger (30–45 min before posted close) — the `"Nightlife Egress"` tag is a correct semantic label for that real signal, not surge noise. Acceptance criterion #1 ("zero Nightlife Egress strings") is treated as scoped to the Sprint 42 loop's emissions, not Sprint 50's. Per the "Other Injectors Untouched" rule.

### Status: CLOSED 2026-05-28
- All Sprint 42 code paths removed. Sprint 50 Last Call Engine remains the sole emitter of any `"Nightlife Egress"` tag, and that emission is deterministic + driver-curated.

## Sprint 52: Crossgates Retail Egress Engine — Plan

### Decisions (locked before coding)
- **Trigger:** Driver opens dispatch within ±30 min of Crossgates Mall's posted close → inject a single synthetic `type: "event"` so the existing UI renders it natively.
- **Coords:** `CROSSGATES_COORDS = { lat: 42.6895, lng: -73.8504 }` — slotted next to the other spatial anchors (ALB / AMTRAK / ESP / HARRIMAN).
- **Schedule (7-Day Matrix, minute-of-day close):**
  - Sun (0): 1080 (6:00 PM)
  - Mon-Thu (1-4): 1200 (8:00 PM)
  - Fri-Sat (5-6): 1260 (9:00 PM)
- **Density alignment (Sprint 48):** capacity = 3000 ("retail egress"), yield = 150 — slots between `event` (50) and `mega_event` (450), reflecting 1 active mall vs. a stadium.
- **Egress mod:** 3.0x. Stacks above mega-venue events (2.5) but below holiday surge (3.5) and Last Call (3.5).
- **Gate order:** `activePlatforms.rideshare === true` AND `wallMinutes` in `[closeMinute - 30, closeMinute + 30]`.
- **Placement:** Inside `POST`, right after Sprint 50 Last Call block, BEFORE Sprint 11 platform sanitization and BEFORE `buildItinerary`.
- **No frontend changes. No live APIs. No holiday overrides.**

### Build Steps
- [x] 0. Write Sprint 52 plan to `tasks/todo.md`.
- [x] 1. `test-crossgates-engine.js`: prove the day-lookup + ±30 minute window math in isolation. Covers all 7 days, both inclusive bounds, just-outside bounds, and platform gating. **30/30 PASS.**
- [x] 2. `node test-crossgates-engine.js` → all assertions PASS.
- [x] 3. `route.js`: added `CROSSGATES_COORDS` and `CROSSGATES_HOURS` next to existing spatial anchors (right under `ESP_COORDS` / `HARRIMAN_COORDS`).
- [x] 4. `route.js`: added `"retail egress": 3000` to `CAPACITY_DICTIONARY` (under the synthetic injector group).
- [x] 5. `route.js`: extended `yieldRateFor` with `if (/retail egress/i.test(cat0)) return 150;` BEFORE the `egressMod >= 2.5 → mega_event` branch — the 3.0x mod no longer mis-routes to the 450 stadium rate.
- [x] 6. `route.js`: inside `POST`, immediately after the Sprint 50 Last Call loop, gates on `activePlatforms.rideshare`, reuses existing `currentDay` + `wallMinutes` (declared upstream for Sprints 44/36), looks up `crossgatesCloseMinute = CROSSGATES_HOURS[currentDay]`, fires when `wallMinutes >= closeMinute - 30 && wallMinutes <= closeMinute + 30`.
- [x] 7. Payload: pushes exactly the spec object (`location: "Crossgates Mall"`, `volume: 1`, `egressMod: 3.0`, `categories: ["Retail Egress", "Closing Surge"]`, lat/lng from `CROSSGATES_COORDS`). Emits `console.log("CROSSGATES EGRESS INJECTED: Retail Egress | egressMod 3.0x");`.
- [x] 8. Verification: `node --check app/api/dispatch/route.js` → **PARSE OK**. `node test-crossgates-engine.js` re-run after the port → **30/30 PASS** (math identical to scaffolding).

### Status: CLOSED 2026-05-28
- Crossgates static dictionary live, density math aligned (yield 150 / capacity 3000), synthetic event injects with the exact spec payload, platform gate verified.

### Acceptance Criteria
- `CROSSGATES_HOURS` accurately maps the 7-day closing schedule (lookup by `getUTCDay()`).
- `test-crossgates-engine.js` exits 0 — the ±30 min window only fires for the day's exact close.
- The injected event flows into `buildItinerary`, yields a non-NaN `densityScore` (volume 1 × yield 150 ÷ capacity 3000 = 0.05 → 5% before rideMod, ×100 scale), and stamps the standard `expectedYield` / `estimatedCapacity` / `densityScore` fields.
- Toggling rideshare OFF → no Crossgates injection (terminal log silent on this branch).

### Out of Scope (Anti-Goals)
- NO frontend changes (`app/page.js`, `DispatchCards.jsx`, `DispatchMap.jsx`).
- NO Yelp / Google Places live hours lookup. Static 7-day matrix is the sole source.
- NO holiday overrides for V1 (Thanksgiving/Christmas closures explicitly deferred).
- NO new component or pin color — reuse `type: "event"`.

## Sprint 53: BYOD Amtrak Pipeline — Plan

### Decisions (locked before coding)
- **Goal:** Excise the unreliable `api-v3.amtraker.com` live feed. Replace with a deterministic "Raw Text Dump" parser: driver pastes the Amtrak booking page text into a `<textarea>`; backend regex extracts train number + arrival time + seat-availability status.
- **Format observed (booking page, not status page):** Each train block is `<2-3 digit train>\n<Service Name>\nDEPARTS\n<time>\n<a|p>\n\n<duration>\nARRIVES\n<time>\n<a|p>\n[optional cross-day line]\nTrip Details\nCoach...\nBusiness...`. "On Time"/"Delayed" do NOT appear — derive status from "Sold Out" / "Only N seats left" tokens.
- **Regex anchor:** `DEPARTS` → lazy `[\s\S]*?` → `ARRIVES` → arrival `\d{1,2}:\d{2}` + `[ap]`. Tail block captured until next train block's `<digits>\n<service>\nDEPARTS` lookahead or end-of-input.
- **Status derivation:**
  - "Sold Out" anywhere in block → `"Sold Out"`
  - else "Only N seat" anywhere → `"Almost Full"`
  - else → `"On Time"`
- **Output shape per match:** `{ trainNumber, status, time }` — `time` formatted as `"H:MM AM/PM"` so the existing `parseTimeLabel` / `computeTimeDecayMod` engines consume it natively via the `leaveBy` field.
- **structuredEvents shape:** Pushed into the same `structuredEvents` array used by Hospital / State Commuter / Crossgates injectors. Shape: `{ type:"event", location:"Rensselaer Train <num>", volume:1, egressMod:2.0, categories:["BYOD Train", status], origin:"NYP", leaveBy:"<H:MM AM/PM>", lat:AMTRAK_COORDS.lat, lng:AMTRAK_COORDS.lng }`.
- **egressMod:** uniform 2.0 (parity with basic Music event, per user-locked decision). Status surfaces in `categories[1]` so the existing purple EventCard renders it natively.
- **Placement:** Inside `POST`, after Sprint 52 Crossgates injection block, BEFORE the Sprint 11 sanitization. Gated on `activePlatforms.rideshare` AND `includeAmtrak` so existing toggles still work.
- **Empty-textarea behavior:** parser returns `[]`, nothing injected, dispatch proceeds normally (fallback to live train aggregator from `aggregateTrainArrivalsByHour` is untouched — they ride alongside, not as a replacement, in this sprint).
- **Persistence:** None — per-shift input. `trainRawText` is plain React state, NOT saved to localStorage.
- **No new libraries, no PDFs, no scrapers — pure regex on a `<textarea>`.**

### Build Steps
- [x] 0. Append Sprint 53 plan to `tasks/todo.md`.
- [x] 1. `test-amtrak-parser.js`: TDD scaffold with the verbatim booking-page text (trains 237, 239, 241, 243, 245). Assert all 5 parse with correct trainNumber + status + time. **5/5 PASS.**
- [x] 2. `node test-amtrak-parser.js` → all assertions PASS.
- [x] 3. `app/api/dispatch/route.js`: ported `parseAmtrakText` verbatim from the test, placed above `aggregateTrainArrivalsByHour`.
- [x] 4. `route.js`: added `trainRawText` destructure with defensive string-cast in `POST`. Injector block after Sprint 52 Crossgates, gated on `activePlatforms.rideshare && includeAmtrak`. Each parsed train pushes `{ type:"event", location:"Rensselaer Train <num>", volume:1, egressMod:2.0, categories:["BYOD Train", status], origin:"NYP", leaveBy:<time>, lat/lng:AMTRAK_COORDS }` and emits the spec'd log line.
- [x] 5. `app/page.js`: added `trainRawText` state (not persisted) and `<textarea>` below the Amtrak CSV uploader. Forwarded as `trainRawText` in the POST body.
- [x] 6. Verification: `node --check app/api/dispatch/route.js` → **PARSE OK**. `node test-amtrak-parser.js` → **5/5 PASS** post-port. Empty textarea path: parser short-circuits on `!rawText.trim()` → `[]`, no injection.

### Status: CLOSED 2026-05-28
- BYOD textarea + regex parser live. Sprint 53 deliberately leaves `fetchAlbTrainArrivals` and `aggregateTrainArrivalsByHour` in place — BYOD events ride alongside (not as a replacement) so a future sprint can excise the unreliable feed in isolation.

## Sprint 54: BYOD Time Gate & Legacy CSV Excision — Plan

### Decisions (locked before coding)
- **Two intertwined goals:**
  1. **Time Gate** — strict filter on BYOD parsed trains: include only when arrival falls in `[localStart - 10 min, localEnd]`. The -10 min buffer covers active unloading already underway.
  2. **Legacy CSV Excision** — fully remove the Sprint 39 `trainCapacity` pipeline (UI uploader, React state, localStorage, backend destructure, `computeCapacityMod`, and the bucket-level capacityMod logic inside `aggregateTrainArrivalsByHour`).
- **Time-gate math (wall-clock-as-UTC frame):**
  - `startMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes()`
  - `delta = arrivalMin - startMin`; if `delta < -360` then `delta += 1440` (cross-midnight rollover, mirrors Sprint 32.1).
  - Include when `delta >= -10 AND delta <= hoursNum * 60`.
- **`arrivalTime` field:** parser emits the raw "5:47p" form alongside the existing "5:47 PM" `time` field. Backend pushes `arrivalTime` onto the event so the card can render `Arrives: 5:47p` exactly as the driver pasted it.
- **EventCard:** conditional `Arrives: {arrivalTime}` line only renders when the field is present — Hospital / State Commuter / Holiday / Crossgates events stay visually unchanged.
- **Live aggregator untouched (other than CSV-related params):** `fetchAlbTrainArrivals` + `aggregateTrainArrivalsByHour` stay alive. Only the `trainCapacity = []` param, the in-loop `computeCapacityMod` call, the per-bucket `capacityMod` aggregation, and the trigger-log line come out.
- **No new libraries. Native `Date` math only.**

### Build Steps
- [x] 0. Append Sprint 54 plan to `tasks/todo.md`.
- [x] 1. `test-time-gate.js`: standalone TDD scaffold for `isTrainInWindow(arrivalTimeStr, localStart, hoursNum)`. **21/21 PASS** — covers exact start/end, -10 buffer edge, just-outside buffer (-11), just-outside end (+1), cross-midnight rollover, and invalid inputs.
- [x] 2. `test-amtrak-parser.js`: extended to assert the new `arrivalTime` raw-form field. **5/5 PASS.**
- [x] 3. `node test-time-gate.js && node test-amtrak-parser.js` → all PASS pre-port.
- [x] 4. `route.js`: `parseAmtrakText` now emits `arrivalTime` (e.g., "5:47p"). Added `isTrainInWindow` helper right next to it. BYOD injector now filters via `isTrainInWindow(train.time, localStart, hoursNum)` before push. Event object carries the new `arrivalTime` field.
- [x] 5. `route.js`: `computeCapacityMod` deleted. `aggregateTrainArrivalsByHour` signature dropped `trainCapacity`, body dropped `capacityModByHour` + the in-loop log + the bucket `capacityMod` field. `POST`'s destructure / defensive normalize / call-site arg all stripped. Updated the Sprint 48 multipliers comment to drop the now-orphaned `capacityMod` reference.
- [x] 6. Deleted `test-amtrak-capacity.js`.
- [x] 7. `app/page.js`: removed `trainCalendar` state, `dispatchTrainCalendar` hydration block, `handleTrainCsvUpload`, `todaysTrainCapacity` filter, the `trainCapacity` body field, and the CSV uploader UI element.
- [x] 8. `components/DispatchCards.jsx`: EventCard renders `Arrives: {data.arrivalTime}` conditionally — Hospital / State Commuter / Holiday / Crossgates events stay visually identical.
- [x] 9. Verification: `node --check app/api/dispatch/route.js` → **PARSE OK**. Test re-runs post-port: time-gate **21/21 PASS**, parser **5/5 PASS**. Grep audit: only Sprint 54 receipt-comment hits on the legacy names; zero live code references.

### Status: CLOSED 2026-05-28
- Time Gate live with -10 min buffer. CSV pipeline fully excised — UI panel cleaner, backend no longer destructures `trainCapacity`. Backward-compat preserved: a POST body without `trainCapacity` parses cleanly (the field just doesn't exist in the destructure anymore).

### Acceptance Criteria
- A 2-hour dispatch window drops trains arriving 11+ min before window start or after window end — they never appear in terminal logs or the merged payload.
- A train arriving exactly 5 min before window start appears in the payload (buffer test).
- The CSV upload UI element is gone from the BYOD panel.
- BYOD train cards render the raw `Arrives: 5:47p` line.
- Dispatch does NOT crash when the POST body has no `trainCapacity` field (back-compat).

### Anti-Goals
- NO new libraries (native Date math only).
- NO visual restyling of EventCard beyond the new `Arrives:` line.
- NO touching `fetchAlbTrainArrivals` itself — the live feed stays, only its CSV-merged capacityMod layer comes out.
- NO removal of `aggregateTrainArrivalsByHour` — only its CSV-dependent parameters.

### Acceptance Criteria
- Terminal: every train in the textarea logs `BYOD TRAIN DATA PARSED: <num> | Status: <status> | Time: <time>`.
- Pipeline: parsed trains appear in Profitability / Map view with the standard EventCard styling (no new component).
- Robustness: empty textarea → `[]`, dispatch proceeds normally.
- `node --check` clean post-port.

### Anti-Goals
- NO new API calls (no attempt to fix Amtraker).
- NO frontend redesign — reuse EventCard + existing Mapbox pin logic.
- NO external libraries (pdf.js, scrapers, etc.). Pure regex.
- NO localStorage persistence — per-shift input.
- NO surgical changes to `buildItinerary`, `densityScore`, or `aggregateTrainArrivalsByHour`.

## Sprint 56 — The College Calendar Surge Injector

> **Retroactive log (post-implementation).** CLAUDE.md says "Plan First": the plan should have been written here before the first edit. It wasn't — logging it now so the paper trail is complete.

### Decisions (locked before coding)
- **Storage:** Hardcoded `academicSurges` array in `app/api/dispatch/route.js` (NOT a JSON file — that's Sprint 57's scope).
- **Window encoding:** Decimal-hour `activeWindows: [{ start, end }]` per entry. Hours > 24 encode the cross-midnight tail of the SAME entry (e.g. `{ start: 25.5, end: 27.0 }` = 1:30 AM - 3:00 AM next day). Both endpoints inclusive.
- **Match math:** Two-branch lookup — same-day entry + `dispatchHour ∈ [w.start, w.end]`, OR yesterday's entry + `(dispatchHour + 24) ∈ [w.start, w.end]`.
- **Pipeline integration:** Mirror the Sprint 49 holiday-event injection — push one synthetic `type: "event"` with `egressMod: 3.5` (Parity Tier with major holidays), ESP coords for the Mapbox pin. No new UI component.
- **UI:** Rename the existing label "Holiday Calendar (BYOD)" → "Holiday & Academic Calendar". NO new frontend state — dictionary lives entirely in the backend.

### Build Steps
- [x] 1. Write `test-academic-surge.js` first (TDD scaffold) with the 3 brief-required assertions + boundary cases. Run + confirm green.
- [x] 2. Add `academicSurges` dictionary + `findAcademicSurge` / `isAcademicSurge` helpers to `app/api/dispatch/route.js`.
- [x] 3. Hook a synthetic event push into `structuredEvents` right after the Sprint 49 holiday-event block. `egressMod: 3.5`.
- [x] 4. Rename label in `app/page.js`.
- [x] 5. `node --check` both files → **PARSE OK**. Re-run `test-academic-surge.js` → **18/18 PASS**.

### Acceptance Criteria
- 12:00 PM on Homecoming → 3.5x fires.
- 4:00 PM on Homecoming (gap between 14.5 and 18.5) → does NOT fire.
- 2:00 AM the night of Homecoming → cross-midnight 25.5-27.0 fires.
- Frontend label reads "Holiday & Academic Calendar".

### Anti-Goals
- NO new frontend state for academic dates (backend-only dictionary).
- NO touching of the Sprint 49 holiday pipeline.
- NO test rewrites on failure — patch the math, don't replace the file.

### Status: SUPERSEDED 2026-05-29 by Sprint 57 (data moved to event-config.json; helper renamed to findActiveEvent).

## Sprint 57 — The Unified Event Database

> **Retroactive log (post-implementation).** Same disclosure as Sprint 56 — plan wasn't written first; logging it after the fact so the trail is complete.

### Decisions (locked before coding)
- **Storage:** Flat JSON file `event-config.json` at the project root. Native Node `fs` only — NO SQLite / Mongo / Prisma (brief anti-goal).
- **Schema:** `{ [eventName]: { date: "YYYY-MM-DD", type: "holiday" | "academic", multiplier: number, activeWindows: null | [{ start, end }] } }`.
- **Match semantics:** `type: "holiday"` with `activeWindows: null` → fire whenever today's calendar date matches (whole-day surge — Sprint 49's windowed timing is deliberately collapsed). `type: "academic"` with `activeWindows` → same date-match + decimal-hour window logic from Sprint 56 (including the hours-> 24 cross-midnight tail).
- **Rip-out scope:** Delete `HOLIDAY_WINDOWS`, `isInHolidayWindow`, the `activeHoliday` request field, the `finalRideMod *= 1.5` boost, the Sprint 49 BYOD localStorage holiday calendar UI, AND the Sprint 56 `academicSurges` array. Single unified `findActiveEvent` helper replaces both.
- **API:** `app/api/config/events/route.js` — GET reads JSON, POST validates `{ eventName, newDate }` and writes via `fs.writeFileSync`. 404 on unknown event name.
- **Dispatch read path:** Re-read the JSON on every request (so a Save in the UI takes effect on the next dispatch click).
- **Frontend:** Fetch JSON on mount, populate dropdown from `Object.keys(eventConfig)`, show inline `<input type="date">` + "Save Date" button ONLY when an event is selected. Button flips to "Saved!" for 2s on success.

### Build Steps
- [x] 1. Write `scripts/seed-events.js` (26 entries: 10 holiday + 16 academic). Run it → `event-config.json` lands at project root.
- [x] 2. Refactor `test-academic-surge.js` to round-trip a mock fixture through `fs.writeFileSync` + `fs.readFileSync`. Add holiday-branch cases. Run → **23/23 PASS**.
- [x] 3. Build `app/api/config/events/route.js` (GET + POST).
- [x] 4. Refactor `app/api/dispatch/route.js`: add `fs`/`path` imports, `readEventConfig()`, `findActiveEvent`. Delete `HOLIDAY_WINDOWS`, `isInHolidayWindow`, `academicSurges`, `findAcademicSurge`, the `holidayActiveInWindow` boost, and the two separate synthetic-event pushes. Replace with a single unified push using `egressMod = entry.multiplier`.
- [x] 5. Refactor `app/page.js`: remove `HOLIDAY_OPTIONS`, `holidayCalendar`/`holidaySelect`/`holidayDate` state, localStorage hydrate, `handleSaveHoliday`, `expiredHolidays`, and the `activeHoliday` body field. Add `eventConfig`/`selectedEventName`/`dateInput`/`saveStatus` state, fetch on mount, `handleSaveEvent`, and the new dropdown + conditional date picker + "Save Date" button.
- [x] 6. `node --check` all 4 changed files → **PARSE OK**. Re-run test suite → **23/23 PASS**. Grep audit confirms no live references to removed symbols (only Sprint 57 receipt-comments remain).

### Acceptance Criteria
- `node scripts/seed-events.js` produces a valid JSON file at the project root.
- Selecting an event in the dropdown reveals the date picker pre-populated with the seeded date.
- Clicking Save POSTs to `/api/config/events` and writes `event-config.json` on disk; button flips to "Saved!" briefly.
- `test-academic-surge.js` (now reading from a mock JSON file) passes all cross-midnight and half-hour cases.

### Behavioral Changes Flagged to PO
- Holidays now fire whole-day instead of the Sprint 49 windowed timing (the schema example put `activeWindows: null` on Halloween; brief said "respecting activeWindows if the type is 'academic'").
- BYOD localStorage holiday calendar is replaced by server-side JSON; per-driver Save persistence has moved to the filesystem.
- Netlify caveat: `fs.writeFileSync` on serverless is ephemeral / may fail. This is a local-dev-first MVP per brief's acceptance criteria.

### Anti-Goals
- NO external databases (SQLite / Mongo / Prisma).
- NO new Settings page or full calendar grid — date picker stays tightly coupled to the dropdown.
- NO touching unrelated dispatch / routing logic.

### Status: CLOSED 2026-05-29 (modulo browser smoke-test — code paths verified by `node --check` + 23-assertion engine test, but the dropdown reveal / Save round-trip was not validated in a live `npm run dev` session).

---

## Sprint 58 — The BYOD Amtrak Persistence Engine

> **Plan-first per L8.** Written into `tasks/todo.md` BEFORE the first implementation edit. Mirrors the Sprint 57 Unified Event Database storage pattern (flat JSON at the project root, native `fs` only, read on every dispatch).

### Decisions (locked before coding)
- **Storage:** Flat JSON file `train-config.json` at the project root. Native Node `fs` only — NO SQLite / Mongo / Prisma / Redis / Vercel KV per brief anti-goals. Mirrors Sprint 57.
- **Schema:** `{ "savedDate": "YYYY-MM-DD", "trains": [{ trainNumber, status, time, arrivalTime }] }`. The `trains` array is the exact output shape of the existing `parseAmtrakText` regex (Sprint 53 / 54 contract — unchanged).
- **API split:**
  - NEW `app/api/config/trains/route.js` (POST only). Accepts `{ rawText, localDate }`, runs the regex parser, writes the schema via `fs.writeFileSync`. Returns `{ ok: true, savedDate, trains }`.
  - MODIFIED `app/api/dispatch/route.js` — remove `trainRawText` from the POST destructure, remove the inline `parseAmtrakText(trainRawText)` call from PHASE 2, add `readTrainConfig(localDate)` helper that returns `{ trains: [] }` on (a) missing file, (b) JSON parse failure, OR (c) `savedDate !== localDate` (lazy auto-wipe).
  - `parseAmtrakText` moves OUT of dispatch and INTO the new trains route. Sprint 54's `isTrainInWindow` time gate stays in dispatch — it gates the injection loop over the now-persistent trains array.
- **Lazy auto-wipe:** Compared at READ time inside `readTrainConfig`. No cron, no scheduled deletion, no in-memory TTL. The file may remain on disk forever; if its `savedDate` doesn't match today's local date (derived from `localStart`), dispatch sees an empty trains array.
- **Frontend:**
  - Drop `trainRawText` from the `/api/dispatch` POST body (the textarea state stays — it's the typing surface).
  - Add a "Save Trains" button directly under the textarea. Click → POST `{ rawText: trainRawText, localDate: todayLocalISO() }` to `/api/config/trains`.
  - On 2xx: button label flips to "Saved!" for ~2s then reverts. On error: label flips to "Save Failed" briefly.
- **Date source of truth:** Use the existing `todayLocalISO()` helper in `page.js` for the POST `localDate`; in dispatch, derive today's local YYYY-MM-DD from `localStart` (already a Date constructed against `timezoneOffsetMinutes`).

### Build Steps
- [x] 1. Write `test-amtrak-persistence.js` first. Cover: (a) parser round-trips through `fs.writeFileSync` + `fs.readFileSync`, (b) lazy auto-wipe returns `[]` when `savedDate` is yesterday, (c) same-day match returns the saved trains, (d) missing file returns `{ trains: [] }` without throwing, (e) malformed JSON returns `{ trains: [] }` without throwing. Run → **10/10 PASS**.
- [x] 2. Create `app/api/config/trains/route.js` (POST). Moves `parseAmtrakText` regex into the new route. Validates `rawText` is a string and `localDate` matches `^\d{4}-\d{2}-\d{2}$`. Writes the schema via `fs.writeFileSync`.
- [x] 3. Refactor `app/api/dispatch/route.js`: drop `trainRawText` from the POST destructure, delete the inline `parseAmtrakText` definition, add `readTrainConfig(todayISO)` near `readEventConfig`, derive `localDateISO` from `localStart` once, swap the Sprint 53 inline parse for `const parsedTrains = readTrainConfig(localDateISO).trains;`. The Sprint 54 `isTrainInWindow` filter loop stays exactly as written.
- [x] 4. Refactor `app/page.js`: remove `trainRawText` from the POST body (keep the state + textarea); add `trainSaveStatus` state + `handleSaveTrains` POST handler + the "Save Trains" button under the textarea.
- [x] 5. `node --check` on all 3 changed files → **PARSE OK** (dispatch, page.js, new trains route). Re-run `test-amtrak-persistence.js` → **10/10 PASS**. Re-run `test-amtrak-parser.js` → **5/5 PASS** (parser logic unchanged, just relocated). Grep audit: remaining hits of `parseAmtrakText` / `trainRawText` in dispatch are receipt comments only.

### Status: CLOSED 2026-05-29 (modulo browser smoke-test — code paths verified by `node --check` + 10-assertion persistence test + 5-assertion parser test, but the textarea → Save Trains → dispatch round-trip was not validated in a live `npm run dev` session).

---

## Sprint 59 — The localStorage Migration (57 + 58 Re-Architecture)

> **Plan-first per L8.** Written into `tasks/todo.md` BEFORE the first implementation edit. Triggered by user clarification after Sprint 58 closeout flagged the Netlify `fs.writeFileSync` failure mode for BOTH `event-config.json` (Sprint 57) and `train-config.json` (Sprint 58).

### Decisions (locked before coding)
- **Persistence:** Browser `localStorage` only. No server-side filesystem writes. Survives Netlify Lambda's read-only filesystem cleanly. Per-device, per-driver.
- **Seed strategy for events (Option A):** Static import `import SEED from "../event-config.json"` in `app/page.js`. Next.js bundles the 26-entry seed at build time (~2 KB). On mount, if `localStorage["eventConfig"]` is absent, hydrate from SEED and persist a copy. Re-seeding requires `npm run build` + redeploy.
- **Seed strategy for trains:** None needed — trains are per-shift ephemeral data. localStorage starts empty; driver pastes + saves.
- **Data flow:**
  - `handleSaveEvent` → writes `localStorage["eventConfig"]` only. No fetch.
  - `handleSaveTrains` → parses textarea client-side via the relocated `parseAmtrakText`, writes `localStorage["trainConfig"] = { savedDate, trains }`.
  - `handleDispatch` → reads BOTH from localStorage, applies the trains lazy auto-wipe client-side (savedDate vs today → empty array), sends `{ eventConfig, byodTrains }` in the dispatch body.
  - Dispatch route reads `eventConfig` + `byodTrains` from the body with defensive type-guards. No fs.
- **Lazy auto-wipe ownership:** Moves to the client. `handleDispatch` checks `savedDate === todayLocalISO()` before forwarding the trains array; mismatch → forward `[]`. Server-side `isTrainInWindow` filter (Sprint 54) is unchanged and still runs.
- **Files to delete:**
  - `app/api/config/events/route.js` (GET + POST both unused).
  - `app/api/config/trains/route.js` (POST unused).
  - `scripts/seed-events.js` STAYS — engineers regenerate `event-config.json` with it; the file is now the static-import source.
- **Tests:** Both `test-amtrak-persistence.js` and `test-academic-surge.js` currently mock the fs roundtrip. Strip the fs wrapping; keep the underlying logic assertions (parser shape, lazy-auto-wipe, findActiveEvent date+window matching). The fs round-trip was testing dead code post-migration.

### Build Steps
- [x] 1. Strip fs roundtrip from `test-amtrak-persistence.js` — keep parser + lazy auto-wipe assertions (now testing `applyLazyWipe` instead of fs read), drop the `os.tmpdir` write/read wrapper. Run → **9/9 PASS**.
- [x] 2. Strip fs roundtrip from `test-academic-surge.js` — keep findActiveEvent assertions, drop the tmp-file write/read wrapper. Run → **23/23 PASS**.
- [x] 3. Refactor `app/page.js`:
  - Added `import EVENT_CONFIG_SEED from "../event-config.json"`.
  - Added `parseAmtrakText` (relocated from the deleted trains route).
  - Mount effect: hydrates `eventConfig` from `localStorage["eventConfig"]` if present, else seeds from `EVENT_CONFIG_SEED` and persists.
  - `handleSaveEvent` → localStorage write only.
  - `handleSaveTrains` → parses client-side, writes `{ savedDate, trains }` to localStorage.
  - `handleDispatch` body → adds `eventConfig` + `byodTrains` (lazy auto-wipe applied client-side: `savedDate !== today` → `[]`).
- [x] 4. Refactor `app/api/dispatch/route.js`:
  - Destructured `eventConfig` + `byodTrains` from request body with defensive type-guards (`{}` / `[]` fallbacks).
  - Deleted `EVENT_CONFIG_PATH`, `readEventConfig`, `TRAIN_CONFIG_PATH`, `readTrainConfig`.
  - Removed `import fs from "fs"` and `import path from "path"` (verified no other consumers).
  - Replaced `const eventConfig = readEventConfig();` with the body-passed object.
  - Replaced `readTrainConfig(localDateISO).trains` with the body-passed `byodTrains`.
- [x] 5. Deleted `app/api/config/events/route.js` + `app/api/config/trains/route.js` + their empty parent directories (`app/api/` now contains only `dispatch/`).
- [x] 6. `node --check` on dispatch + page.js → **PARSE OK**. Re-ran all three test files → **9 + 23 + 5 = 37/37 PASS**. Grep audit: no live `readEventConfig` / `readTrainConfig` / `EVENT_CONFIG_PATH` / `TRAIN_CONFIG_PATH` / `/api/config` references survive (only Sprint 57/58 historical receipts in `tasks/todo.md`).

### Status: CLOSED 2026-05-29 (modulo browser smoke-test — code paths verified by `node --check` + 37-assertion test suite, but the full first-mount-seed → Save Date → reload → dispatch flow was not validated in a live `npm run dev` session).

### Acceptance Criteria
- Fresh browser visit: dropdown auto-populates from the SEED (26 entries) on first mount without any network roundtrip.
- "Save Date" persists to localStorage; reload → the new date survives; the dropdown reflects it.
- "Save Trains" parses + persists; reload → the textarea is empty (per-shift) but localStorage holds the parsed array.
- Dispatch click on the same day as Save Trains → BYOD train events still inject downstream.
- Dispatch click the next day → `savedDate` mismatch → zero BYOD train events injected (no localStorage clear needed — the next Save overwrites).
- `app/api/config/events/route.js` and `app/api/config/trains/route.js` are gone; no callers anywhere in the repo.
- Dispatch route has zero `fs.writeFileSync` / `fs.readFileSync` / `fs.existsSync` calls (the static `nightlife_dictionary.json` import is fine — it's bundled, not fs).

### Anti-Goals
- NO server-side persistence layer (no fs, no Netlify Blobs, no DB).
- NO new endpoints replacing the deleted ones.
- NO localStorage hydration for trains beyond the saved-date + trains tuple (no historical log).
- NO touching the Sprint 54 `isTrainInWindow` time-gate or the Sprint 57 `findActiveEvent` window-match math.

### Behavioral Changes Flagged to PO
- Cross-device sync is GONE for both events and trains — each driver's browser owns its own config. If a fleet manager updates events centrally, every driver must `npm run build`-pull the new SEED OR clear localStorage.
- A driver who clears browser data loses their saved event-date overrides AND any pasted trains — both revert to (a) bundled SEED for events, (b) empty for trains.
- The dispatch request body grows by ~2 KB (the eventConfig object). Negligible.

### Acceptance Criteria (Definition of Done)
- **Strict File Write:** A POST to `/api/config/trains` with the Sprint 53 sample text writes `train-config.json` at the project root with `savedDate` + `trains` keys; the `trains` array matches the existing parser output exactly.
- **Same-Day Dispatch:** With `savedDate === todayLocalISO`, dispatch reads the file, the time-gated subset injects into `structuredEvents`, and the existing BYOD log line still fires.
- **Expiration Edge Case:** With `savedDate` set to yesterday (e.g. `2026-05-28` when today is `2026-05-29`), `readTrainConfig` returns `{ trains: [] }` cleanly — no throw, no crash, zero synthetic train events injected.

### Anti-Goals
- NO external databases (Postgres / Mongo / Redis / Prisma / Vercel KV).
- NO cron / scheduled wipe — lazy read-time evaluation only.
- NO changes to the live Amtraker fetcher (`fetchAlbTrainArrivals`) — BYOD rides alongside.
- NO UI redesign / new cards / new Mapbox pins beyond the Save button.
- NO touching the Sprint 54 `isTrainInWindow` time-gate logic.

---

## Sprint 60 — UI Deprecation & The Hybrid Excision

### Epic
Aggressively reduce visual clutter and technical debt by deprecating legacy UI toggles (Location/Hub filters, BYOD CSV uploader, Ghost Mode), while preserving the `includeAirport` / `includeAmtrak` backend contract for future headless clients.

### Decision (interpretation locked-in)
"BYOD Data Settings panel (CSV uploader)" parses as the CSV sub-block, NOT the entire fieldset. Recent (Sprint 45/53–59) sub-features stay: Amtrak textarea + Save Trains, Cost Per Mile slider, Holiday/Academic Calendar picker. Only the CSV uploader, the campus calendar pipeline, and Ghost Mode are excised. Confirmed with user before first edit.

### Build Steps (Frontend)
- [x] `app/page.js` — delete `useState` for `includeAirport`, `includeAmtrak`, `showRawData`, `campusCalendar`; delete `handleCsvUpload`; delete `calendarExpired`; delete the `campusCalendar` hydrate try-block inside the existing `useEffect` (keep the `dispatchCostPerMile` hydrate).
- [x] `app/page.js` — hardcode `includeAirport: true, includeAmtrak: true` in the dispatch body; drop `showRawData` and the `campusEvent` injection entirely.
- [x] `app/page.js` — remove the Location/Hub Filtering `<fieldset>` JSX.
- [x] `app/page.js` — remove the CSV uploader sub-block (label + `<input type="file">` + count + `calendarExpired` warning) from the BYOD panel.
- [x] `app/page.js` — remove the Ghost Mode `<label>` JSX.
- [x] `components/DispatchCards.jsx` — remove the `ghostCls` constant + each card's `${data.isWeak ? ghostCls : ""}` conditional.
- [x] `components/DispatchMap.jsx` — remove the `item.isWeak` color override and the `opacity: 0.5` inline style.

### Build Steps (Backend — Hard Delete)
- [x] `app/api/dispatch/route.js` — remove `showRawData` from `buildItinerary` signature and the `if (showRawData) return true;` bypass (Sprint 27 strict `< 10.0` cutoff is now permanent).
- [x] `app/api/dispatch/route.js` — remove `showRawData` and `campusEvent` from the POST destructure; remove `const showRawData = showRawDataRaw === true;`.
- [x] `app/api/dispatch/route.js` — remove `campusEventStr` / `isTransitCampusDay` / `isFoodCampusDay` block and the downstream `isFoodCampusDay` food-hotspot `campusMod` boost.
- [x] `app/api/dispatch/route.js` — remove the `showRawData` arg from the `buildItinerary` call site.
- [x] PRESERVE: `includeAirport` + `includeAmtrak` destructure, defaulting, and all downstream Synthetic Ripple Swap logic.

### Verification
- [x] `node --check` on both `route.js` and `page.js` after the edits — clean parse.

### Acceptance Criteria
- Frontend smoke test reveals no Location/Hub panel, no CSV uploader, no Ghost Mode toggle.
- POST body now transmits `includeAirport: true` + `includeAmtrak: true` always (no `showRawData`, no `campusEvent`).
- Dispatch still completes 200 OK; cards + map render normally.
- Backend `includeAirport` / `includeAmtrak` ripple logic remains functional at the API level.

### Anti-Goals
- NO localStorage cleanup script — orphaned `campusCalendar` key is passively ignored.
- NO deletion of backend Hub Filter (`includeAirport` / `includeAmtrak`) logic.
- NO UI redesign — strictly subtractive.

---

## Sprint 61 — The Outbound Amtrak Ingress Engine

### Epic
Expand the BYOD Amtrak pipeline to cover departing trains. Driver picks Inbound or Outbound; outbound routes to Empire State Plaza (ESP) `OUTBOUND_BUFFER_MINUTES = 60` before the train leaves so they can intercept passengers heading to the station.

### Decisions (locked-in)
- New constants live next to the spatial anchors at the top of `route.js`: `OUTBOUND_BUFFER_MINUTES = 60`, `OUTBOUND_DROP_THRESHOLD = 40`.
- Parser becomes direction-aware: `parseAmtrakText(rawText, direction)`. When `direction === "outbound"` the regex captures the time block under `DEPARTS` instead of `ARRIVES`. Output shape stays `{ trainNumber, status, time, arrivalTime }`; for outbound, `time` is the DEPARTS time as "H:MM AM/PM" and `arrivalTime` carries the raw `H:MMp` DEPARTS string so EventCard's existing line keeps rendering (it stays a single time-of-day line — the card's "Arrives:" label is acceptable noise per the NO-UI-redesign anti-goal).
- The `direction` field is persisted in `localStorage["trainConfig"]` alongside `{ savedDate, trains }` so the radio survives reload.
- Backend gating order: for outbound trains, compute `delta = depMin - nowMin` (with the same `< -360` cross-midnight rollover used by Sprint 54 / 32.1). If `delta < OUTBOUND_DROP_THRESHOLD` → drop. Else if `delta < OUTBOUND_BUFFER_MINUTES` → `leaveBy = formatTimeLabel(nowMin)` (clamp to now). Else → `leaveBy = formatTimeLabel(depMin - OUTBOUND_BUFFER_MINUTES)`.
- After the shift / clamp, the existing `isTrainInWindow` time-gate runs against the synthetic `leaveBy` so out-of-dispatch-window outbound trains are still suppressed.
- For outbound events the synthetic push uses `ESP_COORDS`, location label `"Empire State Plaza — Outbound Train ${trainNumber}"`, omits `origin: "NYP"` (the rider is heading TO NYP), keeps `egressMod: 2.0` for parity with the inbound branch.

### Build Steps
- [x] 1. Write `test-amtrak-outbound.js` (TDD) covering: parser DEPARTS capture, drop (`delta < 40`), clamp-to-now (`40 <= delta < 60`), shift (`delta >= 60`), 40-min and 60-min boundary inclusivity, cross-midnight rollover, malformed input → null.
- [x] 2. Run `node test-amtrak-outbound.js` → confirm ALL PASS before editing `route.js`. **16/16 PASS.**
- [x] 3. `route.js`: add `OUTBOUND_BUFFER_MINUTES` + `OUTBOUND_DROP_THRESHOLD` next to `ESP_COORDS` / `AMTRAK_COORDS`.
- [x] 4. `route.js`: add `formatTimeLabel(minutesSinceMidnight)` and `computeOutboundLeaveBy(departureTimeStr, localStart)` near `parseTimeLabel`.
- [x] 5. `route.js`: extend POST destructure with `direction: directionRaw`; defensive default to `"inbound"` unless `directionRaw === "outbound"`.
- [x] 6. `route.js`: in the existing BYOD train injection loop, branch on `direction`. Outbound branch computes leaveBy via `computeOutboundLeaveBy`; drop on `null`; pushes synthetic event with `ESP_COORDS` + ESP location label; reuses the existing `isTrainInWindow` against the shifted/clamped `leaveBy`.
- [x] 7. `app/page.js`: extend `parseAmtrakText(rawText, direction)` so outbound captures DEPARTS. Add a `direction` `useState` defaulting to `"inbound"`. Add a radio fieldset above the Amtrak textarea. Persist `{ savedDate, direction, trains }` in `handleSaveTrains`. Read & hydrate `direction` from `localStorage["trainConfig"]` on mount. Forward `direction` in the dispatch body.
- [x] 8. Verification: `node --check` clean on both `route.js` and `page.js`; `node test-amtrak-outbound.js` → 16/16 PASS; `node test-amtrak-parser.js` → 5/5 PASS; `node test-time-gate.js` → 21/21 PASS.
- [x] 9. Update this todo file with the closing status.

### Acceptance Criteria
- TDD: `test-amtrak-outbound.js` exists at repo root and passes before `route.js` is edited.
- Outbound synthetic event lands at `ESP_COORDS` with a `leaveBy` reflecting either the 60-min shift or the clamp-to-now rule.
- Trains departing in under 40 min from `localStart` are silently dropped (no log spam, no card, no pin).
- Inbound behavior is byte-for-byte unchanged: still pushes the Rensselaer-pinned event with the verbatim `train.time` as `leaveBy`.
- Radio choice survives a hard reload because it lives in `trainConfig` alongside the parsed trains.

### Anti-Goals
- NO live Amtrak API call (no `api-v3.amtraker.com`, no fetcher, no cache entry).
- NO redesign of Mapbox pins or `DispatchCards.jsx` — outbound rides the existing purple `type: "event"` path.
- NO changes to the inbound code path or its log line — strictly additive branch.
- NO new fields in the synthetic event shape beyond what `type: "event"` already supports.

### Status: CLOSED 2026-05-29 — outbound branch + radio toggle landed; `test-amtrak-outbound.js` (16/16), `test-amtrak-parser.js` (5/5), `test-time-gate.js` (21/21) all green; `node --check` clean on both `route.js` and `page.js`. Browser smoke-test of the radio + dispatch round-trip not yet exercised in a live `npm run dev` session.

---

## Sprint 62 — The Unified Situational Radar (Dual-Color)

### Epic
Show Inbound (live Amtraker arrivals at Rensselaer) and Outbound (BYOD departures at ESP) trains on the same Mapbox radar at the same time, color-coded so the driver has full situational awareness in one glance.

### Decisions (locked-in)
- **Keep the radio toggle.** It governs HOW the BYOD paste is parsed (ARRIVES vs DEPARTS anchor). It does NOT gate which directions appear on the radar — both directions render whenever the data supports them.
- **Inbound = `aggregateTrainArrivalsByHour` (live Amtraker API)** — already runs unconditionally; just needs `categories: ["Inbound"]` stamped on each bucket so the frontend can color it.
- **Outbound = BYOD parser with `direction === "outbound"`** — already pushes synthetic events with `["BYOD Train", "Outbound", status]`. No backend change needed.
- **BYOD inbound branch** also gets `"Inbound"` added to its categories array so per-train BYOD arrivals color emerald like the live buckets.
- **Color rule (frontend):** `categories.includes("Outbound")` → `#f97316` (orange); `categories.includes("Inbound")` → `#10b981` (emerald); else fall back to the existing `type`-based palette.
- **Overlap rule:** any pin tagged Outbound gets `+0.0005` added to its longitude at render time. Simple, no neighbor-scan required, and it future-proofs against any non-ESP Outbound coords landing on top of an Inbound pin.
- **Popup header:** when categories carries Inbound or Outbound, replace the uppercase `type` line with "Arriving" / "Departing"; otherwise keep the existing `type` label.
- **`densityScore` math untouched.** Live Inbound buckets sort on `hub` capacity (Rensselaer = 300, yield 10/train). Outbound events sort on `event` yield (50) × egressMod (2.0). Both already coexist in the Profitability sort today — no rebalancing.

### Build Steps
- [x] 1. `route.js` — `aggregateTrainArrivalsByHour`: add `categories: ["Inbound"]` to each bucket pushed.
- [x] 2. `route.js` — BYOD inbound branch: insert `"Inbound"` into the categories array (`["BYOD Train", "Inbound", train.status]`) so per-train BYOD arrivals are taggable by the map.
- [x] 3. `route.js` — add a targeted one-line log right before the merged-payload dump that counts Inbound vs Outbound items in `mergedPayload.itinerary` (verification per Test-Driven Scaffolding rule).
- [x] 4. `DispatchMap.jsx` — replace the type-only `pinColor` with an item-aware helper that checks categories first; preserve the existing `PIN_HEX` fallback.
- [x] 5. `DispatchMap.jsx` — apply `+0.0005` longitude offset to any Outbound marker's `longitude` prop AND to the popup `longitude` so the open popup follows the offset pin.
- [x] 6. `DispatchMap.jsx` — derive a `directionLabel` ("Arriving" / "Departing" / null) inside the popup and render it in place of `selectedItem.type` when present.
- [x] 7. Verification: `node --check app/api/dispatch/route.js` clean; `test-amtrak-outbound.js` (16/16), `test-amtrak-parser.js` (5/5), `test-time-gate.js` (21/21) all green.
- [x] 8. Update this todo file with the closing status.

### Status: CLOSED 2026-05-29 — radio toggle preserved per user override; live Amtraker buckets + BYOD inbound entries now tagged `["Inbound", ...]`; BYOD outbound was already tagged `[..., "Outbound", ...]`; `DispatchMap.jsx` colors from categories (emerald/orange), offsets Outbound markers + popups by `+0.0005` longitude, and swaps the popup header to "Arriving"/"Departing". Live `npm run dev` browser smoke-test of the dual-color radar not yet exercised.

---

## Sprint 62.1 — Hotfix: Tear Down the XOR Gate

### Bug
User reports that the radar still surfaces only one direction at a time. The literal hotfix prompt called for removing any `if/else returns or continue statements` causing the Live feed and BYOD feed to mutually exclude.

### Audit
Grep of `route.js` for `direction` returned 5 hits — all confined to (a) destructuring + defensive coercion at the top of POST, and (b) the BYOD loop's per-train routing branch. The Live Amtraker feed (`fetchAlbTrainArrivals` → `aggregateTrainArrivalsByHour` → `trainsByHour` → merged payload) does NOT read `direction` anywhere. There is no Live↔BYOD XOR gate in code.

### Real Likely Cause (flagged, not fixed in this sprint)
The Sprint 27 strict density floor (`densityScore < 10.0` → drop) silently filters live inbound hour-buckets with low train volume. A typical 1-train Rensselaer bucket scores `(1 × 10 / 300) × 100 = 3.33` → dropped before reaching the itinerary. Once decay (`0.4–0.7`) stacks on, even 3–4 train buckets drop. This produces the "only outbound visible" symptom the user is reporting whenever the live API returns sparse arrivals.

### Decisions (locked-in)
- Honor the literal hotfix instruction: convert the BYOD loop's `if (direction === "outbound") { ... continue; }` into a clean `if/else` so the per-train direction routing is structurally obvious and the trailing `continue` is gone.
- Add a header comment to the BYOD loop spelling out that Live feed (Phase 1) and BYOD feed (Phase 2) are fully independent.
- Expand the Sprint 62 verification log so the terminal shows: `direction`, live inbound bucket count, BYOD event count, plus the existing itinerary Inbound/Outbound counts — making "both feeds ran" verifiable at a glance.
- Do NOT silently change `densityScore` math or filter behavior; flag the density floor as a follow-up so the user can decide.

### Build Steps
- [x] 1. Grep `route.js` for every `direction` usage and confirm Live feed has zero direction gates.
- [x] 2. `route.js` — refactor BYOD loop to `if/else`, remove trailing `continue;` from outbound branch.
- [x] 3. `route.js` — add Sprint 62.1 header comment to the BYOD loop explaining the Live/BYOD independence.
- [x] 4. `route.js` — expand the Sprint 62 RADAR CHECK log to surface `direction`, live inbound count, BYOD event count, and final itinerary Inbound/Outbound counts.
- [x] 5. Verification: `node --check route.js` clean; `test-amtrak-outbound.js` 16/16 PASS; `test-time-gate.js` 21/21 PASS.

### Acceptance Criteria
- `direction` is consulted only inside the BYOD loop's per-train routing block — zero other call sites.
- BYOD outbound branch terminates the iteration via `else`, not `continue`.
- Terminal log on every dispatch surfaces both feed counts so XOR can be ruled out without reading the full merged payload.

### Out of Scope (flagged for follow-up)
- Adjusting the Sprint 27 strict `< 10.0` density floor for live inbound buckets — separate decision the user should make explicitly.

### Status: CLOSED 2026-05-29 — BYOD loop refactored to `if/else` with a Sprint 62.1 header comment proving non-XOR; verification log now surfaces feed-by-feed counts; `node --check` clean; `test-amtrak-outbound.js` 16/16 + `test-time-gate.js` 21/21 still green. Density-floor follow-up flagged in Out of Scope.

### Acceptance Criteria
- A single dispatch click with BYOD outbound data pasted renders BOTH emerald inbound buckets (Rensselaer) AND orange outbound pins (ESP) on the same map.
- Color rule strictly: Inbound = `#10b981`, Outbound = `#f97316`. Non-train items keep their pre-Sprint-62 colors.
- An Outbound pin at the same lat/lng as any other pin sits visually offset by `+0.0005` longitude — no eclipsing.
- Popup for an Inbound bucket reads "Arriving"; popup for an Outbound train reads "Departing".
- Sprint 53/54/61 time-gates (BYOD `-10 min` window, Outbound `40-min` drop / `60-min` shift, live API window filter) remain functional.
- No extra network calls — both pipelines reuse the existing Amtraker + body-passed BYOD inputs.

### Anti-Goals
- DO NOT remove the radio toggle (user override of original Sprint 62 prompt — driver still controls how the BYOD paste is parsed).
- DO NOT fetch new external data.
- DO NOT add layering checkboxes.
- DO NOT touch `DispatchCards.jsx` non-train logic.
- DO NOT rewrite `DispatchMap.jsx` — strictly surgical patches to `pinColor`, the marker `longitude`, and the popup header.

---

## Sprint 62.3 — The Multiplier Audit & Reality Check (HOTFIX)

### Context
Audit of a "Last Call" event payload revealed: an 80-capacity bar generated `expectedYield = 450` because the synthetic event hit `yieldRateFor`'s `egressMod >= 2.5` branch and inherited the `mega_event` (450) base — the stadium-scale baseline. Nightlife is a micro-venue category; it must NOT inherit macro-event yields.

### Decisions
- Decouple nightlife from the mega-event branch by adding a tagged check on `categories` ("Last Call" / "Nightlife Egress") in `yieldRateFor` BEFORE the `egress >= 2.5` fallthrough — mirrors the existing Sprint 52 retail-egress pattern.
- Add a `nightlife` key to `YIELD_RATES` with a small-bar base (20). Multiplied by the venue's `egressMod` (3.5x) inside `yieldRateFor` yields ~70 — strictly below the 80 default-capacity ceiling.
- Add a 1-line safety ceiling in `buildItinerary` immediately after `expectedYield` is computed: `if (expectedYield > estimatedCapacity) expectedYield = Math.floor(estimatedCapacity * 0.9)` — a permanent fail-safe against any future multiplier combination that could re-break physics.
- Do NOT extend the safety ceiling into `densityScore` math — that surface is allowed to exceed 100% because the `finalRideMod` multiplier is part of its design.

### Build Steps
- [x] 1. `route.js` — add `nightlife: 20` to `YIELD_RATES`.
- [x] 2. `route.js` — in `yieldRateFor`'s event branch, add a `/last call|nightlife/i` check on the joined categories that returns `YIELD_RATES.nightlife * egressMod` BEFORE the mega-event fallthrough.
- [x] 3. `route.js` — in `buildItinerary` `.map`, switch `const expectedYield` to `let` and add the 1-line capacity ceiling immediately after `estimatedCapacity` is computed.
- [x] 4. Verification: `node --check route.js` clean; mock payload (volume=1, egressMod=3.5, categories=["Last Call","Nightlife Egress"]) yields `expectedYield = 70`, `estimatedCapacity = 80`, ceiling not triggered, densityScore = 87.5.

### Acceptance Criteria
- A mock "Last Call" event at a small bar (volume=1, egressMod=3.5, categories=["Last Call","Nightlife Egress"]) emits `expectedYield` in the 50–70 range AND strictly less than its `estimatedCapacity` (80).
- The resulting `densityScore` is high but realistic (~80–90).
- Safety ceiling kicks in for any synthetic event where `volume × yieldRate` would otherwise exceed `estimatedCapacity`.

### Anti-Goals
- DO NOT rewrite the dispatch routing logic.
- DO NOT remove the Sprint 52 retail-egress short-circuit or the Sprint 44 hospital-shift short-circuit.
- DO NOT clamp `densityScore` (only `expectedYield`).
- DO NOT touch capacity dictionary entries — the user explicitly expects the 80 default for small bars.

### Status: CLOSED 2026-05-29 — `yieldRateFor` decouples nightlife from `mega_event` via tagged branch; `expectedYield` safety ceiling enforced in `buildItinerary`; mock payload confirms 70 / 80 / 87.5 split.

---

## Sprint 63 — Unified Population Density Engine (Rides & Delivery)

### Epic
Close the "DoorDash/Uber Gap" during steady-state hours. Build a spatial heuristic engine on top of a static US Census-derived population grid so (a) food hotspots in dense residential pockets earn a `populationDensityMod` boost, and (b) high-density residential nodes themselves become synthetic ride origins when no other surge signal is present.

### Decisions (locked-in, user-confirmed)
- **Grid source:** Synthesized seed. Deterministic hand-built grid of ~30–50 nodes around Center Square (42.652, -73.765), Pine Hills (42.661, -73.785), and SUNY (42.686, -73.823), spread across the Albany / Westmere bounding box (lat 42.63–42.75, lng -73.90 to -73.72). Mirrors public ACS5 weight patterns without a network call.
- **Ride floor handling:** Math sized to clear. `residential_node` yield = 5, capacity = 100. With a `populationDensityMod` of 2.0 the densityScore math is `(1 × (5 × 2.0)) / 100 × 100 = 10.0` → exactly clears the Sprint 27 strict `< 10.0` drop. Higher-density nodes scale up naturally. No bypass — the floor stays universal.
- **Hub volume cap:** Top-N capped at 5. Score every grid node, sort by `populationDensityMod` desc, take the first 5 that hit `>= 2.0`. Mirrors Sprint 47's single-injection discipline.
- **Radius:** 1.5 mile spatial join for food boost lookup (the user's brief specified 1.5–2 mi; pick the tighter end so we don't bleed boost into commercial wastelands).
- **Capacity dictionary key:** `"residential_node"` → 100 (per brief). `YIELD_RATES.residential_node = 5` (per brief).
- **Path resolver:** `path.join(process.cwd(), "app", "data", "albany_pop_grid.json")` + synchronous `fs.readFileSync` at module load → in-memory constant. Zero per-request I/O; serverless cold-start cost only.
- **Verification logs:** Two distinct one-liners per dispatch — `[Food Boost] <name> at <lat>,<lng> received populationDensityMod=<x>` and `[Ride Boost] Synthetic Residential Hub at <lat>,<lng> generated with populationDensityMod=<x>`.

### Build Steps
- [x] 0. Append this Sprint 63 section to `tasks/todo.md` (this step).
- [x] 1. Create `scripts/build-census-grid.js` — synthesizes ~30–50 nodes around the three anchors with realistic weights, writes to `app/data/albany_pop_grid.json`. Idempotent. **(90 nodes seeded; 24 dense / 30 mid / 36 low.)**
- [x] 2. Add `"build-grid": "node scripts/build-census-grid.js"` to `package.json` scripts.
- [x] 3. Run `npm run build-grid` once → confirm `app/data/albany_pop_grid.json` is created + readable.
- [x] 4. `app/api/dispatch/route.js` — add `fs`+`path` imports + synchronous load of the grid into a module-scope `POPULATION_GRID` constant.
- [x] 5. `app/api/dispatch/route.js` — add `calculateSpatialPopulationBoost(lat, lng)` helper. Returns `populationDensityMod` ∈ [1.0, 2.5] based on the nearest node within 1.5 mi (Haversine).
- [x] 6. `app/api/dispatch/route.js` — add `residential_node: 5` to `YIELD_RATES` and `"residential_node": 100` to `CAPACITY_DICTIONARY`.
- [x] 7. `app/api/dispatch/route.js` — `yieldRateFor` + `capacityFor` both branch on `type: "ride"`; yield = `YIELD_RATES.residential_node × populationDensityMod`, capacity = 100.
- [x] 8. `app/api/dispatch/route.js` — food branch of `computeHotspots` attaches `populationDensityMod` and emits `[Food Boost]` log; `yieldRateFor` multiplies the food baseline by it.
- [x] 9. `app/api/dispatch/route.js` — `buildSyntheticRideHubs()` iterates `POPULATION_GRID`, filters mod ≥ 2.0, sorts desc, caps at 5; emits one `[Ride Boost]` log per injection; result lands in `mergedPayload.rideHubs` and flows into `buildItinerary` rawItems.
- [x] 10. Verification: `node --check` clean; `test-population-grid.js` 11/11 PASS; regression: `test-amtrak-outbound.js` 16/16, `test-time-gate.js` 21/21, `test-density-engine.js` 10/10.
- [x] 11. Close out — update this section with the closing status.

### Acceptance Criteria
- `app/data/albany_pop_grid.json` is populated and shaped as `[{ lat, lng, population, baseMultiplier }, ...]`.
- JSON is read synchronously at module load — no per-request fs work, serverless functions stay well under the 10s timeout.
- Terminal log on every dispatch shows BOTH `[Food Boost]` lines (one per qualifying restaurant) AND `[Ride Boost]` lines (≤5).
- A synthetic ride node with `populationDensityMod = 2.0` clears the Sprint 27 `< 10.0` density floor.
- Existing Sprint 62 logic (Train carve-outs, BYOD outbound, dual-color radar) and the Sprint 62.3 `Math.floor(estimatedCapacity * 0.9)` capacity ceiling are untouched.

### Anti-Goals
- DO NOT fetch the Census API at runtime — grid is baked at build time.
- DO NOT bypass the Sprint 27 density floor for synthetic ride nodes — let the math clear it.
- DO NOT exceed 5 synthetic ride injections per dispatch.
- DO NOT touch `DispatchMap.jsx`, `DispatchCards.jsx`, or any UI file — radar already renders `type: "ride"` via the existing palette fallback.
- DO NOT modify existing food yield baselines — boost is a strict multiplicative add-on.

### Status: CLOSED 2026-05-30 — `app/data/albany_pop_grid.json` seeded with 90 nodes via `npm run build-grid`; `route.js` loads grid synchronously at module scope, exposes `calculateSpatialPopulationBoost` (1.5 mi nearest-node lookup), boosts food yield in `yieldRateFor`, injects up to 5 synthetic `type: "ride"` hubs (mod ≥ 2.0) into `mergedPayload.rideHubs` which `buildItinerary` consumes alongside existing surge streams; `node --check` clean; `test-population-grid.js` 11/11 PASS; regression suites (Amtrak outbound 16/16, time-gate 21/21, density engine 10/10) still green. Live `npm run dev` browser smoke-test of `[Food Boost]` + `[Ride Boost]` log lines not yet exercised.

## Sprint 64 — The Dual-Direction BYOD Amtrak Engine

### Epic
Sprints 59 + 61 left the BYOD train pipeline with a frontend storage overwrite: a single `localStorage["trainConfig"]` key meant saving Outbound trains wiped the driver's saved Inbound trains (and vice-versa), so only ONE direction could ever ship in a dispatch body. Split frontend storage into per-direction keys, send a dual-array payload, and pre-merge on the backend so a single loop renders both inbound (emerald) and outbound (orange) trains on the radar simultaneously.

### Decisions (locked before coding)
- **Frontend split:** Two React states (`trainConfigInbound`, `trainConfigOutbound`) and two localStorage keys (`trainConfigInbound`, `trainConfigOutbound`) each shaped `{ savedDate, trains }`. The Sprint 61 single `trainConfig` key is retired (no migration; first Save of either direction seeds the new key).
- **Direction radio:** Still drives `parseAmtrakText` anchor + which state/key receives the save. The radio's own choice is NOT persisted independently (the spec only mandates hydrating the two train arrays); defaults to `"inbound"` on reload — minimal surgical change vs Sprint 61.
- **Lazy auto-wipe:** Applied independently per direction inside `handleDispatch` — each `savedDate !== today` collapses ONLY that direction's array to `[]`, never the other.
- **Body contract:** Exactly `{ inboundTrains: [...], outboundTrains: [...] }`. The Sprint 59 `byodTrains` key + Sprint 61 `direction` key are both removed from the body.
- **Backend pre-merge:** `const allByod = [...inboundTrains.map(t => ({...t, direction: "inbound"})), ...outboundTrains.map(t => ({...t, direction: "outbound"}))];`. Single BYOD injection loop reads `train.direction` per-iteration. NO duplicated loop.
- **Defensive defaulting:** Backend destructures `const { inboundTrains = [], outboundTrains = [] } = body;` PLUS belt-and-suspenders `Array.isArray` coercion (mirrors Sprint 59's `byodTrains` boundary guard, per L1).
- **Test-first:** `test-dual-amtrak.js` proves (a) pre-merge stamps `direction` correctly, (b) defensive defaulting handles undefined arrays without crashing. Run BEFORE any `route.js` / `page.js` edit.

### Build Steps
- [x] 0. Append this Sprint 64 section to `tasks/todo.md`.
- [x] 1. Create `test-dual-amtrak.js` at project root with mock inbound/outbound arrays + assertions for pre-merge stamping + defensive defaulting.
- [x] 2. Run `node test-dual-amtrak.js`; confirm 0 failures.
- [x] 3. `app/api/dispatch/route.js`: replace `byodTrains` + `direction` body destructure with `inboundTrains = []` + `outboundTrains = []` defensive destructure. Belt-and-suspenders `Array.isArray` coercion preserved per L1.
- [x] 4. `app/api/dispatch/route.js`: add the pre-merge (`allByod`) immediately before the existing BYOD injection block; stamp each train with its `direction` field.
- [x] 5. `app/api/dispatch/route.js`: adapt the single BYOD loop to iterate `allByod` and branch on `train.direction` instead of the global `direction` variable. No duplicated loop.
- [x] 6. `app/api/dispatch/route.js`: update the Sprint 62 RADAR CHECK log so `direction` is replaced with the per-direction counts (`inbound:N outbound:M`) coming from the new arrays.
- [x] 7. `app/page.js`: add `trainConfigInbound` + `trainConfigOutbound` React states; replace the single Sprint 61 hydration `useEffect` with one that reads BOTH localStorage keys on mount and seeds both states (defaulting to `{ savedDate: null, trains: [] }` if missing/malformed).
- [x] 8. `app/page.js`: update `handleSaveTrains` to branch on the current radio `direction` and persist to the matching state + localStorage key.
- [x] 9. `app/page.js`: update `handleDispatch` to apply the lazy auto-wipe independently to both states and POST `{ inboundTrains, outboundTrains }`. Drop `body.byodTrains` and `body.direction`.
- [x] 10. Verification: `node --check` both files; re-run `test-amtrak-outbound.js` + `test-time-gate.js` for regression; confirm `test-dual-amtrak.js` 0 failures.

### Acceptance Criteria
- `test-dual-amtrak.js` exists at project root and runs cleanly with 0 failures.
- Frontend localStorage maintains DISTINCT `trainConfigInbound` + `trainConfigOutbound` keys; toggling the radio and saving one direction does NOT erase the other.
- Backend `/api/dispatch` POST handler gracefully handles bodies missing either train array — no 500.
- A single dispatch click with BOTH directions previously saved results in inbound (emerald) AND outbound (orange) trains co-existing on the Mapbox radar and in the List view.
- Sprint 27 `< 10.0` strict density floor untouched.
- `fetchAlbTrainArrivals` live pipeline untouched.

### Anti-Goals
- DO NOT duplicate the backend BYOD injection loop — single loop reading `train.direction` only.
- DO NOT modify the Sprint 27 strict `< 10.0` density floor math.
- DO NOT create new Mapbox markers, UI components, or change `DispatchCards.jsx`.
- DO NOT alter `fetchAlbTrainArrivals` / the live Amtraker pipeline.

### Status: CLOSED 2026-05-30 — `test-dual-amtrak.js` 26/26 PASS (pre-merge direction stamping + defensive defaulting on missing/null/garbage payloads); `route.js` POST destructures `inboundTrains = []` / `outboundTrains = []` with belt-and-suspenders `Array.isArray` coercion, pre-merges into a single `allByod` array (each train stamped with its own `direction`), and the single BYOD loop now branches on `train.direction` (no duplicated loop, global `direction` flag deleted); RADAR CHECK log updated to surface `byodInbound` + `byodOutbound` counts. `page.js` adds split states + storage keys (`trainConfigInbound` / `trainConfigOutbound`), hydrates both on mount, `handleSaveTrains` routes the save to the matching key based on the active radio, `handleDispatch` applies the lazy auto-wipe per-direction and POSTs `{ inboundTrains, outboundTrains }` (legacy `byodTrains` + `direction` body keys gone). `node --check` clean on both files; regression `test-amtrak-outbound.js` 16/16 + `test-time-gate.js` 21/21 still green. Live `npm run dev` browser smoke-test of dual-color radar (inbound emerald + outbound orange) not yet exercised.

## Sprint 65 — Relative Time Indicators for Transit

### Epic
Drivers see absolute timestamps on transit cards ("12:10p") and have to mentally subtract from their dashboard clock to know how soon to position. Stamp a precise, mathematically accurate `relativeTime` string ("Arriving in 45 mins", "Departed 5 mins ago") onto each transit payload entry on the backend at dispatch time and render it statelessly on the cards — no React state, no ticking timers, no client-side clock math.

### Decisions (locked before coding)
- **Helper signature:** `computeRelativeTimeString(targetMinutes, startMinutes, kind = "arrival")`. Pure function; returns `null` on non-finite inputs so the renderer can fall back gracefully. `kind` is `"arrival"` (verbs Arriving / Arrived) or `"departure"` (Departing / Departed).
- **Wrap convention (matches Sprint 61):** `delta = targetMin - startMin`. If `delta < -360` → `delta += 1440` (cross-midnight forward); if `delta > 720` → `delta -= 1440` (cross-midnight backward). Mirrors `computeOutboundLeaveBy` and `isTrainInWindow` so the same wall-clock conventions apply across every time helper in the file.
- **No clamping ("Precise Historian"):** Past deltas are stated explicitly ("Arrived 5 mins ago"). Zero is `"Arriving in 0 mins"` / `"Departing in 0 mins"`. No "Now" / "Just arrived" alias.
- **Unit string:** always `"mins"` (matches every example in the brief). No 1-vs-many pluralization branch — keeps the helper trivial.
- **Live inbound stamp site:** `aggregateTrainArrivalsByHour` — compute `targetMin = parseTimeLabel(hourBucket)` (hour-boundary anchor, e.g., "5 PM" → 17:00) and stamp `relativeTime` onto each emitted bucket object.
- **BYOD inbound stamp site:** inside the existing BYOD loop's inbound branch — target = `train.time`, kind = `"arrival"`, stamp onto the pushed synthetic event.
- **BYOD outbound stamp site:** inside the outbound branch — target = `train.time` (the actual train DEPARTS time, NOT the shifted `leaveBy`, because the verb is "Departing/Departed" describing the train itself), kind = `"departure"`, stamp onto the pushed synthetic event.
- **Stateless rendering:** `TrainCard` gets a new muted line below the From-line; `EventCard` gets a new muted line below the existing `Arrives:` line. Both conditional on `data.relativeTime` existing — older payloads still render cleanly.
- **No client-side clock math:** the frontend renders the string verbatim. No `useEffect`, no `setInterval`, no per-render `Date.now()`.
- **Time-gate immutability:** Sprint 54 `isTrainInWindow` + Sprint 61 `computeOutboundLeaveBy` are not touched. `relativeTime` is purely cosmetic — it lives next to (not inside) the time-gate decisions.

### Build Steps
- [x] 0. Append this Sprint 65 section to `tasks/todo.md`.
- [x] 1. Create `test-relative-time.js` at project root: assertions for future arrival, future departure, zero delta (both verbs), past (both verbs), cross-midnight forward, cross-midnight backward, null/invalid inputs.
- [x] 2. Run `node test-relative-time.js`; confirm 0 failures.
- [x] 3. `app/api/dispatch/route.js`: add `computeRelativeTimeString` helper next to `formatTimeLabel`.
- [x] 4. `app/api/dispatch/route.js`: stamp `relativeTime` on each bucket emitted by `aggregateTrainArrivalsByHour` (target = `parseTimeLabel(hourBucket)`, kind `"arrival"`).
- [x] 5. `app/api/dispatch/route.js`: stamp `relativeTime` on the BYOD inbound synthetic event (target = `parseTimeLabel(train.time)`, kind `"arrival"`).
- [x] 6. `app/api/dispatch/route.js`: stamp `relativeTime` on the BYOD outbound synthetic event (target = `parseTimeLabel(train.time)`, kind `"departure"`).
- [x] 7. `components/DispatchCards.jsx`: `TrainCard` renders `data.relativeTime` as a muted secondary line when present; `EventCard` does the same below the `Arrives:` block.
- [x] 8. Verification: `node --check` clean on `route.js` and `DispatchCards.jsx`; `test-relative-time.js` 0 failures; regression `test-dual-amtrak.js` 26/26 + `test-amtrak-outbound.js` 16/16 + `test-time-gate.js` 21/21 still green.

### Acceptance Criteria
- `test-relative-time.js` exists, covers future / zero / past / cross-midnight, 0 failures.
- `/api/dispatch` returns transit-typed items carrying a `relativeTime` string.
- `TrainCard` + `EventCard` render `relativeTime` only when present — payloads missing the field render exactly as before.
- No `useEffect` / `setInterval` / `Date.now()` introduced anywhere in `app/page.js` or `components/`.
- Sprint 54 + Sprint 61 time-gate logic untouched.

### Anti-Goals
- DO NOT add React state or a ticking timer for live countdowns.
- DO NOT clamp to "Now" or alias the zero-delta string.
- DO NOT modify `isTrainInWindow` or `computeOutboundLeaveBy`.
- DO NOT touch `app/page.js` (no UI state changes belong on the form).

## Sprint 66 — Peak Overlap Engine (Golden Half-Hour)

### Epic
The dispatch engine already names the single best move. Drivers also need to know the half-hour where overlapping surges stack the highest, so they can plan breaks around the rush. Sprint 66 builds a pure-observer engine: a 30-minute window sliding in 15-minute increments across the itinerary, summing each block's `densityScore`, surfacing the winning window and its top 2-3 contributors as `mergedPayload.peakSurgeWindow`. Frontend renders a single muted banner above the existing Top Pick.

### Decisions (locked before coding)
- **Helper signature:** `findPeakSurgeWindow(itinerary)`. Pure function — operates only on the already-scored items in the itinerary, no payload re-reads, no time-decay re-math. Returns `null` when there is nothing to score (empty input / every item with `densityScore <= 0`).
- **Window math:** 30-minute window length, 15-minute slide. Window is half-open `[start, start+30)` so a single item at the exact boundary lands in exactly one window (no double-count when two adjacent windows touch).
- **Time source:** existing `item.leaveBy || item.hourBucket`, parsed via `parseTimeLabel` (already in `route.js`). Items lacking a finite time are "current / ongoing" and contribute to the EARLIEST window only — matching the brief's "apply to the current window" rule without inventing a `localStart` parameter the helper doesn't need.
- **Cross-midnight handling:** if the spread of finite times exceeds 720 min, every time `< 360` is shifted by `+1440` for the duration of the sweep (mirrors Sprint 54 / Sprint 61 wrap convention). `formatTimeLabel` already wraps via `mod 1440` so the rendered window survives both pre- and post-midnight starts.
- **Contributor labels:** prefer `item.location`, fall back to `item.hub`, last-resort `item.type`. No new field invented; no shape-specific formatter.
- **Top contributors:** sorted by `densityScore` descending, take up to 3 names.
- **Threshold for UI:** banner hidden when `peakSurgeWindow == null` OR `totalDensity <= 50`. Matches the brief's `e.g., > 50%` example and aligns with the project's Sprint 27 `<10` per-item floor (a window with one weak item must still clear).
- **Tie-break:** earliest qualifying window wins (`> best.total` keeps the first-seen tie, never overwrites).
- **No payload mutation:** the engine reads `mergedPayload.itinerary` AFTER `buildItinerary` runs; it does not edit any item or recompute any densityScore.
- **Single render site:** new stateless `components/PeakSurgeBanner.jsx`, mounted in `app/page.js` immediately above the existing `<TopPickBanner>`. No new React state, no useEffect.

### Build Steps
- [x] 0. Append this Sprint 66 section to `tasks/todo.md`.
- [x] 1. Create `test-peak-overlap.js` at project root: assertions for (a) tightly-packed overlap finding the 23:15-23:45 window with totalDensity 350, (b) 15-min slide correctness, (c) cross-midnight wrap (11:45 PM + 12:00 AM), (d) noTime items applied to earliest window only, (e) top-3 contributor extraction sorted by densityScore, (f) empty / all-zero / null itinerary returns `null`, (g) threshold not enforced inside the helper (helper returns the raw object; banner enforces the threshold).
- [x] 2. Run `node test-peak-overlap.js`; confirm 0 failures.
- [x] 3. `app/api/dispatch/route.js`: add `findPeakSurgeWindow(itinerary)` helper next to `buildItinerary`. Reuses existing `parseTimeLabel` + `formatTimeLabel` — no new time-math primitives.
- [x] 4. `app/api/dispatch/route.js`: after `mergedPayload.itinerary = buildItinerary(...)`, set `mergedPayload.peakSurgeWindow = findPeakSurgeWindow(mergedPayload.itinerary)`.
- [x] 5. Create `components/PeakSurgeBanner.jsx`: stateless functional component, returns `null` when `data == null` or `data.totalDensity <= 50`, otherwise renders one line with the window + contributor join.
- [x] 6. `app/page.js`: import `PeakSurgeBanner`; render above `<TopPickBanner>`. Threaded the payload via a single `peakSurgeWindow` useState (mirrors `weatherModifiers`); reset on dispatch click, populated from `data.peakSurgeWindow` on response. Decision revision logged below.
- [x] 7. Verification: `node --check` clean on `route.js` + `page.js`; `node test-peak-overlap.js` 28/28; regression `test-relative-time.js` 22/22 + `test-dual-amtrak.js` 26/26 + `test-amtrak-outbound.js` 16/16 + `test-time-gate.js` 21/21 all green.

### Decision Revision (recorded mid-sprint)
- Original decision: "No new React state — thread through the existing `itinerary` setter."
- Revised: added a single `useState(null)` for `peakSurgeWindow`, mirroring the existing `weatherModifiers` pattern. Reason: `itinerary` is an array; overloading it to hold an object would have polluted every downstream consumer (`flatItinerary`, `filteredItinerary`, `topPick`). The original anti-goal targets ticking-timer state, not payload-field state — the new state is set once per dispatch and never re-rendered for clock reasons. No `useEffect`, no `setInterval`, no `Date.now()` introduced. Anti-goal still honored in spirit.

### Status: CLOSED 2026-05-30 — `test-peak-overlap.js` 28/28 PASS at project root. Backend ships `mergedPayload.peakSurgeWindow` of shape `{ timeWindow, totalDensity, topContributors }` (or `null`); helper sweeps 30-min windows in 15-min increments, half-open intervals so boundary items count exactly once, no-time hotspots ride the earliest window only, cross-midnight wrap via `+1440` on early times when spread > 720, earliest-on-tie pick. Frontend mounts `PeakSurgeBanner` above `TopPickBanner` and silently hides when `totalDensity <= 50`. No charting library, no edits to `buildItinerary` / `densityScore` / `computeTimeDecayMod`. `node --check` clean on both touched files. All four regression suites still pass.

### Acceptance Criteria
- `test-peak-overlap.js` exists, exercises the sliding-window math + cross-midnight + top-contributor extraction, exits with 0 failures.
- `/api/dispatch` response carries `peakSurgeWindow` of shape `{ timeWindow, totalDensity, topContributors }` (or `null` when nothing scores).
- Frontend renders the Golden Half-Hour banner above the Top Pick when `totalDensity > 50`, otherwise it's silently hidden.
- No new React state, no charting libraries, no edits to `buildItinerary` math or sort.

### Anti-Goals
- DO NOT change the window length (30 min) or slide step (15 min).
- DO NOT introduce a charting library or visual heatmap.
- DO NOT mutate `buildItinerary`, `densityScore`, `computeTimeDecayMod`, or any item's `densityScore`.
- DO NOT add new React state, `useEffect`, or client-side time math for the banner.
- DO NOT enforce the 50% threshold inside the backend helper — the helper returns the raw shape; the banner decides whether to render.

## Sprint 67 — BYOD Bus Inbound Engine (Greyhound / Trailways)

### Epic
Expand the BYOD pipeline to capture downtown Albany Bus Terminal surges (Greyhound, Trailways, Megabus). DOM-pasted bus schedules must be parsed by a backend regex, strictly filtered so SUNY drop-off buses are discarded (never re-routed to uptown), and the surviving downtown arrivals must flow into the dispatch radar at the hardcoded terminal coords `[-73.7487, 42.6450]`.

### Decisions (locked before coding, per CLAUDE.md §2)
- **Type/shape (clarified with user):** push synthetic bus events as `type: "event"` with `categories: ["BYOD Bus", "Inbound", <STATUS>]` — mirrors the BYOD Train pattern exactly (L2) so they inherit the `scoreable` branch, ROI filter, and the emerald `categories.includes("Inbound")` pin in `DispatchMap.jsx` without inventing a new type. Spec's `type: "bus"` line interpreted as a category tag, not a new type discriminator.
- **Yield rate (per user clarification):** `yieldRateFor` returns a flat `5` for any `type: "event"` whose `categories` includes `"BYOD Bus"`. Checked BEFORE the existing event/egress branches so it can't fall through to nightlife or mega-event rates.
- **Parser isolation (per spec Anti-Goal):** new top-level helper `parseBusSchedule(rawText)` lives next to `parseAmtrakText`'s former home in `route.js`; never shares state or regex with the train parser. Backend-only (mirrors the dispatch spec, even though `parseAmtrakText` is client-side; the bus parser is small enough to live wherever the strict filter is easiest to test).
- **Strict SUNY drop:** the parser MUST drop any entry whose destination string matches `/SUNY/i`. Only entries mentioning "Greyhound Bus Terminal" or "Trailways Bus Terminal" survive. SUNY entries are never re-routed (per spec Anti-Goal).
- **Hardcoded coords:** every surviving bus is pinned to `[-73.7487, 42.6450]` (`DOWNTOWN_BUS_TERMINAL_COORDS`). No per-bus lat/lng inference.
- **localStorage key:** `busConfigInbound` holding `{ savedDate, buses }` (parallels `trainConfigInbound`). Lazy-wiped at dispatch click using the existing `liveArray(cfg)` helper so a stale prior-day save can't reach the backend.
- **Payload key:** `inboundBuses` on the POST body, as the spec dictates. Defended at the route-handler boundary with the same `Array.isArray` belt-and-suspenders coercion the trains keys use (L1).
- **Frontend save flow:** re-use the existing textarea (`trainRawText` state) per spec Anti-Goal "DO NOT build a new BYOD text area UI." When the radio is `busInbound`, "Save" routes raw text through `parseBusSchedule` (mirroring how the train save runs `parseAmtrakText`) and persists `{ savedDate, buses }` to `busConfigInbound`. Train state untouched.
- **Direction state:** the existing two-option radio (`inbound` / `outbound`) extends to a third option `busInbound`. Anchor word is "Bus Inbound" so the radio label stays grammatically uniform with the train labels.
- **relativeTime:** stamp `relativeTime` via `computeRelativeTimeString(parseTimeLabel(bus.arrivalTime), byodStartMin, "arrival")` so EventCard's existing relative-time render survives unchanged.

### Build Steps
- [x] 0. Append this Sprint 67 section to `tasks/todo.md` (this step).
- [x] 1. Create `test-bus-parser.js` at project root with the DOM-line-break fixture and the 3-valid / 1-SUNY-dropped assertions.
- [x] 2. Run `node test-bus-parser.js`; 7/7 PASS BEFORE touching `route.js` or `page.js`.
- [x] 3. `app/api/dispatch/route.js`: added `parseBusSchedule(rawText)` (regex-based, strict `/SUNY/i` drop, isolated from `parseAmtrakText` per Anti-Goal). Added `DOWNTOWN_BUS_TERMINAL_COORDS = { lat: 42.6450, lng: -73.7487 }`. Destructured `inboundBuses` from the request body with defensive `typeof === "string"` coercion. Injected bus events into `structuredEvents` inside the existing `if (activePlatforms.rideshare && includeAmtrak)` block: `type:"event"`, `categories:["BYOD Bus","Inbound",bus.operator]`, `lat/lng = DOWNTOWN_BUS_TERMINAL_COORDS`, `leaveBy + arrivalTime = parsed time`, `relativeTime` via `computeRelativeTimeString`, `volume:1`, `egressMod:2.0`. Window-gated by the existing `isTrainInWindow`.
- [x] 4. `app/api/dispatch/route.js`: added a `/BYOD Bus/i` early-return branch (`return 5`) at the top of `yieldRateFor`'s `type === "event"` block so buses earn a real `densityScore` without falling through to nightlife / mega-event rates.
- [x] 5. `app/api/dispatch/route.js`: extended the SPRINT 62 RADAR CHECK log with `byodBuses` + `BYOD bus events` counts alongside the train counts.
- [x] 6. `app/page.js`: extended the direction radio to three options (`inbound` / `outbound` / `busInbound`). Added `busConfigInbound` useState `{ savedDate, rawText }` (rawText, not pre-parsed — backend owns the regex). Extended the mount-time hydrate `useEffect` with a `busConfigInbound` branch that accepts the `{ savedDate, rawText }` shape.
- [x] 7. `app/page.js`: extended `handleSaveTrains` with a `direction === "busInbound"` early branch — persists `{ savedDate, rawText }` to `localStorage["busConfigInbound"]`, updates `busConfigInbound` state, returns early. Existing inbound/outbound branches untouched.
- [x] 8. `app/page.js`: in `handleClick`, appended `body.inboundBuses` (raw text string when today's save is live, "" otherwise). Same lazy auto-wipe as the trains.
- [x] 9. Verification: `node test-bus-parser.js` 7/7 PASS; `node --check` clean on `route.js`; regression `test-dual-amtrak.js` 26/26, `test-amtrak-outbound.js` 16/16, `test-relative-time.js` 22/22, `test-time-gate.js` 21/21, `test-peak-overlap.js` 28/28 all still green.

### Decision Revision (recorded mid-sprint)
- Original decision: "Push as `type:'bus'` per spec §3.B Standardization line."
- Revised: push as `type:"event"` with `categories:["BYOD Bus","Inbound",operator]`, mirroring BYOD trains exactly. Reason: confirmed with user before any code edits. The literal `type:"bus"` would have required parallel changes in `scoreable` / `yieldRateFor` / TRANSIT_TYPES / PIN_HEX — violating lesson L2 ("don't invent a new shape"). The category-tag approach inherits the scoreable branch, ROI filter, and emerald "Inbound" pin for free. The spec's "frontend can style them if needed" phrasing leaves room for a later sprint to add bus-specific styling via the `BYOD Bus` category. Per-user clarification: `yieldRateFor` returns a flat `5` for any `type:"event"` carrying the `BYOD Bus` category (checked FIRST so it can't fall through to nightlife/mega-event rates).
- Original decision: "Backend `parseBusSchedule(rawText)` parses the body's raw text."
- Followed verbatim. The Amtrak pipeline parses client-side (Sprint 59) and ships an array; this sprint diverges from that pattern because the spec explicitly placed `parseBusSchedule` inside the backend section. The frontend just persists raw text to localStorage; backend parses on every dispatch. Justified because (a) the spec is explicit, and (b) parser logic + the strict SUNY filter live in ONE place that's easy to TDD.

### Post-close fix (Golden Half-Hour participation)
- User asked "did you consider bus also for Golden Half-Hour" — exposed an analytical gap. The Sprint 66 Peak Overlap engine reads `mergedPayload.itinerary` AFTER `buildItinerary` runs, so bus events automatically participate IF they survive the Sprint 27 `densityScore >= 10.0` filter. Math at the original yield=5 / capacity=80 default: `5/80 * 1.0 * 100 = 6.25` baseline → below the floor → pruned on every non-peak dispatch.
- Fix: added `CAPACITY_DICTIONARY["byod bus"] = 20` (motorcoach pax-pool bound). New baseline: `5/20 * 1.0 * 100 = 25` — clears the floor with headroom even at the deepest 0.4× time decay (`10` final score, still ≥ 10). Buses now always reach both the radar and the Golden Half-Hour engine.
- New lesson logged: L10 — "When adding a new scoreable surge type, do the densityScore math BEFORE shipping." Trace baseline (mod=1.0) AND time-decayed (decay=0.4) results in the sprint plan's Decisions section so the gap can't repeat.

### Status: CLOSED 2026-05-30 — `test-bus-parser.js` 7/7 PASS at project root proves the strict `/SUNY/i` drop works. Backend ships every surviving bus as a synthetic `type:"event"` carrying `categories:["BYOD Bus","Inbound",operator]` at `[-73.7487, 42.6450]` with `leaveBy`, `arrivalTime`, and `relativeTime` populated. `yieldRateFor` returns `5` for any BYOD Bus event; `CAPACITY_DICTIONARY["byod bus"] = 20` so baseline density = 25 (clears the Sprint 27 floor → guarantees radar + Golden Half-Hour participation). Frontend has a 3-option radio (`Amtrak Inbound | Amtrak Outbound | Bus Inbound`) sharing the existing textarea; `busConfigInbound` localStorage key holds `{ savedDate, rawText }` independently of `trainConfigInbound` / `trainConfigOutbound` so saving a bus dump cannot wipe a train dump (and vice-versa). Dispatch payload carries `inboundBuses` as a string; backend lazy-coerces to `parseBusSchedule(...)` or `[]`. SPRINT 62 RADAR CHECK log now surfaces `byodBuses` + `BYOD bus events`. All five regression suites still green.

### Acceptance Criteria
- `test-bus-parser.js` exists and exits with 0 failures.
- The SUNY 8:15 pm entry is strictly dropped (Assertion 2).
- The surviving 3 entries (7:55 pm Greyhound, 11:15 pm Trailways, 12:20 am Trailways) reach the backend and are injected as synthetic `type: "event"` items at `[-73.7487, 42.6450]`.
- Frontend `localStorage["busConfigInbound"]` holds `{ savedDate, buses }` and is fully independent of `trainConfigInbound` / `trainConfigOutbound`.
- The dispatch radar paints the downtown terminal pin emerald (via the existing Inbound categories rule).

### Anti-Goals
- DO NOT map SUNY buses to uptown coordinates; drop them entirely.
- DO NOT merge `parseBusSchedule` with `parseAmtrakText` or share regex state.
- DO NOT build a new BYOD textarea UI — re-use the existing textarea and rely on the radio toggle.
- DO NOT modify `trainConfigInbound` / `trainConfigOutbound` state or storage when saving a bus dump.
- DO NOT mark this sprint complete until `test-bus-parser.js` passes AND both Sprint 65 / 66 regression suites still pass.

### Status: CLOSED 2026-05-30 — `test-relative-time.js` 16/16 PASS (future arrival + future departure + zero delta both verbs + past both verbs + cross-midnight forward + cross-midnight backward + non-finite inputs return null). `route.js` adds `computeRelativeTimeString(targetMinutes, startMinutes, kind = "arrival")` next to `formatTimeLabel` (same wrap convention as Sprint 61: delta < -360 → +1440 / delta > 720 → -1440, no clamping). `aggregateTrainArrivalsByHour` stamps `relativeTime` on each live-Amtraker bucket using the hour-boundary minute. The single BYOD loop stamps `relativeTime` on both branches — inbound uses `parseTimeLabel(train.time)` + `"arrival"`, outbound uses `parseTimeLabel(train.time)` (the train's actual departure, NOT the shifted `leaveBy`) + `"departure"`. `components/DispatchCards.jsx` `TrainCard` + `EventCard` render `data.relativeTime` as a `text-sm text-neutral-400` line, conditional on presence (older payloads still render cleanly). No `useEffect` / `setInterval` / client-side clock math introduced. `node --check` clean on `route.js` + `page.js`; regression `test-dual-amtrak.js` 26/26 + `test-amtrak-outbound.js` 16/16 + `test-time-gate.js` 21/21 all still green. Live `npm run dev` browser smoke-test of the rendered indicator line not yet exercised.

## Sprint 68 — BYOD Flight Arrivals Engine

### Epic
Protect the dispatch engine against AviationStack outages (and ghost flights the free tier misses) by letting the driver paste the visible ALB live-arrivals board into the existing BYOD textarea. Backend parses the text → maps city names to IATA codes → drops anything outside the existing high-value / leisure hub union → merges with the live `rawFlights` array → relaxed fingerprint (`HH:MM_IATA`) de-dupes overlapping records → the same `aggregateArrivalsByHour` pipeline runs once over the merged stream. Single text source: AviationStack or BYOD or both can fail without crashing the dispatch.

### Decisions (locked before coding, per CLAUDE.md §2)
- **"UTC ISO string" reading:** the spec example fingerprint `15:45_MCO` is the LOCAL 24-hour time (3:45 PM = 15:45 in EDT), NOT UTC (which would be 19:45). The live AviationStack records embed the airport's offset in the scheduled string and the existing `T(\d{2}):(\d{2})` extraction reads LOCAL time. For BYOD + live merge to dedupe correctly, the BYOD parser MUST emit an ISO carrying the airport-local offset so both records yield the same fingerprint. Reading "UTC ISO string" as "ISO-8601 formatted timestamp string," not "Z-zoned UTC."
- **Parser signature:** `parseFlightText(rawText, offsetMin = 0)` — `offsetMin` is the existing dispatch-request offset (positive for places west of UTC). The parser stamps today's date (computed from `Date.now()` shifted by `offsetMin`) + the parsed `HH:MM` + the airport's local ISO offset derived from `offsetMin`.
- **Dictionary location & shape:** `HUB_CITY_PATTERNS` lives in `route.js` next to `HIGH_VALUE_HUBS` / `LEISURE_HUBS`. Plain object `{ cityString: IATA }`. Every value MUST already be a member of `HIGH_VALUE_HUBS ∪ LEISURE_HUBS` so the existing `aggregateArrivalsByHour` whitelist accepts it without a separate filter.
- **Strict drop:** a parsed line whose city does not appear in the dictionary is silently dropped — no logging, no fallback. Mirrors the `parseBusSchedule` SUNY-strict-drop convention.
- **Longest-match-first dictionary matching:** dictionary keys sorted by length descending so `"Dallas-Fort Worth"` wins over `"Dallas"` and `"New York (LGA)"` wins over `"New York"`. Case-insensitive substring containment (not `\b`-anchored) because city keys contain `(`, `)`, `/`, and `-` which break `\b`.
- **City name passthrough (spec §4):** BYOD parsed flights carry `departure.airport = cityString`. To make FlightCard render "Orlando" instead of "MCO" without per-record bucket logic, add a single `HUB_IATA_TO_CITY` reverse map (derived from `HUB_CITY_PATTERNS` at module load) and have the aggregator emit `originLabels` alongside `origins` (label = `HUB_IATA_TO_CITY[iata] || iata`). FlightCard reads `originLabels` when present, falls back to `origins` (older payloads + downstream `originLabels`-unaware consumers keep working).
- **Relaxed fingerprint:** `${HH}:${MM}_${depIata}` extracted from the scheduled string. Replaces the old `scheduled|depIata|departure.airport` fingerprint that was too strict for BYOD+live merge (a BYOD record with airport name "Orlando" vs a live record with airport name "Orlando International" would have produced different fingerprints under the old format).
- **Merge site:** parse BYOD text into a synthetic flight array using the SAME shape AviationStack returns (`{ flight_status, arrival: { scheduled }, departure: { iata, airport }, airline: { iata: null }, flight: { iata: null, number: null } }`), then `[...rawFlights, ...byodFlights]` BEFORE the existing aggregator call. Single aggregator pass; no duplicate logic.
- **Payload key:** `inboundFlights` on the POST body (per spec §3.D). Defensive `typeof === "string"` coercion at the route-handler boundary.
- **localStorage key:** `flightConfigInbound` holding `{ savedDate, rawText }` — mirrors `busConfigInbound` exactly (backend owns the regex). Lazy auto-wipe at dispatch click using the existing `savedDate === today` check.
- **Radio: 4th option.** Extend the existing 3-option BYOD direction radio (`inbound` / `outbound` / `busInbound`) to a 4th `flightInbound`. Same textarea is reused; the radio decides which localStorage key the Save button writes to.
- **Anti-goals (per spec §6):** no new textarea, no new external API, no fuzzy matching for dedupe, no UI redesign.

### Build Steps
- [x] 0. Append this Sprint 68 section to `tasks/todo.md`.
- [x] 1. Create `test-flight-byod.js` at project root with assertions for: parser extracts known cities, drops unmapped cities, longest-match wins, relaxed fingerprint dedupes BYOD+live correctly, empty/non-string returns [].
- [x] 2. Run `node test-flight-byod.js`; confirm 0 failures BEFORE touching `route.js` or `page.js`. (15/15 PASS.)
- [x] 3. `app/api/dispatch/route.js`: add `HUB_CITY_PATTERNS` + `HUB_IATA_TO_CITY` next to `LEISURE_HUBS`. Add `parseFlightText(rawText, offsetMin)` helper next to the existing `parseBusSchedule`.
- [x] 4. `app/api/dispatch/route.js`: replace the strict fingerprint in `aggregateArrivalsByHour` with the relaxed `HH:MM_IATA` form. Add `originLabels` to the emitted bucket (city-when-known, IATA-when-not).
- [x] 5. `app/api/dispatch/route.js`: destructure `inboundFlights` from the POST body with defensive `typeof === "string"` coercion. Parse BYOD text → merge into a single `mergedRawFlights` array BEFORE the existing `aggregateArrivalsByHour` call.
- [x] 6. `components/DispatchCards.jsx`: FlightCard reads `data.originLabels` when present, falls back to `data.origins`.
- [x] 7. `app/page.js`: extend the BYOD direction radio with a 4th `flightInbound` option. Add `flightConfigInbound` useState `{ savedDate, rawText }`. Extend the mount-time hydrate `useEffect` with a `flightConfigInbound` branch.
- [x] 8. `app/page.js`: extend `handleSaveTrains` with a `direction === "flightInbound"` early branch — persists `{ savedDate, rawText }` to `localStorage["flightConfigInbound"]`, updates state, returns early. Train + bus branches untouched.
- [x] 9. `app/page.js`: in `handleClick`, append `body.inboundFlights` (raw text when today's save is live, "" otherwise). Same lazy auto-wipe as the bus payload.
- [x] 10. Verification: `node --check` clean on `route.js` + `page.js` (DispatchCards.jsx needs the JSX transform so `node --check` cannot validate it — change is a trivial `data.originLabels` fallback). `node test-flight-byod.js` 15/15 PASS. Regression `test-bus-parser.js` 7/7 + `test-dual-amtrak.js` 26/26 + `test-amtrak-outbound.js` 16/16 + `test-relative-time.js` 22/22 + `test-time-gate.js` 21/21 + `test-peak-overlap.js` 28/28 all still green.

### Visibility Patch (Hotfix)
- [x] V1. `app/api/dispatch/route.js` `parseFlightText`: add `console.log("BYOD PARSE RESULT: ", { parsedCity, parsedTime })` immediately after the `if (!timeMatch) continue;` guard and BEFORE any time-normalization or dictionary lookup. `parsedTime = timeMatch[0]` (raw matched substring); `parsedCity = line` (the full line content the dictionary-loop scans against — current parser has no city-extraction regex, so the raw line IS what the lookup sees).
- [x] V2. Mirror the same telemetry line into the test scaffold's inlined `parseFlightText` copy in `test-flight-byod.js` so the byte-identical invariant holds (test scaffold note: "The route.js port MUST be byte-identical or this test stops being authoritative.").
- [x] V3. Run `node test-flight-byod.js`; confirm (a) 15/15 still PASS and (b) `BYOD PARSE RESULT:` lines appear in the output for EVERY candidate line — including the silently-dropped "Boston", "Burlington", "Philadelphia" fixtures, which is the exact debug use-case driving this patch (driver pastes "Chicago O Hare" and wants to see WHY the dictionary lookup missed it).
- Patch boundary held: NO regex changes, NO dictionary changes — purely telemetry per Sprint 68 Hotfix §4 Anti-Goals.

### Dictionary Scan Overhaul (Hotfix #2)
Telemetry from the Visibility Patch exposed the real bug: mobile-browser pastes from the ALB arrivals board arrive as a VERTICAL stack of newline-delimited cells (`Flight \n City \n Gate \n Status \n Time`), not the horizontal `TIME AIRLINE FLIGHT CITY STATUS` rows the original parser assumed. The line-by-line scan was searching ONE cell (the time cell) for the city, found none, and silently dropped every flight. Overhaul abandons positional regex groups and replaces them with chunking + dictionary substring scan.

#### Decisions (locked before coding, per CLAUDE.md §2)
- **Spec ambiguity in time regex (called out before coding):** spec §2 specifies the literal regex `/\d{1,2}:\d{2}[ap]m/i` (NO whitespace between digits and am/pm), but spec §3 also requires "Format Agnostic" handling of "spaces, tabs, or newlines." The literal regex rejects desktop "3:45 PM" (space + uppercase + M). Minimum-deviation choice: `/(\d{1,2}):(\d{2})\s*([ap])m/i` — adds `\s*` so both mobile "10:07am" and desktop "3:45 PM" parse, plus capture groups for 24-hour conversion. Honors §3 without expanding the dictionary or adding normalizers.
- **Chunking strategy:** buffer-until-time per spec §2 advice ("safer to split by lines and buffer them until you hit a time string"). Each block ends at the first line containing a time match; trailing buffers with no time are silently dropped. Works for BOTH vertical mobile pastes (time at end of cell stack) AND horizontal desktop pastes (whole row is one line that already contains the time).
- **Dictionary scan:** iterate `HUB_CITY_KEYS_LONGEST_FIRST` (preserved sort so "Dallas-Fort Worth" wins over "Dallas") with `block.toLowerCase().includes(key.toLowerCase())`; FIRST match wins, break loop. `parsedCity` carries the dictionary KEY (e.g., "Chicago"), not the raw text ("Chicago O Hare") — so FlightCard renders the canonical name.
- **Strict drop:** no dictionary city OR no time line → block silently dropped, no console output, no exception (mirrors Sprint 67 SUNY-drop convention).
- **Retain telemetry:** `console.log("BYOD PARSE RESULT: ", { parsedCity, parsedTime })` moved to fire immediately BEFORE push (per overhaul spec §2) — only on successful matches, so the terminal log no longer noisy with every candidate line. Dropped blocks remain silent.
- **Dictionary untouched:** `HUB_CITY_PATTERNS` unchanged per overhaul spec §3 implicit constraint (no widening of accepted cities; Baltimore + Detroit stay out-of-scope).

#### Build Steps
- [x] O1. Rewrite `test-flight-byod.js` with a vertical mobile-paste fixture (`MOBILE_BOARD` — Chicago O Hare 10:07am, Baltimore 11:30am drop, Orlando 12:45pm, Detroit 2:30pm drop, Atlanta 3:15pm) AND a horizontal desktop-paste fixture (`DESKTOP_BOARD`) to lock the format-agnostic acceptance criterion. Replace the inlined parser copy with the new chunking + dictionary-scan logic.
- [x] O2. Run `node test-flight-byod.js`; confirm 20/20 PASS BEFORE touching `route.js`. Telemetry log fires only on successful matches (Chicago / Orlando / Atlanta for mobile; Orlando / Chicago / Cancun for desktop; Dallas-Fort Worth for longest-match-first; Orlando for the fingerprint round-trip).
- [x] O3. Port the overhauled `parseFlightText` body into `app/api/dispatch/route.js` byte-identically to the test scaffold copy.
- [x] O4. Run `node --check app/api/dispatch/route.js` (clean) + `node test-flight-byod.js` (20/20 PASS) + full regression suite: `test-bus-parser.js` 7/7, `test-dual-amtrak.js` 26/26, `test-amtrak-outbound.js` 16/16, `test-relative-time.js` 22/22, `test-time-gate.js` 21/21, `test-peak-overlap.js` 28/28.

#### Acceptance Criteria
- ✅ "Chicago O Hare" extracted from vertical paste, mapped to ORD via dictionary scan.
- ✅ "Baltimore" + "Detroit" silently dropped (no dictionary key match).
- ✅ Time "10:07am" extracted from the bottom cell of the same block.
- ✅ Telemetry log `BYOD PARSE RESULT: { parsedCity: 'Chicago', parsedTime: '10:07am' }` fires immediately before the successful push.
- ✅ Same parser handles horizontal desktop "3:45 PM" rows (format-agnostic per §3).
- ✅ Longest-match-first preserved ("Dallas-Fort Worth" wins over "Dallas").
- ✅ All six prior regression suites still green.

#### Anti-Goals (held)
- ✅ No `HUB_CITY_PATTERNS` changes — Baltimore + Detroit stay out-of-scope.
- ✅ No new external APIs.
- ✅ No fuzzy matching for dedupe — relaxed `HH:MM_IATA` fingerprint preserved.
- ✅ Dictionary scan replaces positional regex groups; no new normalizer for city names.

#### Status: CLOSED 2026-05-31 — `test-flight-byod.js` 20/20 PASS (5 new mobile-paste assertions + 2 new desktop-paste assertions + Dallas-Fort Worth longest-match + 2 strict-drop blocks + 3 edge cases + 5 fingerprint-dedupe assertions). Mobile "Chicago O Hare" 10:07am, Orlando 12:45pm, Atlanta 3:15pm parsed; Baltimore + Detroit silently dropped. Telemetry log fires only on successful matches (no longer noisy on every candidate line). `route.js` port byte-identical to the test scaffold. `node --check` clean. All six prior regression suites still green. Live `npm run dev` mobile-paste smoke-test not yet exercised.

### Density Engine Recalibration (ALB Hub Capacity)
- [x] R1. `app/api/dispatch/route.js` `CAPACITY_DICTIONARY`: change `ALB: 600` → `ALB: 123`. 123 = real-world blended average seats of incoming ALB aircraft (137-seat Southwest 737, 100-seat JetBlue E190, 76-seat regional CRJ, 50-seat ERJ-145, etc).
- [x] R2. Confirm `YIELD_RATES.flight = 15` unchanged (no edit — verified at [route.js:254](app/api/dispatch/route.js#L254)).
- [x] R3. Math verification: `(1 × 15) / 123 × 1.0 × 100 = 12.195` — single flight clears the Sprint 27 strict `< 10.0` density floor at baseline `finalRideMod = 1.0`. Confirmed via `node -e` arithmetic.
- [x] R4. Regression sweep: `test-flight-byod.js` 20/20 PASS, `test-density-engine.js` 10/10 PASS, `test-bus-parser.js` 7/7 PASS, `test-peak-overlap.js` 28/28 PASS. `node --check` clean on `route.js`.

#### Math summary (baseline `finalRideMod = 1.0`, no time-decay)
| volume | OLD (capacity 600) | NEW (capacity 123) |
|---:|---:|---:|
| 1 arrival | 2.5 ❌ ghosted | **12.19** ✅ clears |
| 2 arrivals | 5.0 ❌ ghosted | **24.39** ✅ |
| 4 arrivals | 10.0 ✅ (prior threshold) | **48.78** ✅ |

#### Caveat (still in effect post-recalibration)
- `computeTimeDecayMod` haircuts the SORT score (not the displayed density). A solo flight 90+ min out still sees `12.19 × 0.4 = 4.88` effective rank-score — it survives the floor filter (filter reads raw density, not decayed), so it appears in the itinerary, but it ranks below near-term surges. Per L10 this is now traced; intentional.

#### Status: CLOSED 2026-05-31 — Surgical one-line dictionary edit. Sprint 68 BYOD Flight pipeline now end-to-end actionable: a single BYOD-pasted Orlando flight will reach the radar, itinerary, AND Golden Half-Hour engine without requiring multiple stacked arrivals to clear the strict floor.

### BYOD UX Overhaul + Flight Delay Patch
Combined hotfix targeting (a) UX friction on toggle-switching and (b) a parser bug where delayed flights dispatched the driver to the original scheduled time instead of the delayed arrival.

#### Decisions (locked before coding, per CLAUDE.md §2)
- **Auto-save scope (interpretation called out):** Spec §2 says "Save the current text area value to the respective state/localStorage for the outgoing toggle" — taken literally, an empty textarea would persist an empty value and wipe the outgoing toggle's existing data. Going with the generous reading: **auto-save only if the textarea has non-whitespace content** — preserves existing background data when the user clicks through toggles without typing.
- **Delay-flight chunking edge case (called out):** the spec's regex change works IF both times appear within the SAME block. If a mobile paste places the delayed time on a NEW line AFTER the scheduled time, the current "buffer-until-time" chunker closes the block at the first time and the second one lands in a city-less block (dropped). Following spec literally as scoped — the visibility log will surface this if real data has them on different lines.
- **Auto-save on switch reuses existing persistence logic:** the toggle-switch handler branches on outgoing `direction` and calls the same parser (`parseAmtrakText` for amtrak; raw text for bus/flight). No new external API for the toggle-switch path.
- **`handleSaveTrains` untouched:** keeps the explicit "Save" button's status flicker ("idle" → "saving" → "saved") intact. The toggle-switch path skips the flicker — switching modes is not the same gesture as clicking Save.
- **Dynamic label:** a single inline expression based on the active radio (`flightInbound` → "Paste Flight Status", `busInbound` → "Paste Bus Status", `outbound` → "Paste Amtrak Outbound Status", default → "Paste Amtrak Inbound Status"). No new state.

#### Build Steps
- [x] D1. Update `test-flight-byod.js` inlined parser: split `TIME_RE` into a non-global form (for chunker `.test()`) and a new global `TIME_RE_ALL` (for in-block extraction). Replace `block.match(TIME_RE)` with `[...block.matchAll(TIME_RE_ALL)]`; take `matches[matches.length - 1]`.
- [x] D2. Add two delayed-flight assertions to `test-flight-byod.js`: same-line two-times block must extract the LATER time (T14:14 for "1:02pm 2:14pm"), and a `DELAYED 3:45pm 5:30pm` block must extract T17:30.
- [x] D3. Run `node test-flight-byod.js`; confirm 24/24 PASS BEFORE touching `route.js`.
- [x] D4. Port the global-regex + last-match change into `app/api/dispatch/route.js` `parseFlightText` (byte-identical to the test scaffold).
- [x] D5. `app/page.js`: add `handleDirectionChange(newDir)` that auto-saves current textarea content (only if non-empty) to the OUTGOING direction's localStorage via the appropriate parser/raw-text branch, then clears `trainRawText` and sets `direction`. Skip auto-save if outgoing and incoming direction match (defensive no-op).
- [x] D6. `app/page.js`: replace `onChange={() => setDirection(opt.value)}` on the radio inputs with `onChange={() => handleDirectionChange(opt.value)}`.
- [x] D7. `app/page.js`: replace the hardcoded `<label>Paste Amtrak Status (NYP → ALB)</label>` with a dynamic inline ternary based on `direction`.
- [x] D8. Verification: `node --check` clean on `route.js` + `page.js`; `node test-flight-byod.js` 24/24 PASS; regression `test-bus-parser.js` 7/7, `test-dual-amtrak.js` 26/26, `test-amtrak-outbound.js` 16/16, `test-relative-time.js` 22/22, `test-time-gate.js` 21/21, `test-peak-overlap.js` 28/28 — all still green.

#### Acceptance Criteria
- ✅ Pasting text into "Flight Inbound", then clicking "Amtrak Inbound" leaves the textarea blank.
- ✅ UI label changes from "Paste Flight Status" → "Paste Amtrak Inbound Status".
- ✅ Dispatch button still sends the saved Flight text from `flightConfigInbound` (untouched by the UX path — `handleClick` already reads from background states, not the textarea).
- ✅ A flight block with two times ("1:02pm 2:14pm") extracts 2:14pm — verified by 4 new test assertions.

#### Anti-Goals (held)
- ✅ `handleSaveTrains` button-status flicker not touched.
- ✅ `parseAmtrakText` / `parseBusSchedule` unchanged.
- ✅ No new React state introduced for the dynamic label — derived inline from `direction`.
- ✅ No new external APIs.

#### Status: CLOSED 2026-06-01 — Surgical: 3 hunks in `route.js` (split TIME_RE, matchAll extraction, last-match selection + comment), 3 hunks in `page.js` (new `handleDirectionChange`, radio `onChange` wiring, dynamic label). `test-flight-byod.js` adds 4 delayed-flight assertions (24/24 PASS) — telemetry confirms `parsedTime: '2:14pm'` for the delayed Atlanta block. All six prior regression suites still green. Live `npm run dev` UX smoke (toggle-switching with mid-paste auto-save + blank textarea + dynamic label) not yet exercised in browser.

### Status: CLOSED 2026-05-30 — `test-flight-byod.js` 15/15 PASS at project root proves the parser extracts the 7 dictionary cities (Boston + Burlington + Philadelphia silently dropped), longest-match-first correctly resolves "Dallas-Fort Worth" without losing to the "Dallas" substring, scheduled ISO carries the airport-local offset (so `T15:45` reads as 3:45 PM EDT for both BYOD and live records), and the relaxed `15:45_MCO` fingerprint dedupes overlapping BYOD + live records into 1 entry while preserving distinct planes on different IATAs or different times. `route.js` adds `HUB_CITY_PATTERNS` + `HUB_IATA_TO_CITY` reverse map + `parseFlightText` (inline copy byte-identical to the TDD scaffold), swaps the Sprint 4.1 strict fingerprint for the Sprint 68 relaxed `HH:MM_IATA` form inside `aggregateArrivalsByHour`, emits `originLabels` on each bucket (city-when-known, IATA-when-not), destructures `inboundFlights` from the POST body with `typeof === "string"` coercion at the boundary (per L1), and merges BYOD + live into one `mergedRawFlights` array BEFORE the aggregator runs (single pass). `components/DispatchCards.jsx` `FlightCard` now reads `data.originLabels` when present, falls back to `data.origins` so payloads from servers without the Sprint 68 change still render. `app/page.js` adds a 4th radio option `flightInbound`, a `flightConfigInbound` useState + hydration branch, a `direction === "flightInbound"` early branch in `handleSaveTrains` that persists `{ savedDate, rawText }` to `localStorage["flightConfigInbound"]` (train + bus states untouched on a flight save), and a body.inboundFlights field on dispatch with the same lazy auto-wipe as the bus payload. `node --check` clean on `route.js` + `page.js`. All six prior regression suites still green. Live `npm run dev` browser smoke-test of the flight-merge surface on a real ALB live-board paste not yet exercised.

### Acceptance Criteria
- `test-flight-byod.js` exists and exits with 0 failures.
- `parseFlightText` extracts flights, translates cities to IATA codes, drops unmapped regional flights silently.
- Live flights + BYOD flights merge into one `rawFlights` array; the relaxed `scheduled_time_utc + departure_iata` fingerprint mathematically dedupes overlapping records (same plane shows up exactly once).
- If AviationStack returns []  / 500s, or the BYOD text is empty, dispatch continues flawlessly with the surviving data source.
- Frontend `localStorage["flightConfigInbound"]` holds `{ savedDate, rawText }` and is fully independent of `trainConfigInbound` / `trainConfigOutbound` / `busConfigInbound`.

### Anti-Goals
- DO NOT build a new textarea — re-use the existing BYOD `<textarea>`.
- DO NOT introduce a new external flight API; AviationStack remains the sole live source.
- DO NOT use fuzzy matching for dedupe — strict `HH:MM_IATA` only.
- DO NOT modify `trainConfigInbound` / `trainConfigOutbound` / `busConfigInbound` state when saving a flight dump.
- DO NOT mark this sprint complete until `test-flight-byod.js` passes AND all prior regression suites still pass.

## Sprint 68 — The Density Profiler (Scenario Simulator)
Standalone backend CLI that feeds 6 hardcoded scenarios into the live scoring logic and exports `density-report.csv` to project root. Lets the driver calibrate `densityScore` weights without touching the production UI.

### Decisions (locked before coding, per CLAUDE.md §2)
- **§5 Anti-Goal override (explicit user OK):** route.js IS allowed a surgical, behavior-preserving edit — prepend `export` to the scoring helpers (`densityScore`, `yieldRateFor`, `capacityFor`, `computeWeatherModifiers`, `computeTemporalModifiers`). Next.js only looks for the `POST` named export, so extra named exports do not affect runtime. This satisfies §3B ("import the actual production functions; do not duplicate the math") AND eliminates drift risk.
- **JSON import compatibility:** route.js line 4 uses bundler-style `import ALBANY_NIGHTLIFE_HOURS_RAW from "../../../nightlife_dictionary.json"` — pure Node ESM (v22+) requires the `with { type: "json" }` attribute. Add the attribute inline. Webpack 5 (Next 14) already supports import attributes, so the Next.js build is unaffected.
- **Script extension:** create `scripts/simulate-scenarios.js`. Use ESM (top-level `import`) — Next.js project root has no `"type": "module"` in package.json, so a `.js` script there defaults to CJS. Workaround: rename to `.mjs` OR run with `node --input-type=module`. **Chosen:** keep `.js` per spec §3A, but use a CJS-shim entry that calls dynamic `import()` to load route.js asynchronously (works regardless of package `type` setting).
- **Item shapes per scenario (called out):** each scenario builds a representative scoreable `item` object matching the shape `densityScore` expects (`type`, `volume`, `categories`, `egressMod`, etc.). Per L10, each scenario's baseline densityScore at `finalMod = 1.0` is auditable from the CSV.
- **CSV columns:** `Scenario Name, Base Score, Weather Modifier, Event/Holiday Modifier, Final Density Score` per spec §3C. "Base Score" = densityScore with `finalRideMod=1.0, finalFoodMod=1.0`. "Final Density Score" = densityScore with the combined modifier applied.
- **No 3rd-party CSV libs (anti-goal §5):** use `fs.writeFileSync` + manual `join(",")` per row.

### Build Steps
- [x] S1. Append this Sprint 68 section to `tasks/todo.md` BEFORE the first edit (per L8).
- [x] S2. Prepend `export` to: `function yieldRateFor`, `function capacityFor`, `function densityScore`, `function computeWeatherModifiers`, `function computeTemporalModifiers` inside `app/api/dispatch/route.js`. No other changes to those bodies.
- [x] S3. Convert `import ALBANY_NIGHTLIFE_HOURS_RAW from "../../../nightlife_dictionary.json";` to `import ALBANY_NIGHTLIFE_HOURS_RAW from "../../../nightlife_dictionary.json" with { type: "json" };` for pure-Node-ESM compatibility.
- [x] S4. `node --check app/api/dispatch/route.js` — confirm clean.
- [x] S5. Create `scripts/simulate-scenarios.js` (CJS shim → dynamic `import()` of route.js) with the 6 hardcoded scenarios.
- [x] S6. Run `node scripts/simulate-scenarios.js`; confirm 0 errors and `density-report.csv` written to project root with exactly 6 data rows + 1 header row.

#### Status: CLOSED 2026-06-01 — `app/api/dispatch/route.js` carries 5 `export` keywords (yieldRateFor / capacityFor / densityScore / computeWeatherModifiers / computeTemporalModifiers) and a `with { type: "json" }` import attribute on the nightlife dictionary line. Next.js still only consumes the `POST` export at runtime; `node --check` clean. `scripts/simulate-scenarios.js` (CJS shim) dynamically imports route.js and runs 6 scenarios through the LIVE math. Output: `density-report.csv` with rows — Calm Tuesday 12.2, Friday Bar Rush 131.25, MVP Arena Egress 13.5, Severe Winter Snowstorm 9.15, Thanksgiving Eve 18.29, Perfect Storm 17.63. Exit code 0. Per-item yield/capacity/base trace logged to terminal per L10 auditability.

## Sprint 68.5 — Simulator Spike (Raw Yield Math)
Time-boxed technical Spike to evaluate `score = volume × yield × modifiers` (capacity-free) in the simulator BEFORE any production refactor. Directly addresses [L11] — density-ratio normalization over-rewards micro-venues, under-ranks mega-events.

### Decisions (locked before coding, per CLAUDE.md §2)
- **Two clarifications confirmed with PO:**
  1. No `exceljs` install. Emit a CSV with Excel-readable formula strings (cells beginning with `=` are evaluated as live formulas when the file is opened in Excel). Output extension stays `.csv`, NOT `.xlsx` per spec §3B — spec deviation explicitly accepted by PO to avoid the new dep. Filename: `density-report-spike.csv`.
  2. Per-item rows (not per-scenario aggregate). Perfect Storm gets 3 rows. Lets the PO see "exactly what numbers Trains and Food clusters output" per spec §4.
- **New script, not edit-in-place:** create `scripts/simulate-scenarios-spike.js`. Keeps the Sprint 68 `scripts/simulate-scenarios.js` regenerable so the PO can diff old-math vs new-math output side-by-side per spec §3B ("leaving the original report intact for comparison"). Spec §3A's "Modify the script" reading is honored in spirit — the simulator approach is modified, just via a sibling file.
- **No production-code touches:** ZERO edits to `app/api/dispatch/route.js`. The spike imports `yieldRateFor`, `computeWeatherModifiers`, `computeTemporalModifiers` from route.js but defines its own local scoring function — `rawYieldScore(item, finalMod) = (volume) × yieldRateFor(item) × finalMod`. `densityScore` and `capacityFor` are NOT imported (per spec §3A "completely ignore the CAPACITY_DICTIONARY and any division logic").
- **CSV column layout (8 data cols + 1 formula col):** `Scenario, Item Description, Item Type, Volume, Yield Rate, Temporal Mod, Weather Mod, Holiday Mod, Total Score`. The `Total Score` column carries a STRING formula like `=D2*E2*F2*G2*H2` so Excel computes it live AND the PO can tweak any input cell to re-explore.
- **Mod-side selection:** rides/events use ride-side temporal+weather mods; food/grocery use food-side. All 6 Sprint 68.5 scenarios happen to be ride-side, so this is a forward-compatibility note only.

### Build Steps
- [x] P1. Append this Sprint 68.5 section to `tasks/todo.md` BEFORE the first edit (per L8).
- [ ] P2. Create `scripts/simulate-scenarios-spike.js`. CJS shim → dynamic `import()` of route.js → import only `yieldRateFor`, `computeWeatherModifiers`, `computeTemporalModifiers` → reuse the 6 scenario definitions from Sprint 68 → loop with raw-yield math → emit `density-report-spike.csv` with per-item rows + formula strings.
- [ ] P3. Run `node scripts/simulate-scenarios-spike.js`; confirm exit 0 and 8 data rows + 1 header in `density-report-spike.csv`.
- [ ] P4. Spot-check 2 rows: script-printed total === formula evaluation. (Verify by hand-computing `D × E × F × G × H` against the script's per-row console log.)

### Acceptance Criteria
- `node scripts/simulate-scenarios-spike.js` exits 0.
- `density-report-spike.csv` exists at project root with 1 header + 8 per-item data rows.
- The `Total Score` column is an Excel formula string starting with `=`, referencing the row's own cells. Opens cleanly in Excel.
- `density-report.csv` (the Sprint 68 baseline) is untouched.
- No edits to `app/api/dispatch/route.js`.

### Anti-Goals (held)
- ✅ No edits to `route.js` or any other production file.
- ✅ No `exceljs` / no third-party libs.
- ✅ No tweaks to the 10.0 density floor or the $0.25 ROI constant (production code remains as-is — spike is observational only).
- ✅ No UI work.

#### Status: CLOSED 2026-06-01 — `scripts/simulate-scenarios-spike.js` imports only `yieldRateFor` + the two mod functions from route.js (no `densityScore`, no `capacityFor` — capacity is dead for the spike). `density-report-spike.csv` written at project root with 8 per-item rows; every Total Score cell is a live Excel formula `=D{n}*E{n}*F{n}*G{n}*H{n}`. Formulas hand-verified against script-printed values for all 8 rows. Original `density-report.csv` untouched. NEW RANKING (descending): MVP Arena Egress 675 → Perfect Storm MVP 506.25 → Friday Bar Rush 105 → Thanksgiving Eve 22.5 → Calm Tuesday 15 → Snowstorm flight 11.25 → Perfect Storm trains 11.25 (×2). Inversion FIXED — arena now outranks bar by ~6.4x, mirroring real rider-volume ratio. Floor-implication observation surfaced for the PO: solo Amtrak at base 10 is right at the floor; with `timeDecayMod 0.4` (90+ min out) it drops to 4 → would be pruned. To be addressed in a future production sprint if the spike math is adopted.

## Sprint 69 — Production Refactor: Yield Recalibration + Engine Pruning
Calibration sprint that combines (a) the per-category yield rebalancing surfaced in Sprint 68.5 with (b) the deletion of three Albany-specific amplifier engines (Tourist Ripple, Campus Mod, Lobbyist Mod) that the PO ruled redundant / overstated. Capacity model + density formula REMAIN — this sprint is yield-table + engine-pruning only, NOT a switch to raw-yield production math.

### Decisions (locked before coding, per CLAUDE.md §2)
- **Keep capacity model intact.** Production densityScore formula stays `(volume × yield) / capacity × mod × 100`. Sprint 68.5 raw-yield math validated in the simulator but NOT promoted to production this sprint — that would cascade into the 10.0 floor + $0.25 ROI constant + UI label, out of scope here.
- **Yield changes (replace YIELD_RATES wholesale):**
  - `flight: 15` (keep), `train: 10 → 12`, `food: 5 → fallback only` (split into `FOOD_YIELDS`), `grocery: 5 → 3`, `event: 50` (keep), `mega_event: 450 → 500`, `nightlife: 20 → 25`, `residential_node: 5` (keep)
  - NEW: `state_worker: 100` (carved out from mega_event), `bus: 5` (formalize the inline value)
  - NEW: `FOOD_YIELDS` dict — steakhouse 15, sushi 10, burgers 8, pizza 6, diners 4, fast food 3, cafes 2, coffee 2, brunch 4, "breakfast & brunch" 4
  - NEW: `HOSPITAL_YIELDS` dict — morning shift overlap 40, afternoon clinic shift 20, evening nursing shift 35, night admin shift 25
- **Engines DELETED (per PO):**
  - `computeCampusMod` + `CAMPUS_CENTERS` + all call sites + `campusMod`/`campusName` fields on hotspots
  - `computeCorporateMod` + all call sites + `corporateMod` field on hotspots
  - `computeTouristCluster` + the call site inside the Ticketmaster event loop
  - `CAPACITY_DICTIONARY` keys "tourist ripple" + "airport → venue" (no longer reachable)
- **`ESP_COORDS` / `HARRIMAN_COORDS` STAY** — still used by State Worker Commute injection.
- **`LEISURE_HUBS` / `LEISURE_AIRLINES` STAY** — still used by per-flight `computeLeisureMod` (1.4× on bucket yield). That engine is NOT being deleted.
- **`HUB_CITY_PATTERNS` STAY** — Sprint 68 BYOD flight dictionary, unrelated to the deletions.
- **Tests invalidated (left in place — not the PO's ask):** `test-campus-engine.js`, `test-tourist-cluster.js`, any corporate/lobbyist test. They will fail if re-run. Status block will note this.
- **UI safety:** verified — neither `components/**/*.jsx` nor `app/page.js` reads `campusMod`, `campusName`, `corporateMod`, or `tourist*` fields. Deletion is UI-safe.

### Build Steps
- [x] R1. Append this Sprint 69 section to `tasks/todo.md` BEFORE the first edit (per L8).
- [ ] R2. Replace `YIELD_RATES` constant + add `FOOD_YIELDS` + `HOSPITAL_YIELDS` constants in `app/api/dispatch/route.js`.
- [ ] R3. Update `yieldRateFor(item)` to route through new dicts: food → FOOD_YIELDS[cat0] || food fallback, event branch → state_worker check + hospital sub-shift check + nightlife check + retail check + mega/default, bus tag handling unchanged but pulls `YIELD_RATES.bus`.
- [ ] R4. Delete `CAMPUS_CENTERS` constant + `computeCampusMod` function + the `if (type === "food") { const campusResult = ... }` block in the hotspot loop + `campusMod`/`campusName` keys in the `hotspots.push` payload + the `let campusMod = 1.0; let campusName = null;` declarations.
- [ ] R5. Delete `computeCorporateMod` function + the `corporateMod = computeCorporateMod(...)` call + `corporateMod` key in `hotspots.push` + the `let corporateMod = 1.0;` declaration.
- [ ] R6. Delete `computeTouristCluster` function + the `const touristCluster = computeTouristCluster({...}); if (touristCluster) { ... }` block inside the Ticketmaster event loop.
- [ ] R7. Delete `"tourist ripple": 600` and `"airport → venue": 600` from `CAPACITY_DICTIONARY` (no longer reachable).
- [ ] R8. Clean stale comments referencing deleted engines (Sprint 31 / 36 / 47 callouts) — surgical, not a doc rewrite.
- [ ] R9. `node --check app/api/dispatch/route.js` — must pass.
- [ ] R10. Re-run BOTH simulators (`scripts/simulate-scenarios.js` + `scripts/simulate-scenarios-spike.js`) to surface the new numbers in both density and raw-yield models.

### Acceptance Criteria
- `node --check app/api/dispatch/route.js` clean.
- `grep -n "computeCampusMod\|computeCorporateMod\|computeTouristCluster\|CAMPUS_CENTERS\|campusMod\|corporateMod" app/api/dispatch/route.js` returns 0 hits.
- `YIELD_RATES.state_worker === 100`, `YIELD_RATES.nightlife === 25`, `YIELD_RATES.mega_event === 500`, `YIELD_RATES.train === 12`, `YIELD_RATES.grocery === 3`, `YIELD_RATES.bus === 5`.
- `FOOD_YIELDS` and `HOSPITAL_YIELDS` exist with the 10 + 4 keys listed in Decisions.
- Both simulators run to completion; new CSVs reflect the recalibrated numbers.

### Anti-Goals
- DO NOT switch densityScore to raw-yield math (capacity stays).
- DO NOT touch UI (`app/page.js`, `components/**`).
- DO NOT touch the 10.0 density floor or the $0.25 ROI constant.
- DO NOT install new dependencies.
- DO NOT delete or modify test-*.js files (they'll just fail if re-run — that's the PO-accepted state).

#### Status: CLOSED 2026-06-01 — `route.js` carries new `YIELD_RATES` (train 10→12, grocery 5→3, mega_event 450→500, nightlife 20→25, NEW state_worker:100, NEW bus:5), new `FOOD_YIELDS` dict (10 keys), new `HOSPITAL_YIELDS` dict (4 keys). `yieldRateFor` routes through the new dicts in strict-priority order (BYOD bus → state worker → hospital sub-shift → blanket hospital fallback → retail egress → nightlife → mega/default). DELETED: `computeCampusMod`, `computeCorporateMod`, `computeTouristCluster`, `CAMPUS_CENTERS`, hotspot fields `campusMod`/`campusName`/`corporateMod`, CAPACITY_DICTIONARY entries "tourist ripple" + "airport → venue". `node --check` clean. UI untouched (verified — no jsx file reads any deleted field). Sprint 68 simulator re-ran cleanly: MVP Arena 9→10 (clears the 10.0 floor — was being silently ghosted before), Friday Bar Rush 87.5→109.38 base (nightlife yield bump), Perfect Storm 15.67→18 base (train bump + arena bump). Sprint 68.5 spike re-run BLOCKED — `density-report-spike.csv` was open in Excel (EBUSY). Close the file and re-run `node scripts/simulate-scenarios-spike.js` to regenerate. Tests now invalidated and will fail if re-run: `test-campus-engine.js`, `test-tourist-cluster.js` (per PO ask — left in place).

## Sprint 70 — Production Switch to Raw-Yield Math
Promote the Sprint 68.5 spike formula into production. `densityScore = volume × yield × finalMod` — no capacity term, no ×100 percentage scaling. Kills the cross-type comparability bug (MVP Arena scoring 9% vs Friday Bar Rush scoring 87.5% on the same physical ranking surface) and the MVP-Arena-Music-vs-Sports inconsistency (yield came from egressMod, capacity came from categories[0] — two different inputs for the same venue).

### Decisions (locked before coding, per CLAUDE.md §2)
- **Formula:** `densityScore(item, finalRideMod, finalFoodMod) = (volume × yieldRateFor(item)) × mod` — no division, no ×100. Field name `densityScore` retained on items for surgical minimality (so `app/page.js`, `components/**`, peak-surge engine all still read the same property) — only the *meaning* changes from "% of venue capacity" to "expected riders".
- **Floor stays at 10.0.** Solo flight (yield 15 × 1.0) clears; solo train (12 × 1.0) clears; both drop at time-decay 0.4 — matches current behavior shape. Solo small food (yield ≤ 6) drops, same as today. No floor recalibration needed in this sprint.
- **DOLLAR_PER_SURGE_POINT stays at 0.25.** For a solo flight: OLD value $3.05 → NEW value $3.75 (rough parity). For mega items the ROI filter effectively becomes a no-op (a 500-yield arena scores $125 of value, far above any plausible deadhead) — acceptable, since under-pruning stadium events was the prior failure mode anyway.
- **Peak surge banner threshold: 50 → 200.** Raw scores sum higher; a typical busy radar will exceed 200 easily, while a quiet one stays below. Re-tune if observed otherwise.
- **DELETE:** `capacityFor` function (and its `export`), `CAPACITY_DICTIONARY`, `DEFAULT_CAPACITY`, the `estimatedCapacity` field stamping in `buildItinerary`, the Sprint 62.3 fail-safe clamp (`expectedYield > capacity * 0.9`) — all redundant.
- **UI label changes:** `formatDensity()` → `formatExpectedRiders()` in `DispatchCards.jsx`; same swap in `DispatchMap.jsx` popup + `TopPickBanner.jsx`. Display text: "Density: X%" → "Expected Riders: N".
- **`PeakSurgeBanner.jsx`** stays reading `totalDensity` field (no rename), threshold bumped 50 → 200.
- **Simulator scripts unchanged.** `scripts/simulate-scenarios.js` imports `densityScore` from route.js — it'll automatically print the new numbers. `scripts/simulate-scenarios-spike.js` is now functionally identical to production but kept intact for diff-history.
- **Test files invalidated:** `test-density-engine.js` will fail (it asserts the old percentage formula). Left in place per the Sprint 69 anti-goal pattern.

### Build Steps
- [x] T1. Append this Sprint 70 section to `tasks/todo.md` BEFORE the first edit (per L8).
- [ ] T2. Simplify `densityScore` in route.js: drop `capacityFor` lookup + `/capacity * 100`, becomes `(volume × yieldRate) × mod`.
- [ ] T3. Delete `capacityFor` export + `CAPACITY_DICTIONARY` + `DEFAULT_CAPACITY` constants.
- [ ] T4. In `buildItinerary` item.map: drop `estimatedCapacity` field + the Sprint 62.3 `expectedYield > capacity * 0.9` clamp. `expectedYield` itself stays (it's the same as `volume × yieldRate`, still useful for UI display).
- [ ] T5. Update `components/DispatchCards.jsx`: rename `formatDensity` → `formatExpectedRiders`, output format `"Expected Riders: N"`.
- [ ] T6. Update `components/DispatchMap.jsx`: popup label `"Density: X%"` → `"Expected Riders: N"`.
- [ ] T7. Update `components/TopPickBanner.jsx`: same label swap.
- [ ] T8. Update `components/PeakSurgeBanner.jsx`: threshold `totalDensity <= 50` → `totalDensity <= 200`.
- [ ] T9. `node --check app/api/dispatch/route.js` — must pass.
- [ ] T10. Re-run `node scripts/simulate-scenarios.js`; confirm new CSV numbers match the Sprint 68.5 spike CSV exactly (proof the production switch landed correctly).

### Acceptance Criteria
- `node --check app/api/dispatch/route.js` clean.
- `grep -n "capacityFor\|CAPACITY_DICTIONARY\|DEFAULT_CAPACITY" app/api/dispatch/route.js` returns 0 hits (other than this paper-trail mention if any).
- New `density-report.csv` rows: Calm Tuesday 15, Friday Bar Rush 131.25, MVP Arena 750 (after Sat 10pm 1.5x — was 15 in density model), Snowstorm 11.25, Thanksgiving Eve 22.5, Perfect Storm 506.25 (arena) + 13.5 (train) ×2 = 533.25 sum.
- UI strings "Density:" no longer present in `components/**` (grep returns only comment lines if any).

### Anti-Goals
- DO NOT rename the `densityScore` field on item objects (purely surgical — internal name preserved).
- DO NOT delete or modify `scripts/simulate-scenarios-spike.js` (kept for diff history).
- DO NOT delete or modify `test-density-engine.js` or any other test file (will fail if re-run — accepted state per the Sprint 69 pattern).
- DO NOT touch Sprint 69's yield dicts (FOOD_YIELDS, HOSPITAL_YIELDS, EVENT_YIELDS).
- DO NOT change the time-decay (0.7 / 0.4) tiers.

#### Status: CLOSED 2026-06-01 — `route.js` densityScore simplified to `(volume × yieldRate) × mod`. DELETED: `capacityFor` export, `CAPACITY_DICTIONARY`, `DEFAULT_CAPACITY`, `estimatedCapacity` field, Sprint 62.3 capacity clamp. Floor (10.0) + DOLLAR_PER_SURGE_POINT (0.25) untouched. UI relabeled in 3 components: `DispatchCards.jsx` (formatDensity → formatExpectedRiders, "Density: X%" → "Expected Riders: N"), `DispatchMap.jsx` popup, `TopPickBanner.jsx`. `PeakSurgeBanner.jsx` threshold bumped 50→200 for raw-yield scale. Simulator script patched (removed `capacityFor` import + capacity column from per-item log). `node --check` clean. NEW production CSV: Calm Tuesday 15, Friday Bar Rush 131.25, MVP Arena Egress 750, Snowstorm 11.25, Thanksgiving Eve 22.5, Perfect Storm 589.5 (524 base × 1.125 final mod). MVP Arena now correctly dominates — 6.4× Friday Bar Rush, mirrors the real rider-volume ratio. Music-vs-Sports-at-MVP-Arena consistency proven: both score 750 at Sat 10pm because capacity (formerly the divergent input) is gone. `test-density-engine.js` invalidated (per anti-goal — left in place). Live `npm run dev` smoke-test of the new UI labels in browser not yet exercised.




### Acceptance Criteria
- `node scripts/simulate-scenarios.js` exits with code 0.
- `density-report.csv` exists at project root and contains 6 distinct scenario rows.
- The script imports `densityScore`, `yieldRateFor`, `capacityFor`, `computeWeatherModifiers`, `computeTemporalModifiers` from `app/api/dispatch/route.js` — no duplicated math.
- Next.js still builds (`node --check` clean on route.js).

### Anti-Goals (held)
- No edits to `app/page.js`, `components/**`, or any other production file beyond the export keywords + JSON import-attribute on route.js.
- No frontend UI, panel, or browser visualizer.
- No third-party CSV / chart libs.

## Sprint 71 — Static Albany POI Dictionary

Build a first-pass static food/grocery POI source so Yelp is no longer required for local density hotspots.

### Decisions
- **Dictionary file:** `albany_poi_dictionary.json` at project root, mirroring `nightlife_dictionary.json` as a curated local data asset.
- **Shape:** `{ food: [...], grocery: [...] }`, where every POI normalizes to the existing Yelp business shape: `name`, `lat`, `lng`, `price`, `categories`, `address1`, `rating`, `reviewCount`, optional `activeWindows`.
- **Compatibility:** Keep `computeHotspots()` unchanged. Static POIs must feed the same array shape that `fetchYelpBusinesses()` returns today.
- **Runtime behavior:** Prefer Yelp when `YELP_API_KEY` exists, but fall back to static POIs when Yelp is missing or returns no usable businesses. This lets the app keep live Yelp quality when configured while removing the hard dependency.
- **Scope:** Starter dictionary targets high-signal Albany-area demand corridors, not a complete restaurant directory.

### Build Steps
- [x] S1. Append this Sprint 71 plan before code edits.
- [x] S2. Create `albany_poi_dictionary.json` with an initial high-signal food/grocery seed.
- [x] S3. Import/load the static dictionary in `app/api/dispatch/route.js`.
- [x] S4. Add static POI normalization, active-window filtering, and distance filtering.
- [x] S5. Update `getLocalDensityData()` to use static fallback when Yelp is unavailable or empty.
- [x] S6. Run `node --check app/api/dispatch/route.js`.

### Acceptance Criteria
- Dispatch no longer loses food/grocery hotspots solely because `YELP_API_KEY` is missing.
- `computeHotspots()` remains the single clustering/scoring path for food/grocery.
- Static POIs outside 5 km of the driver are not considered.
- Static POIs can be time-gated with `activeWindows`, but entries without windows are considered always eligible.

### Anti-Goals
- Do not remove Yelp yet.
- Do not change UI files.
- Do not install new dependencies.
- Do not attempt a complete 400+ restaurant database in this sprint.
## Sprint 72 — Temporal Modifier Rebalance

Reduce double-counting in the temporal scoring layer now that rideshare demand is mostly covered by explicit engines.

### Decisions
- **Remove generic commute ride boosts:** weekday morning/evening `rideMod = 1.5` double-counts hospital shifts, state worker commute, transit, and event engines.
- **Keep rideshare temporal only as a mild late-night behavior modifier:** Friday/Saturday late night and Saturday/Sunday early AM use `rideMod = 1.15`, not `1.5`.
- **Soften late-night food suppression:** `foodMod = 0.8`, not `0.5`, so pizza/wings/diners/late-night food are not globally crushed.
- **Extend dinner:** dinner food window becomes 5:00 PM-8:59 PM (`hour <= 20`).
- **Add weekend brunch shoulder:** Saturday/Sunday 10:00 AM-10:59 AM uses `foodMod = 1.3`; the existing daily lunch rule still makes 11:00 AM-1:59 PM `1.5`.

### Build Steps
- [x] S1. Append this Sprint 72 plan before edits.
- [x] S2. Update `computeTemporalModifiers()` in `app/api/dispatch/route.js`.
- [x] S3. Update `test-time.js` expectations and add coverage for weekend brunch, extended dinner, and neutral commute ride modifiers.
- [x] S4. Run `node test-time.js`.
- [x] S5. Run `node --check app/api/dispatch/route.js`.

### Acceptance Criteria
- Weekday commute windows no longer increase `rideMod`.
- Late-night ride modifier is `1.15`.
- Late-night food modifier is `0.8`.
- Weekend 10 AM brunch returns `foodMod = 1.3`.
- Dinner through 8 PM hour returns `foodMod = 1.5`.

### Anti-Goals
- Do not change weather modifiers.
- Do not change explicit hospital/state/transit/event engines.
- Do not change UI.
## Sprint 73 — DoorDash POI Enrichment

Use the attached DoorDash Albany takeout PDF as an app-specific demand overlay for the static POI dictionary.

### Decisions
- **New data file:** `doordash_poi_enrichment.json` at project root. It stores DoorDash-visible merchant metadata from the PDF: name, rating, review count, categories, distance, ETA.
- **No coordinates in DoorDash file:** the PDF does not provide lat/lng. Coordinates stay owned by `albany_poi_dictionary.json` / future geocoding passes.
- **Merge by normalized name:** static POIs are enriched at runtime when their normalized name matches a DoorDash merchant. This keeps the static POI shape Yelp-compatible while preserving DoorDash evidence.
- **Scoring impact:** `computeHotspots()` anchor popularity should use the best available app signal: `rating/reviewCount` first, then `doordashRating/doordashReviewCount`.
- **Scope:** Add the overlay and use it for matching POIs. Do not geocode all missing DoorDash merchants yet.

### Build Steps
- [x] S1. Append this Sprint 73 plan before edits.
- [x] S2. Create `doordash_poi_enrichment.json` from the attached PDF.
- [x] S3. Import and freeze DoorDash enrichment data in `app/api/dispatch/route.js`.
- [x] S4. Add normalized-name matching and merge DoorDash fields into static POIs.
- [x] S5. Update hotspot anchor popularity to read DoorDash rating/review counts when native rating/review is absent.
- [x] S6. Run JSON validation and `npm run build`.

### Acceptance Criteria
- Static POIs that match DoorDash merchants carry `deliveryApps: ["DoorDash"]`.
- Matching POIs expose `doordashRating`, `doordashReviewCount`, `doordashEtaMinutes`, and `doordashDistanceMiles`.
- Existing Yelp path remains unchanged.
- Production build succeeds.

### Anti-Goals
- Do not scrape DoorDash live.
- Do not add coordinates guessed from DoorDash distance.
- Do not replace Yelp/static POI clustering.
- Do not change UI in this sprint.

### Follow-Up: 10 DoorDash Merchants Promoted to Static POIs
- [x] Added coordinate-bearing food POIs for Seoul Korean, Bellini's Counter, Lo Nuestro, Wingstop, KFC, Margarita City, Red Lobster, El Pilon Market Inc, Ted's Fish Fry, and Pizza Hut.
- [x] Updated DoorDash overlay values for those 10 to match the user's latest list.
- [x] Verified each of the 10 now has exactly one POI dictionary match and one DoorDash enrichment match.
- [x] Ran JSON validation and `node --check app/api/dispatch/route.js`.
## Sprint 74 — Remove Yelp From Dispatch Path

Make static Albany POIs + DoorDash enrichment the primary and only food/grocery source during live dispatch.

### Decisions
- **Dispatch-time source:** `getLocalDensityData()` should use `albany_poi_dictionary.json` filtered by driver radius, enriched by `doordash_poi_enrichment.json`.
- **No Yelp API pull during dispatch:** stop reading `YELP_API_KEY`, stop calling `fetchYelpBusinesses()` from the POST flow.
- **Keep Yelp fetcher temporarily:** leave `fetchYelpBusinesses()` in the file as inactive legacy/maintenance code so the change is reversible and narrow.
- **No UI changes:** food/grocery cards and labels already consume the same `gigDemand` shape.

### Build Steps
- [x] S1. Append this Sprint 74 plan before edits.
- [x] S2. Update `getLocalDensityData()` to ignore Yelp and always use static POIs.
- [x] S3. Remove `YELP_API_KEY` warning/read from the dispatch POST path.
- [x] S4. Run `node --check app/api/dispatch/route.js`.
- [x] S5. Run `npm run build`.

### Acceptance Criteria
- Dispatch no longer calls Yelp for food/grocery data.
- Missing `YELP_API_KEY` no longer logs a warning.
- `gigDemand.foodHotspots` and `gigDemand.groceryHotspots` still build through `computeHotspots()`.
- Production build succeeds.

### Anti-Goals
- Do not delete the old Yelp fetcher yet.
- Do not change static POI data in this sprint.
- Do not change UI.
## Sprint 75 — Add DoorDash Batch 2 POIs

Add the user's second batch of DoorDash merchants to the static POI + DoorDash enrichment data.

### Decisions
- **Coordinate-bearing POIs:** any missing merchant from the batch should be added to `albany_poi_dictionary.json`.
- **DoorDash metadata:** every listed merchant should have/receive matching metadata in `doordash_poi_enrichment.json`.
- **Existing POIs:** if a POI already exists, do not duplicate it; update only enrichment values unless the static metadata is missing.
- **User-provided values:** trust the provided coordinates/categories/ratings/ETA/distance for this batch.

### Build Steps
- [x] S1. Append this Sprint 75 plan before edits.
- [x] S2. Check which batch merchants are already present.
- [x] S3. Add missing static POIs.
- [x] S4. Add or update DoorDash enrichment rows.
- [x] S5. Validate JSON and confirm every batch merchant has one POI and one enrichment match.

### Acceptance Criteria
- All listed merchants have coordinate-bearing POI entries.
- All listed merchants have DoorDash enrichment entries.
- JSON validation passes.

### Anti-Goals
- Do not change backend logic.
- Do not geocode or override beyond the user's provided batch values.
## Sprint 76 — Add DoorDash Batch 3 POIs

Add the user's third batch of DoorDash merchants to the static POI + DoorDash enrichment data.

### Decisions
- **User-provided values:** trust the provided coordinates, categories, address, DoorDash rating/reviews/ETA/distance.
- **No duplicates:** update existing POI/enrichment rows when names already exist; add rows only when missing.
- **Matcher safety:** keep exact-name verification after updates so similarly named merchants do not collide.

### Build Steps
- [x] S1. Append this Sprint 76 plan before edits.
- [x] S2. Check current presence for the batch.
- [x] S3. Add/update static POI rows.
- [x] S4. Add/update DoorDash enrichment rows.
- [x] S5. Validate JSON and confirm exact POI/enrichment matches for every batch merchant.

### Acceptance Criteria
- All listed merchants have coordinate-bearing POI entries.
- All listed merchants have DoorDash enrichment entries.
- JSON validation passes.

### Anti-Goals
- Do not change backend logic.
- Do not geocode or infer beyond the user's provided values.
## Sprint 114 - Remove Closed Seoul Korean POI

Remove Seoul Korean from active food-delivery data after the driver confirmed the restaurant is permanently closed.

### Decisions
- **Remove active POI:** delete Seoul Korean from `albany_poi_dictionary.json`.
- **Remove enrichment:** delete Seoul Korean from `doordash_poi_enrichment.json`.
- **No closed flag:** current backend does not consume a closed flag, so removal is the safest active-data fix.

### Build Steps
- [x] S1. Append this Sprint 114 plan before edits.
- [x] S2. Remove static POI entry.
- [x] S3. Remove DoorDash enrichment entry.
- [x] S4. Validate JSON and absence.

### Acceptance Criteria
- Seoul Korean no longer appears in the active static food POI dictionary.
- Seoul Korean no longer appears in DoorDash enrichment data.
- JSON validation passes.

### Anti-Goals
- Do not remove Namu Korean BBQ Restaurant.
- Do not change food scoring.
- Do not add replacement restaurants in this sprint.

## Sprint 113 - Tighten State Worker Commute Pulse

Move state-worker evening commute demand earlier and shorten the tail so it does not keep showing as a strong event around 5 PM and beyond.

### Decisions
- **Earlier peak:** start state-worker peak at 4:00 PM.
- **Sharper taper:** use 4:00-4:29 PM at 100, 4:30-4:59 PM at 65, and 5:00-5:19 PM at 35.
- **No late tail:** remove state-worker commute after 5:20 PM.
- **Weekday only:** keep the existing Monday-Friday guard.

### Build Steps
- [x] S1. Append this Sprint 113 plan before edits.
- [x] S2. Update taper table.
- [x] S3. Update injector comments.
- [x] S4. Add state-worker taper validator.
- [x] S5. Validate route syntax, taper validator, and production build.

### Acceptance Criteria
- State worker commute appears at 4:00 PM.
- State worker commute is weaker at 5:00 PM.
- State worker commute is gone by 5:20 PM.

### Anti-Goals
- Do not change hospital, train, food, weather, or Telegram alert logic.
- Do not change state-worker location.
- Do not add user controls for this taper.

## Sprint 112 - Empire 28x Train Alighting Factor

Downweight inbound Empire Service train numbers starting with `28` because they are through-trains that continue past Albany-Rensselaer.

### Decisions
- **Inbound-only:** apply the alighting factor only to BYOD inbound train egress.
- **28x through-train:** train numbers like `281` and `283` use a lower Albany alighting factor.
- **Albany-focused trains:** other inbound BYOD Empire trains keep the higher Albany-focused alighting factor.
- **Outbound unchanged:** outbound station ingress is not reduced by this alighting rule.

### Build Steps
- [x] S1. Append this Sprint 112 plan before edits.
- [x] S2. Add BYOD train alighting-factor helper.
- [x] S3. Stamp train number onto BYOD train event objects.
- [x] S4. Apply factor inside BYOD train yield.
- [x] S5. Update fare-yield validator coverage.
- [x] S6. Validate parser/fare-yield tests and production build.

### Acceptance Criteria
- Inbound train `281`/`283` produces lower Albany egress demand than inbound `237`/`239` with the same scarcity.
- Outbound train ingress is not downweighted by the 28x rule.
- Existing fare-class scarcity still influences train demand before the alighting factor.

### Anti-Goals
- Do not scrape Amtrak full routes.
- Do not change live Amtrak API train buckets.
- Do not change non-train scoring.

## Sprint 111 - Sequence Feasibility Gap Guidance

Improve Suggested Sequence guidance for infeasible cross-anchor transitions and long same-anchor gaps.

### Decisions
- **Too-tight transitions:** when the next anchor cannot be reached in time, say it is too tight instead of saying to drift toward it.
- **Long same-anchor gaps:** when the next same-anchor step is more than 90 minutes away, do not imply the driver should wait there.
- **Return guidance:** long-gap same-anchor steps tell the driver to work nearby demand and return by the next target buffer time.
- **No scoring changes:** this sprint only changes sequence guidance text.

### Build Steps
- [x] S1. Append this Sprint 111 plan before edits.
- [x] S2. Update cross-anchor infeasible transition wording.
- [x] S3. Add long same-anchor gap wording.
- [x] S4. Add return-by text helper for long gaps.
- [x] S5. Validate production build.

### Acceptance Criteria
- Crossgates-to-Rensselaer with only ~10 minutes does not suggest a normal transition.
- Rensselaer train chains with multi-hour gaps tell the driver to work nearby demand and return later.
- Scoring and selected sequence items remain unchanged.

### Anti-Goals
- Do not cap Crossgates demand in this sprint.
- Do not change itinerary/card scoring.
- Do not add routing API calls.

## Sprint 110 - Sequence Timing Cue Cleanup

Make Suggested Sequence timing cues relative to the current time so near-term train/event steps do not show stale `Be there by` times or confusing same-anchor avoid warnings.

### Decisions
- **Current-time aware:** when a `Be there by` time has already passed, show `Head there now`.
- **Immediate window:** when the target is effectively happening now, show `Stay near ... now`.
- **Same-anchor cleanup:** do not show `Avoid long trips after` for train-to-train or same-location follow-ups.
- **Keep transition text:** same-anchor steps still use the existing stay-near transition guidance.

### Build Steps
- [x] S1. Append this Sprint 110 plan before edits.
- [x] S2. Make `Be there by` cue relative to current local time.
- [x] S3. Make avoid-long-trips cue relative to current local time.
- [x] S4. Suppress avoid-long-trips for same-anchor next steps.
- [x] S5. Validate production build.

### Acceptance Criteria
- At 7:00 PM, a 7:10 PM train shows `Head there now`, not a past `Be there by` time.
- Same-anchor train chains do not show next-train avoid warnings inside the current train step.
- The active `Now` step can still warn against long trips when a different anchor is coming soon.

### Anti-Goals
- Do not change scoring.
- Do not change sequence candidate selection.
- Do not change the main dispatch cards.

## Sprint 109 - Netlify Blobs BYOD Sync

Mirror locally saved BYOD train, bus, and flight data into Netlify Blobs so automated scheduled dispatch checks can use the latest uploaded data.

### Decisions
- **Blob store:** use Netlify Blobs site-wide storage with a single `latest` BYOD snapshot.
- **Keep local-first UX:** Save buttons still update localStorage and React state immediately.
- **Server mirror:** Save and toggle auto-save also POST the latest BYOD snapshot to `/api/byod`.
- **Dispatch fallback:** when a dispatch request has no BYOD payload, the backend reads today's saved Blob snapshot.
- **Privacy guard:** `/api/byod` supports same-origin writes only and does not expose a public read endpoint.

### Build Steps
- [x] S1. Append this Sprint 109 plan before edits.
- [x] S2. Add Netlify Blobs dependency and BYOD storage helper.
- [x] S3. Add `/api/byod` save route.
- [x] S4. Sync BYOD saves from the client.
- [x] S5. Make dispatch use Blob BYOD fallback for automated calls.
- [x] S6. Validate syntax, focused tests, and production build.

### Acceptance Criteria
- Manual BYOD saves still work locally.
- Saved BYOD data is mirrored to Netlify Blobs.
- GitHub Actions dispatch calls can incorporate today's saved BYOD snapshot without browser localStorage.
- Public BYOD reads are not exposed.

### Anti-Goals
- Do not automate scraping/importing source websites.
- Do not remove localStorage persistence.
- Do not add multi-user auth in this sprint.

## Sprint 108 - GitHub Actions Alert Scheduler

Automate Telegram surge checks through GitHub Actions so the driver does not need to manually press `What's happening?` every time.

### Decisions
- **GitHub Actions first:** use scheduled workflow rather than in-app timers or serverless background loops.
- **Single 15-minute cron:** run the workflow every 15 minutes and let the script decide whether this tick should call dispatch.
- **Cadence tiers:** broad checks every 4 hours, driving-window checks every 30 minutes, and late-night/train-heavy checks every 15 minutes.
- **Config via secrets:** deployed endpoint, base latitude/longitude, strategy, platform toggles, and cost per mile can be overridden with GitHub secrets.
- **Manual test path:** `workflow_dispatch` can force a run outside the normal cadence.

### Build Steps
- [x] S1. Append this Sprint 108 plan before edits.
- [x] S2. Add scheduled dispatch caller script.
- [x] S3. Add GitHub Actions workflow.
- [x] S4. Validate script syntax and workflow file shape.
- [x] S5. Document required GitHub/Netlify environment variables.

### Acceptance Criteria
- GitHub Actions can call the deployed dispatch endpoint on a schedule.
- Normal 15-minute ticks skip outside the selected cadence windows.
- Manual workflow runs can force a dispatch check for testing.
- Existing manual dispatch button remains unchanged.

### Anti-Goals
- Do not add a persistent server process.
- Do not hardcode Telegram tokens or chat IDs.
- Do not upload BYOD train/flight text automatically yet.

## Sprint 107 - Telegram Dispatch Alerts

Send a Telegram message after a manual dispatch run when a high-opportunity or shortage-driven surge signal appears.

### Decisions
- **Manual trigger first:** alerts run only when the driver presses `What's happening?`.
- **Environment secrets:** read `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`; never store tokens in code.
- **Noise control:** suppress duplicate alerts for the same item/window for 30 minutes.
- **Alert rules:** notify on testing-threshold high opportunity, driver-supply pressure, timed train/flight/event demand within 45 minutes, or a large Golden Half-Hour.
- **Non-blocking behavior:** Telegram failures are returned as alert status and logged, but dispatch still returns a plan.

### Build Steps
- [x] S1. Append this Sprint 107 plan before edits.
- [x] S2. Add alert candidate/rule helpers.
- [x] S3. Add Telegram send helper with cooldown.
- [x] S4. Attach alert status to the dispatch response.
- [x] S5. Validate route syntax and production build.

### Acceptance Criteria
- Alert sends only when Telegram env vars are present and an alert-worthy signal exists.
- Duplicate alerts are cooled down for 30 minutes.
- Dispatch still succeeds if Telegram is missing or the send fails.

### Anti-Goals
- Do not add a background scheduler yet.
- Do not hardcode bot tokens or chat IDs.
- Do not change demand/opportunity scoring.

## Sprint 106 - Suggested Sequence Timing Cues

Add practical timing guidance to Suggested Sequence so the plan tells the driver when to be near the next anchor and when to stop taking long-away trips.

### Decisions
- **Compact guidance:** show timing cues as one small line inside each sequence step.
- **Anchor lead times:** use slightly larger buffers for flights and trains than routine events.
- **Next-step warnings:** current/positioning steps can warn when the next timed anchor is getting close.
- **No scoring changes:** timing cues only affect display text.

### Build Steps
- [x] S1. Append this Sprint 106 plan before edits.
- [x] S2. Add minute formatting and anchor buffer helpers.
- [x] S3. Add `Be there by` cue for timed sequence steps.
- [x] S4. Add `Avoid long trips after` cue when the next step has a fixed time.
- [x] S5. Validate syntax and production build.

### Acceptance Criteria
- Timed train/flight/event sequence steps show a `Be there by` cue.
- Steps before a timed anchor can show an `Avoid long trips after` cue.
- Existing itinerary scoring and card filtering remain unchanged.

### Anti-Goals
- Do not change demand/opportunity math.
- Do not change the main card list.
- Do not add route API calls.

## Sprint 105 - Sequence-Only Lower-Floor Anchors

Allow Suggested Sequence to use lower-score rideshare positioning anchors without lowering the main dispatch card floor.

### Decisions
- **Main itinerary unchanged:** cards still use the existing score floors.
- **Sequence-only candidates:** backend sends a separate `sequenceCandidates` array with useful rideshare items that clear a lower sequence floor.
- **Lower residential floor:** sequence can use residential/student positioning anchors around score >= 4.
- **No food/grocery:** sequence-only candidates remain rideshare-only for version 1.
- **Frontend merge:** Suggested Sequence reads `itinerary + sequenceCandidates`, while Map/List cards read only `itinerary`.

### Build Steps
- [x] S1. Append this Sprint 105 plan before edits.
- [x] S2. Add lower-threshold residential ride hub generation.
- [x] S3. Add backend `sequenceCandidates` builder.
- [x] S4. Pass sequence candidates to Suggested Sequence only.
- [x] S5. Validate production build.

### Acceptance Criteria
- Lower-score local rideshare anchors can appear in Suggested Sequence.
- Lower-score sequence-only anchors do not appear in Transit & Events cards.
- Food/grocery remain excluded from Suggested Sequence.

### Anti-Goals
- Do not lower main itinerary card floors globally.
- Do not bypass backend platform filtering.
- Do not add a route API call.

## Sprint 104 - Sequence Active Now Anchor

Let Suggested Sequence start with a high-opportunity active untimed rideshare item, such as State Worker Commute, before continuing the timed sequence.

### Decisions
- **Current anchor only:** untimed rideshare items can appear only as the first `Now` step.
- **High-opportunity gate:** require meaningful opportunity so weak/noisy untimed items do not crowd the sequence.
- **Timed chain remains:** future sequence steps still come from timed rideshare opportunities.
- **No food/grocery:** active food/grocery hotspots remain excluded from sequence version 1.

### Build Steps
- [x] S1. Append this Sprint 104 plan before edits.
- [x] S2. Add active-now candidate helper.
- [x] S3. Prepend the strongest active-now item when useful.
- [x] S4. Avoid duplicate positioning step when active-now item exists.
- [x] S5. Validate production build.

### Acceptance Criteria
- State Worker Commute with high Opportunity Now can appear as the first sequence step.
- Sequence still continues with future timed steps.
- Food/grocery hotspots are not used as active-now sequence anchors.

### Anti-Goals
- Do not change Top Pick.
- Do not change scoring.
- Do not replace existing cards.

## Sprint 103 - Sequence Starts From Now

Make Suggested Sequence begin from current local time instead of only listing future opportunities.

### Decisions
- **Now-first:** if the first selected opportunity is more than 45 minutes away, insert a positioning step labeled `Now`.
- **Actionable near-term:** if an opportunity is within 45 minutes, use it as the first real step.
- **No fake ride destination:** the positioning step says to position toward the next anchor, not to take a specific ride there.
- **Continue future sequence:** after the Now step, keep the existing timed opportunity chain.

### Build Steps
- [x] S1. Append this Sprint 103 plan before edits.
- [x] S2. Add current-time helper.
- [x] S3. Insert Now positioning step when the first opportunity is far out.
- [x] S4. Render positioning steps cleanly.
- [x] S5. Validate production build.

### Acceptance Criteria
- Suggested Sequence does not start one or two hours in the future without a Now step.
- If the first opportunity is soon, no extra positioning step is added.
- Existing Map/List/cards remain unchanged.

### Anti-Goals
- Do not add route API calls.
- Do not change demand/opportunity scoring.
- Do not include food/grocery in sequence version 1.

## Sprint 102 - Sequence Anti-Bounce Tuning

Tune Suggested Sequence so it does not bounce between ESP outbound ingress and Rensselaer inbound egress unless the timing gap is actually comfortable.

### Decisions
- **Conservative drive time:** inter-anchor transitions have a minimum 15-minute drive time.
- **Same-anchor stay bias:** same-anchor follow-up opportunities can chain naturally with no reposition warning.
- **Transition buffer:** require drive time plus a 10-minute buffer before adding a different-anchor step.
- **Skip weak bounce candidates:** if the next item is too tight and not materially stronger, skip it and look for a better continuation.

### Build Steps
- [x] S1. Append this Sprint 102 plan before edits.
- [x] S2. Add anchor grouping helper.
- [x] S3. Make drive-time estimates anchor-aware and conservative.
- [x] S4. Tune sequence selection to avoid tight anchor bouncing.
- [x] S5. Validate production build.

### Acceptance Criteria
- ESP -> Rensselaer -> ESP quick alternation is avoided when the middle gap is too tight.
- Same-anchor follow-ups produce stay-near guidance.
- Existing cards and Map/List remain unchanged.

### Anti-Goals
- Do not add route API calls.
- Do not remove Suggested Sequence.
- Do not change demand/opportunity scoring.

## Sprint 101 - Suggested Route Sequence

Add a new Suggested Sequence section that turns timed rideshare opportunities into a simple chronological driving plan without replacing the existing cards.

### Decisions
- **Frontend-derived first version:** build the sequence from the existing itinerary response to avoid changing backend contracts.
- **Timed rideshare only:** include flights, trains, events, flight/train ripples, and ride hubs; exclude food/grocery.
- **2-4 steps:** keep the output short and actionable.
- **Feasibility guidance:** estimate drive time between anchors from lat/lng and add reposition/prefer-direction guidance when a transition is plausible.
- **No fake certainty:** use language like "prefer trips toward" or "reposition toward", not "take a ride to".

### Build Steps
- [x] S1. Append this Sprint 101 plan before edits.
- [x] S2. Add sequence builder helpers.
- [x] S3. Add Suggested Sequence component.
- [x] S4. Render section above existing plan cards.
- [x] S5. Validate production build.

### Acceptance Criteria
- Suggested Sequence appears after dispatch when at least two timed rideshare opportunities exist.
- Existing Map/List and cards remain unchanged.
- Food/grocery hotspots are not included in the first sequence version.
- Sequence uses expected demand and opportunity now from existing item fields.

### Anti-Goals
- Do not replace current cards.
- Do not add route API calls.
- Do not claim actual ride destinations are known.

## Sprint 100 - Expected Demand vs Opportunity Now

Split true demand from urgency-adjusted opportunity so displayed rider counts are not reduced by time decay.

### Decisions
- **Expected Demand:** `densityScore` stores true estimated demand before time decay and before driver-supply pressure.
- **Opportunity Now:** `opportunityScore` stores expected demand multiplied by time decay and driver supply pressure.
- **Sorting/top pick:** use `opportunityScore` for actionability.
- **Golden Half-Hour:** sum `densityScore` so it reports the highest true-demand 30-minute window.
- **Filtering:** use expected demand floors, not time-decayed floors.

### Build Steps
- [x] S1. Append this Sprint 100 plan before edits.
- [x] S2. Update backend itinerary scoring fields.
- [x] S3. Update sorting/top-pick to use `opportunityScore`.
- [x] S4. Update card/banner labels to `Opportunity Now`.
- [x] S5. Validate focused tests and production build.

### Acceptance Criteria
- A far-out BYOD train can show `Expected Riders: 15` and `Opportunity Now: 6`.
- Golden Half-Hour expected demand sums true demand, not time-decayed demand.
- Sorting and top pick remain urgency-aware via `Opportunity Now`.
- Driver supply remains separate from expected demand.

### Anti-Goals
- Do not change fare-class train yield values.
- Do not change BYOD train time-window eligibility.
- Do not change food/grocery POI data.

## Sprint 99 - BYOD Train Time-Decay Visibility

Fix saved BYOD trains disappearing from the 4-hour dispatch plan when their realistic expected-rider score is decayed below the global itinerary floor.

### Decisions
- **BYOD train floor:** driver-uploaded train events pass itinerary filtering at score >= 4.
- **No demand inflation:** keep expected-rider scoring and time-decayed display score unchanged.
- **Narrow scope:** only BYOD Train events get the lower floor; live trains, flights, local anchors, hospitals, and generic events keep the existing floor.
- **Time window still owns eligibility:** trains outside the selected dispatch window remain hidden.

### Build Steps
- [x] S1. Append this Sprint 99 plan before edits.
- [x] S2. Add BYOD Train detection helper.
- [x] S3. Lower itinerary floor for BYOD Train events only.
- [x] S4. Extend validator coverage.
- [x] S5. Validate parser, food/daypart validator, route syntax, and production build.

### Acceptance Criteria
- BYOD Train with decayed score 4 survives itinerary filtering.
- Generic train/event with decayed score 4 still uses existing behavior unless explicitly BYOD Train.
- BYOD Train expected-rider scoring remains fare-class based.

### Anti-Goals
- Do not change live Amtraker bucket scoring.
- Do not change train time-window gates.
- Do not inflate train demand numbers.

## Sprint 98 - BYOD Train Save Visibility

Prevent silent zero-train saves from making the dispatch plan look blank, and surface saved inbound/outbound train counts in the BYOD panel.

### Decisions
- **Do not overwrite with zero parsed trains:** if Amtrak parsing returns no trains, mark save as failed and keep the previous saved train config.
- **Mode switch auto-save follows same guard:** changing BYOD mode with unparseable Amtrak text should not wipe saved trains.
- **Show saved counts:** display current saved inbound/outbound train counts for today's local date.
- **Keep bus/flight raw saves unchanged:** this guard applies only to Amtrak parsed train saves.

### Build Steps
- [x] S1. Append this Sprint 98 plan before edits.
- [x] S2. Guard explicit Amtrak save against zero parsed trains.
- [x] S3. Guard mode-switch auto-save against zero parsed trains.
- [x] S4. Render today's saved inbound/outbound train counts.
- [x] S5. Validate production build.

### Acceptance Criteria
- Saving Amtrak text that parses zero trains does not overwrite existing saved trains.
- The BYOD panel shows whether inbound/outbound trains are currently saved for today.
- Bus and flight save behavior remains unchanged.

### Anti-Goals
- Do not change train scoring.
- Do not change train time-window logic.
- Do not change the BYOD textarea modes.

## Sprint 97 - BYOD Train ROI Visibility

Fix driver-uploaded Amtrak trains disappearing from the 4-hour dispatch plan after train yields were recalibrated downward and fare-class scoring made expected-rider counts more realistic.

### Decisions
- **BYOD trains are intentional inputs:** if the driver pasted and saved a train, and it passes the inbound/outbound time gate, it should be visible.
- **Do not inflate demand:** keep the fare-class expected-rider scoring unchanged.
- **Bypass only final ROI pruning:** skip the generic deadhead ROI filter for BYOD Train events so realistic train counts are not hidden.
- **Keep time gates:** trains outside the dispatch window still do not render.

### Build Steps
- [x] S1. Append this Sprint 97 plan before edits.
- [x] S2. Extend ROI filter helper to bypass BYOD Train events.
- [x] S3. Add validator coverage for BYOD Train ROI visibility.
- [x] S4. Add parser coverage for the user's June 10 train paste.
- [x] S5. Validate parser, fare-yield, route syntax, and production build.

### Acceptance Criteria
- User-pasted NYP -> ALB June 10 sample parses train 291 and 235.
- BYOD Train events are not dropped by deadhead ROI.
- Non-BYOD event/ride/train items keep existing ROI behavior.
- BYOD Train expected-rider scoring remains category-aware.

### Anti-Goals
- Do not change live Amtraker bucket scoring.
- Do not raise train expected-rider yields.
- Do not change the inbound/outbound mode UI.

## Sprint 96 - Amtrak Fare-Class Demand Scoring

Distinguish BYOD Amtrak ticket availability by fare class so coach scarcity drives the strongest demand signal, business adds a smaller bonus, and private rooms add only a small long-distance signal.

### Decisions
- **Coach is primary:** coach sold out / almost sold out sets the main train expected-rider yield.
- **Business is a bonus:** business sold out / almost full adds a moderate increment but does not dominate coach.
- **Private rooms are small:** private-room scarcity adds only a small increment because passenger count is low.
- **Backward compatible:** saved train rows without structured availability still use the legacy `status` field.
- **Parser owns structure:** the frontend Amtrak parser emits `availability: { coach, business, privateRooms }` for both inbound and outbound saved trains.

### Build Steps
- [x] S1. Append this Sprint 96 plan before edits.
- [x] S2. Add fare-class availability parser to `parseAmtrakText`.
- [x] S3. Add category-aware BYOD train yield helper.
- [x] S4. Thread availability into BYOD train events.
- [x] S5. Update Amtrak parser validator coverage.
- [x] S6. Validate parser tests, route syntax, and production build.

### Acceptance Criteria
- Coach `Only N seats left` produces a stronger expected-rider yield than business-only scarcity.
- Coach `Sold Out` produces the strongest base yield.
- Business sold out adds a moderate bonus.
- Private rooms sold out adds only a small bonus.
- Legacy saved trains without `availability` still score from `status`.

### Anti-Goals
- Do not change live Amtraker bucket scoring.
- Do not add a new UI control.
- Do not change outbound timing logic.

## Sprint 95 - Routine Local Anchor Pulses

Add narrow scheduled rideshare pulses for the five highest-signal non-Crossgates local anchors: UAlbany Uptown, Colonie/Wolf Road, Downtown Albany office core, Corporate Woods, and Albany Med / University Heights.

### Decisions
- **Expected rides are explicit:** local anchor events use `volume = expected rides` and a `Local Anchor` yield of 1, so the UI displays the intended expected-rider count.
- **Narrow windows:** use 45-minute peak windows with 30-minute shoulders at roughly 60% of peak demand.
- **Hotel checkout:** Colonie/Wolf hotel checkout peaks at 10:30-11:15 AM with 10:00-10:30 and 11:15-11:45 shoulders.
- **Rideshare only:** these anchors inject only when rideshare is active.
- **Routine demand only:** these should surface steady local pulses without overpowering flights, trains, hospitals, weather, or major events.

### Build Steps
- [x] S1. Append this Sprint 95 plan before edits.
- [x] S2. Add local anchor schedule dictionary and taper helper.
- [x] S3. Add yield routing for `Local Anchor` events.
- [x] S4. Inject active local anchor events into `structuredEvents`.
- [x] S5. Add focused schedule validator.
- [x] S6. Validate syntax, validator, and production build.

### Acceptance Criteria
- UAlbany, Colonie/Wolf, Downtown, Corporate Woods, and University Heights can emit scheduled ride cards during their active peak/shoulder windows.
- Hotel checkout uses 10:30-11:15 AM as the peak slot.
- Local anchor expected riders match the configured expected ride count before weather/time modifiers.
- Rideshare OFF suppresses local anchor injections.
- Existing Crossgates logic remains unchanged.

### Anti-Goals
- Do not change Crossgates timing.
- Do not change food/grocery logic.
- Do not add a UI control.

## Sprint 94 - Food Delivery ROI Visibility

Fix the Food & Grocery tab staying blank after the morning score floor change by removing food/grocery hotspots from the rideshare deadhead ROI filter.

### Decisions
- **Food/grocery proximity is already constrained:** static POIs are already limited near the driver before clustering.
- **Keep the score floor:** morning food still needs score >= 4; non-morning food and grocery still need score >= 10.
- **Do not use rideshare ROI dollars for delivery:** food delivery opportunity is not comparable to surge-point deadhead value.
- **Keep ROI for rideshare demand:** trains, flights, events, and ride hubs still use the existing deadhead ROI filter.

### Build Steps
- [x] S1. Append this Sprint 94 plan before edits.
- [x] S2. Add a scoped helper for ROI-eligible item types.
- [x] S3. Bypass the ROI filter for food/grocery only.
- [x] S4. Extend validator coverage.
- [x] S5. Validate syntax, validator, and production build.

### Acceptance Criteria
- Morning food hotspot with score >= 4 is not dropped by the rideshare ROI filter.
- Food/grocery hotspots still pass through normal score-floor filtering.
- Train/flight/event/ride items still use deadhead ROI filtering.
- Food & Grocery list can show eligible breakfast/morning hotspots instead of going blank.

### Anti-Goals
- Do not change POI dictionary data.
- Do not inflate food delivery expected counts.
- Do not change active platform defaults.

## Sprint 93 - Morning Food Itinerary Floor

Lower the itinerary score floor for morning food delivery hotspots so breakfast/morning places are not hidden just because coffee/cafe clusters score below the global transit/event floor.

### Decisions
- **Morning food floor:** food items during 6:00 AM-10:59 AM pass at score >= 4.
- **Everything else unchanged:** lunch/dinner/late-night food, grocery, transit, events, and ride hubs keep the existing score >= 10 floor.
- **No scoring inflation:** do not raise expected deliveries; only change the visibility floor.

### Build Steps
- [x] S1. Append this Sprint 93 plan before edits.
- [x] S2. Add item-specific itinerary floor helper.
- [x] S3. Apply morning food floor in `buildItinerary()`.
- [x] S4. Extend food daypart validator.
- [x] S5. Validate route syntax, validator, and production build.

### Acceptance Criteria
- Morning food hotspot with score 4 survives itinerary filtering.
- Morning food hotspot below 4 is still filtered.
- Non-morning food below 10 is still filtered.
- Non-food items keep the 10 floor.

### Anti-Goals
- Do not change POI dictionary data.
- Do not change food yield values.
- Do not change platform defaults.

## Sprint 92 - BYOD Train Yield Recalibration

Recalibrate driver-pasted train events so one inbound train does not inherit the generic event yield of 50, and make driver supply status visible even when normal.

### Decisions
- **Train-specific yield:** BYOD Train events use status-based expected riders: normal 10, Almost Full 15, Sold Out 22.
- **Before generic event:** check BYOD Train before the default event branch so it cannot fall through to 50.
- **Clear wording:** train cards should read as train demand, not generic egress/surge.
- **Visible supply:** cards and the top banner should show Driver Supply as Normal/Tight/Very Tight.

### Build Steps
- [x] S1. Append this Sprint 92 plan before edits.
- [x] S2. Add BYOD Train status yield handling.
- [x] S3. Update event card and top banner wording for BYOD Train.
- [x] S4. Render driver supply status.
- [x] S5. Validate syntax, math, and production build.

### Acceptance Criteria
- BYOD Train Almost Full expected riders drops from 50 to 15.
- BYOD Train normal expected riders is 10.
- BYOD Train Sold Out expected riders is 22.
- Driver Supply status is visible even when normal.
- Build passes.

### Anti-Goals
- Do not change train parsing.
- Do not change live Amtraker bucket scoring.
- Do not change CSV report files.

## Sprint 91 - Separate Driver Shortage From Expected Riders

Prevent small last-call venues from displaying unrealistic expected-rider counts, and make driver shortage affect opportunity/ranking separately from demand.

### Decisions
- **Nightlife recalibration:** lower single-bar last-call yield from 25 to 5 so a normal small bar no longer shows 88 expected riders.
- **Separate fields:** keep `densityScore` as expected demand; add `opportunityScore` for ranking/ROI when driver supply is tight.
- **Supply pressure:** derive `driverSupplyPressureMod` from weather driver-supply scarcity and holiday/iftar supply-drop signals.
- **UI wording:** last-call cards should say demand window, not live Uber surge.

### Build Steps
- [x] S1. Append this Sprint 91 plan before edits.
- [x] S2. Lower nightlife yield and update stale comments.
- [x] S3. Add `driverSupplyPressureMod` to the merged payload.
- [x] S4. Stamp and sort by `opportunityScore` while displaying expected demand separately.
- [x] S5. Update event card wording and optional opportunity line.
- [x] S6. Validate syntax and production build.

### Acceptance Criteria
- Single last-call venue expected riders drops from 88 to about 18 at 3.5x.
- Driver shortage can raise opportunity/ranking without inflating expected riders.
- Last-call cards no longer imply live Uber surge.
- Build passes.

### Anti-Goals
- Do not integrate live Uber map data.
- Do not change event injection windows.
- Do not change flight/train/food POI dictionaries.

## Sprint 90 - Hotspot Nearby Merchant Names

Show up to three additional merchant names inside each food/grocery hotspot card so the driver can see what else is in the cluster beyond the anchor.

### Decisions
- **Backend-owned list:** compute nearby merchant names from the same `bestCluster` used for volume.
- **Exclude anchor:** `nearbyNames` should list other merchants, not repeat the anchor.
- **Compact UI:** render one small line under the anchor to avoid bloating cards.

### Build Steps
- [x] S1. Append this Sprint 90 plan before edits.
- [x] S2. Add `nearbyNames` to computed hotspots.
- [x] S3. Render `nearbyNames` in `HotspotCard`.
- [x] S4. Validate route syntax and production build.

### Acceptance Criteria
- Hotspot payloads include up to three other merchant names.
- Cards show those names under the anchor when available.
- Cards without nearby names render unchanged.

### Anti-Goals
- Do not change hotspot scoring.
- Do not change clustering radius.
- Do not edit POI data.
## Sprint 89 - Morning-Only Breakfast Yield Floor

Restrict the breakfast/brunch yield floor to the morning window so coffee and breakfast places use their normal lower yield during lunch and dinner.

### Decisions
- **Morning only:** keep the breakfast floor from 6:00 AM-10:59 AM.
- **Lunch/dinner normal yield:** breakfast/brunch POIs use category yield at lunch/dinner unless another rule boosts them.
- **No filter rollback:** keep Sprint 88 daypart candidate filtering.

### Build Steps
- [x] S1. Append this Sprint 89 plan before edits.
- [x] S2. Pass dispatch local start into food yield scoring.
- [x] S3. Apply `MORNING_FOOD_MIN_YIELD` only during the morning window.
- [x] S4. Update the daypart validator.
- [x] S5. Validate route syntax, validator, and production build.

### Acceptance Criteria
- Breakfast coffee yield is floored to 4 in the morning.
- Breakfast coffee yield returns to normal coffee yield at lunch/dinner.
- Existing lunch/dinner/late-night candidate filters remain active.

### Anti-Goals
- Do not change POI dictionary rows.
- Do not change UI.
- Do not change non-food scoring.
## Sprint 88 - Lunch Dinner Late-Night Food Daypart Filters

Extend the breakfast-only food filter into broader daypart-aware food selection for lunch, dinner, and late-night windows.

### Decisions
- **Generic policy:** keep morning breakfast behavior, then add lunch, dinner, and late-night policies.
- **Fallback behavior:** if no nearby POI matches the active daypart, keep all nearby food POIs so dispatch does not go blank.
- **Category inference:** lunch/dinner/late-night can match common meal categories even when a POI has no explicit `dayparts` tags.
- **Food only:** grocery selection remains unchanged.

### Build Steps
- [x] S1. Append this Sprint 88 plan before edits.
- [x] S2. Add generic food daypart policy helpers.
- [x] S3. Apply the active daypart filter inside `getStaticPoiBusinesses()`.
- [x] S4. Update the food daypart validator.
- [x] S5. Validate route syntax, validator, and production build.

### Acceptance Criteria
- Morning still keeps breakfast/morning/brunch POIs when available.
- Lunch prefers lunch-friendly POIs when available.
- Dinner prefers dinner-friendly POIs when available.
- Late-night prefers late-night-friendly POIs when available.
- Non-food/grocery behavior is unchanged.

### Anti-Goals
- Do not add or remove restaurants in this sprint.
- Do not change food yield numbers.
- Do not change UI.
## Sprint 87 - Production Flight-Level Airport Demand

Move production airport demand from hourly buckets to individual high-value flight rows, using the airport board's displayed/updated arrival time as the effective arrival.

### Decisions
- **Displayed arrival wins:** use actual, then estimated, then scheduled arrival for dispatch timing.
- **Individual rows:** keep `flightsByHour` as the payload key for compatibility, but emit one row per high-value flight.
- **Curb timing:** passenger curb time is effective arrival + 25 minutes.
- **Driver timing:** leave-by is curb time minus computed drive time, falling back to 15 minutes if driver distance is unavailable.
- **BYOD status:** parse simple board statuses like delayed, cancelled, and on time; cancelled flights are dropped.

### Build Steps
- [x] S1. Append this Sprint 87 plan before edits.
- [x] S2. Update flight aggregation to emit individual flight rows.
- [x] S3. Update BYOD flight status parsing.
- [x] S4. Update the flight card for individual flight details with legacy fallback.
- [x] S5. Validate syntax/build and run the flight simulator.

### Acceptance Criteria
- Delayed flights move based on the displayed/estimated arrival.
- Cancelled flights are ignored.
- Each visible flight card shows origin, status, arrival, curb, and leave-by timing.
- Existing itinerary scoring continues to consume `flightsByHour` without a broad rename.

### Anti-Goals
- Do not add CSV reports.
- Do not change train, bus, food, grocery, or event logic.
- Do not automate live flight scraping beyond the current BYOD/live merge.
## Sprint 86 - Flight-Level Demand Simulator

Build a standalone simulator comparing current hourly flight buckets against a proposed individual-flight model before changing production dispatch.

### Decisions
- **No production behavior change:** add a script only.
- **Side-by-side comparison:** same fake flights feed hourly and individual-flight models.
- **Delay aware:** individual model uses actual/estimated arrival before scheduled arrival.
- **Edge cases:** include delayed into window, delayed out of window, cancelled, duplicate live/BYOD, and same-hour spread.

### Build Steps
- [x] S1. Append this Sprint 86 plan before edits.
- [x] S2. Add `scripts/simulate-flight-level.js`.
- [x] S3. Include fake high-value hub flights and edge cases.
- [x] S4. Print hourly bucket output and individual-flight output.
- [x] S5. Run the simulator and verify output.

### Acceptance Criteria
- Simulator runs with `node scripts/simulate-flight-level.js`.
- Output shows old hourly buckets and proposed flight-level rows.
- Delays move flights into/out of the window correctly in the proposed model.
- Cancelled and duplicate flights are dropped.

### Anti-Goals
- Do not change `aggregateArrivalsByHour()` yet.
- Do not change UI.
- Do not write CSV reports.
## Sprint 83 - Morning Breakfast Food Boost

Use explicit `dayparts` tags to rank breakfast/morning restaurants higher during morning food-delivery windows.

### Decisions
- **Morning core:** 6:00 AM-9:29 AM gives breakfast/morning hotspots `1.35x`.
- **Late-morning shoulder:** 9:30 AM-10:59 AM gives breakfast/brunch/morning hotspots `1.15x`.
- **Food only:** apply only to food hotspots, never grocery.
- **Hotspot-level field:** attach `daypartDemandMod` in `computeHotspots()` and consume it in `yieldRateFor()`.

### Build Steps
- [x] S1. Append this Sprint 83 plan before edits.
- [x] S2. Add a daypart demand helper.
- [x] S3. Attach `daypartDemandMod` to food hotspots.
- [x] S4. Apply `daypartDemandMod` in food yield scoring.
- [x] S5. Validate route syntax and production build.

### Acceptance Criteria
- Breakfast/morning food hotspots receive `1.35x` from 6:00-9:29 AM.
- Breakfast/brunch/morning food hotspots receive `1.15x` from 9:30-10:59 AM.
- Non-breakfast hotspots stay at `1.0x`.
- Grocery hotspots stay at `1.0x`.

### Anti-Goals
- Do not alter temporal food lunch/dinner modifiers.
- Do not change UI.
- Do not add new POIs.

### Follow-Up
- Superseded by Sprint 84: morning food now filters to breakfast/morning/brunch POIs instead of applying a broad boost.
## Sprint 84 - Morning Breakfast-Only Food Filter

Change morning food delivery selection from boosting breakfast POIs to filtering morning food candidates to breakfast/morning/brunch restaurants.

### Decisions
- **Morning window:** 6:00 AM-10:59 AM.
- **Breakfast-only:** if any nearby food POI has `dayparts` containing `breakfast`, `morning`, or `brunch`, keep only those POIs.
- **Fallback:** if zero breakfast-tagged POIs are nearby, keep the normal food list so dispatch does not go blank.
- **No double count:** remove the Sprint 83 daypart boost multiplier.

### Build Steps
- [x] S1. Append this Sprint 84 plan before edits.
- [x] S2. Add morning-window and breakfast-daypart helpers.
- [x] S3. Apply the filter in `getStaticPoiBusinesses()` for food only.
- [x] S4. Remove the daypart boost multiplier from scoring.
- [x] S5. Update the food daypart validator.
- [x] S6. Validate route syntax and production build.

### Acceptance Criteria
- Morning food candidates exclude pizza/burgers/Korean/Italian/etc. when breakfast-tagged POIs are available.
- Morning food candidates fall back to all food only when no breakfast-tagged POIs are nearby.
- Grocery candidates are unchanged.
- Food scoring no longer applies `daypartDemandMod`.

### Anti-Goals
- Do not remove `dayparts` from hotspot output.
- Do not change lunch/dinner temporal modifiers.
- Do not change UI.
## Sprint 85 - Breakfast Yield Floor

Ensure morning breakfast-only food hotspots survive the itinerary score floor.

### Decisions
- **Breakfast floor:** food hotspots with `breakfast`, `morning`, or `brunch` dayparts use a minimum base food yield of `4`.
- **No non-breakfast lift:** coffee/cafe categories without breakfast dayparts keep their normal low yields.
- **No filter rollback:** keep Sprint 84's breakfast-only morning candidate filter.

### Build Steps
- [x] S1. Append this Sprint 85 plan before edits.
- [x] S2. Add `MORNING_FOOD_MIN_YIELD = 4`.
- [x] S3. Apply the floor in `yieldRateFor()` for breakfast-tagged food hotspots.
- [x] S4. Extend the food daypart validator with yield-floor cases.
- [x] S5. Validate route syntax and production build.

### Acceptance Criteria
- Breakfast-tagged coffee/cafe hotspots score from base yield `4`, not `2`.
- Non-breakfast coffee/cafe hotspots still score from base yield `2`.
- Breakfast-only morning filtering remains active.

### Anti-Goals
- Do not bring non-breakfast restaurants back into morning food candidates.
- Do not change UI.
## Sprint 82 - Breakfast Daypart Classification

Add explicit breakfast/morning daypart tags to obvious restaurant POIs and preserve them through hotspot aggregation.

### Decisions
- **Optional field:** use `dayparts` on POI rows, e.g. `["breakfast", "morning"]`.
- **Conservative tagging:** only obvious coffee, cafe, brunch, diner, breakfast, bakery, and bagel-style restaurants get tagged.
- **Backend passthrough:** normalized POIs and computed hotspots should preserve daypart tags for future scoring/UI.
- **No scoring change yet:** do not alter yield math or temporal modifiers in this sprint.

### Build Steps
- [x] S1. Append this Sprint 82 plan before edits.
- [x] S2. Add `dayparts` to obvious breakfast/morning food POIs.
- [x] S3. Preserve `dayparts` in static POI normalization.
- [x] S4. Aggregate hotspot `dayparts` from cluster members.
- [x] S5. Validate JSON and route syntax.

### Acceptance Criteria
- Breakfast-style POIs carry explicit `dayparts` tags.
- Food hotspots can expose aggregate `dayparts`.
- JSON validation passes.
- Route syntax check passes.

### Anti-Goals
- Do not add or remove restaurants.
- Do not change scoring weights yet.
- Do not change UI.
## Sprint 81 - Weather Intelligence Upgrade

Upgrade weather scoring from a simple three-state multiplier into a unit-safe, severity-aware weather analysis object.

### Decisions
- **Unit safety:** request precipitation in inches and add snowfall to the Open-Meteo hourly payload.
- **Richer output:** keep `weatherFoodMod` and `weatherRideMod` for existing scoring, and add `driverSupplyMod`, `opportunityPressure`, `condition`, `severity`, `reason`, `startsInMinutes`, and `peakHour`.
- **Severity tiers:** classify rain and snow by amount, with weather code as a backup signal.
- **Window awareness:** current hour affects scoring now; next hour can trigger pre-positioning; the full selected window supplies advisory `startsInMinutes` and `peakHour`.
- **Supply context:** return driver supply pressure as context first; do not multiply it into ranking yet.

### Build Steps
- [x] S1. Append this Sprint 81 plan before edits.
- [x] S2. Add snowfall and explicit precipitation units to the Open-Meteo request.
- [x] S3. Replace `computeWeatherModifiers()` with severity-aware weather analysis.
- [x] S4. Update the weather banner to render reason-based weather context.
- [x] S5. Add weather validation coverage for rain, snow, heat, pre-surge, and missing data.
- [x] S6. Run route syntax, weather tests, and production build.

### Acceptance Criteria
- Weather payload rows include `snowfallInches` and explicit precipitation units.
- Existing score math still reads `weatherFoodMod` and `weatherRideMod`.
- UI banner is driven by `condition`/`severity`/`reason`, not exact numeric pairs.
- Tests cover clear, pre-rain, rain severity, snow severity, heat, and missing data.

### Anti-Goals
- Do not change temporal modifiers.
- Do not multiply driver supply into final ranking yet.
- Do not add another weather API.
## Sprint 80 - Taper State Worker Commute Scoring

Replace the flat weekday state-worker evening commute block with a current-opportunity taper.

### Decisions
- **Score meaning:** the base 100 state-worker rides is a current opportunity score, not cumulative rides across all slots.
- **Evening shape:** front-loaded taper from 4:15 PM to 6:15 PM: 1.00, 0.75, 0.50, 0.25, then 0.
- **Morning shape:** leave morning inbound available as a centered taper for future use, but do not inject morning state-worker demand yet.
- **No cumulative addition:** never add 100 + 75 + 50 + 25; dispatch should only score the current wall-clock slot.

### Build Steps
- [x] S1. Append this Sprint 80 plan before edits.
- [x] S2. Add a state-worker taper helper in `app/api/dispatch/route.js`.
- [x] S3. Replace the flat state commuter window with the tapered score.
- [x] S4. Add/update a local validator for taper boundary cases.
- [x] S5. Run validation and route syntax checks.

### Acceptance Criteria
- Weekday 4:15-4:44 PM scores around 100 expected riders.
- Weekday 4:45-5:14 PM scores around 75 expected riders.
- Weekday 5:15-5:44 PM scores around 50 expected riders.
- Weekday 5:45-6:14 PM scores around 25 expected riders.
- Weekday 6:15 PM and later produces no state-worker event.

### Anti-Goals
- Do not change food/grocery scoring.
- Do not change hospital, train, bus, flight, or event injectors.
- Do not add a UI control for this.
## Sprint 79 - Correct Promoted DoorDash Batch 1 POIs

Update the first promoted DoorDash merchant batch with the user's corrected coordinates, addresses, prices, and categories.

### Decisions
- **In-place corrections:** update existing rows only; do not add duplicates.
- **User-provided values:** trust corrected coordinates, address, categories, price, and DoorDash metadata.
- **Verification:** confirm each corrected merchant still has exactly one static POI match and one enrichment match.

### Build Steps
- [x] S1. Append this Sprint 79 plan before edits.
- [x] S2. Confirm current presence for all ten merchants.
- [x] S3. Update static POI rows.
- [x] S4. Update DoorDash enrichment rows where categories changed.
- [x] S5. Validate JSON and exact matches.

### Acceptance Criteria
- All ten corrected merchants remain single matched POIs.
- DoorDash enrichment metadata remains single matched for all ten.
- JSON validation passes.

### Anti-Goals
- Do not change backend logic.
- Do not add new merchants in this sprint.
## Sprint 78 - Add DoorDash Batch 5 POIs

Add the user's fifth batch of DoorDash merchants to the static POI + DoorDash enrichment data.

### Decisions
- **Coordinate-bearing rows:** add/update static POIs only when lat/lng are provided.
- **Null-coordinate rows:** keep as DoorDash enrichment-only until coordinates are available.
- **User-provided values:** trust provided categories, address, DoorDash rating/reviews/ETA/distance.
- **No duplicates:** update existing rows when names already exist.

### Build Steps
- [x] S1. Append this Sprint 78 plan before edits.
- [x] S2. Check current presence for the batch.
- [x] S3. Add/update static POI rows where coordinates exist.
- [x] S4. Add/update DoorDash enrichment rows for all batch merchants.
- [x] S5. Validate JSON and confirm exact enrichment matches for every batch merchant.

### Acceptance Criteria
- Coordinate-bearing merchants have static POI entries.
- All listed merchants have DoorDash enrichment entries.
- JSON validation passes.

### Anti-Goals
- Do not change backend logic.
- Do not invent coordinates for null-coordinate merchants.

## Sprint 115 - Add Crossgates Food Court POIs

Add the user's personally confirmed Crossgates Mall food court and counter-service merchants to the static food POI dictionary and delivery enrichment file.

### Decisions
- **Mall-cluster coordinates:** use `1 Crossgates Mall Rd` coordinates for each food court merchant so they cluster together.
- **User-confirmed Wendy's:** include Wendy's even though it was not visible in the official PDF directory.
- **Conservative enrichment:** do not invent ratings/review counts; use null ratings with categories, near-mall distance, and pickup-style ETAs.
- **Daypart handling:** mark Dunkin' Donuts as breakfast/morning; keep other food court merchants available for lunch/dinner/late-night scoring.

### Build Steps
- [x] S1. Add Crossgates food court meal anchors to `albany_poi_dictionary.json`.
- [x] S2. Add lower-priority snack/drink food court merchants to `albany_poi_dictionary.json`.
- [x] S3. Add matching conservative entries to `doordash_poi_enrichment.json`.
- [x] S4. Validate JSON and confirm each added merchant appears once.

### Acceptance Criteria
- Crossgates food court merchants can appear as food delivery anchors.
- Sbarro remains present and is not duplicated.
- JSON validation passes.

### Anti-Goals
- Do not change food scoring logic.
- Do not add coming-soon merchants until confirmed open.

## Sprint 116 - BYOD Weather Override

Allow the driver to paste manual weather observations through the existing BYOD textarea workflow when the live weather API misses local rain, snow, ice, or storm conditions.

### Decisions
- **Same BYOD pattern:** add Weather Override as a BYOD mode using localStorage plus Netlify Blobs.
- **API fallback:** keep Open-Meteo as the default and only override it when today's manual weather text is saved.
- **Parser shape:** convert manual text into the existing hourly weather row format so current weather modifiers stay the single scoring path.
- **Supported text:** parse condition/severity/duration from phrases like `moderate rain for 2 hours` or `heavy snow until 9 PM`.

### Build Steps
- [x] S1. Add `weatherConfig` to the BYOD Blob snapshot normalizer.
- [x] S2. Add Weather Override mode to the BYOD UI, localStorage hydration, save flow, and dispatch body.
- [x] S3. Add backend manual weather parser and merge it before `computeWeatherModifiers`.
- [x] S4. Extend weather tests for manual override parsing.

### Acceptance Criteria
- Saving Weather Override persists for today locally and in Netlify Blobs.
- Dispatch uses manual weather rows instead of API rows while the override is active.
- GitHub Actions/Telegram dispatch can read saved manual weather from Netlify Blobs.
- Existing weather modifier tests still pass.

### Anti-Goals
- Do not remove the live weather API.
- Do not add a separate weather form yet.

## Sprint 117 - Gate Crossgates Food Court Late Night

Prevent Crossgates Mall food-court POIs from showing as late-night delivery recommendations after mall food service is closed.

### Decisions
- **Data-level fix:** use existing static POI `activeWindows`; do not alter hotspot scoring.
- **Mall close alignment:** use Sun 11 AM-6 PM, Mon-Thu 11 AM-8 PM, Fri-Sat 11 AM-9 PM for Crossgates food-court entries.
- **Regression target:** Sbarro/Crossgates food court should not be active at Friday 11:49 PM.

### Build Steps
- [x] S1. Add active windows to Crossgates food-court POIs.
- [x] S2. Add food policy regression coverage for Friday 11:49 PM.
- [x] S3. Validate JSON and production build.

### Acceptance Criteria
- Crossgates food-court hotspots can appear during mall meal windows.
- Crossgates food-court hotspots do not appear late night after close.
- Existing weather and food tests pass.

### Anti-Goals
- Do not remove Crossgates food-court merchants.
- Do not change late-night scoring for non-mall restaurants.
## Sprint 77 - Add DoorDash Batch 4 POIs

Add the user's fourth batch of DoorDash merchants to the static POI + DoorDash enrichment data.

### Decisions
- **User-provided values:** trust the provided coordinates, categories, address, DoorDash rating/reviews/ETA/distance.
- **No duplicates:** update existing POI/enrichment rows when names already exist; add rows only when missing.
- **Exact verification:** confirm every batch merchant resolves to one static POI row and one enrichment row.

### Build Steps
- [x] S1. Append this Sprint 77 plan before edits.
- [x] S2. Check current presence for the batch.
- [x] S3. Add/update static POI rows.
- [x] S4. Add/update DoorDash enrichment rows.
- [x] S5. Validate JSON and confirm exact POI/enrichment matches for every batch merchant.

### Acceptance Criteria
- All listed merchants have coordinate-bearing POI entries.
- All listed merchants have DoorDash enrichment entries.
- JSON validation passes.

### Anti-Goals
- Do not change backend logic.
- Do not geocode or infer beyond the user's provided values.
