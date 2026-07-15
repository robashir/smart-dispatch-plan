import { parseSequenceTime } from "./demand-first-sequence.mjs";
import { getDemandFirstDeadline } from "./demand-first-timing.mjs";

function normalizeMinute(value) {
  return ((Math.round(value) % 1440) + 1440) % 1440;
}

function formatMinute(value) {
  const minute = normalizeMinute(value);
  const hour24 = Math.floor(minute / 60);
  const ampm = hour24 >= 12 ? "PM" : "AM";
  return `${hour24 % 12 || 12}:${String(minute % 60).padStart(2, "0")} ${ampm}`;
}

function forwardDelta(targetMinute, startMinute) {
  let delta = targetMinute - startMinute;
  if (delta < -360) delta += 1440;
  return delta;
}

function completedWindowLabel(item) {
  return item?.windowEnd || item?.curbTime || item?.arrivalTime || item?.leaveBy || item?.hourBucket || null;
}

export function flexTargetLabel(item) {
  const categories = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (item?.type === "flight" || /BYOD Flight/i.test(categories)) return "ALB";
  if (/BYOD Train/i.test(categories) && /Outbound/i.test(categories)) {
    return "Empire State Plaza";
  }
  if (item?.type === "train" || /BYOD Train/i.test(categories)) return "Rensselaer";
  if (/BYOD Bus/i.test(categories)) return "Downtown Bus Terminal";
  return item?.location || item?.hub || "the next demand window";
}

export function buildDemandFirstFlexWindows(
  { activeNow = null, selected = [] } = {},
  { nowMinute, firstGapMinutes = 45, betweenGapMinutes = 60, safetyMinutes = 15 } = {}
) {
  const now = Number.isFinite(nowMinute)
    ? nowMinute
    : new Date().getHours() * 60 + new Date().getMinutes();
  const windows = [];

  selected.forEach((candidate, index) => {
    const previous = selected[index - 1] || null;
    const gap = previous ? candidate.delta - previous.delta : candidate.delta;
    const threshold = previous ? betweenGapMinutes : firstGapMinutes;
    if ((!previous && activeNow) || gap <= threshold) return;

    const deadline = getDemandFirstDeadline(candidate.item);
    const deadlineMinute = parseSequenceTime(deadline?.label);
    if (!Number.isFinite(deadlineMinute)) return;
    const deadlineDelta = forwardDelta(deadlineMinute, now);
    const cutoffDelta = deadlineDelta - safetyMinutes;
    const previousCompletedLabel = previous ? completedWindowLabel(previous.item) : null;
    const previousCompletedMinute = parseSequenceTime(previousCompletedLabel);
    const startDelta =
      previous && Number.isFinite(previousCompletedMinute)
        ? forwardDelta(previousCompletedMinute, now)
        : previous
          ? previous.delta
          : 0;
    if (cutoffDelta - startDelta < 20) return;

    windows.push({
      beforeIndex: index,
      startLabel: previousCompletedLabel || "Now",
      cutoffLabel: formatMinute(now + cutoffDelta),
      target: flexTargetLabel(candidate.item),
      deadlineInstruction: deadline.instruction,
      gapMinutes: gap,
    });
  });

  return windows;
}
