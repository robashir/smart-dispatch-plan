import fs from "node:fs";
import path from "node:path";

const DEFAULT_LATITUDE = 42.686;
const DEFAULT_LONGITUDE = -73.843;
const NY_TIME_ZONE = "America/New_York";

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TIME_ZONE,
    hour12: false,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function minutesSinceMidnight({ hour, minute }) {
  return hour * 60 + minute;
}

function nyTimezoneOffsetMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: NY_TIME_ZONE,
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

function inWindow(nowMin, start, end) {
  if (start <= end) return nowMin >= start && nowMin <= end;
  return nowMin >= start || nowMin <= end;
}

function shouldRunDispatch(parts) {
  const nowMin = minutesSinceMidnight(parts);
  const weekendNight = ["Thu", "Fri", "Sat"].includes(parts.weekday);

  const lateNight = weekendNight && inWindow(nowMin, 21 * 60, 2 * 60 + 30);
  const trainHeavy =
    inWindow(nowMin, 16 * 60, 0) || inWindow(nowMin, 5 * 60 + 30, 9 * 60);
  const drivingWindow =
    inWindow(nowMin, 6 * 60, 10 * 60) ||
    inWindow(nowMin, 11 * 60, 14 * 60) ||
    inWindow(nowMin, 16 * 60, 20 * 60);
  const broadPlanning = parts.hour % 4 === 0 && parts.minute < 15;

  if (lateNight || trainHeavy) {
    return { shouldRun: true, cadence: "15-minute late-night/train-heavy" };
  }
  if (drivingWindow && parts.minute % 30 < 15) {
    return { shouldRun: true, cadence: "30-minute driving window" };
  }
  if (broadPlanning) {
    return { shouldRun: true, cadence: "4-hour broad planning" };
  }
  return { shouldRun: false, cadence: "outside alert cadence" };
}

function readEventConfig() {
  const eventPath = path.join(process.cwd(), "event-config.json");
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch (err) {
    console.warn(`[dispatch-cron] event-config.json unavailable: ${err.message}`);
    return {};
  }
}

async function main() {
  const endpoint = (process.env.DISPATCH_ENDPOINT || "").trim();
  const alertSecret = (process.env.DISPATCH_ALERT_SECRET || "").trim();
  if (!endpoint) {
    throw new Error(
      "DISPATCH_ENDPOINT GitHub Actions secret is required, for example https://genuine-spider-98efb1.netlify.app/api/dispatch"
    );
  }
  if (!/^https:\/\/.+\/api\/dispatch$/.test(endpoint)) {
    throw new Error(
      `DISPATCH_ENDPOINT must be the full https URL ending in /api/dispatch. Received: ${endpoint}`
    );
  }
  if (!alertSecret) {
    throw new Error("DISPATCH_ALERT_SECRET GitHub Actions secret is required.");
  }
  const parts = nyParts();
  const decision = shouldRunDispatch(parts);

  console.log(
    `[dispatch-cron] New York time ${parts.weekday} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")} | ${decision.cadence}`
  );

  if (!decision.shouldRun && process.env.FORCE_DISPATCH_CRON !== "true") {
    console.log("[dispatch-cron] Skipping this 15-minute tick.");
    return;
  }

  const body = {
    latitude: envNumber("DISPATCH_LATITUDE", DEFAULT_LATITUDE),
    longitude: envNumber("DISPATCH_LONGITUDE", DEFAULT_LONGITUDE),
    hours: envNumber("DISPATCH_HOURS", 4),
    timezoneOffsetMinutes: envNumber("DISPATCH_TIMEZONE_OFFSET_MINUTES", nyTimezoneOffsetMinutes()),
    platforms: {
      rideshare: process.env.DISPATCH_ENABLE_RIDESHARE !== "false",
      food: process.env.DISPATCH_ENABLE_FOOD !== "false",
      grocery: process.env.DISPATCH_ENABLE_GROCERY === "true",
    },
    includeAirport: process.env.DISPATCH_INCLUDE_AIRPORT !== "false",
    includeAmtrak: process.env.DISPATCH_INCLUDE_AMTRAK !== "false",
    routingStrategy: process.env.DISPATCH_ROUTING_STRATEGY || "profitability",
    costPerMile: envNumber("DISPATCH_COST_PER_MILE", 0.65),
    eventConfig: readEventConfig(),
    inboundTrains: [],
    outboundTrains: [],
    inboundBuses: "",
    inboundFlights: "",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${alertSecret}`,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`[dispatch-cron] Dispatch failed ${response.status}: ${text.slice(0, 500)}`);
  }

  const data = JSON.parse(text);
  const alert = data.telegramAlert || {};
  console.log(
    `[dispatch-cron] itinerary=${Array.isArray(data.itinerary) ? data.itinerary.length : 0} alert=${alert.reason || "unknown"} sent=${alert.sent === true} title=${alert.title || ""}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
