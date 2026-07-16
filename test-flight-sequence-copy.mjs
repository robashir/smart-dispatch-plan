import assert from "node:assert/strict";
import {
  formatInboundFlightArrivalWindow,
  formatInboundFlightSequenceHeading,
  formatOutboundFlightNextWindow,
  inboundFlightOriginLabels,
} from "./components/flight-sequence-copy.mjs";

const inbound = {
  type: "flight",
  hub: "ALB",
  originLabels: ["Orlando", "Orlando"],
  origins: ["MCO"],
};

assert.deepEqual(inboundFlightOriginLabels(inbound), ["Orlando"]);
assert.equal(
  formatInboundFlightSequenceHeading(inbound),
  "Inbound — ALB Flight Arrivals from Orlando"
);
assert.equal(
  formatInboundFlightSequenceHeading({ type: "flight", originLabel: "Atlanta" }),
  "Inbound — ALB Flight Arrivals from Atlanta"
);
assert.equal(
  formatInboundFlightSequenceHeading({ type: "flight", origins: ["ORD"] }),
  "Inbound — ALB Flight Arrivals from ORD"
);
assert.equal(
  formatInboundFlightSequenceHeading({
    type: "flight",
    isFlightWave: true,
    originLabels: ["New York (LGA)", "Chicago"],
  }),
  "Inbound — ALB Arrival Wave from New York (LGA) & Chicago"
);
assert.equal(
  formatInboundFlightSequenceHeading({ type: "flight" }),
  "Inbound — ALB Flight Arrivals"
);
assert.equal(
  formatInboundFlightArrivalWindow(inbound),
  "Stay near ALB for the arrival window from Orlando."
);
assert.equal(
  formatOutboundFlightNextWindow({ destination: "Atlanta" }),
  "Look for an ALB-bound ride ahead of the Atlanta departure window."
);
assert.equal(
  formatOutboundFlightNextWindow({}),
  "Look for an ALB-bound ride ahead of the next departure window."
);

console.log("Flight sequence copy: 9 assertions passed.");
