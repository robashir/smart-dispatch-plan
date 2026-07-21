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
  const { computeWeatherModifiers, parseManualWeatherOverrideText } = await import(routeUrl);

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

  const manualStart = new Date("2026-06-09T18:15:00.000Z");
  const manualCases = [
    {
      name: "Manual moderate rain for 2 hours",
      text: "Moderate rain now for 2 hours",
      expect: { condition: "rain", severity: "moderate", food: 1.35, ride: 1.1, supply: 0.85 },
    },
    {
      name: "Manual heavy snow until 9 PM",
      text: "Heavy snow until 9 PM",
      expect: { condition: "snow", severity: "heavy", food: 1.8, ride: 1.3, supply: 0.55 },
    },
  ];

  console.log("\n=== Manual Weather Override Parser ===\n");
  for (const c of manualCases) {
    const rows = parseManualWeatherOverrideText(c.text, manualStart, 4);
    const got = computeWeatherModifiers(rows);
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
      })}`
    );
  }

  const manualTable = [
    "Time\tConditions\tTemp.\tFeels Like\tPrecip\tAmount\tCloud Cover\tDew Point\tHumidity\tWind\tPressure",
    "12 :00 pm\tMostly SunnyMostly Sunny\t80 °F\t81 °F\t0 %\t0 in\t20 %\t57 °F\t45 %\t7 mph NNE\t29.97 in",
    "1 :00 pm\tLight RainLight Rain\t78 °F\t78 °F\t80 %\t0.03 in\t90 %\t61 °F\t68 %\t5 mph N\t29.95 in",
    "2 :00 pm\tCloudyCloudy\t77 °F\t77 °F\t10 %\t0 in\t100 %\t61 °F\t69 %\t5 mph N\t29.95 in",
  ].join("\n");
  const tableRows = parseManualWeatherOverrideText(manualTable, new Date("2026-06-09T13:20:00.000Z"), 2);
  const tableGot = computeWeatherModifiers(tableRows);
  const tableOk =
    tableGot.condition === "rain" &&
    tableGot.severity === "light" &&
    tableGot.weatherFoodMod === 1.15 &&
    tableGot.weatherRideMod === 1.05 &&
    tableGot.driverSupplyMod === 0.95;
  if (!tableOk) allPass = false;
  console.log(
    `${tableOk ? "PASS" : "FAIL"} - Manual hourly weather table\n  expected ${JSON.stringify({
      condition: "rain",
      severity: "light",
      food: 1.15,
      ride: 1.05,
      supply: 0.95,
    })}\n  got      ${JSON.stringify({
      condition: tableGot.condition,
      severity: tableGot.severity,
      food: tableGot.weatherFoodMod,
      ride: tableGot.weatherRideMod,
      supply: tableGot.driverSupplyMod,
    })}`
  );

  const futureOnlyTable = [
    "Time\tConditions\tTemp\tUnused\tPrecip\tAmount",
    "3:00 pm\tCloudy\t78 F\t-\t15%\t0 in",
  ].join("\n");
  const futureOnlyRows = parseManualWeatherOverrideText(
    futureOnlyTable,
    new Date("2026-07-21T14:15:00.000Z"),
    1
  );
  const missingCurrentHourOk =
    futureOnlyRows[0] === null && futureOnlyRows[1]?.tempF === 78;
  if (!missingCurrentHourOk) allPass = false;
  console.log(
    `${missingCurrentHourOk ? "PASS" : "FAIL"} - Missing BYOD current hour remains empty for live fallback`
  );

  console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
  process.exit(allPass ? 0 : 1);
})();
