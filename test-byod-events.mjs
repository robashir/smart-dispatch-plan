import assert from "node:assert/strict";
import {
  buildByodEventOpportunities,
  mergeByodEventText,
  parseByodEventText,
  ticketmasterEventKey,
} from "./app/lib/byod-events.mjs";

const raw = "MVP Arena | Benson Boone | Doors 6:30 PM | Starts 8:00 PM | Music";
const parsed = parseByodEventText(raw, "2026-07-16");
assert.equal(parsed.length, 1);
assert.equal(parsed[0].eventName, "Benson Boone");
assert.equal(parsed[0].doorsMinutes, 18 * 60 + 30);
assert.equal(parsed[0].startMinutes, 20 * 60);
assert.equal(parsed[0].category, "Music");

const opportunities = buildByodEventOpportunities({
  rawText: raw,
  savedDate: "2026-07-16",
  localStart: new Date("2026-07-16T17:30:00Z"),
  planningEnd: new Date("2026-07-17T00:00:00Z"),
  venueDictionary: { "mvp arena": { lat: 42.6483, lng: -73.7547 } },
});
assert.equal(opportunities.length, 6);
const ingressSegments = opportunities.filter((item) => item.categories.includes("Ingress"));
const egressSegments = opportunities.filter((item) => item.categories.includes("Egress"));
const ingress = ingressSegments[0];
const egress = egressSegments[0];
assert.equal(ingress.windowStart, "5:45 PM");
assert.equal(ingress.windowEnd, "6:35 PM");
assert.equal(ingress.demandYield, 35);
assert.equal(egress.windowStart, "10:30 PM");
assert.equal(egress.windowEnd, "10:50 PM");
assert.equal(egress.projectedEnd, "11:00 PM");
assert.equal(egress.demandYield, 80);
assert.ok(egress.demandYield > ingress.demandYield);
assert.deepEqual(ingressSegments.map((item) => item.volume), [0.6, 1, 0.6]);
assert.deepEqual(egressSegments.map((item) => item.volume), [0.6, 1, 0.6]);

assert.equal(parseByodEventText(`${raw}\n${raw}`, "2026-07-16").length, 1);
assert.equal(parseByodEventText("MVP Arena | Cancelled Show | Starts 8 PM | Music", "2026-07-16").length, 0);
assert.equal(parseByodEventText("MVP Arena | Missing Category | Starts 8 PM", "2026-07-16").length, 0);
assert.equal(
  ticketmasterEventKey({
    dates: { start: { localDate: "2026-07-16", localTime: "20:00:00" } },
    _embedded: { venues: [{ name: "MVP Arena" }] },
  }),
  parsed[0].sourceEventKey
);

const mergedText = mergeByodEventText(
  `MVP Arena | First Event | Doors 6:00 PM | Starts 7:00 PM | Music
Palace Theatre | Second Event | Starts 8:00 PM | Theatre`,
  `The Egg | Third Event | Starts 6:30 PM | Arts`,
  "2026-07-16"
);
assert.equal(parseByodEventText(mergedText, "2026-07-16").length, 3);

const updatedText = mergeByodEventText(
  mergedText,
  "MVP Arena | Updated First Event | Doors 6:15 PM | Starts 7:00 PM | Music",
  "2026-07-16"
);
const updatedEvents = parseByodEventText(updatedText, "2026-07-16");
assert.equal(updatedEvents.length, 3);
assert.equal(updatedEvents.find(({ venueName }) => venueName === "MVP Arena").eventName, "Updated First Event");

console.log("BYOD venue events: assertions passed.");
