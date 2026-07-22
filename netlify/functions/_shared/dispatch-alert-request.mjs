const DEFAULT_LATITUDE = 42.686;
const DEFAULT_LONGITUDE = -73.843;
const NEW_YORK_TIME_ZONE = "America/New_York";

function envNumber(readEnv, name, fallback) {
  const raw = readEnv(name);
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function newYorkTimezoneOffsetMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NEW_YORK_TIME_ZONE,
    timeZoneName: "shortOffset",
  }).formatToParts(date);
  const offset = parts.find((part) => part.type === "timeZoneName")?.value || "GMT-4";
  const match = offset.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return 240;
  const hours = Number(match[2]);
  const minutes = match[3] ? Number(match[3]) : 0;
  const total = hours * 60 + minutes;
  return match[1] === "-" ? total : -total;
}

export function buildScheduledDispatchBody({
  readEnv,
  eventConfig = {},
  now = new Date(),
}) {
  return {
    latitude: envNumber(readEnv, "DISPATCH_LATITUDE", DEFAULT_LATITUDE),
    longitude: envNumber(readEnv, "DISPATCH_LONGITUDE", DEFAULT_LONGITUDE),
    hours: envNumber(readEnv, "DISPATCH_HOURS", 4),
    timezoneOffsetMinutes: envNumber(
      readEnv,
      "DISPATCH_TIMEZONE_OFFSET_MINUTES",
      newYorkTimezoneOffsetMinutes(now)
    ),
    platforms: {
      rideshare: readEnv("DISPATCH_ENABLE_RIDESHARE") !== "false",
      food: readEnv("DISPATCH_ENABLE_FOOD") !== "false",
      grocery: readEnv("DISPATCH_ENABLE_GROCERY") === "true",
    },
    includeAirport: readEnv("DISPATCH_INCLUDE_AIRPORT") !== "false",
    includeAmtrak: readEnv("DISPATCH_INCLUDE_AMTRAK") !== "false",
    routingStrategy: readEnv("DISPATCH_ROUTING_STRATEGY") || "profitability",
    costPerMile: envNumber(readEnv, "DISPATCH_COST_PER_MILE", 0.65),
    eventConfig,
    inboundTrains: [],
    outboundTrains: [],
    inboundBuses: "",
    inboundFlights: "",
  };
}
