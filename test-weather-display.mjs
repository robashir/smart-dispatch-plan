import assert from "node:assert/strict";
import {
  buildCurrentWeatherDisplay,
  cleanWeatherConditionLabel,
  mergeWeatherWindows,
} from "./app/lib/weather-display.mjs";

assert.equal(cleanWeatherConditionLabel("Partly CloudyPartly Cloudy"), "Partly Cloudy");
assert.equal(cleanWeatherConditionLabel("Mostly Cloudy Mostly Cloudy"), "Mostly Cloudy");

assert.deepEqual(
  buildCurrentWeatherDisplay(
    { tempF: 85, weatherCode: 3, manualCondition: "Partly CloudyPartly Cloudy" },
    true
  ),
  { currentTempF: 85, currentConditionLabel: "Partly Cloudy", source: "manual" }
);

assert.deepEqual(buildCurrentWeatherDisplay({ tempF: 72, weatherCode: 2 }), {
  currentTempF: 72,
  currentConditionLabel: "Partly Cloudy",
  source: "live",
});

assert.equal(
  buildCurrentWeatherDisplay({ tempF: 65, weatherCode: 63, hasExplicitTemp: false }, true)
    .currentTempF,
  null
);
assert.equal(
  buildCurrentWeatherDisplay({ tempF: 61, weatherCode: 65 }).currentConditionLabel,
  "Heavy Rain"
);

const liveNow = { time: "2026-07-21T14:00", tempF: 76, weatherCode: 2 };
const manualNext = {
  time: "2026-07-21T15:00",
  tempF: 78,
  weatherCode: 3,
  source: "manual_table",
};
assert.deepEqual(
  mergeWeatherWindows([null, manualNext], [liveNow, { time: "2026-07-21T15:00" }]),
  [liveNow, manualNext]
);

console.log("Weather display: 7 assertions passed.");
