import assert from "node:assert/strict";
import { formatDispatchAlertEligibility } from "./scripts/dispatch-alert-log.mjs";

const line = formatDispatchAlertEligibility({
  windowMinutes: 60,
  driverSupplyPressureMod: 1,
  normalSupply: true,
  areaCounts: { downtown: 4, uptown: 0, other: 7 },
  areaTotal: 11,
  threshold: 4,
  aboveThreshold: true,
  eligible: true,
});

assert.equal(
  line,
  "[dispatch-cron] eligibility window=60m pressure=1.00 normalSupply=true downtown=4 uptown=0 other=7 total=11 threshold=>4 aboveThreshold=true eligible=true"
);
assert.equal(
  formatDispatchAlertEligibility(null),
  "[dispatch-cron] eligibility unavailable"
);

console.log("Dispatch alert eligibility log tests passed.");
