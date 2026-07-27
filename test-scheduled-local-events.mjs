import assert from "node:assert/strict";
import {
  buildScheduledConfiguredEvents,
  buildScheduledCrossgatesEvents,
  buildScheduledHospitalEvents,
  buildScheduledLastCallEvents,
  buildScheduledLocalAnchorEvents,
  buildScheduledStateWorkerEvents,
  aggregateLastCallVenueClusters,
} from "./app/lib/scheduled-local-events.mjs";

const coords = { lat: 42.65, lng: -73.75 };
const localStart = new Date("2026-07-15T14:00:00Z");
const localEnd = new Date("2026-07-15T17:00:00Z");

const hospitals = buildScheduledHospitalEvents({
  localStart,
  localEnd,
  shifts: [{ start: 870, end: 930, mod: 2, label: "Afternoon Clinic Shift" }],
  coords,
});
assert.equal(hospitals.length, 3);
assert.equal(hospitals[0].leaveBy, "2:30 PM");
assert.equal(hospitals[0].hourBucket, "2:30 PM");
assert.equal(hospitals[0].windowEnd, "2:50 PM");
assert.equal(hospitals[0].activeNow, false);
assert.deepEqual(hospitals.map((event) => event.volume), [0.6, 1, 0.6]);
assert.deepEqual(hospitals.map((event) => event.categories[2]), ["Build", "Peak", "Taper"]);

const stateWorkers = buildScheduledStateWorkerEvents({
  localStart,
  localEnd,
  slots: [{ start: 960, end: 990, factor: 1, label: "Peak Exit Wave" }],
  coords,
});
assert.equal(stateWorkers.length, 1);
assert.equal(stateWorkers[0].leaveBy, "4:00 PM");
assert.deepEqual(stateWorkers[0].categories, ["State Worker Commute", "Peak Exit Wave"]);

const boundaryStateWorker = buildScheduledStateWorkerEvents({
  localStart: new Date("2026-07-15T11:41:00Z"),
  localEnd: new Date("2026-07-15T16:11:00Z"),
  slots: [{ start: 960, end: 990, factor: 1, label: "Peak Exit Wave" }],
  coords,
});
assert.equal(boundaryStateWorker.length, 1);
assert.equal(boundaryStateWorker[0].leaveBy, "4:00 PM");

const activeHospital = buildScheduledHospitalEvents({
  localStart: new Date("2026-07-15T15:15:00Z"),
  localEnd,
  shifts: [{ start: 870, end: 930, mod: 2, label: "Afternoon Clinic Shift" }],
  coords,
})[0];
assert.equal(activeHospital.activeNow, true);
assert.equal(activeHospital.leaveBy, undefined);
assert.equal(activeHospital.hourBucket, undefined);

const crossgates = buildScheduledCrossgatesEvents({
  localStart: new Date("2026-07-15T19:00:00Z"),
  localEnd: new Date("2026-07-15T21:00:00Z"),
  closingHours: { 3: 1200 },
  coords,
});
assert.equal(crossgates.length, 3);
assert.equal(crossgates[0].windowStart, "7:30 PM");
assert.equal(crossgates[0].windowEnd, "7:50 PM");
assert.deepEqual(crossgates.map((event) => event.volume), [0.6, 1, 0.6]);
assert.deepEqual(crossgates.map((event) => event.categories[2]), ["Build", "Peak", "Taper"]);

const anchors = buildScheduledLocalAnchorEvents({
  localStart,
  localEnd,
  schedules: [{
    name: "Office Campus",
    days: [3],
    windows: [{ start: 915, end: 960, expected: 7, label: "Campus Exit" }],
    ...coords,
  }],
});
assert.equal(anchors.length, 3);
assert.deepEqual(anchors.map((event) => event.categories[2]), ["Build", "Peak", "Taper"]);

const lastCall = buildScheduledLastCallEvents({
  localStart: new Date("2026-07-16T00:30:00Z"),
  localEnd: new Date("2026-07-16T02:00:00Z"),
  dictionary: [{
    name: "Night Venue",
    closingTimes: { 3: "01:30" },
    ...coords,
  }],
});
assert.equal(lastCall.length, 1);
assert.equal(lastCall[0].windowStart, "12:45 AM");
assert.equal(lastCall[0].windowEnd, "1:00 AM");
assert.equal(lastCall[0].demandYield, 4);
assert.equal(lastCall[0].demandCap, 6);
assert.equal(lastCall[0].location, "Last Call Egress: Night Venue");

const ignoredRestaurantClosing = buildScheduledLastCallEvents({
  localStart: new Date("2026-07-15T20:00:00Z"),
  localEnd: new Date("2026-07-15T22:00:00Z"),
  dictionary: [{
    name: "Innovo Kitchen",
    closingTimes: { 3: "21:00" },
    ...coords,
  }],
});
assert.equal(
  ignoredRestaurantClosing.length,
  0,
  "restaurant closings must not enter dispatch or Telegram calculations"
);

const clusteredLastCall = buildScheduledLastCallEvents({
  localStart: new Date("2026-07-16T01:00:00Z"),
  localEnd: new Date("2026-07-16T02:00:00Z"),
  dictionary: [
    {
      name: "McGeary's",
      closingTimes: { 3: "02:00" },
      lat: 42.65407,
      lng: -73.75059,
    },
    {
      name: "Hill Street Cafe",
      closingTimes: { 3: "02:00" },
      lat: 42.646606,
      lng: -73.758049,
    },
    {
      name: "Tipsy Moose Tap & Tavern",
      closingTimes: { 3: "02:00" },
      lat: 42.746239,
      lng: -73.759122,
    },
    {
      name: "The Hollow Bar & Kitchen",
      closingTimes: { 3: "02:00" },
      lat: 42.652266,
      lng: -73.750901,
    },
  ],
});
assert.equal(clusteredLastCall.length, 2);
assert.equal(
  clusteredLastCall.some((event) => /The Hollow Bar & Kitchen/i.test(event.location)),
  false,
  "restaurants must remain excluded even when they share a late closing time"
);
const downtownLastCallCluster = clusteredLastCall.find((event) => event.isLastCallCluster);
assert.deepEqual(downtownLastCallCluster.venues, ["Hill Street Cafe", "McGeary's"]);
assert.equal(downtownLastCallCluster.venueCount, 2);
assert.equal(downtownLastCallCluster.demandYield, 7);
assert.equal(downtownLastCallCluster.demandCap, 8);
assert.equal(downtownLastCallCluster.windowStart, "1:15 AM");
assert.match(downtownLastCallCluster.location, /^Last Call Egress Cluster:/);

assert.equal(
  aggregateLastCallVenueClusters([], { localStart: new Date("2026-07-16T01:00:00Z") }).length,
  0
);

const restaurantClosings = [
  {
    location: "Restaurant Closing: A",
    categories: ["Restaurant Closing", "Closing Demand", "restaurant"],
    lat: 42.65,
    lng: -73.75,
    _scheduleStartMs: 1000,
    _scheduleEndMs: 2000,
  },
  {
    location: "Restaurant Closing: B",
    categories: ["Restaurant Closing", "Closing Demand", "restaurant"],
    lat: 42.651,
    lng: -73.751,
    _scheduleStartMs: 1000,
    _scheduleEndMs: 2000,
  },
];
assert.equal(
  aggregateLastCallVenueClusters(restaurantClosings, {
    localStart: new Date("2026-07-16T01:00:00Z"),
  }).length,
  2
);

const configured = buildScheduledConfiguredEvents({
  localStart,
  localEnd,
  eventConfig: {
    "Academic Dismissal": {
      date: "2026-07-15",
      type: "academic",
      multiplier: 3.5,
      activeWindows: [{ start: 15.5, end: 16.25 }],
    },
  },
  coords,
});
assert.equal(configured.length, 3);
assert.equal(configured[0].leaveBy, "3:30 PM");
assert.equal(configured[0].windowEnd, "3:45 PM");
assert.deepEqual(configured.map((event) => event.categories[2]), ["Build", "Peak", "Taper"]);
assert.deepEqual(configured.map((event) => event.demandYield), [12, 20, 12]);
assert.equal(configured[0].location, "UAlbany Uptown Campus — Academic Dismissal");

const holiday = buildScheduledConfiguredEvents({
  localStart: new Date("2026-07-15T18:00:00Z"),
  localEnd: new Date("2026-07-15T22:00:00Z"),
  eventConfig: {
    "Summer Festival": {
      date: "2026-07-15",
      type: "holiday",
      multiplier: 3.5,
      activeWindows: [{ start: 18, end: 21 }],
    },
  },
  coords,
});
assert.equal(holiday.length, 3);
assert.deepEqual(holiday.map((event) => event.volume), [0.6, 1, 0.6]);
assert.deepEqual(holiday.map((event) => event.categories.at(-1)), ["Build", "Peak", "Taper"]);

console.log("Scheduled local events: phased demand assertions passed.");
