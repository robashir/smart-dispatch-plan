import assert from "node:assert/strict";
import { densityScore } from "./app/api/dispatch/route.js";
import {
  buildScheduledLastCallEvents,
  closingDemandFor,
  nightlifeVenueClass,
} from "./app/lib/scheduled-local-events.mjs";

assert.equal(nightlifeVenueClass("City Line Bar and Grill"), "restaurant");
assert.equal(nightlifeVenueClass("McGeary's"), "nightlife");
assert.equal(nightlifeVenueClass("The Olde English"), "late_bar");

assert.deepEqual(
  closingDemandFor({
    venueName: "City Line Bar and Grill",
    closeMinute: 21 * 60,
    dayIndex: 1,
  }),
  { demandYield: 2, demandCap: 6, trueLastCall: false, venueClass: "restaurant", normalizedClose: 1260 }
);

assert.deepEqual(
  closingDemandFor({
    venueName: "City Line Bar and Grill",
    closeMinute: 22 * 60,
    dayIndex: 5,
  }),
  { demandYield: 4, demandCap: 10, trueLastCall: false, venueClass: "restaurant", normalizedClose: 1320 }
);

assert.deepEqual(
  closingDemandFor({
    venueName: "The Olde English",
    closeMinute: 23 * 60,
    dayIndex: 5,
  }),
  { demandYield: 5, demandCap: 10, trueLastCall: true, venueClass: "late_bar", normalizedClose: 1380 }
);

assert.deepEqual(
  closingDemandFor({
    venueName: "McGeary's",
    closeMinute: 2 * 60,
    dayIndex: 3,
  }),
  { demandYield: 5, demandCap: 6, trueLastCall: true, venueClass: "nightlife", normalizedClose: 1560 }
);

assert.deepEqual(
  closingDemandFor({
    venueName: "McGeary's",
    closeMinute: 2 * 60,
    dayIndex: 6,
  }),
  { demandYield: 8, demandCap: 10, trueLastCall: true, venueClass: "nightlife", normalizedClose: 1560 }
);

assert.deepEqual(
  closingDemandFor({
    venueName: "JT Maxies Bar & Grill",
    closeMinute: 4 * 60,
    dayIndex: 5,
  }),
  { demandYield: 9, demandCap: 10, trueLastCall: true, venueClass: "nightlife", normalizedClose: 1680 }
);

const cityLineWeekday = buildScheduledLastCallEvents({
  localStart: new Date("2026-07-13T20:00:00Z"),
  localEnd: new Date("2026-07-13T21:00:00Z"),
  dictionary: [{
    name: "City Line Bar and Grill",
    closingTimes: { 1: "21:00" },
    lat: 42.6773,
    lng: -73.8264,
  }],
})[0];
assert.equal(cityLineWeekday.location, "Restaurant Closing: City Line Bar and Grill");
assert.equal(cityLineWeekday.demandYield, 2);
assert.deepEqual(cityLineWeekday.categories, ["Restaurant Closing", "Closing Demand", "restaurant"]);

const mcgearysWeekend = buildScheduledLastCallEvents({
  localStart: new Date("2026-07-18T01:00:00Z"),
  localEnd: new Date("2026-07-18T02:00:00Z"),
  dictionary: [{
    name: "McGeary's",
    closingTimes: { 5: "02:00" },
    lat: 42.6541,
    lng: -73.7506,
  }],
})[0];
assert.equal(mcgearysWeekend.location, "Last Call Egress: McGeary's");
assert.equal(mcgearysWeekend.demandYield, 8);
assert.deepEqual(mcgearysWeekend.categories, ["Last Call", "Nightlife Egress", "nightlife"]);

assert.equal(
  densityScore(
    { type: "event", volume: 1, demandYield: 9, demandCap: 10 },
    1.5,
    1
  ),
  10
);

console.log("Nightlife scoring: 16 assertions passed.");
