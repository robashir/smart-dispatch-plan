export function formatDispatchAlertEligibility(evaluation) {
  if (!evaluation || typeof evaluation !== "object") {
    return "[dispatch-cron] eligibility unavailable";
  }

  const counts = evaluation.areaCounts || {};
  const demand = evaluation.areaExpectedDemand || {};
  const pressure = Number(evaluation.driverSupplyPressureMod);
  const pressureLabel = Number.isFinite(pressure) ? pressure.toFixed(2) : "unknown";
  const threshold = Number(evaluation.threshold);
  const thresholdLabel = Number.isFinite(threshold) ? threshold : "unknown";
  return [
    "[dispatch-cron] eligibility",
    `window=${Number(evaluation.windowMinutes) || 60}m`,
    `pressure=${pressureLabel}`,
    `normalSupply=${evaluation.normalSupply === true}`,
    `downtown=${Number(counts.downtown) || 0}`,
    `uptown=${Number(counts.uptown) || 0}`,
    `other=${Number(counts.other) || 0}`,
    `total=${Number(evaluation.areaTotal) || 0}`,
    `demandDowntown=${Math.round(Number(demand.downtown) || 0)}`,
    `demandUptown=${Math.round(Number(demand.uptown) || 0)}`,
    `demandOther=${Math.round(Number(demand.other) || 0)}`,
    `demandMinimum=>=${Number(evaluation.areaExpectedDemandMinimum) || 25}`,
    `qualifyingAreas=${Array.isArray(evaluation.qualifyingDemandAreas) ? evaluation.qualifyingDemandAreas.length : 0}`,
    `minimumQualifyingAreas=${Number(evaluation.minimumQualifyingDemandAreas) || 2}`,
    `enoughDemandAreas=${evaluation.enoughDemandAreas === true}`,
    `threshold=>${thresholdLabel}`,
    `aboveThreshold=${evaluation.aboveThreshold === true}`,
    `eligible=${evaluation.eligible === true}`,
  ].join(" ");
}
