import assert from "node:assert/strict";
import {
  buildDemandFirstTimeline,
  groupDemandFirstTimeSlots,
} from "./components/demand-first-sequence.mjs";

function timed(location, leaveBy, demand, opportunity) {
  return {
    type: "event",
    location,
    leaveBy,
    densityScore: demand,
    opportunityScore: opportunity,
  };
}

const sameWindow = buildDemandFirstTimeline(
  [
    timed("Earlier Low", "4:30 PM", 10, 15),
    timed("Highest Demand", "4:35 PM", 30, 20),
    timed("Later Medium", "4:42 PM", 20, 40),
    timed("Next Window", "5:10 PM", 12, 12),
  ],
  { nowMinute: 16 * 60 }
);
assert.deepEqual(
  sameWindow.timed.map(({ item }) => item.location),
  ["Earlier Low", "Highest Demand", "Later Medium", "Next Window"]
);
assert.equal(sameWindow.timed[0].rankInTimeWindow, 3);
assert.equal(sameWindow.timed[0].optionsInTimeWindow, 3);
assert.equal(sameWindow.timed[0].conflictCount, 2);
assert.equal(sameWindow.timed[1].rankInTimeWindow, 1);
assert.equal(sameWindow.timed[3].optionsInTimeWindow, 1);

const demandTieBreak = buildDemandFirstTimeline(
  [
    timed("Lower Opportunity", "4:30 PM", 20, 15),
    timed("Higher Opportunity", "4:35 PM", 20, 25),
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(demandTieBreak.timed[1].item.location, "Higher Opportunity");
assert.equal(demandTieBreak.timed[1].rankInTimeWindow, 1);

const noReachabilitySuppression = buildDemandFirstTimeline(
  [
    timed("Nearby", "4:15 PM", 20, 20),
    timed("Far Away High Demand", "4:16 PM", 50, 50),
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(noReachabilitySuppression.timed.length, 2);
assert.equal(noReachabilitySuppression.timed[1].item.location, "Far Away High Demand");
assert.equal(noReachabilitySuppression.timed[1].rankInTimeWindow, 1);

const current = buildDemandFirstTimeline(
  [
    { type: "event", location: "Current Low", densityScore: 30, opportunityScore: 40 },
    { type: "event", location: "Current High", densityScore: 60, opportunityScore: 60 },
  ],
  { nowMinute: 16 * 60 }
);
assert.deepEqual(
  current.current.map(({ item }) => item.location),
  ["Current High", "Current Low"]
);
assert.equal(current.current[0].timeLabel, "Now");
assert.equal(current.current[0].conflictCount, 1);

const hospitalAfterTrain = buildDemandFirstTimeline(
  [
    timed("Inbound — Rensselaer Train 233", "1:51 PM", 8, 3),
    {
      ...timed("Albany Med & St. Peter's Hospitals", "2:30 PM", 20, 14),
      windowStart: "2:30 PM",
      windowEnd: "3:30 PM",
    },
    {
      ...timed("Albany Med / University Heights", "3:15 PM", 7, 3),
      windowStart: "3:15 PM",
      windowEnd: "4:00 PM",
    },
    timed("Outbound — Empire State Plaza — Train 244", "3:30 PM", 10, 4),
  ],
  { nowMinute: 13 * 60 }
);
assert.deepEqual(
  hospitalAfterTrain.timed.map(({ item }) => item.location),
  [
    "Inbound — Rensselaer Train 233",
    "Albany Med & St. Peter's Hospitals",
    "Albany Med / University Heights",
    "Outbound — Empire State Plaza — Train 244",
  ]
);
assert.equal(hospitalAfterTrain.timed[1].conflictCount, 1);
assert.equal(hospitalAfterTrain.timed[2].optionsInTimeWindow, 2);
assert.equal(hospitalAfterTrain.timed[2].rankInTimeWindow, 2);
assert.equal(hospitalAfterTrain.timed[3].rankInTimeWindow, 1);

const activeThreshold = buildDemandFirstTimeline(
  [
    {
      type: "ride",
      location: "Qualifying current sequence event",
      densityScore: 4,
      opportunityScore: 4,
      sequenceOnly: true,
    },
    {
      type: "ride",
      location: "Below threshold",
      densityScore: 3,
      opportunityScore: 3,
      sequenceOnly: true,
    },
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(activeThreshold.current.length, 1);
assert.equal(activeThreshold.current[0].item.location, "Qualifying current sequence event");

const stackedLastCall = groupDemandFirstTimeSlots([
  { timeLabel: "11:15 PM", minute: 1395, item: { location: "The City Beer Hall" } },
  { timeLabel: "11:15 PM", minute: 1395, item: { location: "Tipsy Moose" } },
  { timeLabel: "11:30 PM", minute: 1410, item: { location: "Next Event" } },
]);
assert.equal(stackedLastCall.length, 2);
assert.deepEqual(
  stackedLastCall[0].candidates.map(({ item }) => item.location),
  ["The City Beer Hall", "Tipsy Moose"]
);
assert.equal(stackedLastCall[1].candidates.length, 1);

console.log("Demand-first timeline: 23 assertions passed.");
