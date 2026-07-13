import assert from "node:assert/strict";
import {
  buildCurrentWeatherDisplay,
  cleanWeatherConditionLabel,
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

console.log("Weather display: 6 assertions passed.");
