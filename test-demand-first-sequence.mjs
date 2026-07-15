import assert from "node:assert/strict";
import { buildDemandFirstSelection } from "./components/demand-first-sequence.mjs";

function timed(location, leaveBy, demand, opportunity, lat = 42.65, lng = -73.75) {
  return {
    type: "event",
    location,
    leaveBy,
    densityScore: demand,
    opportunityScore: opportunity,
    lat,
    lng,
  };
}

const sameWindow = buildDemandFirstSelection(
  [
    timed("Earlier Low", "4:30 PM", 10, 15),
    timed("Highest Demand", "4:35 PM", 30, 20),
    timed("Later Medium", "4:42 PM", 20, 40),
    timed("Next Window", "5:10 PM", 12, 12),
  ],
  { nowMinute: 16 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(sameWindow.selected[0].item.location, "Highest Demand");
assert.equal(sameWindow.selected[0].competingOptions, 3);
assert.equal(sameWindow.selected[0].alternatives.length, 2);
assert.equal(sameWindow.selected[0].alternatives[0].reason, "Lower expected demand");
assert.equal(sameWindow.selected[1].item.location, "Next Window");

const opportunityTieBreak = buildDemandFirstSelection(
  [
    timed("Lower Opportunity", "4:30 PM", 20, 15),
    timed("Higher Opportunity", "4:35 PM", 20, 25),
  ],
  { nowMinute: 16 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(opportunityTieBreak.selected[0].item.location, "Higher Opportunity");
assert.equal(
  opportunityTieBreak.selected[0].alternatives[0].reason,
  "Lower Opportunity Now after demand tie"
);

const unreachableWinner = buildDemandFirstSelection(
  [
    timed("Reachable", "4:15 PM", 20, 20, 42.65, -73.75),
    timed("Unreachable High", "4:16 PM", 50, 50, 43.2, -74.2),
  ],
  { nowMinute: 16 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(unreachableWinner.selected[0].item.location, "Reachable");
assert.equal(unreachableWinner.selected[0].alternatives[0].item.location, "Unreachable High");
assert.equal(
  unreachableWinner.selected[0].alternatives[0].reason,
  "Unreachable before its deadline"
);

const active = buildDemandFirstSelection(
  [
    { type: "event", location: "Current Low", densityScore: 30, opportunityScore: 40 },
    { type: "event", location: "Current High", densityScore: 60, opportunityScore: 60 },
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(active.activeNow.location, "Current High");
assert.equal(active.activeCompetingOptions, 2);
assert.equal(active.activeAlternatives.length, 1);
assert.equal(active.activeAlternatives[0].item.location, "Current Low");

const scheduledWindowCompetition = buildDemandFirstSelection(
  [
    {
      ...timed("Albany Hospitals", "3:00 PM", 20, 20),
      windowStart: "3:00 PM",
      windowEnd: "4:00 PM",
    },
    timed("Rensselaer Train", "3:30 PM", 10, 10),
    {
      ...timed("Government Staff Dismissal", "4:00 PM", 30, 30),
      windowStart: "4:00 PM",
      windowEnd: "4:30 PM",
    },
    {
      ...timed("Government Staff Dismissal Taper", "4:30 PM", 20, 20),
      windowStart: "4:30 PM",
      windowEnd: "5:00 PM",
    },
  ],
  { nowMinute: 14 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(scheduledWindowCompetition.selected[0].item.location, "Albany Hospitals");
assert.equal(scheduledWindowCompetition.selected[0].competingOptions, 2);
assert.equal(
  scheduledWindowCompetition.selected[0].alternatives[0].item.location,
  "Rensselaer Train"
);
assert.equal(
  scheduledWindowCompetition.selected[1].item.location,
  "Government Staff Dismissal Taper"
);

const noTransitiveOverlapChain = buildDemandFirstSelection(
  [
    {
      ...timed("Afternoon Clinic Shift", "2:30 PM", 20, 20),
      windowStart: "2:30 PM",
      windowEnd: "3:30 PM",
    },
    {
      ...timed("Last Call", "3:15 PM", 18, 12),
      windowStart: "3:15 PM",
      windowEnd: "3:30 PM",
    },
    timed("Bridge A", "3:25 PM", 10, 10),
    timed("Bridge B", "3:41 PM", 10, 10),
    timed("Bridge C", "3:55 PM", 10, 10),
    {
      ...timed("Peak Exit Wave", "4:00 PM", 100, 40),
      windowStart: "4:00 PM",
      windowEnd: "4:30 PM",
    },
  ],
  { nowMinute: 14 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(noTransitiveOverlapChain.selected[0].item.location, "Afternoon Clinic Shift");
assert.equal(noTransitiveOverlapChain.selected[0].competingOptions, 3);
assert.equal(noTransitiveOverlapChain.selected[1].item.location, "Peak Exit Wave");
assert.equal(noTransitiveOverlapChain.selected[1].competingOptions, 3);

const flightCrossesStateBoundary = buildDemandFirstSelection(
  [
    {
      type: "event",
      location: "Albany Hospitals",
      densityScore: 20,
      opportunityScore: 20,
      windowStart: "2:30 PM",
      windowEnd: "3:30 PM",
      activeNow: true,
      sequenceOnly: true,
      lat: 42.6534,
      lng: -73.7933,
    },
    {
      ...timed("Earlier Local Anchor", "3:15 PM", 7, 5, 42.6534, -73.7933),
      windowStart: "3:15 PM",
      windowEnd: "4:00 PM",
    },
    {
      type: "flight",
      hub: "ALB",
      leaveBy: "3:58 PM",
      curbTime: "4:09 PM",
      densityScore: 15,
      opportunityScore: 11,
      lat: 42.7483,
      lng: -73.8017,
    },
    {
      ...timed("Peak Exit Wave", "4:00 PM", 100, 40, 42.6514, -73.7608),
      windowStart: "4:00 PM",
      windowEnd: "4:30 PM",
    },
  ],
  { nowMinute: 15 * 60, driverCoords: { latitude: 42.6534, longitude: -73.7933 } }
);
assert.equal(flightCrossesStateBoundary.activeNow.location, "Albany Hospitals");
assert.equal(flightCrossesStateBoundary.selected[0].item.location, "Peak Exit Wave");
assert.equal(flightCrossesStateBoundary.selected[0].competingOptions, 3);
assert.equal(
  flightCrossesStateBoundary.selected[0].alternatives.some(
    (alternative) => alternative.item.hub === "ALB"
  ),
  true
);

console.log("Demand-first sequence: 26 assertions passed.");
