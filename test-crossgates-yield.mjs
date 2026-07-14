import assert from "node:assert/strict";
import { densityScore, yieldRateFor } from "./app/api/dispatch/route.js";

const crossgates = {
  type: "event",
  location: "Crossgates Mall",
  volume: 1,
  egressMod: 3,
  categories: ["Retail Egress", "Closing Surge"],
};

assert.equal(yieldRateFor(crossgates), 36);
assert.equal(densityScore(crossgates, 1, 1), 36);
assert.equal(yieldRateFor({ ...crossgates, egressMod: 1 }), 12);
assert.equal(
  yieldRateFor({ type: "event", volume: 1, egressMod: 3, categories: ["Sports"] }),
  500
);

console.log("Crossgates yield: 4 assertions passed.");
