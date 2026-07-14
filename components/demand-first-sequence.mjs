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

function groupOverlappingCandidates(candidates, overlapMinutes) {
  const groups = [];
  for (const candidate of candidates) {
    const current = groups[groups.length - 1];
    if (!current || candidate.delta - current[0].delta >= overlapMinutes) {
      groups.push([candidate]);
    } else {
      current.push(candidate);
    }
  }
  return groups;
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

  const timed = items
    .filter((item) => TIMED_TYPES.has(item?.type) && demandValue(item) > 0)
    .map((item) => {
      const minute = parseSequenceTime(timeLabel(item));
      return { item, minute, delta: minutesUntil(minute, resolvedNow) };
    })
    .filter((candidate) => Number.isFinite(candidate.minute) && candidate.delta >= -15)
    .sort((a, b) => a.delta - b.delta);

  const groups = groupOverlappingCandidates(timed, overlapMinutes);
  const selected = [];
  let previous = activeNow ? { item: activeNow, delta: 0 } : null;
  for (const group of groups) {
    if (selected.length >= maxTimedSteps) break;
    const ranked = [...group].sort(compareDemand);
    const winner = ranked.find((candidate) =>
      isReachable(candidate, previous, driverCoords, safetyMinutes)
    );
    if (!winner) continue;
    selected.push({ ...winner, competingOptions: group.length });
    previous = winner;
  }

  return {
    activeNow,
    activeCompetingOptions: activeOptions.length,
    selected,
  };
}
