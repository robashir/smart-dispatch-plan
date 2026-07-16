import assert from "node:assert/strict";
import {
  buildScheduledConfiguredEvents,
  buildScheduledLocalAnchorEvents,
  suppressOverlappingUAlbanyRoutineEvents,
} from "./app/lib/scheduled-local-events.mjs";
import {
  academicEventPolicy,
  isUAlbanyNode,
  isUAlbanyRegularSession,
} from "./app/lib/ualbany-demand.mjs";

assert.equal(isUAlbanyRegularSession("2026-07-16"), false);
assert.equal(isUAlbanyRegularSession("2026-08-24"), true);
assert.equal(isUAlbanyRegularSession("2026-10-12"), false);
assert.equal(isUAlbanyRegularSession("2026-11-30"), true);
assert.equal(isUAlbanyRegularSession("2027-03-15"), false);
assert.equal(isUAlbanyRegularSession("2028-09-12"), true);
assert.equal(isUAlbanyRegularSession("2028-11-23"), false);
assert.equal(isUAlbanyRegularSession("2026-07-16", "in-session"), true);
assert.equal(isUAlbanyRegularSession("2026-09-15", "out-of-session"), false);

assert.deepEqual(
  academicEventPolicy("Fall Move-In Day 1", { type: "academic" }),
  {
    anchorKey: "ualbany",
    peakDemand: 35,
    location: "UAlbany Uptown Campus — Fall Move-In Day 1",
    lat: 42.6868,
    lng: -73.8238,
  }
);
assert.equal(
  academicEventPolicy("Halloweekend (Downtown)", { type: "academic" }).anchorKey,
  "downtown"
);
assert.equal(
  academicEventPolicy("St. Patrick's (Kegs & Eggs)", { type: "academic" }).anchorKey,
  "pine-hills"
);
assert.equal(isUAlbanyNode({ lat: 42.686, lng: -73.823 }), true);
assert.equal(isUAlbanyNode({ lat: 42.6506, lng: -73.7529 }), false);

const ualbanySchedule = [{
  name: "UAlbany Uptown Campus",
  sessionOnly: true,
  days: [1, 2, 3, 4, 5],
  windows: [{ start: 480, end: 525, expected: 8, label: "Morning Campus Arrival" }],
  lat: 42.6868,
  lng: -73.8238,
}];

const summerRoutine = buildScheduledLocalAnchorEvents({
  localStart: new Date("2026-07-16T07:30:00Z"),
  localEnd: new Date("2026-07-16T09:15:00Z"),
  schedules: ualbanySchedule,
});
assert.equal(summerRoutine.length, 0);

const forcedSummerRoutine = buildScheduledLocalAnchorEvents({
  localStart: new Date("2026-07-16T07:30:00Z"),
  localEnd: new Date("2026-07-16T09:15:00Z"),
  schedules: ualbanySchedule,
  academicSessionMode: "in-session",
});
assert.deepEqual(forcedSummerRoutine.map((event) => event.volume), [5, 8, 5]);

const fallRoutine = buildScheduledLocalAnchorEvents({
  localStart: new Date("2026-09-15T07:30:00Z"),
  localEnd: new Date("2026-09-15T09:15:00Z"),
  schedules: ualbanySchedule,
});
assert.deepEqual(fallRoutine.map((event) => event.volume), [5, 8, 5]);

const dedupedAcademic = buildScheduledConfiguredEvents({
  localStart: new Date("2026-05-16T09:00:00Z"),
  localEnd: new Date("2026-05-16T17:00:00Z"),
  eventConfig: {
    "Spring Move-Out Day 2": {
      date: "2026-05-16",
      type: "academic",
      activeWindows: [{ start: 9, end: 17 }],
    },
    Commencement: {
      date: "2026-05-16",
      type: "academic",
      activeWindows: [{ start: 9, end: 17 }],
    },
  },
  coords: { lat: 42.6514, lng: -73.7608 },
});
assert.equal(dedupedAcademic.length, 3);
assert.deepEqual(dedupedAcademic.map((event) => event.demandYield), [24, 40, 24]);
assert.equal(dedupedAcademic.every((event) => /Commencement/.test(event.location)), true);

const overlappingAcademic = buildScheduledConfiguredEvents({
  localStart: new Date("2026-09-15T07:30:00Z"),
  localEnd: new Date("2026-09-15T12:00:00Z"),
  eventConfig: {
    "Campus Special": {
      date: "2026-09-15",
      type: "academic",
      activeWindows: [{ start: 7.5, end: 9.25 }],
    },
  },
  coords: { lat: 42.6514, lng: -73.7608 },
});
const dedupedCampusSignals = suppressOverlappingUAlbanyRoutineEvents([
  ...fallRoutine,
  ...overlappingAcademic,
]);
assert.equal(
  dedupedCampusSignals.some((event) => event.categories.includes("Local Anchor")),
  false
);

const laterAcademic = buildScheduledConfiguredEvents({
  localStart: new Date("2026-09-15T07:30:00Z"),
  localEnd: new Date("2026-09-15T13:00:00Z"),
  eventConfig: {
    "Later Campus Special": {
      date: "2026-09-15",
      type: "academic",
      activeWindows: [{ start: 11, end: 12 }],
    },
  },
  coords: { lat: 42.6514, lng: -73.7608 },
});
const nonOverlappingCampusSignals = suppressOverlappingUAlbanyRoutineEvents([
  ...fallRoutine,
  ...laterAcademic,
]);
assert.equal(
  nonOverlappingCampusSignals.filter((event) => event.categories.includes("Local Anchor")).length,
  3
);

console.log("UAlbany demand: 22 assertions passed.");
