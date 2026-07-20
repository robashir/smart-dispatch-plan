import assert from "node:assert/strict";
import {
  demandFirstAreaFor,
  normalizeDemandFirstAreaFilters,
} from "./components/demand-first-areas.mjs";

assert.equal(demandFirstAreaFor({ location: "Inbound — Rensselaer Train 233" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "MVP Arena" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Empire State Plaza & Harriman Campus" }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Crossgates Mall" }), "uptown");
assert.equal(demandFirstAreaFor({ location: "UAlbany Uptown Campus" }), "uptown");
assert.equal(demandFirstAreaFor({ location: "Inbound — ALB Flight Arrivals" }), "other");
assert.equal(demandFirstAreaFor({ location: "Albany Med & St. Peter's Hospitals" }), "other");
assert.equal(demandFirstAreaFor({ location: "Unknown", lat: 42.65, lng: -73.75 }), "downtown");
assert.equal(demandFirstAreaFor({ location: "Unknown", lat: 42.68, lng: -73.83 }), "uptown");
assert.deepEqual(normalizeDemandFirstAreaFilters({ downtown: false }), {
  downtown: false,
  uptown: true,
  other: true,
});

console.log("Demand-first areas: 10 assertions passed.");
