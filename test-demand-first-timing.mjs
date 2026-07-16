import assert from "node:assert/strict";
import {
  formatDemandFirstTiming,
  formatSuggestedServiceTiming,
  getDemandFirstDeadline,
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
    type: "flight",
    categories: ["Inbound"],
    flightDetails: [
      { arrivalTime: "12:47 PM", curbTime: "1:12 PM" },
      { arrivalTime: "12:48 PM", curbTime: "1:13 PM" },
    ],
    arrivalTime: "12:47 PM",
    curbTime: "1:13 PM",
    leaveBy: "1:01 PM",
  }),
  "Arrivals 12:47–12:48 PM | Expected curb 1:12–1:13 PM | Leave for ALB by 1:01 PM"
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
  "Train departs 11:15 AM | Be at Empire State Plaza by 10:15 AM"
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

assert.deepEqual(
  getDemandFirstDeadline({
    type: "event",
    categories: ["BYOD Train", "Outbound"],
    leaveBy: "3:30 PM",
  }),
  { label: "3:30 PM", instruction: "Be at Empire State Plaza by 3:30 PM" }
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    categories: ["BYOD Flight", "Outbound"],
    departureTimes: [
      { destination: "LaGuardia", time: "12:25 PM" },
      { destination: "Atlanta", time: "12:27 PM" },
    ],
    leaveBy: "10:55 AM",
  }),
  "Flights depart LaGuardia 12:25 PM; Atlanta 12:27 PM | Complete ALB drop-off by 10:55 AM"
);

assert.equal(
  formatDemandFirstTiming({
    type: "event",
    leaveBy: "3:00 PM",
    windowStart: "3:00 PM",
    windowEnd: "4:00 PM",
  }),
  "Demand window 3:00 PM–4:00 PM | Be there by 3:00 PM"
);

console.log("Demand-first timing: 11 assertions passed.");
