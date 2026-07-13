import assert from "node:assert/strict";
import { computeTemporalModifiers } from "./app/api/dispatch/route.js";

function mondayAt(hour) {
  return new Date(Date.UTC(2026, 6, 13, hour, 0, 0));
}

assert.equal(computeTemporalModifiers(mondayAt(0)).foodMod, 0.8);
assert.equal(computeTemporalModifiers(mondayAt(1)).foodMod, 0.8);
assert.equal(computeTemporalModifiers(mondayAt(2)).foodMod, 0.25);
assert.equal(computeTemporalModifiers(mondayAt(5)).foodMod, 0.25);
assert.equal(computeTemporalModifiers(mondayAt(6)).foodMod, 1.0);
assert.equal(computeTemporalModifiers(mondayAt(13)).foodMod, 1.5);
assert.equal(computeTemporalModifiers(mondayAt(14)).foodMod, 0.5);
assert.equal(computeTemporalModifiers(mondayAt(16)).foodMod, 0.5);
assert.equal(computeTemporalModifiers(mondayAt(17)).foodMod, 1.5);
assert.equal(computeTemporalModifiers(mondayAt(20)).foodMod, 1.5);
assert.equal(computeTemporalModifiers(mondayAt(21)).foodMod, 0.8);
assert.equal(computeTemporalModifiers(mondayAt(23)).foodMod, 0.8);
assert.equal(computeTemporalModifiers(mondayAt(23)).rideMod, 1.0);

const fridayAt22 = new Date(Date.UTC(2026, 6, 17, 22, 0, 0));
assert.equal(computeTemporalModifiers(fridayAt22).rideMod, 1.15);

console.log("Food time windows: 14 assertions passed.");
