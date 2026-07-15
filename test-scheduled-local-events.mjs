import assert from "node:assert/strict";
import {
  buildScheduledConfiguredEvents,
  buildScheduledCrossgatesEvents,
  buildScheduledHospitalEvents,
  buildScheduledLastCallEvents,
  buildScheduledLocalAnchorEvents,
  buildScheduledStateWorkerEvents,
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
assert.equal(hospitals.length, 1);
assert.equal(hospitals[0].leaveBy, "2:30 PM");
assert.equal(hospitals[0].hourBucket, "2:30 PM");
assert.equal(hospitals[0].windowEnd, "3:30 PM");
assert.equal(hospitals[0].activeNow, false);

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
assert.equal(crossgates.length, 1);
assert.equal(crossgates[0].windowStart, "7:30 PM");
assert.equal(crossgates[0].windowEnd, "8:30 PM");

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
assert.equal(configured.length, 1);
assert.equal(configured[0].leaveBy, "3:30 PM");
assert.equal(configured[0].windowEnd, "4:15 PM");

console.log("Scheduled local events: 26 assertions passed.");
