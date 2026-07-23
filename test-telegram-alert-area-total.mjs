import assert from "node:assert/strict";
import {
  buildTelegramAlertCandidate,
  buildTelegramAlertEvaluation,
  buildTelegramAlertForecast,
  collapseTelegramAlertDemandPhases,
  shouldSendTelegramDemandTransition,
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
assert.match(referenceAlert.message, /total is more than 9/);
assert.match(referenceAlert.message, /Downtown Expected Demand: 100/);
assert.match(referenceAlert.message, /Other Areas Expected Demand: 175/);
assert.match(referenceAlert.message, /Areas Meeting Expected Demand >= 25: 2/);
assert.match(referenceAlert.message, /Driver Supply: Normal \(1\.00\)/);

const referenceEvaluation = buildTelegramAlertEvaluation(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.0 },
  localStart
);
assert.deepEqual(referenceEvaluation.areaCounts, { downtown: 4, uptown: 0, other: 7 });
assert.equal(referenceEvaluation.areaTotal, 11);
assert.deepEqual(referenceEvaluation.areaExpectedDemand, {
  downtown: 100,
  uptown: 0,
  other: 175,
});
assert.deepEqual(referenceEvaluation.qualifyingDemandAreas, ["downtown", "other"]);
assert.equal(referenceEvaluation.enoughDemandAreas, true);
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
assert.deepEqual(displayedTimelineEvaluation.areaExpectedDemand, {
  downtown: 25,
  uptown: 0,
  other: 125,
});
assert.deepEqual(
  displayedTimelineEvaluation.qualifyingDemandAreas,
  ["downtown", "other"],
  "an area with expected demand exactly 25 should qualify"
);
assert.equal(displayedTimelineEvaluation.enoughDemandAreas, true);
assert.equal(displayedTimelineEvaluation.aboveThreshold, false);
assert.equal(displayedTimelineEvaluation.eligible, false);

const taperedCandidates = [
  {
    ...timedRide("Colonie Center / Wolf Road Corridor", "4:05 PM"),
    type: "event",
    densityScore: 4,
    sourceEventKey: "colonie-retail-closing-2026-07-21",
    categories: ["Local Anchor", "Retail Closing Pulse", "Build"],
  },
  {
    ...timedRide("Colonie Center / Wolf Road Corridor", "4:35 PM"),
    type: "event",
    densityScore: 6,
    sourceEventKey: "colonie-retail-closing-2026-07-21",
    categories: ["Local Anchor", "Retail Closing Pulse", "Peak"],
  },
  {
    ...timedRide("Colonie Center / Wolf Road Corridor", "4:55 PM"),
    type: "event",
    densityScore: 4,
    sourceEventKey: "colonie-retail-closing-2026-07-21",
    categories: ["Local Anchor", "Retail Closing Pulse", "Taper"],
  },
];
const collapsedTaperedCandidates = collapseTelegramAlertDemandPhases(
  taperedCandidates.map((item) => ({ item }))
);
assert.equal(
  collapsedTaperedCandidates.length,
  1,
  "Build, Peak, and Taper phases of one event should count as one opportunity"
);
assert.equal(
  collapsedTaperedCandidates[0].item.densityScore,
  6,
  "a tapered event should contribute its highest eligible phase demand"
);

const taperedEvaluation = buildTelegramAlertEvaluation(
  {
    itinerary: [],
    sequenceCandidates: taperedCandidates,
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.deepEqual(taperedEvaluation.areaCounts, { downtown: 0, uptown: 0, other: 1 });
assert.deepEqual(taperedEvaluation.areaExpectedDemand, {
  downtown: 0,
  uptown: 0,
  other: 6,
});

const ingressAndEgress = collapseTelegramAlertDemandPhases([
  {
    item: {
      ...taperedCandidates[0],
      sourceEventKey: "arena-show",
      categories: ["BYOD Event", "Ingress", "Music", "Build"],
    },
  },
  {
    item: {
      ...taperedCandidates[1],
      sourceEventKey: "arena-show",
      categories: ["BYOD Event", "Egress", "Music", "Peak"],
    },
  },
]);
assert.equal(
  ingressAndEgress.length,
  2,
  "ingress and egress for the same event should remain separate opportunities"
);

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

const onlyOneDemandArea = buildTelegramAlertEvaluation(
  {
    itinerary: [
      activeRide("Empire State Plaza"),
      ...Array.from({ length: 9 }, () => ({
        ...activeRide("Albany Airport"),
        densityScore: 2,
      })),
    ],
    driverSupplyPressureMod: 1.0,
  },
  localStart
);
assert.equal(onlyOneDemandArea.areaTotal, 10);
assert.deepEqual(onlyOneDemandArea.qualifyingDemandAreas, ["downtown"]);
assert.equal(onlyOneDemandArea.aboveThreshold, true);
assert.equal(onlyOneDemandArea.enoughDemandAreas, false);
assert.equal(onlyOneDemandArea.eligible, false);

const nineTotal = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary.slice(0, 9), driverSupplyPressureMod: 1.0 },
  localStart
);
assert.equal(nineTotal, null, "normal supply should not alert when the total is exactly 9");

const nineCurrent = referenceItinerary.slice(0, 9);
const exactlySixtyMinutes = buildTelegramAlertCandidate(
  {
    itinerary: [...nineCurrent, timedRide("Crossgates Mall", "5:00 PM")],
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
    itinerary: [...nineCurrent, timedRide("Crossgates Mall", "5:01 PM")],
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
assert.equal(tightSupply?.title, "Citywide Demand Total");
assert.match(tightSupply.message, /Driver Supply: Tight \(1\.25\)/);
const tightEvaluation = buildTelegramAlertEvaluation(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.25 },
  localStart
);
assert.equal(tightEvaluation.areaTotal, 11);
assert.equal(tightEvaluation.normalSupply, false);
assert.equal(tightEvaluation.aboveThreshold, true);
assert.equal(tightEvaluation.eligible, true);

const shortageSupply = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary, driverSupplyPressureMod: 1.5 },
  localStart
);
assert.equal(shortageSupply?.title, "Citywide Demand Total");
assert.match(shortageSupply.message, /Driver Supply: Very Tight \(1\.50\)/);

assert.equal(
  shouldSendTelegramDemandTransition({ eligible: false }, referenceEvaluation),
  true,
  "demand should alert when it changes from not qualified to qualified"
);
assert.equal(
  shouldSendTelegramDemandTransition({ eligible: true }, referenceEvaluation),
  false,
  "continuously qualified demand should not repeat an alert"
);
assert.equal(
  shouldSendTelegramDemandTransition({ eligible: false }, displayedTimelineEvaluation),
  false,
  "non-qualifying demand should not alert"
);

const forecastAtCurrentCheck = buildTelegramAlertForecast(
  {
    itinerary: referenceItinerary,
    sequenceCandidates: [],
    hours: 1,
    driverSupplyPressureMod: 1.5,
  },
  localStart
);
assert.equal(forecastAtCurrentCheck.status, "qualifies_now");
assert.equal(forecastAtCurrentCheck.firstEligibleTime, "4:00 PM");
assert.equal(forecastAtCurrentCheck.evaluation.areaTotal, 11);

const futureForecast = buildTelegramAlertForecast(
  {
    itinerary: [
      ...Array.from({ length: 5 }, () => timedRide("MVP Arena", "5:15 PM")),
      ...Array.from({ length: 5 }, () => timedRide("Albany Airport", "5:15 PM")),
    ],
    sequenceCandidates: [],
    hours: 2,
    driverSupplyPressureMod: 1.5,
  },
  localStart
);
assert.equal(futureForecast.status, "expected");
assert.equal(futureForecast.firstEligibleTime, "4:15 PM");
assert.equal(futureForecast.evaluation.areaTotal, 10);
assert.deepEqual(futureForecast.evaluation.qualifyingDemandAreas, [
  "downtown",
  "other",
]);

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
