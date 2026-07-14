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
