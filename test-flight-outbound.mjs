import assert from "node:assert/strict";
import {
  computeOutboundFlightLeaveBy,
  densityScore,
  yieldRateFor,
} from "./app/api/dispatch/route.js";
import {
  aggregateOutboundFlightEvents,
  parseOutboundFlightText,
} from "./app/lib/byod-outbound-flight.mjs";
import {
  formatByodFlightDemandLabel,
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./components/byod-flight-labels.mjs";
import { formatDemandFirstTiming } from "./components/demand-first-timing.mjs";

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

const grouped = aggregateOutboundFlightEvents(
  [
    {
      ...event,
      location: "ALB Flight to LaGuardia",
      destination: "LaGuardia",
      destinationIata: "LGA",
      departureTime: "12:25 PM",
      leaveBy: "10:55 AM",
    },
    {
      ...event,
      location: "ALB Flight to Atlanta",
      destination: "Atlanta",
      destinationIata: "ATL",
      departureTime: "12:27 PM",
      leaveBy: "10:57 AM",
    },
    {
      ...event,
      location: "ALB Flight to Orlando",
      destination: "Orlando",
      destinationIata: "MCO",
      departureTime: "1:00 PM",
      leaveBy: "11:30 AM",
    },
  ],
  { nowMinute: 10 * 60 + 30 }
);
assert.equal(grouped.length, 2);
assert.equal(grouped[0].flightCount, 2);
assert.equal(grouped[0].volume, 2);
assert.equal(grouped[0].demandCap, 30);
assert.equal(grouped[0].leaveBy, "10:55 AM");
assert.deepEqual(grouped[0].destinations, ["LaGuardia", "Atlanta"]);
assert.equal(
  formatByodFlightHeading(grouped[0]),
  "Outbound — ALB Flight Wave to LaGuardia & Atlanta"
);
assert.equal(densityScore(grouped[0], 1, 1), 20);
assert.equal(
  formatDemandFirstTiming(grouped[0]),
  "Flights depart LaGuardia 12:25 PM; Atlanta 12:27 PM | Complete ALB drop-off by 10:55 AM"
);
assert.equal(grouped[1].destination, "Orlando");

console.log("BYOD outbound flights: 27 assertions passed.");
