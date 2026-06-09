// Sprint 81 - Weather Intelligence validator.
//
// Imports the production computeWeatherModifiers helper so tests stay tied
// to the live dispatch math.

const path = require("node:path");

const routeUrl =
  "file://" +
  path
    .join(__dirname, "app", "api", "dispatch", "route.js")
    .replace(/\\/g, "/");

(async () => {
  const { computeWeatherModifiers } = await import(routeUrl);

  const row = (overrides = {}) => ({
    time: "2026-06-09T12:00",
    tempF: 70,
    precipChancePct: 0,
    precipInches: 0,
    snowfallInches: 0,
    weatherCode: 0,
    ...overrides,
  });

  const cases = [
    {
      name: "Clear baseline",
      weather: [row(), row({ time: "2026-06-09T13:00" })],
      expect: { condition: "clear", severity: "clear", food: 1, ride: 1, supply: 1 },
    },
    {
      name: "Pre-rain within next hour",
      weather: [row(), row({ time: "2026-06-09T13:00", precipChancePct: 80, precipInches: 0.12 })],
      expect: { condition: "pre_rain", severity: "moderate", food: 1.05, ride: 1.2, supply: 1 },
    },
    {
      name: "Light rain active",
      weather: [row({ precipChancePct: 70, precipInches: 0.03 }), row()],
      expect: { condition: "rain", severity: "light", food: 1.15, ride: 1.05, supply: 0.95 },
    },
    {
      name: "Moderate rain active",
      weather: [row({ precipChancePct: 80, precipInches: 0.15 }), row()],
      expect: { condition: "rain", severity: "moderate", food: 1.35, ride: 1.1, supply: 0.85 },
    },
    {
      name: "Heavy rain active",
      weather: [row({ precipChancePct: 90, precipInches: 0.3 }), row()],
      expect: { condition: "rain", severity: "heavy", food: 1.6, ride: 1.2, supply: 0.75 },
    },
    {
      name: "Light snow active",
      weather: [row({ precipChancePct: 70, snowfallInches: 0.12, weatherCode: 71 }), row()],
      expect: { condition: "snow", severity: "light", food: 1.25, ride: 1.1, supply: 0.85 },
    },
    {
      name: "Moderate snow active",
      weather: [row({ precipChancePct: 80, snowfallInches: 0.4, weatherCode: 73 }), row()],
      expect: { condition: "snow", severity: "moderate", food: 1.5, ride: 1.2, supply: 0.7 },
    },
    {
      name: "Heavy snow active",
      weather: [row({ precipChancePct: 90, snowfallInches: 0.8, weatherCode: 75 }), row()],
      expect: { condition: "snow", severity: "heavy", food: 1.8, ride: 1.3, supply: 0.55 },
    },
    {
      name: "Heat active",
      weather: [row({ tempF: 92 }), row()],
      expect: { condition: "heat", severity: "moderate", food: 1.15, ride: 1.1, supply: 0.9 },
    },
    {
      name: "Missing weather data",
      weather: null,
      expect: { condition: "clear", severity: "clear", food: 1, ride: 1, supply: 1 },
    },
  ];

  let allPass = true;
  console.log("=== Sprint 81 Weather Intelligence - Test Run ===\n");
  for (const c of cases) {
    const got = computeWeatherModifiers(c.weather);
    const ok =
      got.condition === c.expect.condition &&
      got.severity === c.expect.severity &&
      got.weatherFoodMod === c.expect.food &&
      got.weatherRideMod === c.expect.ride &&
      got.driverSupplyMod === c.expect.supply;
    if (!ok) allPass = false;
    console.log(
      `${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify({
        condition: got.condition,
        severity: got.severity,
        food: got.weatherFoodMod,
        ride: got.weatherRideMod,
        supply: got.driverSupplyMod,
        reason: got.reason,
      })}`
    );
  }

  console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
  process.exit(allPass ? 0 : 1);
})();
