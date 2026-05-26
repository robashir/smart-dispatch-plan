// Sprint 46: Global Weather Banner — stateless "Frontend Decoder" for the
// Sprint 19 predictive weather engine. Reads { weatherFoodMod, weatherRideMod }
// directly and surfaces a high-contrast alert ONLY when the pair matches one
// of the three known states. Anything else (including 1.0/1.0 Clear and any
// unrecognized combo) renders nothing so the dashboard stays uncluttered.
export function GlobalWeatherBanner({ weatherModifiers }) {
  if (!weatherModifiers) return null;
  const { weatherFoodMod, weatherRideMod } = weatherModifiers;

  let copy = null;
  let theme = "";

  if (weatherFoodMod === 1.5 && weatherRideMod === 0.75) {
    copy = "⛈️ Active Storm: Food Delivery demand is surging (1.5x) while rideshare drops.";
    theme = "bg-blue-900/50 text-blue-200 border border-blue-700";
  } else if (weatherFoodMod === 1.0 && weatherRideMod === 1.5) {
    copy = "🌩️ Pre-Surge: Impending rain detected. Rideshare demand is surging (1.5x).";
    theme = "bg-indigo-900/50 text-indigo-200 border border-indigo-700";
  } else if (weatherFoodMod === 1.25 && weatherRideMod === 0.9) {
    copy = "☀️ Heatwave: Extreme heat active. Food Delivery demand is elevated (1.25x).";
    theme = "bg-amber-900/50 text-amber-200 border border-amber-700";
  } else {
    return null;
  }

  return (
    <div className={`p-4 rounded-lg mb-2 text-sm font-semibold ${theme}`}>
      {copy}
    </div>
  );
}
