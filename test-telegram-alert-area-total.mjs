import assert from "node:assert/strict";
import {
  buildTelegramAlertCandidate,
  buildTelegramAlertEvaluation,
} from "./app/api/dispatch/route.js";

const localStart = new Date("2026-07-21T16:00:00.000Z");

function activeRide(location) {
  return {
    type: "ride",
    location,
    densityScore: 25,
    opportunityScore: 25,
  };
}

function timedRide(location, hourBucket) {
  return { ...activeRide(location), hourBucket };
}

const referenceItinerary = [
  ...Array.from({ length: 4 }, () => activeRide("MVP Arena")),
  ...Array.from({ length: 7 }, () => activeRide("Albany Airport")),
];

const referenceAlert = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.0 },
  localStart
);
assert.equal(referenceAlert?.title, "Citywide Demand Total");
assert.match(referenceAlert.message, /Downtown: 4/);
assert.match(referenceAlert.message, /Uptown: 0/);
assert.match(referenceAlert.message, /Other Areas: 7/);
assert.match(referenceAlert.message, /Total Opportunities: 11/);
assert.match(referenceAlert.message, /Window: Current \/ Next 60 Minutes/);

const referenceEvaluation = buildTelegramAlertEvaluation(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.0 },
  localStart
);
assert.deepEqual(referenceEvaluation.areaCounts, { downtown: 4, uptown: 0, other: 7 });
assert.equal(referenceEvaluation.areaTotal, 11);
assert.equal(referenceEvaluation.normalSupply, true);
assert.equal(referenceEvaluation.aboveThreshold, true);
assert.equal(referenceEvaluation.eligible, true);

const displayedTimelineEvaluation = buildTelegramAlertEvaluation(
  {
    itinerary: [
      activeRide("Empire State Plaza"),
      ...Array.from({ length: 3 }, () => activeRide("Albany Airport")),
    ],
    sequenceCandidates: [
      activeRide("Colonie Center / Wolf Road Corridor"),
      timedRide("Colonie Center / Wolf Road Corridor", "5:00 PM"),
    ],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.deepEqual(
  displayedTimelineEvaluation.areaCounts,
  { downtown: 1, uptown: 0, other: 5 },
  "Telegram should count the same itinerary and sequence candidates shown in the UI"
);
assert.equal(displayedTimelineEvaluation.areaTotal, 6);
assert.equal(displayedTimelineEvaluation.eligible, true);

const duplicateCandidateEvaluation = buildTelegramAlertEvaluation(
  {
    itinerary: referenceItinerary.slice(0, 4),
    sequenceCandidates: [referenceItinerary[0]],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.equal(
  duplicateCandidateEvaluation.areaTotal,
  4,
  "an item present in both response lists should only be counted once"
);
assert.equal(duplicateCandidateEvaluation.eligible, false);

const fourTotal = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary.slice(0, 4), driverSupplyPressureMod: 1.0 },
  localStart
);
assert.equal(fourTotal, null, "normal supply should not alert when the total is exactly 4");

const fourCurrent = referenceItinerary.slice(0, 4);
const exactlySixtyMinutes = buildTelegramAlertCandidate(
  {
    itinerary: [...fourCurrent, timedRide("Crossgates Mall", "5:00 PM")],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.equal(
  exactlySixtyMinutes?.title,
  "Citywide Demand Total",
  "an opportunity exactly 60 minutes away should count"
);

const sixtyOneMinutes = buildTelegramAlertCandidate(
  {
    itinerary: [...fourCurrent, timedRide("Crossgates Mall", "5:01 PM")],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.equal(
  sixtyOneMinutes,
  null,
  "an opportunity 61 minutes away should not count"
);

const tightSupply = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.25 },
  localStart
);
assert.equal(tightSupply, null, "tight-supply alerts must be disabled");
const tightEvaluation = buildTelegramAlertEvaluation(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.25 },
  localStart
);
assert.equal(tightEvaluation.areaTotal, 11);
assert.equal(tightEvaluation.normalSupply, false);
assert.equal(tightEvaluation.aboveThreshold, true);
assert.equal(tightEvaluation.eligible, false);

const shortageSupply = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.5 },
  localStart
);
assert.equal(shortageSupply, null, "shortage alerts must be disabled");

const individualHighOpportunity = buildTelegramAlertCandidate(
  {
    itinerary: [{ ...activeRide("MVP Arena"), opportunityScore: 100 }],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.equal(
  individualHighOpportunity,
  null,
  "an individual high opportunity must not bypass the citywide total"
);

const goldenHalfHour = buildTelegramAlertCandidate(
  {
    itinerary: [],
    driverSupplyPressureMod: 1.0,
    peakSurgeWindow: { totalDensity: 100, timeWindow: "4:00 PM - 4:30 PM" },
  },
  localStart
);
assert.equal(goldenHalfHour, null, "Golden Half-Hour alerts must be disabled");

console.log("Telegram normal-supply 60-minute area total tests passed.");
