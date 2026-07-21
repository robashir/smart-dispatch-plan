// Sprint 81: Reason-based weather banner. The backend now returns a richer
// weather analysis object, while still preserving weatherFoodMod/weatherRideMod
// for scoring. This component renders the decision context, not exact pairs.
export function GlobalWeatherBanner({ weatherModifiers }) {
  if (!weatherModifiers) return null;

  const {
    condition,
    severity,
    reason,
    weatherFoodMod,
    weatherRideMod,
    driverSupplyMod,
    opportunityPressure,
    startsInMinutes,
    currentTempF,
    currentConditionLabel,
    source,
    byodForecastStartsAt,
  } = weatherModifiers;

  const forecastTimeMatch = String(byodForecastStartsAt || "").match(/T(\d{2}):(\d{2})/);
  let byodForecastLabel = "";
  if (forecastTimeMatch) {
    const hour24 = Number(forecastTimeMatch[1]);
    const minute = forecastTimeMatch[2];
    const suffix = hour24 >= 12 ? "PM" : "AM";
    byodForecastLabel = `BYOD forecast begins at ${hour24 % 12 || 12}:${minute} ${suffix}`;
  }

  const hasWeatherImpact = condition !== "clear";
  const isSnowOrIce = condition === "snow" || condition === "ice" || condition === "pre_snow" || condition === "pre_ice";
  const isHeat = condition === "heat";
  const theme = isSnowOrIce
    ? "bg-sky-950/60 text-sky-100 border border-sky-700"
    : isHeat
      ? "bg-amber-950/60 text-amber-100 border border-amber-700"
      : hasWeatherImpact
        ? "bg-blue-950/60 text-blue-100 border border-blue-700"
        : "bg-neutral-900/70 text-neutral-100 border border-neutral-700";

  const foodPct = Math.round((Number(weatherFoodMod || 1) - 1) * 100);
  const ridePct = Math.round((Number(weatherRideMod || 1) - 1) * 100);
  const supplyPct = Math.round((1 - Number(driverSupplyMod || 1)) * 100);
  const pressure = Number(opportunityPressure);
  const startText =
    Number.isFinite(startsInMinutes) && startsInMinutes > 0
      ? ` Starts in about ${startsInMinutes} min.`
      : "";

  return (
    <div className={`p-4 rounded-lg mb-2 text-sm font-semibold ${theme}`}>
      <div>
        Weather now: {Number.isFinite(Number(currentTempF)) ? `${Math.round(Number(currentTempF))}°F · ` : ""}
        {currentConditionLabel || "Weather unavailable"} · {source === "manual" ? "BYOD" : "Live"}
        {byodForecastLabel ? ` · ${byodForecastLabel}` : ""}
      </div>
      {hasWeatherImpact ? (
        <>
          <div className="mt-1 text-xs font-medium opacity-90">
            {reason || `${severity || "Weather"} ${condition}`}.{startText}
          </div>
          <div className="mt-1 text-xs font-medium opacity-90">
            Food {foodPct >= 0 ? "+" : ""}{foodPct}%, rides {ridePct >= 0 ? "+" : ""}{ridePct}%,
            driver supply {supplyPct > 0 ? `${supplyPct}% tighter` : "normal"}
            {Number.isFinite(pressure) && pressure !== 1 ? `, pressure ${pressure}x` : ""}
          </div>
        </>
      ) : (
        <div className="mt-1 text-xs font-medium opacity-75">No weather demand adjustment.</div>
      )}
    </div>
  );
}
