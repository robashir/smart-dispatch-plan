const WEATHER_CODE_LABELS = new Map([
  [0, "Clear"],
  [1, "Mainly Clear"],
  [2, "Partly Cloudy"],
  [3, "Overcast"],
  [45, "Fog"],
  [48, "Freezing Fog"],
  [51, "Light Drizzle"],
  [53, "Drizzle"],
  [55, "Heavy Drizzle"],
  [56, "Light Freezing Drizzle"],
  [57, "Freezing Drizzle"],
  [61, "Light Rain"],
  [63, "Moderate Rain"],
  [65, "Heavy Rain"],
  [66, "Light Freezing Rain"],
  [67, "Freezing Rain"],
  [71, "Light Snow"],
  [73, "Moderate Snow"],
  [75, "Heavy Snow"],
  [77, "Snow Grains"],
  [80, "Light Rain Showers"],
  [81, "Rain Showers"],
  [82, "Heavy Rain Showers"],
  [85, "Light Snow Showers"],
  [86, "Heavy Snow Showers"],
  [95, "Thunderstorm"],
  [96, "Thunderstorm with Hail"],
  [99, "Severe Thunderstorm with Hail"],
]);

export function cleanWeatherConditionLabel(value) {
  const text = String(value || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "Weather unavailable";

  const words = text.split(" ");
  if (words.length % 2 === 0) {
    const midpoint = words.length / 2;
    const first = words.slice(0, midpoint).join(" ");
    const second = words.slice(midpoint).join(" ");
    if (first.toLowerCase() === second.toLowerCase()) return first;
  }
  return text;
}

export function buildCurrentWeatherDisplay(row, isManual = false) {
  const temperature = Number(row?.tempF);
  const temperatureWasProvided = row?.hasExplicitTemp !== false;
  const currentTempF =
    Number.isFinite(temperature) && temperatureWasProvided ? temperature : null;
  const code = Number(row?.weatherCode);
  const currentConditionLabel = row?.manualCondition
    ? cleanWeatherConditionLabel(row.manualCondition)
    : WEATHER_CODE_LABELS.get(code) || "Weather unavailable";

  return {
    currentTempF,
    currentConditionLabel,
    source: isManual ? "manual" : "live",
  };
}

export function mergeWeatherWindows(manualRows, liveRows) {
  if (!Array.isArray(manualRows)) return liveRows;
  const live = Array.isArray(liveRows) ? liveRows : [];
  const length = Math.max(manualRows.length, live.length);
  return Array.from({ length }, (_, index) => manualRows[index] || live[index] || null);
}
