import assert from "node:assert/strict";
import {
  formatByodTrainDemandLabel,
  formatByodTrainHeading,
  getByodTrainDirection,
} from "./components/byod-train-labels.mjs";

const inbound = {
  location: "Rensselaer Train 283",
  categories: ["BYOD Train", "Inbound", "On Time"],
};
const outbound = {
  location: "Empire State Plaza — Outbound Train 64",
  categories: ["BYOD Train", "Outbound", "On Time"],
};

assert.equal(getByodTrainDirection(inbound), "Inbound");
assert.equal(formatByodTrainHeading(inbound), "Inbound — Rensselaer Train 283");
assert.equal(formatByodTrainDemandLabel(inbound), "Inbound Train Demand");
assert.equal(getByodTrainDirection(outbound), "Outbound");
assert.equal(formatByodTrainHeading(outbound), "Outbound — Empire State Plaza — Train 64");
assert.equal(formatByodTrainDemandLabel(outbound), "Outbound Train Demand");
assert.equal(formatByodTrainHeading({ location: "Generic Event" }), "Generic Event");

console.log("BYOD train labels: 7 assertions passed.");
