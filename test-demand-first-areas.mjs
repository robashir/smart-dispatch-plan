import assert from "node:assert/strict";
import {
  demandFirstAreaCounts,
  demandFirstAreaFor,
  normalizeDemandFirstAreaFilters,
} from "./components/demand-first-areas.mjs";

assert.equal(demandFirstAreaFor({ location: "Inbound — Rensselaer Train 233" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "MVP Arena" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Empire State Plaza & Harriman Campus" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Crossgates Mall" }), "uptown");
assert.equal(demandFirstAreaFor({ location: "UAlbany Uptown Campus" }), "uptown");
assert.equal(demandFirstAreaFor({ location: "Inbound — ALB Flight Arrivals" }), "other");
assert.equal(
  demandFirstAreaFor({
    location: "Albany Med & St. Peter's Hospitals — Shift Change",
  }),
  "downtown"
);
assert.equal(demandFirstAreaFor({ location: "An Unrelated Hospital" }), "other");
assert.equal(demandFirstAreaFor({ location: "Unknown", lat: 42.65, lng: -73.75 }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Unknown", lat: 42.68, lng: -73.83 }), "uptown");
assert.deepEqual(normalizeDemandFirstAreaFilters({ downtown: false }), {
  downtown: false,
  uptown: true,
  other: true,
});
assert.deepEqual(
  demandFirstAreaCounts([
    { item: { location: "MVP Arena" } },
    { item: { location: "Crossgates Mall" } },
    { item: { location: "Albany Airport" } },
    { item: { location: "Another Airport" } },
  ]),
  { downtown: 1, uptown: 1, other: 2 }
);

console.log("Demand-first areas: 12 assertions passed.");
