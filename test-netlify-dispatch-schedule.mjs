import assert from "node:assert/strict";
import {
  buildScheduledDispatchBody,
  newYorkTimezoneOffsetMinutes,
} from "./netlify/functions/_shared/dispatch-alert-request.mjs";

const values = new Map();
const readEnv = (name) => values.get(name);
const summer = new Date("2026-07-22T16:00:00.000Z");
const winter = new Date("2026-01-22T17:00:00.000Z");

assert.equal(newYorkTimezoneOffsetMinutes(summer), 240);
assert.equal(newYorkTimezoneOffsetMinutes(winter), 300);

const defaults = buildScheduledDispatchBody({
  readEnv,
  eventConfig: { sample: true },
  now: summer,
});
assert.equal(defaults.latitude, 42.686);
assert.equal(defaults.longitude, -73.843);
assert.equal(defaults.hours, 4);
assert.equal(defaults.timezoneOffsetMinutes, 240);
assert.deepEqual(defaults.platforms, {
  rideshare: true,
  food: true,
  grocery: false,
});
assert.equal(defaults.includeAirport, true);
assert.equal(defaults.includeAmtrak, true);
assert.equal(defaults.routingStrategy, "profitability");
assert.equal(defaults.costPerMile, 0.65);
assert.deepEqual(defaults.eventConfig, { sample: true });

values.set("DISPATCH_LATITUDE", "42.7");
values.set("DISPATCH_LONGITUDE", "-73.8");
values.set("DISPATCH_HOURS", "2");
values.set("DISPATCH_ENABLE_RIDESHARE", "false");
values.set("DISPATCH_ENABLE_FOOD", "false");
values.set("DISPATCH_ENABLE_GROCERY", "true");
values.set("DISPATCH_INCLUDE_AIRPORT", "false");
values.set("DISPATCH_INCLUDE_AMTRAK", "false");
values.set("DISPATCH_ROUTING_STRATEGY", "chronological");
values.set("DISPATCH_COST_PER_MILE", "0.8");

const configured = buildScheduledDispatchBody({ readEnv, now: winter });
assert.equal(configured.latitude, 42.7);
assert.equal(configured.longitude, -73.8);
assert.equal(configured.hours, 2);
assert.equal(configured.timezoneOffsetMinutes, 300);
assert.deepEqual(configured.platforms, {
  rideshare: false,
  food: false,
  grocery: true,
});
assert.equal(configured.includeAirport, false);
assert.equal(configured.includeAmtrak, false);
assert.equal(configured.routingStrategy, "chronological");
assert.equal(configured.costPerMile, 0.8);

console.log("Netlify scheduled dispatch request tests passed.");
