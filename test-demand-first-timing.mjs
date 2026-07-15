import assert from "node:assert/strict";
import { formatDemandFirstTiming } from "./components/demand-first-timing.mjs";

assert.equal(
  formatDemandFirstTiming({
    type: "flight",
    categories: ["Inbound"],
    arrivalTime: "11:15 AM",
    leaveBy: "10:01 AM",
  }),
  "Arrival time 11:15 AM | Be there by 10:01 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    categories: ["BYOD Flight", "Outbound"],
    departureTime: "1:18 PM",
    leaveBy: "11:48 AM",
  }),
  "Departure time 1:18 PM | Be there by 11:48 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    categories: ["BYOD Train", "Outbound"],
    departureTime: "11:15 AM",
    leaveBy: "10:15 AM",
  }),
  "Departure time 11:15 AM | Be there by 10:15 AM"
);

assert.equal(
  formatDemandFirstTiming({ type: "train", hourBucket: "12 PM" }),
  "Arrival time 12 PM | Be there by 12 PM"
);
assert.equal(formatDemandFirstTiming({ type: "event", location: "Current Event" }), null);

console.log("Demand-first timing: 5 assertions passed.");
