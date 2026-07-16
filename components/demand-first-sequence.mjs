const TIMED_TYPES = new Set([
  "flight",
  "train",
  "event",
  "flight_ripple",
  "train_ripple",
  "ride",
]);
const ACTIVE_TYPES = new Set(["event", "ride", "flight_ripple", "train_ripple"]);

export function demandValue(item) {
  const value = Number(item?.densityScore);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function opportunityValue(item) {
  const opportunity = Number(item?.opportunityScore);
  return Number.isFinite(opportunity) ? opportunity : demandValue(item);
}

export function parseSequenceTime(label) {
  if (!label || typeof label !== "string") return Infinity;
  const match = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return Infinity;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour === 12) hour = 0;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}

function timeLabel(item) {
  return item?.leaveBy || item?.hourBucket || null;
}

function minutesUntil(target, nowMinute) {
  let delta = target - nowMinute;
  if (delta < -360) delta += 1440;
  return delta;
}

function compareDemand(a, b) {
  return (
    demandValue(b.item || b) - demandValue(a.item || a) ||
    opportunityValue(b.item || b) - opportunityValue(a.item || a) ||
    Number(a.delta || 0) - Number(b.delta || 0)
  );
}

function intervalsOverlap(a, b, proximityMinutes) {
  if (Math.abs(a.delta - b.delta) <= proximityMinutes) return true;
  const aHasWindow = Number.isFinite(a.windowStartDelta) && Number.isFinite(a.windowEndDelta);
  const bHasWindow = Number.isFinite(b.windowStartDelta) && Number.isFinite(b.windowEndDelta);
  if (!aHasWindow && !bHasWindow) return false;
  const aStart = aHasWindow ? a.windowStartDelta : a.delta;
  const aEnd = aHasWindow ? a.windowEndDelta : a.delta;
  const bStart = bHasWindow ? b.windowStartDelta : b.delta;
  const bEnd = bHasWindow ? b.windowEndDelta : b.delta;
  return aStart < bEnd && aEnd > bStart;
}

function rankNearbyTimes(candidates, rankingWindowMinutes) {
  const ranked = [];
  let index = 0;
  while (index < candidates.length) {
    const anchorDelta = candidates[index].delta;
    const group = [];
    while (
      index < candidates.length &&
      candidates[index].delta - anchorDelta <= rankingWindowMinutes
    ) {
      group.push(candidates[index]);
      index += 1;
    }
    const demandRank = new Map(
      [...group].sort(compareDemand).map((candidate, rank) => [candidate.item, rank + 1])
    );
    group.forEach((candidate) => {
      ranked.push({
        ...candidate,
        rankInTimeWindow: demandRank.get(candidate.item),
        optionsInTimeWindow: group.length,
      });
    });
  }
  return ranked;
}

export function buildDemandFirstTimeline(
  itinerary,
  { nowMinute, rankingWindowMinutes = 20 } = {}
) {
  const resolvedNow = Number.isFinite(nowMinute)
    ? nowMinute
    : new Date().getHours() * 60 + new Date().getMinutes();
  const items = Array.isArray(itinerary) ? itinerary : [];

  const current = items
    .filter((item) => {
      if (!ACTIVE_TYPES.has(item?.type)) return false;
      if (Number.isFinite(parseSequenceTime(timeLabel(item)))) return false;
      const threshold = item?.sequenceOnly ? 4 : 25;
      return opportunityValue(item) >= threshold && demandValue(item) > 0;
    })
    .sort(compareDemand)
    .map((item, index, activeItems) => ({
      item,
      timeLabel: "Now",
      rankInTimeWindow: index + 1,
      optionsInTimeWindow: activeItems.length,
      conflictCount: Math.max(0, activeItems.length - 1),
    }));

  const chronological = items
    .filter((item) => TIMED_TYPES.has(item?.type) && demandValue(item) > 0)
    .map((item) => {
      const label = timeLabel(item);
      const minute = parseSequenceTime(label);
      const delta = minutesUntil(minute, resolvedNow);
      const windowStartMinute = parseSequenceTime(item?.windowStart);
      const windowEndMinute = parseSequenceTime(item?.windowEnd || item?.curbTime);
      const windowStartDelta = Number.isFinite(windowStartMinute)
        ? minutesUntil(windowStartMinute, resolvedNow)
        : null;
      let windowEndDelta = Number.isFinite(windowEndMinute)
        ? minutesUntil(windowEndMinute, resolvedNow)
        : null;
      if (
        Number.isFinite(windowStartDelta) &&
        Number.isFinite(windowEndDelta) &&
        windowEndDelta < windowStartDelta
      ) {
        windowEndDelta += 1440;
      }
      return { item, minute, delta, timeLabel: label, windowStartDelta, windowEndDelta };
    })
    .filter((candidate) => Number.isFinite(candidate.minute) && candidate.delta >= -15)
    .sort((a, b) => a.delta - b.delta);

  const timed = rankNearbyTimes(chronological, rankingWindowMinutes).map((candidate) => ({
    ...candidate,
    conflictCount: chronological.filter(
      (other) =>
        other.item !== candidate.item && intervalsOverlap(candidate, other, rankingWindowMinutes)
    ).length,
  }));

  return { current, timed };
}
