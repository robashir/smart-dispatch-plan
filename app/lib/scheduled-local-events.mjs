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
      const close = atMinute(operationalDay, adjustedCloseMinute);
      const start = new Date(close.getTime() - 45 * MINUTE_MS);
      const end = new Date(close.getTime() - 30 * MINUTE_MS);
      if (!intersects(start, end, localStart, localEnd)) continue;
      events.push({
        type: "event",
        location: `Last Call Egress: ${venue.name}`,
        volume: 1,
        egressMod: 3.5,
        categories: ["Last Call", "Nightlife Egress"],
        closeTime: formatTime(close),
        lat: venue.lat,
        lng: venue.lng,
        ...timingFields(start, end, localStart),
      });
    }
  }
  return events;
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
      const start = new Date(day.getTime() + Number(window.start) * 60 * MINUTE_MS);
      const end = new Date(day.getTime() + Number(window.end) * 60 * MINUTE_MS);
      if (!intersects(start, end, localStart, localEnd)) continue;
      const mod = Number(entry.multiplier) > 0 ? Number(entry.multiplier) : 3.5;
      events.push({
        type: "event",
        location: `${name} Surge`,
        volume: 1,
        egressMod: mod,
        categories: [entry.type === "holiday" ? "Holiday Surge" : "Academic Calendar", "High Demand"],
        lat: coords.lat,
        lng: coords.lng,
        ...timingFields(start, end, localStart),
      });
    }
  }
  return events;
}

export const scheduledEventInternals = { formatTime, intersects, timingFields };
