// Sprint 96 - BYOD Amtrak fare-class yield validator.

const BYOD_TRAIN_YIELDS = {
  default: 10,
  almostFull: 15,
  soldOut: 22,
};

function byodTrainAlbanyAlightingFactor(item) {
  const catsAll = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  const trainNumber = String(item?.trainNumber || "").trim();
  if (!/BYOD Train/i.test(catsAll) || !/Inbound/i.test(catsAll)) return 1.0;
  if (/^28\d/.test(trainNumber)) return 0.45;
  return 0.8;
}

function byodTrainYieldFor(item) {
  let yieldValue = BYOD_TRAIN_YIELDS.default;
  const availability = item?.availability;
  if (availability && typeof availability === "object") {
    const coach = String(availability?.coach?.status || "").toLowerCase();
    const business = String(availability?.business?.status || "").toLowerCase();
    const privateRooms = String(availability?.privateRooms?.status || "").toLowerCase();

    if (coach === "almostfull") yieldValue = BYOD_TRAIN_YIELDS.almostFull;
    if (coach === "soldout") yieldValue = BYOD_TRAIN_YIELDS.soldOut;

    if (business === "almostfull") yieldValue += 3;
    if (business === "soldout") yieldValue += 4;
    if (privateRooms === "almostfull") yieldValue += 1;
    if (privateRooms === "soldout") yieldValue += 2;

    yieldValue = Math.min(yieldValue, 28);
  } else {
    const catsAll = Array.isArray(item?.categories) ? item.categories.join("|") : "";
    if (/sold out/i.test(catsAll)) yieldValue = BYOD_TRAIN_YIELDS.soldOut;
    else if (/almost full/i.test(catsAll)) yieldValue = BYOD_TRAIN_YIELDS.almostFull;
  }

  return Math.round(yieldValue * byodTrainAlbanyAlightingFactor(item));
}

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
    name: "Legacy sold-out status still works",
    item: { categories: ["BYOD Train", "Inbound", "Sold Out"] },
    expect: 18,
  },
  {
    name: "Empire 28x inbound through train is downweighted",
    item: {
      trainNumber: "281",
      categories: ["BYOD Train", "Inbound", "Sold Out"],
    },
    expect: 10,
  },
  {
    name: "Albany-focused inbound Empire train keeps higher alighting factor",
    item: {
      trainNumber: "237",
      categories: ["BYOD Train", "Inbound", "Sold Out"],
    },
    expect: 18,
  },
  {
    name: "Outbound train ingress is not alighting-downweighted",
    item: {
      trainNumber: "281",
      categories: ["BYOD Train", "Outbound", "Sold Out"],
    },
    expect: 22,
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
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
