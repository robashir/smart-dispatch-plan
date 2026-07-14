import assert from "node:assert/strict";
import {
  computeOutboundFlightLeaveBy,
  densityScore,
  yieldRateFor,
} from "./app/api/dispatch/route.js";
import { parseOutboundFlightText } from "./app/lib/byod-outbound-flight.mjs";
import {
  formatByodFlightDemandLabel,
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./components/byod-flight-labels.mjs";

const cities = {
  Chicago: "ORD",
  Atlanta: "ATL",
  Orlando: "MCO",
  LaGuardia: "LGA",
};

const sample = `Chicago 10:30 AM
Chicago 10:40 AM
Atlanta 11:24 AM
Orlando 12:22 PM
LaGuardia/LGA 12:47 PM`;
const parsed = parseOutboundFlightText(sample, cities);
assert.equal(parsed.length, 5);
assert.deepEqual(parsed[0], {
  destination: "Chicago",
  iata: "ORD",
  departureTime: "10:30 AM",
  status: "On Time",
});
assert.equal(parsed[1].departureTime, "10:40 AM");
assert.equal(parsed[4].iata, "LGA");

const filtered = parseOutboundFlightText(
  `Chicago 10:30 AM
Chicago 10:30 AM
Atlanta 9:00 AM 11:24 AM Delayed
Orlando 12:22 PM Cancelled`,
  cities
);
assert.equal(filtered.length, 2);
assert.equal(filtered[1].departureTime, "11:24 AM");
assert.equal(filtered[1].status, "Delayed");

assert.equal(
  computeOutboundFlightLeaveBy("10:30 AM", new Date("2026-07-14T08:00:00Z")),
  "9:00 AM"
);
assert.equal(
  computeOutboundFlightLeaveBy("10:30 AM", new Date("2026-07-14T09:20:00Z")),
  "9:20 AM"
);
assert.equal(
  computeOutboundFlightLeaveBy("10:30 AM", new Date("2026-07-14T09:46:00Z")),
  null
);
assert.equal(
  computeOutboundFlightLeaveBy("12:30 AM", new Date("2026-07-14T22:00:00Z")),
  "11:00 PM"
);

const event = {
  type: "event",
  volume: 1,
  categories: ["BYOD Flight", "Outbound", "On Time"],
  destination: "Chicago",
};
assert.equal(yieldRateFor(event), 10);
assert.equal(densityScore(event, 1, 1), 10);
assert.equal(isByodOutboundFlight(event), true);
assert.equal(formatByodFlightHeading(event), "Outbound — ALB Flight to Chicago");
assert.equal(formatByodFlightDemandLabel(event), "Outbound Flight Demand");

console.log("BYOD outbound flights: 17 assertions passed.");
