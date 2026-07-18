import assert from "node:assert/strict";
import {
  mergeByodCategoryUpdate,
  mergeByodUpdates,
  normalizeByodSnapshot,
  reconcileByodSnapshots,
} from "./app/lib/byod-snapshot.mjs";

const older = "2026-07-13T12:00:00.000Z";
const newer = "2026-07-13T13:00:00.000Z";

const initial = normalizeByodSnapshot({
  savedAt: older,
  trainConfigInbound: {
    savedDate: "2026-07-13",
    trains: [{ trainNumber: "49" }],
    updatedAt: older,
  },
  busConfigInbound: {
    savedDate: "2026-07-13",
    rawText: "Bus board",
    updatedAt: older,
  },
});

const merged = mergeByodUpdates(
  initial,
  {
    flightConfigInbound: {
      savedDate: "2026-07-13",
      rawText: "Flight board",
      updatedAt: newer,
    },
  },
  newer
);
assert.equal(merged.trainConfigInbound.trains[0].trainNumber, "49");
assert.equal(merged.busConfigInbound.rawText, "Bus board");
assert.equal(merged.flightConfigInbound.rawText, "Flight board");
assert.equal(merged.trainConfigOutbound.updatedAt, null);
assert.equal(merged.trainConfigOutbound.revision, 0);
assert.equal(merged.academicSessionConfig.mode, "auto");
assert.deepEqual(merged.byodEventConfig.eventsByDate, {});

const eventMerged = mergeByodUpdates(
  merged,
  {
    byodEventConfig: {
      savedDate: "2026-07-13",
      rawText: "MVP Arena | Event | Doors 6:30 PM | Starts 8:00 PM | Music",
      updatedAt: newer,
    },
  },
  newer
);
assert.match(eventMerged.byodEventConfig.eventsByDate["2026-07-13"], /MVP Arena/);

const multiDateEvents = mergeByodUpdates(
  eventMerged,
  {
    byodEventConfig: {
      eventsByDate: {
        ...eventMerged.byodEventConfig.eventsByDate,
        "2026-07-14": "The Egg | Future Event | Starts 7:00 PM | Arts",
      },
      updatedAt: "2026-07-13T14:00:00.000Z",
    },
  },
  "2026-07-13T14:00:00.000Z"
);
assert.match(multiDateEvents.byodEventConfig.eventsByDate["2026-07-13"], /MVP Arena/);
assert.match(multiDateEvents.byodEventConfig.eventsByDate["2026-07-14"], /Future Event/);

const legacyEventMigration = normalizeByodSnapshot({
  byodEventConfig: {
    savedDate: "2026-07-12",
    rawText: "Palace Theatre | Legacy Event | Starts 8:00 PM | Theatre",
  },
});
assert.match(
  legacyEventMigration.byodEventConfig.eventsByDate["2026-07-12"],
  /Legacy Event/
);

const academicOverrideMerged = mergeByodUpdates(
  merged,
  { academicSessionConfig: { mode: "out-of-session", updatedAt: newer } },
  newer
);
assert.equal(academicOverrideMerged.academicSessionConfig.mode, "out-of-session");
assert.equal(academicOverrideMerged.academicSessionConfig.updatedAt, newer);

const outboundFlightMerged = mergeByodUpdates(
  merged,
  {
    flightConfigOutbound: {
      savedDate: "2026-07-13",
      rawText: "Chicago 10:30 AM",
      updatedAt: newer,
    },
  },
  newer
);
assert.equal(outboundFlightMerged.flightConfigOutbound.rawText, "Chicago 10:30 AM");

const staleWrite = mergeByodUpdates(
  merged,
  {
    flightConfigInbound: {
      savedDate: "2026-07-13",
      rawText: "Stale phone board",
      updatedAt: older,
    },
  },
  "2026-07-13T14:00:00.000Z"
);
assert.equal(staleWrite.flightConfigInbound.rawText, "Flight board");

const localNewer = reconcileByodSnapshots(
  {
    weatherConfig: {
      savedDate: "2026-07-13",
      rawText: "Heavy rain",
      updatedAt: newer,
    },
  },
  {
    savedAt: older,
    weatherConfig: {
      savedDate: "2026-07-13",
      rawText: "Light rain",
      updatedAt: older,
    },
  }
);
assert.equal(localNewer.snapshot.weatherConfig.rawText, "Heavy rain");
assert.equal(localNewer.pendingUpdates.weatherConfig.rawText, "Heavy rain");

const cloudNewer = reconcileByodSnapshots(
  {
    busConfigInbound: {
      savedDate: "2026-07-13",
      rawText: "Old local bus board",
      updatedAt: older,
    },
  },
  {
    busConfigInbound: {
      savedDate: "2026-07-13",
      rawText: "New cloud bus board",
      updatedAt: newer,
    },
  }
);
assert.equal(cloudNewer.snapshot.busConfigInbound.rawText, "New cloud bus board");
assert.deepEqual(cloudNewer.pendingUpdates, {});

const legacyLocalOnly = reconcileByodSnapshots(
  { flightConfigInbound: { savedDate: "2026-07-13", rawText: "Legacy local" } },
  null
);
assert.equal(legacyLocalOnly.snapshot.flightConfigInbound.rawText, "Legacy local");
assert.equal(legacyLocalOnly.pendingUpdates.flightConfigInbound.rawText, "Legacy local");

const legacyCloudWins = reconcileByodSnapshots(
  { flightConfigInbound: { savedDate: "2026-07-13", rawText: "Legacy local" } },
  {
    savedAt: newer,
    flightConfigInbound: { savedDate: "2026-07-13", rawText: "Legacy cloud" },
  }
);
assert.equal(legacyCloudWins.snapshot.flightConfigInbound.rawText, "Legacy cloud");

const serverNow = "2026-07-13T15:00:00.000Z";
const replacedFlight = mergeByodCategoryUpdate(
  "flightConfigInbound",
  { savedDate: "2026-07-13", rawText: "Old board", revision: 4 },
  { savedDate: "2026-07-13", rawText: "Fresh board", revision: 2 },
  serverNow
);
assert.equal(replacedFlight.rawText, "Fresh board");
assert.equal(replacedFlight.revision, 5);
assert.equal(replacedFlight.updatedAt, serverNow);

const currentEventText =
  "MVP Arena | Cloud Name | Doors 6:30 PM | Starts 8:00 PM | Music";
const staleEventMerge = mergeByodCategoryUpdate(
  "byodEventConfig",
  {
    eventsByDate: { "2026-07-14": currentEventText },
    revision: 3,
  },
  {
    eventsByDate: {
      "2026-07-14":
        "MVP Arena | Stale Name | Doors 6:00 PM | Starts 8:00 PM | Music\nThe Egg | New Event | Starts 7:00 PM | Arts",
    },
    revision: 2,
  },
  serverNow
);
assert.match(staleEventMerge.eventsByDate["2026-07-14"], /Cloud Name/);
assert.doesNotMatch(staleEventMerge.eventsByDate["2026-07-14"], /Stale Name/);
assert.match(staleEventMerge.eventsByDate["2026-07-14"], /New Event/);
assert.equal(staleEventMerge.revision, 4);

console.log("BYOD cloud sync: assertions passed.");
