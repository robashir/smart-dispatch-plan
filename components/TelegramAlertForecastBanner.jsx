"use client";

const AREA_LABELS = {
  downtown: "Downtown",
  uptown: "Uptown",
  other: "Other Areas",
};

function qualifyingAreaText(evaluation) {
  const demand = evaluation?.areaExpectedDemand || {};
  const areas = Array.isArray(evaluation?.qualifyingDemandAreas)
    ? evaluation.qualifyingDemandAreas
    : [];
  return areas
    .map((area) => `${AREA_LABELS[area] || area} ${Math.round(Number(demand[area]) || 0)}`)
    .join(" · ");
}

export function TelegramAlertForecastBanner({ forecast }) {
  if (!forecast) return null;

  if (forecast.status === "not_expected") {
    const evaluation = forecast.bestEvaluation || forecast.currentEvaluation || {};
    const opportunities = Number(evaluation.areaTotal) || 0;
    const qualifyingAreas = Array.isArray(evaluation.qualifyingDemandAreas)
      ? evaluation.qualifyingDemandAreas.length
      : 0;
    return (
      <section className="rounded-xl bg-neutral-900 border border-neutral-700 p-4">
        <div className="text-xs uppercase tracking-wide text-neutral-400 font-semibold">
          Telegram Alert Forecast
        </div>
        <div className="text-base font-semibold mt-1">
          No qualifying alert slot found through {forecast.forecastEndTime || "11:59 PM"} today
        </div>
        <div className="text-xs text-neutral-400 mt-2">
          Strongest projected check at {forecast.strongestProjectedTime || "the current time"}: {opportunities}/10 opportunities · {qualifyingAreas}/2 areas at Expected Demand ≥25
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Based on the current BYOD and dispatch data; live updates can change this forecast.
        </div>
      </section>
    );
  }

  const evaluation = forecast.evaluation || {};
  const areaText = qualifyingAreaText(evaluation);
  return (
    <section className="rounded-xl bg-emerald-950/50 border border-emerald-600 p-4">
      <div className="text-xs uppercase tracking-wide text-emerald-300 font-semibold">
        Telegram Alert Forecast
      </div>
      <div className="text-lg font-bold mt-1">
        {forecast.status === "qualifies_now"
          ? "Demand qualifies now"
          : `Expected to qualify around ${forecast.firstEligibleTime}`}
      </div>
      <div className="text-sm text-emerald-100 mt-1">
        Projected qualifying window: {forecast.firstEligibleTime}–{forecast.eligibleWindowEnd}
      </div>
      <div className="text-xs text-neutral-300 mt-2">
        {Number(evaluation.areaTotal) || 0} opportunities
        {areaText ? ` · ${areaText}` : ""}
      </div>
      <div className="text-xs text-neutral-400 mt-1">
        Estimated through {forecast.forecastEndTime || "11:59 PM"} from current BYOD and dispatch data. Telegram sends only when demand newly changes to qualified.
      </div>
    </section>
  );
}
