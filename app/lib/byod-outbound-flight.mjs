function formatClockTime(hourValue, minuteValue, ampmValue) {
  const hour = Number(hourValue);
  const minute = String(minuteValue).padStart(2, "0");
  const ampm = String(ampmValue).toUpperCase();
  return `${hour}:${minute} ${ampm}`;
}

export function parseOutboundFlightText(rawText, cityPatterns = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) return [];

  const cityKeys = Object.keys(cityPatterns).sort((a, b) => b.length - a.length);
  const timePattern = /(\d{1,2}):(\d{2})\s*([ap]m)/gi;
  const seen = new Set();
  const flights = [];

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const matches = [...line.matchAll(timePattern)];
    if (matches.length === 0) continue;
    if (/\b(cancelled|canceled)\b/i.test(line)) continue;

    const lineLower = line.toLowerCase();
    const destination = cityKeys.find((city) => lineLower.includes(city.toLowerCase()));
    if (!destination) continue;

    const latestTime = matches[matches.length - 1];
    const departureTime = formatClockTime(latestTime[1], latestTime[2], latestTime[3]);
    const iata = cityPatterns[destination];
    const fingerprint = `${iata}_${departureTime}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    flights.push({
      destination,
      iata,
      departureTime,
      status: /\bdelayed\b/i.test(line) ? "Delayed" : "On Time",
    });
  }

  return flights;
}

function parseClockMinute(label) {
  const match = String(label || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Infinity;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 12) hour = 0;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}

function forwardDelta(label, nowMinute) {
  const minute = parseClockMinute(label);
  if (!Number.isFinite(minute)) return Infinity;
  let delta = minute - nowMinute;
  if (delta < -360) delta += 1440;
  return delta;
}

function joinDestinations(destinations) {
  if (destinations.length <= 1) return destinations[0] || "Destination";
  if (destinations.length === 2) return `${destinations[0]} & ${destinations[1]}`;
  return `${destinations.slice(0, -1).join(", ")} & ${destinations.at(-1)}`;
}

export function aggregateOutboundFlightEvents(
  events,
  { nowMinute, windowMinutes = 20, demandCap = 30 } = {}
) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const now = Number.isFinite(nowMinute) ? nowMinute : 0;
  const sorted = events
    .map((event) => ({ event, delta: forwardDelta(event?.departureTime, now) }))
    .filter(({ delta }) => Number.isFinite(delta))
    .sort((a, b) => a.delta - b.delta);
  const groups = [];
  let index = 0;
  while (index < sorted.length) {
    const anchor = sorted[index].delta;
    const group = [];
    while (index < sorted.length && sorted[index].delta - anchor <= windowMinutes) {
      group.push(sorted[index].event);
      index += 1;
    }
    groups.push(group);
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0];
    const earliest = [...group].sort(
      (a, b) => forwardDelta(a.leaveBy, now) - forwardDelta(b.leaveBy, now)
    )[0];
    const destinations = [...new Set(group.map((event) => event.destination).filter(Boolean))];
    const departureTimes = group.map((event) => ({
      destination: event.destination,
      iata: event.destinationIata,
      time: event.departureTime,
      status: event.categories?.[2] || "On Time",
    }));
    const includesDelayed = departureTimes.some(({ status }) => /delayed/i.test(status));
    return {
      ...earliest,
      location: `ALB Flight Wave to ${joinDestinations(destinations)}`,
      volume: group.reduce((sum, event) => sum + (Number(event.volume) || 0), 0),
      demandCap,
      categories: ["BYOD Flight", "Outbound", includesDelayed ? "Includes Delayed" : "On Time"],
      destination: joinDestinations(destinations),
      destinations,
      departureTimes,
      flightCount: group.length,
      isFlightWave: true,
    };
  });
}
