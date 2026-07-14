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
assert.equal(sameWindow.selected[1].item.location, "Next Window");

const opportunityTieBreak = buildDemandFirstSelection(
  [
    timed("Lower Opportunity", "4:30 PM", 20, 15),
    timed("Higher Opportunity", "4:35 PM", 20, 25),
  ],
  { nowMinute: 16 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(opportunityTieBreak.selected[0].item.location, "Higher Opportunity");

const unreachableWinner = buildDemandFirstSelection(
  [
    timed("Reachable", "4:15 PM", 20, 20, 42.65, -73.75),
    timed("Unreachable High", "4:16 PM", 50, 50, 43.2, -74.2),
  ],
  { nowMinute: 16 * 60, driverCoords: { latitude: 42.65, longitude: -73.75 } }
);
assert.equal(unreachableWinner.selected[0].item.location, "Reachable");

const active = buildDemandFirstSelection(
  [
    { type: "event", location: "Current Low", densityScore: 30, opportunityScore: 40 },
    { type: "event", location: "Current High", densityScore: 60, opportunityScore: 60 },
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(active.activeNow.location, "Current High");
assert.equal(active.activeCompetingOptions, 2);

const deliveryCompetesNormally = buildDemandFirstSelection(
  [
    { type: "event", location: "Current Event", densityScore: 30, opportunityScore: 30 },
    { type: "food", location: "Food Winner", densityScore: 40, opportunityScore: 35 },
    { type: "grocery", location: "Grocery Lower", densityScore: 20, opportunityScore: 50 },
  ],
  { nowMinute: 16 * 60 }
);
assert.equal(deliveryCompetesNormally.activeNow.location, "Food Winner");
assert.equal(deliveryCompetesNormally.activeCompetingOptions, 3);

const smallDelivery = buildDemandFirstSelection(
  [{ type: "food", location: "Small Food Opportunity", densityScore: 5, opportunityScore: 5 }],
  { nowMinute: 16 * 60 }
);
assert.equal(smallDelivery.activeNow.location, "Small Food Opportunity");

console.log("Demand-first sequence: 10 assertions passed.");
