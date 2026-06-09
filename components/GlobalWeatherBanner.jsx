// Sprint 81: Reason-based weather banner. The backend now returns a richer
// weather analysis object, while still preserving weatherFoodMod/weatherRideMod
// for scoring. This component renders the decision context, not exact pairs.
export function GlobalWeatherBanner({ weatherModifiers }) {
  if (!weatherModifiers || weatherModifiers.condition === "clear") return null;

  const {
    condition,
    severity,
    reason,
    weatherFoodMod,
    weatherRideMod,
    driverSupplyMod,
    opportunityPressure,
    startsInMinutes,
  } = weatherModifiers;

  const isSnowOrIce = condition === "snow" || condition === "ice" || condition === "pre_snow" || condition === "pre_ice";
  const isHeat = condition === "heat";
  const theme = isSnowOrIce
    ? "bg-sky-950/60 text-sky-100 border border-sky-700"
    : isHeat
      ? "bg-amber-950/60 text-amber-100 border border-amber-700"
      : "bg-blue-950/60 text-blue-100 border border-blue-700";

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
      <div>{reason || `${severity || "Weather"} ${condition}`}.{startText}</div>
      <div className="mt-1 text-xs font-medium opacity-90">
        Food {foodPct >= 0 ? "+" : ""}{foodPct}%, rides {ridePct >= 0 ? "+" : ""}{ridePct}%,
        driver supply {supplyPct > 0 ? `${supplyPct}% tighter` : "normal"}
        {Number.isFinite(pressure) && pressure !== 1 ? `, pressure ${pressure}x` : ""}
      </div>
    </div>
  );
}
