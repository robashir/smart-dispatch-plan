import assert from "node:assert/strict";
import { aggregateInboundFlightEvents } from "./app/lib/inbound-flight-wave.mjs";
import { densityScore } from "./app/api/dispatch/route.js";
import { formatInboundFlightSequenceHeading } from "./components/flight-sequence-copy.mjs";
import { formatDemandFirstTiming } from "./components/demand-first-timing.mjs";

const base = {
  type: "flight",
  volume: 1,
  hub: "ALB",
  status: "On Time",
  driveMinutes: 11,
  fatigueMod: 1,
  leisureMod: 1,
};

const grouped = aggregateInboundFlightEvents(
  [
    {
      ...base,
      flightNumber: "LGA101",
      origin: "LGA",
      origins: ["LGA"],
      originLabel: "New York (LGA)",
      originLabels: ["New York (LGA)"],
      arrivalTime: "12:47 PM",
      curbTime: "1:12 PM",
      leaveBy: "1:01 PM",
    },
    {
      ...base,
      flightNumber: "ORD202",
      origin: "ORD",
      origins: ["ORD"],
      originLabel: "Chicago",
      originLabels: ["Chicago"],
      arrivalTime: "12:48 PM",
      curbTime: "1:13 PM",
      leaveBy: "1:02 PM",
    },
    {
      ...base,
      flightNumber: "ATL303",
      origin: "ATL",
      origins: ["ATL"],
      originLabel: "Atlanta",
      originLabels: ["Atlanta"],
      arrivalTime: "1:30 PM",
      curbTime: "1:55 PM",
      leaveBy: "1:44 PM",
    },
  ],
  { nowMinute: 11 * 60 + 30 }
);

assert.equal(grouped.length, 2);
assert.equal(grouped[0].isFlightWave, true);
assert.equal(grouped[0].flightCount, 2);
assert.equal(grouped[0].volume, 2);
assert.equal(grouped[0].demandCap, 45);
assert.equal(grouped[0].leaveBy, "1:01 PM");
assert.equal(grouped[0].curbTime, "1:13 PM");
assert.deepEqual(grouped[0].origins, ["LGA", "ORD"]);
assert.deepEqual(grouped[0].originLabels, ["New York (LGA)", "Chicago"]);
assert.equal(densityScore(grouped[0], 1, 1), 30);
assert.equal(
  formatInboundFlightSequenceHeading(grouped[0]),
  "Inbound — ALB Arrival Wave from New York (LGA) & Chicago"
);
assert.equal(
  formatDemandFirstTiming(grouped[0]),
  "Arrivals 12:47–12:48 PM | Expected curb 1:12–1:13 PM | Leave for ALB by 1:01 PM"
);
assert.equal(grouped[1].originLabel, "Atlanta");

console.log("Inbound flight waves: 12 assertions passed.");
