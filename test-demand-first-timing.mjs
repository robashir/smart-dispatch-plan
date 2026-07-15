import assert from "node:assert/strict";
import {
  formatDemandFirstTiming,
  formatSuggestedServiceTiming,
} from "./components/demand-first-timing.mjs";

assert.equal(
  formatDemandFirstTiming({
    type: "flight",
    categories: ["Inbound"],
    arrivalTime: "11:15 AM",
    leaveBy: "10:01 AM",
  }),
  "Arrives 11:15 AM | Leave for ALB by 10:01 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "flight",
    categories: ["Inbound"],
    arrivalTime: "10:32 AM",
    curbTime: "10:57 AM",
    leaveBy: "10:46 AM",
  }),
  "Arrives 10:32 AM | Expected curb 10:57 AM | Leave for ALB by 10:46 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    categories: ["BYOD Flight", "Outbound"],
    departureTime: "1:18 PM",
    leaveBy: "11:48 AM",
  }),
  "Departs 1:18 PM | Complete ALB drop-off by 11:48 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    categories: ["BYOD Train", "Outbound"],
    departureTime: "11:15 AM",
    leaveBy: "10:15 AM",
  }),
  "Train departs 11:15 AM | Be at Empire State Plaza by 10:01 AM"
);

assert.equal(
  formatDemandFirstTiming({ type: "train", hourBucket: "12 PM" }),
  "Be at Rensselaer by 11:46 AM"
);
assert.equal(formatDemandFirstTiming({ type: "event", location: "Current Event" }), null);

assert.equal(
  formatSuggestedServiceTiming({
    type: "flight",
    arrivalTime: "10:32 AM",
    curbTime: "10:57 AM",
  }),
  "Arrives 10:32 AM | Expected curb 10:57 AM"
);

console.log("Demand-first timing: 7 assertions passed.");
