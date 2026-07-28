import assert from "node:assert/strict";
import {
  applyCalendarTransitBoost,
  calendarTransitBoostFor,
  transitIdentityFor,
} from "./app/lib/calendar-transit-boost.mjs";
import { densityScore } from "./app/api/dispatch/route.js";

const calendar = {
  Thanksgiving: { date: "2026-11-26", type: "holiday" },
  Christmas: { date: "2026-12-25", type: "holiday" },
  "Fall Move-In Day 1": { date: "2026-08-22", type: "academic" },
  "Spring Move-Out Day 1": { date: "2026-05-15", type: "academic" },
  "Spring Break Exodus": { date: "2026-03-13", type: "academic" },
  "Spring Break Return": { date: "2026-03-22", type: "academic" },
  "4th of July": { date: "2026-07-04", type: "holiday" },
};

const inboundFlight = { type: "flight", volume: 1, hub: "ALB" };
const inboundTrain = { type: "train", volume: 1, hub: "Rensselaer" };
const outboundFlight = {
  type: "event",
  volume: 1,
  categories: ["BYOD Flight", "Outbound"],
};
const outboundTrain = {
  type: "event",
  volume: 1,
  categories: ["BYOD Train", "Outbound"],
};
const food = { type: "food", volume: 2, categories: ["Pizza"] };

assert.deepEqual(transitIdentityFor(inboundFlight), {
  mode: "flight",
  direction: "inbound",
});
assert.deepEqual(transitIdentityFor(outboundTrain), {
  mode: "train",
  direction: "outbound",
});
assert.equal(transitIdentityFor(food), null);

for (const date of ["2026-11-24", "2026-11-25"]) {
  assert.equal(
    calendarTransitBoostFor({ item: outboundFlight, eventConfig: calendar, targetDate: date })
      ?.multiplier,
    1.3
  );
  assert.equal(
    calendarTransitBoostFor({ item: outboundTrain, eventConfig: calendar, targetDate: date })
      ?.multiplier,
    1.3
  );
  assert.equal(
    calendarTransitBoostFor({ item: inboundFlight, eventConfig: calendar, targetDate: date }),
    null
  );
}

assert.equal(
  calendarTransitBoostFor({
    item: inboundFlight,
    eventConfig: calendar,
    targetDate: "2026-11-29",
  })?.multiplier,
  1.35
);
assert.equal(
  calendarTransitBoostFor({
    item: outboundFlight,
    eventConfig: calendar,
    targetDate: "2026-11-29",
  }),
  null
);

assert.equal(
  calendarTransitBoostFor({
    item: outboundFlight,
    eventConfig: calendar,
    targetDate: "2026-12-21",
  })?.multiplier,
  1.25
);
assert.equal(
  calendarTransitBoostFor({
    item: inboundFlight,
    eventConfig: calendar,
    targetDate: "2026-12-28",
  })?.multiplier,
  1.3
);

assert.equal(
  calendarTransitBoostFor({
    item: inboundTrain,
    eventConfig: calendar,
    targetDate: "2026-08-22",
  })?.multiplier,
  1.25
);
assert.equal(
  calendarTransitBoostFor({
    item: outboundTrain,
    eventConfig: calendar,
    targetDate: "2026-05-15",
  })?.multiplier,
  1.25
);
assert.equal(
  calendarTransitBoostFor({
    item: outboundTrain,
    eventConfig: calendar,
    targetDate: "2026-03-13",
  })?.multiplier,
  1.3
);
assert.equal(
  calendarTransitBoostFor({
    item: inboundTrain,
    eventConfig: calendar,
    targetDate: "2026-03-22",
  })?.multiplier,
  1.35
);

assert.equal(
  calendarTransitBoostFor({
    item: outboundFlight,
    eventConfig: calendar,
    targetDate: "2026-07-02",
  })?.multiplier,
  1.2
);
assert.equal(
  calendarTransitBoostFor({
    item: inboundFlight,
    eventConfig: calendar,
    targetDate: "2026-07-05",
  })?.multiplier,
  1.25
);
assert.equal(
  calendarTransitBoostFor({
    item: food,
    eventConfig: calendar,
    targetDate: "2026-11-24",
  }),
  null
);

const boostedFlight = applyCalendarTransitBoost(
  inboundFlight,
  calendar,
  "2026-11-29"
);
assert.equal(boostedFlight.calendarTransitMultiplier, 1.35);
assert.match(boostedFlight.calendarTransitReason, /Thanksgiving return/);
assert.equal(densityScore(boostedFlight, 1, 1), 20.25);

const cappedWave = applyCalendarTransitBoost(
  { ...inboundFlight, volume: 4, demandCap: 45 },
  calendar,
  "2026-11-29"
);
assert.ok(Math.abs(densityScore(cappedWave, 1, 1) - 60.75) < 0.0001);
assert.equal(
  densityScore({ ...food, calendarTransitMultiplier: 1.35 }, 1, 1),
  12
);

console.log("Calendar transit boost: assertions passed.");
