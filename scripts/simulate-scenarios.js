// Sprint 68: Density Profiler (Scenario Simulator).
//
// Standalone backend CLI. Feeds 6 hardcoded extreme scenarios into the LIVE
// scoring helpers exported from app/api/dispatch/route.js and writes
// density-report.csv to project root for offline weight-tuning.
//
// Math source: imports `densityScore`, `yieldRateFor`, `capacityFor`,
// `computeWeatherModifiers`, `computeTemporalModifiers` from the production
// route handler — no duplicated math (Sprint 68 §3B). The route file only
// exports POST in production; the additional named exports are inert to
// Next.js and exist solely so this simulator stays in lockstep with the live
// engine.
//
// CSV columns (per Sprint 68 §3C):
//   Scenario Name, Base Score, Weather Modifier, Event/Holiday Modifier,
//   Final Density Score
//
//   Base Score             = Σ densityScore(item, 1.0, 1.0) across items
//   Weather Modifier       = weatherRideMod from computeWeatherModifiers
//   Event/Holiday Modifier = holidayMod × MAX(egressMod across items)
//   Final Density Score    = Σ densityScore(item, finalRideMod, finalFoodMod)
//                            where final mods = temporal × weather × holiday
//
// Run: `node scripts/simulate-scenarios.js` from project root.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ROUTE_URL = "file://" + path.join(ROOT, "app", "api", "dispatch", "route.js").replace(/\\/g, "/");
const OUTPUT = path.join(ROOT, "density-report.csv");

// CJS → ESM bridge: package.json has no "type": "module", so this entry
// stays CJS for predictability while route.js (ESM) loads via dynamic
// import().
(async () => {
  // Sprint 70: capacityFor deleted from production. Simulator imports only
  // the surviving helpers.
  const {
    densityScore,
    yieldRateFor,
    computeWeatherModifiers,
    computeTemporalModifiers,
  } = await import(ROUTE_URL);

  // ---- Scenarios ---------------------------------------------------------
  // Each scenario builds representative scoreable items in the same shape
  // buildItinerary feeds densityScore. dispatchDate is constructed UTC-fields
  // = wall-clock so computeTemporalModifiers reads the intended hour/day
  // (mirrors the `localStart` pattern in route.js).

  const wallClock = (year, monthIdx, day, hour, minute = 0) =>
    new Date(Date.UTC(year, monthIdx, day, hour, minute));

  const clearWeather = [
    { tempF: 68, precipChancePct: 0, precipInches: 0 },
    { tempF: 68, precipChancePct: 0, precipInches: 0 },
  ];
  const blizzard = [
    { tempF: 22, precipChancePct: 100, precipInches: 0.8 },
    { tempF: 21, precipChancePct: 100, precipInches: 0.9 },
  ];

  // Representative items (matched to route.js item shape)
  const soloFlightItem = {
    type: "flight",
    volume: 1,
    hub: "ALB",
  };
  const trainItem = {
    type: "train",
    volume: 1,
    hub: "Rensselaer",
  };
  const lastCallNightlifeItem = {
    type: "event",
    volume: 1,
    location: "Downtown Bar Cluster",
    categories: ["Last Call", "Nightlife Egress"],
    egressMod: 3.5,
  };
  const mvpArenaEgressItem = {
    type: "event",
    volume: 1,
    location: "MVP Arena",
    categories: ["Sports"],
    egressMod: 2.5,
  };

  const scenarios = [
    {
      name: "Calm Tuesday",
      dispatchDate: wallClock(2026, 5, 2, 14, 0), // Tue 2 PM
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [soloFlightItem],
    },
    {
      name: "Friday Bar Rush",
      dispatchDate: wallClock(2026, 5, 5, 23, 30), // Fri 11:30 PM
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [lastCallNightlifeItem],
    },
    {
      name: "MVP Arena Egress",
      dispatchDate: wallClock(2026, 5, 6, 22, 0), // Sat 10 PM
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [mvpArenaEgressItem],
    },
    {
      name: "Severe Winter Snowstorm",
      dispatchDate: wallClock(2026, 1, 3, 14, 0), // Tue 2 PM, Feb
      weatherArray: blizzard,
      holidayMod: 1.0,
      items: [soloFlightItem],
    },
    {
      name: "Thanksgiving Eve",
      dispatchDate: wallClock(2026, 10, 25, 18, 0), // Wed before Thanksgiving, 6 PM
      weatherArray: clearWeather,
      holidayMod: 1.5,
      items: [soloFlightItem],
    },
    {
      name: "The Perfect Storm",
      dispatchDate: wallClock(2026, 1, 7, 22, 0), // Sat 10 PM, Feb
      weatherArray: blizzard,
      holidayMod: 1.0,
      items: [mvpArenaEgressItem, trainItem, trainItem],
    },
  ];

  // ---- Compute -----------------------------------------------------------
  const round2 = (n) => Math.round(n * 100) / 100;

  const rows = scenarios.map((sc) => {
    const { foodMod: tFood, rideMod: tRide } = computeTemporalModifiers(sc.dispatchDate);
    const { weatherFoodMod, weatherRideMod } = computeWeatherModifiers(sc.weatherArray);

    const finalRideMod = tRide * weatherRideMod * sc.holidayMod;
    const finalFoodMod = tFood * weatherFoodMod * sc.holidayMod;

    const baseSum = sc.items.reduce(
      (acc, it) => acc + densityScore(it, 1.0, 1.0),
      0
    );
    const finalSum = sc.items.reduce(
      (acc, it) => acc + densityScore(it, finalRideMod, finalFoodMod),
      0
    );

    const maxEgress = sc.items.reduce(
      (m, it) => Math.max(m, Number(it.egressMod) || 1.0),
      1.0
    );
    const eventHolidayMod = sc.holidayMod * maxEgress;

    return {
      name: sc.name,
      base: round2(baseSum),
      weather: round2(weatherRideMod),
      eventHoliday: round2(eventHolidayMod),
      final: round2(finalSum),
    };
  });

  // ---- Per-item sanity log. Sprint 70: capacity column dropped since the
  // raw-yield formula no longer consults it.
  console.log("Scenario item breakdown (yield / base score):");
  for (const sc of scenarios) {
    console.log(`  ${sc.name}`);
    for (const it of sc.items) {
      const y = yieldRateFor(it);
      const d = densityScore(it, 1.0, 1.0);
      console.log(
        `    type=${it.type} vol=${it.volume} yield=${y} base=${round2(d)}`
      );
    }
  }

  // ---- CSV ---------------------------------------------------------------
  const header = [
    "Scenario Name",
    "Base Score",
    "Weather Modifier",
    "Event/Holiday Modifier",
    "Final Density Score",
  ].join(",");
  const body = rows
    .map((r) => [r.name, r.base, r.weather, r.eventHoliday, r.final].join(","))
    .join("\n");
  const csv = header + "\n" + body + "\n";

  fs.writeFileSync(OUTPUT, csv, "utf8");
  console.log(`\nWrote ${OUTPUT} (${rows.length} scenarios).`);
})().catch((err) => {
  console.error("Simulator failed:", err);
  process.exit(1);
});
