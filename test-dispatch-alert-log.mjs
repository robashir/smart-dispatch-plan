import assert from "node:assert/strict";
import { formatDispatchAlertEligibility } from "./scripts/dispatch-alert-log.mjs";

const line = formatDispatchAlertEligibility({
  windowMinutes: 60,
  driverSupplyPressureMod: 1,
  normalSupply: true,
  areaCounts: { downtown: 4, uptown: 0, other: 7 },
  areaTotal: 11,
  areaExpectedDemand: { downtown: 100, uptown: 0, other: 175 },
  areaExpectedDemandMinimum: 25,
  qualifyingDemandAreas: ["downtown", "other"],
  minimumQualifyingDemandAreas: 2,
  enoughDemandAreas: true,
  threshold: 9,
  aboveThreshold: true,
  eligible: true,
});

assert.equal(
  line,
  "[dispatch-cron] eligibility window=60m pressure=1.00 normalSupply=true downtown=4 uptown=0 other=7 total=11 demandDowntown=100 demandUptown=0 demandOther=175 demandMinimum=>=25 qualifyingAreas=2 minimumQualifyingAreas=2 enoughDemandAreas=true threshold=>9 aboveThreshold=true eligible=true"
);
assert.equal(
  formatDispatchAlertEligibility(null),
  "[dispatch-cron] eligibility unavailable"
);

console.log("Dispatch alert eligibility log tests passed.");
