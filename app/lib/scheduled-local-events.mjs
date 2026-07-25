import {
  academicEventPolicy,
  isUAlbanyRegularSession,
} from "./ualbany-demand.mjs";

const MINUTE_MS = 60 * 1000;

function startOfWallDay(date, dayOffset = 0) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + dayOffset
  ));
}

function atMinute(day, minute) {
  return new Date(day.getTime() + Number(minute) * MINUTE_MS);
}

function formatTime(date) {
  const hour24 = date.getUTCHours();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${hour24 % 12 || 12}:${String(date.getUTCMinutes()).padStart(2, "0")} ${ampm}`;
}

function intersects(start, end, horizonStart, horizonEnd) {
  return start < horizonEnd && end > horizonStart;
}

function timingFields(start, end, horizonStart) {
  const activeNow = horizonStart >= start && horizonStart < end;
  return {
    ...(activeNow ? {} : { leaveBy: formatTime(start), hourBucket: formatTime(start) }),
    windowStart: formatTime(start),
    windowEnd: formatTime(end),
    activeNow,
    sequenceOnly: true,
    _scheduleStartMs: start.getTime(),
    _scheduleEndMs: end.getTime(),
  };
}

function scheduledDays(localStart) {
  return [startOfWallDay(localStart, 0), startOfWallDay(localStart, 1)];
}

export function buildScheduledHospitalEvents({
  localStart,
  localEnd,
  shifts = [],
  coords,
}) {
  const events = [];
  for (const day of scheduledDays(localStart)) {
    for (const shift of shifts) {
      const start = atMinute(day, shift.start);
      const end = atMinute(day, shift.end);
      if (!intersects(start, end, localStart, localEnd)) continue;
      events.push({
        type: "event",
        location: "Albany Med & St. Peter's Hospitals",
        volume: 1,
        egressMod: shift.mod,
        categories: [shift.label, "Hospital Shift", "High Demand"],
        lat: coords.lat,
        lng: coords.lng,
        ...timingFields(start, end, localStart),
      });
    }
  }
  return events;
}

export function buildScheduledStateWorkerEvents({
  localStart,
  localEnd,
  slots = [],
  coords,
}) {
  const events = [];
  for (const day of scheduledDays(localStart)) {
    const weekday = day.getUTCDay();
    if (weekday < 1 || weekday > 5) continue;
    for (const slot of slots) {
      const start = atMinute(day, slot.start);
      const end = atMinute(day, slot.end);
      if (!intersects(start, end, localStart, localEnd)) continue;
      events.push({
        type: "event",
        location: "Empire State Plaza & Harriman Campus",
        volume: slot.factor,
        egressMod: Number((1 + 1.5 * slot.factor).toFixed(2)),
        categories: ["State Worker Commute", slot.label],
        lat: coords.lat,
        lng: coords.lng,
        ...timingFields(start, end, localStart),
      });
    }
  }
  return events;
}

export function buildScheduledCrossgatesEvents({
  localStart,
  localEnd,
  closingHours = {},
  coords,
}) {
  const events = [];
  for (const day of scheduledDays(localStart)) {
    const closeMinute = closingHours[day.getUTCDay()];
    if (!Number.isFinite(Number(closeMinute))) continue;
    const close = atMinute(day, Number(closeMinute));
    const start = new Date(close.getTime() - 30 * MINUTE_MS);
    const end = new Date(close.getTime() + 30 * MINUTE_MS);
    if (!intersects(start, end, localStart, localEnd)) continue;
    events.push({
      type: "event",
      location: "Crossgates Mall",
      volume: 1,
      egressMod: 3.0,
      categories: ["Retail Egress", "Closing Surge"],
      closeTime: formatTime(close),
      lat: coords.lat,
      lng: coords.lng,
      ...timingFields(start, end, localStart),
    });
  }
  return events;
}

export function buildScheduledLocalAnchorEvents({
  localStart,
  localEnd,
  schedules = [],
  academicSessionMode = "auto",
}) {
  const events = [];
  const phases = [
    { startOffset: -30, endOffset: 0, factor: 0.6, phase: "Build" },
    { startOffset: 0, endOffset: null, factor: 1.0, phase: "Peak" },
    { startOffset: null, endOffset: 30, factor: 0.6, phase: "Taper" },
  ];
  for (const day of scheduledDays(localStart)) {
    for (const anchor of schedules) {
      if (!anchor.days?.includes(day.getUTCDay())) continue;
      if (anchor.sessionOnly && !isUAlbanyRegularSession(day, academicSessionMode)) continue;
      for (const slot of anchor.windows || []) {
        for (const phase of phases) {
          const startMinute =
            phase.phase === "Taper" ? slot.end : slot.start + phase.startOffset;
          const endMinute =
            phase.phase === "Build"
              ? slot.start
              : phase.phase === "Peak"
                ? slot.end
                : slot.end + phase.endOffset;
          const start = atMinute(day, startMinute);
          const end = atMinute(day, endMinute);
          if (!intersects(start, end, localStart, localEnd)) continue;
          const expected = Math.max(1, Math.round(Number(slot.expected) * phase.factor));
          events.push({
            type: "event",
            location: anchor.name,
            volume: expected,
            egressMod: Number((1 + expected / 10).toFixed(1)),
            categories: ["Local Anchor", slot.label, phase.phase],
            lat: anchor.lat,
            lng: anchor.lng,
            ...timingFields(start, end, localStart),
          });
        }
      }
    }
  }
  return events;
}

function parseCloseMinute(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

const RESTAURANT_CLOSING_VENUES = new Set([
  "The Hollow Bar & Kitchen",
  "Innovo Kitchen",
  "City Line Bar and Grill",
  "Black and Blue Steak and Crab",
  "The Nest",
  "Cafe Capriccio",
  "Lucas Confectionery",
  "Dove + Deer",
  "Bacchus",
  "Maggie McFly's | Albany",
  "Illusive Restaurant & Bar",
  "Josie’s Table",
  "Swifty's Restaurant & Pub",
  "Stella Pasta Bar & Bistro And Seven Points Brewery",
  "Wellington's",
  "Sea Smoke Waterfront Grill",
  "Dukes Chophouse",
  "O'Slattery's Irish Restaurant & Pub",
  "Marisa's Place",
  "Milano Restaurant",
  "Chili's",
  "Scarlet Knife",
  "Hooters",
]);

const NIGHTLIFE_VENUES = new Set([
  "The City Beer Hall",
  "The Ruck",
  "Wolff's Biergarten",
  "Katie O'Byrne's",
  "20 North Broadway Tavern",
  "Savoy Taproom",
  "Dave & Buster's Albany",
  "McGeary's",
  "Madison Pour House",
  "JT Maxies Bar & Grill",
  "151 Bar & Restaurant",
  "The Copper Crow",
  "Funny Bone Comedy Club & Restaurant",
  "Hill Street Cafe",
]);

export function nightlifeVenueClass(name) {
  if (RESTAURANT_CLOSING_VENUES.has(name)) return "restaurant";
  if (NIGHTLIFE_VENUES.has(name)) return "nightlife";
  return "late_bar";
}

export function closingDemandFor({ venueName, closeMinute, dayIndex }) {
  const normalizedClose = closeMinute < 360 ? closeMinute + 1440 : closeMinute;
  const weekend = dayIndex === 5 || dayIndex === 6;
  const venueClass = nightlifeVenueClass(venueName);
  const trueLastCall = venueClass !== "restaurant" && normalizedClose >= 23 * 60;
  const venueFactor = trueLastCall
    ? venueClass === "nightlife" ? 1.1 : 1.0
    : venueClass === "restaurant" ? 0.6 : venueClass === "nightlife" ? 0.8 : 0.7;
  const dayFactor = weekend ? 1.2 : 0.7;
  const closeHour = normalizedClose / 60;
  const closingBaseline =
    closeHour <= 22 ? 5 : closeHour < 24 ? 4 : closeHour < 25 ? 5 : closeHour <= 26 ? 6 : 7;
  const cap = weekend ? 10 : 6;
  const demandYield = Math.max(
    1,
    Math.min(cap, Math.round(closingBaseline * dayFactor * venueFactor))
  );
  return { demandYield, demandCap: cap, trueLastCall, venueClass, normalizedClose };
}

const LAST_CALL_CLUSTER_RADIUS_MILES = 2;
const LAST_CALL_ADDITIONAL_VENUE_WEIGHT = 0.4;

function distanceMiles(a, b) {
  const lat1 = Number(a?.lat);
  const lng1 = Number(a?.lng);
  const lat2 = Number(b?.lat);
  const lng2 = Number(b?.lng);
  if (![lat1, lng1, lat2, lng2].every(Number.isFinite)) return Infinity;
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const value =
    sinLat * sinLat +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * sinLng * sinLng;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function joinVenueNames(names) {
  if (names.length <= 1) return names[0] || "Nearby Venues";
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names.at(-1)}`;
}

function venueNameFromLastCall(event) {
  return String(event?.location || "")
    .replace(/^Last Call Egress:\s*/i, "")
    .trim();
}

function lastCallVenueClass(event) {
  return Array.isArray(event?.categories) ? event.categories[2] || "late_bar" : "late_bar";
}

function isLastCallEvent(event) {
  return Array.isArray(event?.categories) && event.categories.includes("Last Call");
}

function lastCallWindowsOverlap(a, b) {
  return (
    Number.isFinite(a?._scheduleStartMs) &&
    Number.isFinite(a?._scheduleEndMs) &&
    Number.isFinite(b?._scheduleStartMs) &&
    Number.isFinite(b?._scheduleEndMs) &&
    a._scheduleStartMs < b._scheduleEndMs &&
    a._scheduleEndMs > b._scheduleStartMs
  );
}

function overlapAdjustedValue(events, field, additionalWeight) {
  const values = events
    .map((event) => Number(event?.[field]) || 0)
    .sort((a, b) => b - a);
  return Math.round((values[0] || 0) + additionalWeight * values.slice(1).reduce((sum, value) => sum + value, 0));
}

export function aggregateLastCallVenueClusters(
  events,
  {
    localStart,
    radiusMiles = LAST_CALL_CLUSTER_RADIUS_MILES,
    additionalVenueWeight = LAST_CALL_ADDITIONAL_VENUE_WEIGHT,
  } = {}
) {
  const source = Array.isArray(events) ? events : [];
  const remaining = source.filter(isLastCallEvent);
  const aggregated = source.filter((event) => !isLastCallEvent(event));

  while (remaining.length > 0) {
    const seed = remaining.shift();
    const group = [seed];
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      const candidate = remaining[index];
      if (
        lastCallVenueClass(candidate) === lastCallVenueClass(seed) &&
        lastCallWindowsOverlap(seed, candidate) &&
        distanceMiles(seed, candidate) <= radiusMiles
      ) {
        group.push(candidate);
        remaining.splice(index, 1);
      }
    }

    if (group.length === 1) {
      aggregated.push(seed);
      continue;
    }

    group.sort(
      (a, b) =>
        (Number(b.demandYield) || 0) - (Number(a.demandYield) || 0) ||
        venueNameFromLastCall(a).localeCompare(venueNameFromLastCall(b))
    );
    const venueNames = group.map(venueNameFromLastCall);
    const clusterStartMs = Math.max(...group.map((event) => event._scheduleStartMs));
    const clusterEndMs = Math.min(...group.map((event) => event._scheduleEndMs));
    const combinedYield = overlapAdjustedValue(group, "demandYield", additionalVenueWeight);
    const combinedCap = Math.max(
      combinedYield,
      overlapAdjustedValue(group, "demandCap", additionalVenueWeight)
    );
    const centroid = {
      lat: group.reduce((sum, event) => sum + Number(event.lat), 0) / group.length,
      lng: group.reduce((sum, event) => sum + Number(event.lng), 0) / group.length,
    };

    aggregated.push({
      ...group[0],
      location: `Last Call Egress Cluster: ${joinVenueNames(venueNames)}`,
      volume: 1,
      demandYield: combinedYield,
      demandCap: combinedCap,
      categories: ["Last Call", "Nightlife Egress", lastCallVenueClass(seed), "Cluster"],
      lat: centroid.lat,
      lng: centroid.lng,
      venues: venueNames,
      venueCount: group.length,
      isLastCallCluster: true,
      ...timingFields(
        new Date(clusterStartMs),
        new Date(clusterEndMs),
        localStart instanceof Date ? localStart : new Date(clusterStartMs - 1)
      ),
    });
  }

  return aggregated.sort(
    (a, b) =>
      (Number(a._scheduleStartMs) || 0) - (Number(b._scheduleStartMs) || 0) ||
      (Number(b.demandYield) || 0) - (Number(a.demandYield) || 0)
  );
}

function venueNameFromRestaurantClosing(event) {
  return String(event?.location || "")
    .replace(/^Restaurant Closing:\s*/i, "")
    .trim();
}

function isRestaurantClosingEvent(event) {
  return Array.isArray(event?.categories) && event.categories.includes("Restaurant Closing");
}

export function aggregateRestaurantClosingAreaTimeClusters(
  events,
  {
    areaFor,
    additionalVenueWeight = LAST_CALL_ADDITIONAL_VENUE_WEIGHT,
  } = {}
) {
  const source = Array.isArray(events) ? events : [];
  const resolveArea = typeof areaFor === "function" ? areaFor : () => "other";
  const groups = new Map();

  for (const event of source) {
    if (!isRestaurantClosingEvent(event)) continue;
    const area = resolveArea(event);
    const closingKey = event.closeTime || `${event.windowStart || ""}|${event.windowEnd || ""}`;
    const key = `${area}|${closingKey}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }

  const emitted = new Set();
  return source.flatMap((event) => {
    if (!isRestaurantClosingEvent(event)) return [event];
    const area = resolveArea(event);
    const closingKey = event.closeTime || `${event.windowStart || ""}|${event.windowEnd || ""}`;
    const key = `${area}|${closingKey}`;
    if (emitted.has(key)) return [];
    emitted.add(key);
    const group = groups.get(key) || [event];
    if (group.length === 1) return group;

    const ranked = [...group].sort(
      (a, b) =>
        (Number(b.demandYield) || 0) - (Number(a.demandYield) || 0) ||
        venueNameFromRestaurantClosing(a).localeCompare(venueNameFromRestaurantClosing(b))
    );
    const anchor = ranked[0];
    const venues = ranked.map(venueNameFromRestaurantClosing);
    const combinedYield = overlapAdjustedValue(group, "demandYield", additionalVenueWeight);
    const combinedCap = Math.max(
      combinedYield,
      overlapAdjustedValue(group, "demandCap", additionalVenueWeight)
    );
    const areaLabel =
      area === "downtown" ? "Downtown" : area === "uptown" ? "Uptown" : "Other Areas";

    return [{
      ...anchor,
      location: `Restaurant Closings — ${areaLabel}`,
      volume: 1,
      demandYield: combinedYield,
      demandCap: combinedCap,
      categories: ["Restaurant Closing", "Closing Demand", "restaurant", "Area Cluster"],
      demandFirstArea: area,
      venues,
      venueCount: group.length,
      anchorVenue: venueNameFromRestaurantClosing(anchor),
      isRestaurantClosingCluster: true,
    }];
  });
}

export function buildScheduledLastCallEvents({
  localStart,
  localEnd,
  dictionary = [],
}) {
  const events = [];
  for (let dayOffset = -1; dayOffset <= 1; dayOffset += 1) {
    const operationalDay = startOfWallDay(localStart, dayOffset);
    const dayIndex = operationalDay.getUTCDay();
    for (const venue of dictionary) {
      const closeMinute = parseCloseMinute(venue?.closingTimes?.[String(dayIndex)]);
      if (closeMinute === null) continue;
      const adjustedCloseMinute = closeMinute < 360 ? closeMinute + 1440 : closeMinute;
      const closingDemand = closingDemandFor({
        venueName: venue.name,
        closeMinute,
        dayIndex,
      });
      const close = atMinute(operationalDay, adjustedCloseMinute);
      const start = new Date(close.getTime() - 45 * MINUTE_MS);
      const end = new Date(close.getTime() - 30 * MINUTE_MS);
      if (!intersects(start, end, localStart, localEnd)) continue;
      events.push({
        type: "event",
        location: closingDemand.trueLastCall
          ? `Last Call Egress: ${venue.name}`
          : `Restaurant Closing: ${venue.name}`,
        volume: 1,
        demandYield: closingDemand.demandYield,
        demandCap: closingDemand.demandCap,
        egressMod: closingDemand.trueLastCall ? 1.5 : 1.0,
        categories: closingDemand.trueLastCall
          ? ["Last Call", "Nightlife Egress", closingDemand.venueClass]
          : ["Restaurant Closing", "Closing Demand", closingDemand.venueClass],
        closeTime: formatTime(close),
        lat: venue.lat,
        lng: venue.lng,
        ...timingFields(start, end, localStart),
      });
    }
  }
  return aggregateLastCallVenueClusters(events, { localStart });
}

export function buildScheduledConfiguredEvents({
  localStart,
  localEnd,
  eventConfig = {},
  coords,
}) {
  const events = [];
  for (const [name, entry] of Object.entries(eventConfig || {})) {
    if (!entry || typeof entry.date !== "string") continue;
    const day = new Date(`${entry.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) continue;
    const windows = Array.isArray(entry.activeWindows) && entry.activeWindows.length > 0
      ? entry.activeWindows
      : [{ start: 0, end: 24 }];
    for (const window of windows) {
      const windowStart = Number(window.start) * 60;
      const windowEnd = Number(window.end) * 60;
      const policy = academicEventPolicy(name, entry);
      const phases = policy
        ? [
            { start: windowStart, end: windowStart + (windowEnd - windowStart) / 3, factor: 0.6, label: "Build" },
            { start: windowStart + (windowEnd - windowStart) / 3, end: windowStart + ((windowEnd - windowStart) * 2) / 3, factor: 1, label: "Peak" },
            { start: windowStart + ((windowEnd - windowStart) * 2) / 3, end: windowEnd, factor: 0.6, label: "Taper" },
          ]
        : [{ start: windowStart, end: windowEnd, factor: 1, label: "Peak" }];
      for (const phase of phases) {
        const start = atMinute(day, phase.start);
        const end = atMinute(day, phase.end);
        if (!intersects(start, end, localStart, localEnd)) continue;
        const mod = Number(entry.multiplier) > 0 ? Number(entry.multiplier) : 3.5;
        const demandYield = policy
          ? Math.max(1, Math.round(policy.peakDemand * phase.factor))
          : null;
        events.push({
          type: "event",
          location: policy?.location || `${name} Surge`,
          volume: 1,
          egressMod: policy ? 1 : mod,
          ...(policy
            ? {
                demandYield,
                demandCap: demandYield,
                anchorKey: policy.anchorKey,
              }
            : {}),
          categories: policy
            ? ["Academic Calendar", name, phase.label]
            : ["Holiday Surge", "High Demand"],
          lat: policy?.lat ?? coords.lat,
          lng: policy?.lng ?? coords.lng,
          ...timingFields(start, end, localStart),
        });
      }
    }
  }
  const deduped = new Map();
  for (const event of events) {
    if (!event.anchorKey) {
      deduped.set(Symbol(), event);
      continue;
    }
    const key = `${event.anchorKey}|${event.windowStart}|${event.windowEnd}`;
    const existing = deduped.get(key);
    if (!existing || Number(event.demandYield) > Number(existing.demandYield)) {
      deduped.set(key, event);
    }
  }
  return [...deduped.values()];
}

export function suppressOverlappingUAlbanyRoutineEvents(events = []) {
  const source = Array.isArray(events) ? events : [];
  const academicEvents = source.filter((event) => event?.anchorKey === "ualbany");
  if (academicEvents.length === 0) return source;
  return source.filter(
    (event) =>
      !(
        event?.location === "UAlbany Uptown Campus" &&
        Array.isArray(event.categories) &&
        event.categories.includes("Local Anchor") &&
        academicEvents.some(
          (academic) =>
            event._scheduleStartMs < academic._scheduleEndMs &&
            event._scheduleEndMs > academic._scheduleStartMs
        )
      )
  );
}

export const scheduledEventInternals = { formatTime, intersects, timingFields };
