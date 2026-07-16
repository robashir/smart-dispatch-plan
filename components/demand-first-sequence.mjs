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

function coordinates(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function haversineMiles(from, to) {
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const earthRadiusMiles = 3958.8;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimatedDriveMinutes(fromValue, toValue) {
  const from = coordinates(fromValue);
  const to = coordinates(toValue);
  if (!from || !to) return 20;
  const miles = haversineMiles(from, to);
  if (miles <= 0.75) return 0;
  return Math.max(15, Math.ceil((miles / 25) * 60));
}

function isReachable(candidate, previous, driverCoords, safetyMinutes) {
  const origin = previous?.item || driverCoords;
  if (!origin) return true;
  const availableMinutes = candidate.delta - (previous?.delta || 0);
  const requiredMinutes = estimatedDriveMinutes(origin, candidate.item) + safetyMinutes;
  return availableMinutes >= requiredMinutes;
}

function formatSequenceMinute(value) {
  const minute = ((Math.round(value) % 1440) + 1440) % 1440;
  const hour24 = Math.floor(minute / 60);
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${hour24 % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${ampm}`;
}

function activeTransitionFor(activeNow, firstSelected, nowMinute, safetyMinutes) {
  if (!activeNow || !firstSelected) return null;
  const travelMinutes = estimatedDriveMinutes(activeNow, firstSelected.item);
  const requiredMinutes = travelMinutes + safetyMinutes;
  const cutoffDelta = firstSelected.delta - requiredMinutes;
  if (cutoffDelta < 0) return null;
  return {
    target: firstSelected.item?.location || firstSelected.item?.hub || "the next demand window",
    cutoffLabel: formatSequenceMinute(nowMinute + cutoffDelta),
    travelMinutes,
    safetyMinutes,
  };
}

function alternativeReason(candidateItem, winnerItem, reachable = true) {
  if (!reachable) return "Unreachable before its deadline";
  if (demandValue(candidateItem) < demandValue(winnerItem)) return "Lower expected demand";
  if (opportunityValue(candidateItem) < opportunityValue(winnerItem)) {
    return "Lower Opportunity Now after demand tie";
  }
  return "Later in the same time window";
}

function groupOverlappingCandidates(candidates, overlapMinutes) {
  const groups = [];
  let index = 0;
  while (index < candidates.length) {
    const anchorStart = Number.isFinite(candidates[index].windowStartDelta)
      ? candidates[index].windowStartDelta
      : candidates[index].delta;
    let anchorEnd = Number.isFinite(candidates[index].windowEndDelta)
      ? candidates[index].windowEndDelta
      : candidates[index].delta + overlapMinutes;
    const group = [];

    // Candidates beginning at the same moment define the decision window
    // together. This lets an explicit service window (for example, a
    // hospital shift) establish the boundary regardless of input order.
    while (index < candidates.length) {
      const candidate = candidates[index];
      const start = Number.isFinite(candidate.windowStartDelta)
        ? candidate.windowStartDelta
        : candidate.delta;
      if (start !== anchorStart) break;
      const end = Number.isFinite(candidate.windowEndDelta)
        ? candidate.windowEndDelta
        : candidate.delta + overlapMinutes;
      anchorEnd = Math.max(anchorEnd, end);
      group.push(candidate);
      index += 1;
    }

    // Include options directly inside the anchored window, but do not let
    // those secondary options extend it into a transitive overlap chain.
    while (index < candidates.length) {
      const candidate = candidates[index];
      const start = Number.isFinite(candidate.windowStartDelta)
        ? candidate.windowStartDelta
        : candidate.delta;
      if (start >= anchorEnd) break;
      group.push(candidate);
      index += 1;
    }
    groups.push(group);
  }
  return groups;
}

function candidatesOverlap(a, b) {
  const aStart = Number.isFinite(a?.windowStartDelta) ? a.windowStartDelta : a?.delta;
  const aEnd = Number.isFinite(a?.windowEndDelta) ? a.windowEndDelta : a?.delta;
  const bStart = Number.isFinite(b?.windowStartDelta) ? b.windowStartDelta : b?.delta;
  const bEnd = Number.isFinite(b?.windowEndDelta) ? b.windowEndDelta : b?.delta;
  return aStart < bEnd && aEnd > bStart;
}

export function buildDemandFirstSelection(
  itinerary,
  {
    nowMinute,
    driverCoords = null,
    overlapMinutes = 20,
    safetyMinutes = 10,
    maxTimedSteps = 4,
  } = {}
) {
  const resolvedNow = Number.isFinite(nowMinute)
    ? nowMinute
    : new Date().getHours() * 60 + new Date().getMinutes();
  const items = Array.isArray(itinerary) ? itinerary : [];

  const activeOptions = items
    .filter((item) => {
      if (!ACTIVE_TYPES.has(item?.type)) return false;
      if (Number.isFinite(parseSequenceTime(timeLabel(item)))) return false;
      const threshold = item?.sequenceOnly ? 4 : 25;
      return opportunityValue(item) >= threshold && demandValue(item) > 0;
    })
    .sort(compareDemand);
  const activeNow = activeOptions[0] || null;
  const activeAlternatives = activeNow
    ? activeOptions.slice(1).map((item) => ({
        item,
        reason: alternativeReason(item, activeNow),
      }))
    : [];

  const timed = items
    .filter((item) => TIMED_TYPES.has(item?.type) && demandValue(item) > 0)
    .map((item) => {
      const minute = parseSequenceTime(timeLabel(item));
      const delta = minutesUntil(minute, resolvedNow);
      const windowStartMinute = parseSequenceTime(item?.windowStart);
      const serviceEndMinute = parseSequenceTime(item?.windowEnd || item?.curbTime);
      const windowStartDelta = Number.isFinite(windowStartMinute)
        ? minutesUntil(windowStartMinute, resolvedNow)
        : delta;
      let windowEndDelta = Number.isFinite(serviceEndMinute)
        ? minutesUntil(serviceEndMinute, resolvedNow)
        : delta + overlapMinutes;
      if (windowEndDelta < windowStartDelta) windowEndDelta += 1440;
      return { item, minute, delta, windowStartDelta, windowEndDelta };
    })
    .filter((candidate) => Number.isFinite(candidate.minute) && candidate.delta >= -15)
    .sort((a, b) => a.delta - b.delta);

  const groups = groupOverlappingCandidates(timed, overlapMinutes);
  const selected = [];
  const consumed = new Set();
  // A current opportunity is interruptible. Reachability to the first timed
  // step starts at "now" instead of assuming the driver stays until the
  // current window ends. Later timed steps still begin after the prior
  // selected service window.
  let previous = activeNow ? { item: activeNow, delta: 0 } : null;
  for (const group of groups) {
    if (selected.length >= maxTimedSteps) break;
    const initialGroup = group.filter((candidate) => !consumed.has(candidate));
    if (initialGroup.length === 0) continue;
    initialGroup.forEach((candidate) => consumed.add(candidate));
    const initialEvaluated = [...initialGroup].sort(compareDemand).map((candidate) => ({
      ...candidate,
      reachable: isReachable(candidate, previous, driverCoords, safetyMinutes),
    }));
    const provisionalWinner = initialEvaluated.find((candidate) => candidate.reachable);
    if (!provisionalWinner) continue;

    // Compare candidates that directly overlap the provisional winner's
    // actual service interval. Do this once so a flight crossing a boundary
    // can compete with a 4 PM event without recreating transitive chains.
    const directOverlaps = timed.filter(
      (candidate) =>
        !consumed.has(candidate) && candidatesOverlap(candidate, provisionalWinner)
    );
    directOverlaps.forEach((candidate) => consumed.add(candidate));
    const evaluated = [...initialGroup, ...directOverlaps]
      .sort(compareDemand)
      .map((candidate) => ({
        ...candidate,
        reachable: isReachable(candidate, previous, driverCoords, safetyMinutes),
      }));
    const winner = evaluated.find((candidate) => candidate.reachable);
    if (!winner) continue;
    const alternatives = evaluated
      .filter((candidate) => candidate !== winner)
      .map((candidate) => ({
        item: candidate.item,
        minute: candidate.minute,
        delta: candidate.delta,
        reason: alternativeReason(candidate.item, winner.item, candidate.reachable),
      }));
    selected.push({ ...winner, competingOptions: evaluated.length, alternatives });
    previous = {
      ...winner,
      delta: Number.isFinite(winner.windowEndDelta)
        ? winner.windowEndDelta
        : winner.delta,
    };
  }

  return {
    activeNow,
    activeCompetingOptions: activeOptions.length,
    activeAlternatives,
    activeTransition: activeTransitionFor(activeNow, selected[0], resolvedNow, safetyMinutes),
    selected,
  };
}
