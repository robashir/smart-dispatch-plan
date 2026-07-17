import assert from "node:assert/strict";
import { countSavedByodRecords } from "./app/lib/byod-counts.mjs";

const buses = `Arriving
6:00 pm
To
Albany (Trailways Bus Terminal)

Arriving
7:55 pm
To
Albany (Greyhound Bus Terminal)

Arriving
8:30 pm
To
SUNY Albany`;
assert.equal(countSavedByodRecords("bus", buses), 2);

assert.equal(
  countSavedByodRecords("flight", "Chicago 10:30 AM\nCanceled Atlanta 11:24 AM\nOrlando 12:22 PM"),
  2
);

const weather = `Time\tConditions\tTemp.\tPrecip
12:00 pm\tMostly Cloudy\t84 F\t8%
1:00 pm\tCloudy\t84 F\t15%
1:00 pm\tCloudy duplicate\t84 F\t15%`;
assert.equal(countSavedByodRecords("weather", weather), 2);
assert.equal(countSavedByodRecords("weather", "Moderate rain for 2 hours"), 1);

const events = `MVP Arena | Show One | Doors 6:30 PM | Starts 8:00 PM | Music
Palace Theatre | Show Two | Starts 7:30 PM | Theatre
MVP Arena | Missing Category | Starts 9:00 PM`;
assert.equal(countSavedByodRecords("event", events, "2026-07-16"), 2);
assert.equal(countSavedByodRecords("event", events, null), 0);

console.log("BYOD saved counts: 7 assertions passed.");
