// Sprint 96 - BYOD Amtrak fare-class yield validator.

import {
  byodTrainDirectionFactor,
  byodTrainYieldFor,
  opportunityTimeLabelFor,
} from "./app/api/dispatch/route.js";

const cases = [
  {
    name: "Normal train defaults to 10",
    item: { availability: { coach: { status: "available" } } },
    expect: 10,
  },
  {
    name: "Coach almost full sets strong yield",
    item: { availability: { coach: { status: "almostFull" } } },
    expect: 15,
  },
  {
    name: "Coach sold out sets strongest base yield",
    item: { availability: { coach: { status: "soldOut" } } },
    expect: 22,
  },
  {
    name: "Business sold out is a moderate bonus only",
    item: { availability: { coach: { status: "available" }, business: { status: "soldOut" } } },
    expect: 14,
  },
  {
    name: "Coach almost full plus business sold out stacks",
    item: { availability: { coach: { status: "almostFull" }, business: { status: "soldOut" } } },
    expect: 19,
  },
  {
    name: "Private rooms sold out is small",
    item: { availability: { coach: { status: "available" }, privateRooms: { status: "soldOut" } } },
    expect: 12,
  },
  {
    name: "Scarcity stack caps at 28",
    item: {
      availability: {
        coach: { status: "soldOut" },
        business: { status: "soldOut" },
        privateRooms: { status: "soldOut" },
      },
    },
    expect: 28,
  },
  {
    name: "Regular inbound sold-out train keeps the full yield",
    item: { categories: ["BYOD Train", "Inbound", "Sold Out"] },
    expect: 22,
  },
  {
    name: "Empire 28x inbound through train receives a moderate discount",
    item: {
      trainNumber: "281",
      categories: ["BYOD Train", "Inbound", "Sold Out"],
    },
    expect: 17,
  },
  {
    name: "Albany-focused inbound train keeps full demand",
    item: {
      trainNumber: "237",
      categories: ["BYOD Train", "Inbound", "Sold Out"],
    },
    expect: 22,
  },
  {
    name: "Outbound train ingress receives the boarding discount",
    item: {
      trainNumber: "281",
      categories: ["BYOD Train", "Outbound", "Sold Out"],
    },
    expect: 14,
  },
  {
    name: "Normal outbound demand ranks below normal inbound demand",
    item: {
      trainNumber: "237",
      categories: ["BYOD Train", "Outbound", "On Time"],
      availability: { coach: { status: "available" } },
    },
    expect: 7,
  },
];

let allPass = true;
console.log("=== Sprint 96 Amtrak Fare-Class Yield - Test Run ===\n");
for (const c of cases) {
  const got = byodTrainYieldFor(c.item);
  const ok = got === c.expect;
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${c.expect}\n  got      ${got}`);
}
if (byodTrainDirectionFactor({ categories: ["BYOD Train", "Inbound"], trainNumber: "237" }) !== 1) {
  allPass = false;
}
if (byodTrainDirectionFactor({ categories: ["BYOD Train", "Inbound"], trainNumber: "281" }) !== 0.75) {
  allPass = false;
}
if (byodTrainDirectionFactor({ categories: ["BYOD Train", "Outbound"], trainNumber: "237" }) !== 0.65) {
  allPass = false;
}
if (opportunityTimeLabelFor({ categories: ["BYOD Train", "Inbound"], leaveBy: "3:45 PM" }) !== "3:33 PM") {
  allPass = false;
}
if (opportunityTimeLabelFor({ categories: ["BYOD Train", "Outbound"], leaveBy: "3:30 PM" }) !== "3:30 PM") {
  allPass = false;
}
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
