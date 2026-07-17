const EVENT_CATEGORIES = new Map([
  ["music", "Music"],
  ["sports", "Sports"],
  ["theatre", "Theatre"],
  ["theater", "Theatre"],
  ["arts", "Arts"],
  ["arts & theatre", "Arts"],
  ["other", "Other"],
]);

const DEFAULT_DURATION_HOURS = {
  Music: 3,
  Sports: 3.5,
  Theatre: 2.5,
  Arts: 2.5,
  Other: 3,
};

function normalizeText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function parseClock(value) {
  const match = normalizeText(value).match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (hour === 12) hour = 0;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}

function dateAtMinutes(savedDate, minuteOfDay) {
  const date = new Date(`${savedDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCMinutes(minuteOfDay);
  return date;
}

function formatClock(date) {
  const hour = date.getUTCHours();
  return `${hour % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function byodEventKey(venueName, savedDate, startMinutes) {
  return `${normalizeText(venueName).toLowerCase()}|${savedDate}|${startMinutes}`;
}

export function parseByodEventText(rawText, savedDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(savedDate || ""))) return [];
  const seen = new Set();
  const parsed = [];

  for (const rawLine of String(rawText || "").split(/\r?\n/)) {
    const line = normalizeText(rawLine);
    if (!line || /\bcancel(?:led|ed)\b/i.test(line)) continue;
    const parts = line.split("|").map(normalizeText).filter(Boolean);
    if (parts.length < 4) continue;

    const venueName = parts[0];
    const eventName = parts[1];
    let doorsMinutes = null;
    let startMinutes = null;
    let endMinutes = null;
    let category = null;

    for (const part of parts.slice(2)) {
      const labeled = part.match(/^(Doors?|Starts?|Ends?)\s*:?\s*(.+)$/i);
      if (labeled) {
        const minutes = parseClock(labeled[2]);
        if (minutes === null) continue;
        if (/^doors?/i.test(labeled[1])) doorsMinutes = minutes;
        else if (/^starts?/i.test(labeled[1])) startMinutes = minutes;
        else endMinutes = minutes;
        continue;
      }
      const matchedCategory = EVENT_CATEGORIES.get(part.toLowerCase());
      if (matchedCategory) category = matchedCategory;
    }

    if (!venueName || !eventName || startMinutes === null || !category) continue;
    const sourceEventKey = byodEventKey(venueName, savedDate, startMinutes);
    if (seen.has(sourceEventKey)) continue;
    seen.add(sourceEventKey);
    parsed.push({
      venueName,
      eventName,
      savedDate,
      doorsMinutes,
      startMinutes,
      endMinutes,
      category,
      sourceEventKey,
      rawLine: line,
    });
  }
  return parsed;
}

export function mergeByodEventText(existingRawText, incomingRawText, savedDate) {
  const merged = new Map();
  for (const event of parseByodEventText(existingRawText, savedDate)) {
    merged.set(event.sourceEventKey, event.rawLine);
  }
  for (const event of parseByodEventText(incomingRawText, savedDate)) {
    merged.set(event.sourceEventKey, event.rawLine);
  }
  return [...merged.values()].join("\n");
}

function resolveVenue(venueDictionary, venueName) {
  return venueDictionary?.[normalizeText(venueName).toLowerCase()] || null;
}

function overlaps(start, end, planningStart, planningEnd) {
  return start < planningEnd && end > planningStart;
}

export function buildByodEventOpportunities({
  rawText,
  savedDate,
  localStart,
  planningEnd,
  venueDictionary,
}) {
  if (!(localStart instanceof Date) || !(planningEnd instanceof Date)) return [];
  const opportunities = [];

  for (const event of parseByodEventText(rawText, savedDate)) {
    const coords = resolveVenue(venueDictionary, event.venueName);
    if (!coords) continue;
    const startTime = dateAtMinutes(savedDate, event.startMinutes);
    if (!startTime) continue;
    let endTime;
    if (event.endMinutes !== null) {
      endTime = dateAtMinutes(savedDate, event.endMinutes);
      if (endTime <= startTime) endTime.setUTCDate(endTime.getUTCDate() + 1);
    } else {
      endTime = new Date(startTime.getTime() + DEFAULT_DURATION_HOURS[event.category] * 3600000);
    }
    const megaVenue = /arena|stadium|amphitheater|coliseum/i.test(event.venueName);
    const shared = {
      type: "event",
      location: event.venueName,
      eventName: event.eventName,
      eventCategory: event.category,
      eventStartTime: formatClock(startTime),
      projectedEnd: formatClock(endTime),
      sourceEventKey: event.sourceEventKey,
      source: "byod_event",
      volume: 1,
      lat: coords.lat,
      lng: coords.lng,
      sequenceOnly: true,
    };

    if (event.doorsMinutes !== null) {
      let doorsTime = dateAtMinutes(savedDate, event.doorsMinutes);
      if (doorsTime > startTime) doorsTime.setUTCDate(doorsTime.getUTCDate() - 1);
      const ingressStart = new Date(doorsTime.getTime() - 45 * 60000);
      const ingressEnd = new Date(startTime.getTime() + 15 * 60000);
      if (overlaps(ingressStart, ingressEnd, localStart, planningEnd)) {
        const activeNow = localStart >= ingressStart && localStart < ingressEnd;
        opportunities.push({
          ...shared,
          categories: ["BYOD Event", "Ingress", event.category],
          demandYield: megaVenue ? 35 : 15,
          doorsTime: formatClock(doorsTime),
          windowStart: formatClock(ingressStart),
          windowEnd: formatClock(ingressEnd),
          activeNow,
          ...(activeNow ? {} : { leaveBy: formatClock(ingressStart), hourBucket: formatClock(ingressStart) }),
        });
      }
    }

    const egressBuffer = megaVenue ? 30 : 15;
    const egressStart = new Date(endTime.getTime() - egressBuffer * 60000);
    const egressEnd = new Date(endTime.getTime() + egressBuffer * 60000);
    if (overlaps(egressStart, egressEnd, localStart, planningEnd)) {
      const activeNow = localStart >= egressStart && localStart < egressEnd;
      opportunities.push({
        ...shared,
        categories: ["BYOD Event", "Egress", event.category],
        demandYield: megaVenue ? 80 : 30,
        egressMod: megaVenue ? 2.5 : 2,
        windowStart: formatClock(egressStart),
        windowEnd: formatClock(egressEnd),
        activeNow,
        ...(activeNow ? {} : { leaveBy: formatClock(egressStart), hourBucket: formatClock(egressStart) }),
      });
    }
  }
  return opportunities;
}

export function ticketmasterEventKey(event) {
  const venueName = event?._embedded?.venues?.[0]?.name;
  const savedDate = event?.dates?.start?.localDate;
  const localTime = event?.dates?.start?.localTime;
  if (!venueName || !savedDate || !localTime) return null;
  const match = String(localTime).match(/^(\d{2}):(\d{2})/);
  if (!match) return null;
  return byodEventKey(venueName, savedDate, Number(match[1]) * 60 + Number(match[2]));
}
