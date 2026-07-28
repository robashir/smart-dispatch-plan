const DAY_MS = 24 * 60 * 60 * 1000;

const MAJOR_HOLIDAY_PATTERN =
  /^(new year's day|memorial day|4th of july|independence day|labor day)$/i;

function parseYmd(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function toYmd(value) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function dayDifference(targetDate, calendarDate) {
  return Math.round((targetDate.getTime() - calendarDate.getTime()) / DAY_MS);
}

function candidate(multiplier, reason, calendarEventName) {
  return { multiplier, reason, calendarEventName };
}

function ruleForEntry(name, entry, targetDate, direction) {
  const calendarDate = parseYmd(entry?.date);
  if (!calendarDate) return null;
  const delta = dayDifference(targetDate, calendarDate);
  const normalizedName = String(name).trim();

  if (/move[- ]?in/i.test(normalizedName) && direction === "inbound" && delta === 0) {
    return candidate(1.25, `${normalizedName} inbound travel`, normalizedName);
  }
  if (/move[- ]?out/i.test(normalizedName) && direction === "outbound" && delta === 0) {
    return candidate(1.25, `${normalizedName} outbound travel`, normalizedName);
  }
  if (/exodus/i.test(normalizedName) && direction === "outbound" && delta === 0) {
    return candidate(1.3, `${normalizedName} outbound travel`, normalizedName);
  }
  if (/return/i.test(normalizedName) && direction === "inbound" && delta === 0) {
    return candidate(1.35, `${normalizedName} inbound travel`, normalizedName);
  }

  if (/^thanksgiving$/i.test(normalizedName)) {
    if (direction === "outbound" && (delta === -2 || delta === -1)) {
      return candidate(1.3, "Thanksgiving outbound travel", normalizedName);
    }
    if (direction === "inbound" && delta === 3) {
      return candidate(1.35, "Thanksgiving return travel", normalizedName);
    }
  }

  if (/^christmas(?: day)?$/i.test(normalizedName)) {
    if (direction === "outbound" && delta >= -5 && delta <= -1) {
      return candidate(1.25, "Christmas outbound travel", normalizedName);
    }
    if (direction === "inbound" && delta >= 1 && delta <= 4) {
      return candidate(1.3, "Christmas return travel", normalizedName);
    }
  }

  if (MAJOR_HOLIDAY_PATTERN.test(normalizedName)) {
    if (direction === "outbound" && delta >= -3 && delta <= -1) {
      return candidate(1.2, `${normalizedName} weekend outbound travel`, normalizedName);
    }
    if (direction === "inbound" && delta >= 0 && delta <= 2) {
      return candidate(1.25, `${normalizedName} weekend return travel`, normalizedName);
    }
  }

  return null;
}

export function transitIdentityFor(item) {
  const categories = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (item?.type === "flight") return { mode: "flight", direction: "inbound" };
  if (item?.type === "train") return { mode: "train", direction: "inbound" };
  if (/BYOD Flight/i.test(categories) && /Outbound/i.test(categories)) {
    return { mode: "flight", direction: "outbound" };
  }
  if (/BYOD Train/i.test(categories) && /Outbound/i.test(categories)) {
    return { mode: "train", direction: "outbound" };
  }
  if (/BYOD Train/i.test(categories) && /Inbound/i.test(categories)) {
    return { mode: "train", direction: "inbound" };
  }
  return null;
}

export function calendarTransitBoostFor({
  item,
  eventConfig,
  targetDate,
}) {
  const transit = transitIdentityFor(item);
  const date =
    targetDate instanceof Date && !Number.isNaN(targetDate.getTime())
      ? targetDate
      : parseYmd(targetDate);
  if (!transit || !date || !eventConfig || typeof eventConfig !== "object") {
    return null;
  }

  let best = null;
  for (const [name, entry] of Object.entries(eventConfig)) {
    const match = ruleForEntry(name, entry, date, transit.direction);
    if (!match || (best && best.multiplier >= match.multiplier)) continue;
    best = { ...match, mode: transit.mode, direction: transit.direction };
  }
  return best;
}

export function applyCalendarTransitBoost(item, eventConfig, targetDate) {
  const boost = calendarTransitBoostFor({ item, eventConfig, targetDate });
  if (!boost) return item;
  return {
    ...item,
    calendarTransitMultiplier: boost.multiplier,
    calendarTransitReason: boost.reason,
    calendarTransitEvent: boost.calendarEventName,
    calendarTransitDirection: boost.direction,
  };
}

export function targetCalendarDate(localStart) {
  const ymd = toYmd(localStart);
  return ymd ? parseYmd(ymd) : null;
}
