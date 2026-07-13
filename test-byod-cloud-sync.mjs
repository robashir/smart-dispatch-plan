import assert from "node:assert/strict";
import {
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

console.log("BYOD cloud sync: 12 assertions passed.");
