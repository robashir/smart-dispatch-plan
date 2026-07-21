import assert from "node:assert/strict";
import { buildTelegramAlertCandidate } from "./app/api/dispatch/route.js";

const localStart = new Date("2026-07-21T16:00:00.000Z");

function activeRide(location) {
  return {
    type: "ride",
    location,
    densityScore: 25,
    opportunityScore: 25,
  };
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

const nineTotal = buildTelegramAlertCandidate(
  { itinerary: referenceItinerary.slice(0, 9), driverSupplyPressureMod: 1.0 },
  localStart
);
assert.equal(nineTotal, null, "normal supply should not alert when the total is exactly 9");

const tightSupply = buildTelegramAlertCandidate(
  { itinerary: [activeRide("MVP Arena")], driverSupplyPressureMod: 1.25 },
  localStart
);
assert.equal(tightSupply?.title, "MVP Arena", "tight-supply rules should remain unchanged");

console.log("Telegram normal-supply area total tests passed.");
