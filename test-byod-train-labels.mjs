import assert from "node:assert/strict";
import {
  formatByodTrainDemandLabel,
  formatDemandFirstByodTrainHeading,
  formatByodTrainHeading,
  getByodTrainSalesStatus,
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

const soldOutInbound = {
  ...inbound,
  categories: ["BYOD Train", "Inbound", "Sold Out"],
};
assert.equal(getByodTrainSalesStatus(soldOutInbound), "Sold Out");
assert.equal(
  formatDemandFirstByodTrainHeading(soldOutInbound),
  "Inbound — Rensselaer Train 283 — Sold Out"
);

const almostFullOutbound = {
  ...outbound,
  categories: ["BYOD Train", "Outbound", "Almost Full"],
};
assert.equal(getByodTrainSalesStatus(almostFullOutbound), "Almost Sold Out");
assert.equal(
  formatDemandFirstByodTrainHeading(almostFullOutbound),
  "Outbound — Empire State Plaza — Train 64 — Almost Sold Out"
);
assert.equal(formatDemandFirstByodTrainHeading(inbound), formatByodTrainHeading(inbound));

console.log("BYOD train labels: 12 assertions passed.");
