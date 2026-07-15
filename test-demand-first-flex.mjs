import assert from "node:assert/strict";
import { buildDemandFirstFlexWindows } from "./components/demand-first-flex.mjs";

const inboundFlight = {
  item: {
    type: "flight",
    leaveBy: "12:33 PM",
    arrivalTime: "12:19 PM",
    curbTime: "12:44 PM",
    lat: 42.75,
    lng: -73.8,
  },
  minute: 12 * 60 + 33,
  delta: 52,
};
const inboundTrain = {
  item: {
    type: "event",
    categories: ["BYOD Train", "Inbound"],
    leaveBy: "1:51 PM",
  },
  minute: 13 * 60 + 51,
  delta: 130,
};
const outboundTrain = {
  item: {
    type: "event",
    categories: ["BYOD Train", "Outbound"],
    leaveBy: "3:30 PM",
  },
  minute: 15 * 60 + 30,
  delta: 229,
};

const windows = buildDemandFirstFlexWindows(
  { selected: [inboundFlight, inboundTrain, outboundTrain] },
  { nowMinute: 11 * 60 + 41 }
);
assert.equal(windows.length, 3);
assert.equal(windows[0].beforeIndex, 0);
assert.equal(windows[0].cutoffLabel, "12:18 PM");
assert.equal(windows[0].target, "ALB");
assert.equal(windows[1].startLabel, "12:44 PM");
assert.equal(windows[2].beforeIndex, 2);
assert.equal(windows[2].cutoffLabel, "3:01 PM");
assert.equal(windows[2].target, "Empire State Plaza");
assert.equal(windows[2].deadlineInstruction, "Be at Empire State Plaza by 3:16 PM");

const noInitialWindowWithActiveNow = buildDemandFirstFlexWindows(
  { activeNow: { type: "event" }, selected: [inboundFlight] },
  { nowMinute: 11 * 60 + 41 }
);
assert.equal(noInitialWindowWithActiveNow.length, 0);

const afterScheduledWindow = buildDemandFirstFlexWindows(
  {
    selected: [
      {
        item: {
          type: "event",
          leaveBy: "3:00 PM",
          windowStart: "3:00 PM",
          windowEnd: "4:00 PM",
        },
        minute: 15 * 60,
        delta: 60,
      },
      {
        item: {
          type: "event",
          categories: ["BYOD Train", "Outbound"],
          leaveBy: "5:30 PM",
        },
        minute: 17 * 60 + 30,
        delta: 210,
      },
    ],
  },
  { nowMinute: 14 * 60 }
);
assert.equal(afterScheduledWindow[1].startLabel, "4:00 PM");

console.log("Demand-first flex windows: 11 assertions passed.");
