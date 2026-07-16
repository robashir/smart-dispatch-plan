function categoriesFor(item) {
  return Array.isArray(item?.categories) ? item.categories.join("|") : "";
}

function subtractMinutes(label, minutes) {
  const match = String(label || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour === 12) hour = 0;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const value = ((hour * 60 + minute - minutes) % 1440 + 1440) % 1440;
  const h24 = Math.floor(value / 60);
  const ampm = h24 >= 12 ? "PM" : "AM";
  return `${h24 % 12 || 12}:${String(value % 60).padStart(2, "0")} ${ampm}`;
}

export function formatSuggestedServiceTiming(item) {
  if (!item || typeof item !== "object") return null;
  const categories = categoriesFor(item);
  const outbound = /Outbound/i.test(categories);
  if (item.type === "flight" && !outbound) {
    const parts = [];
    if (item.arrivalTime) parts.push(`Arrives ${item.arrivalTime}`);
    if (item.curbTime) parts.push(`Expected curb ${item.curbTime}`);
    return parts.join(" | ") || null;
  }
  if (
    /BYOD Flight/i.test(categories) &&
    outbound &&
    Array.isArray(item.departureTimes) &&
    item.departureTimes.length > 1
  ) {
    return `Flights depart ${item.departureTimes
      .map((flight) => `${flight.destination || flight.iata} ${flight.time}`)
      .join("; ")}`;
  }
  if (/BYOD Flight/i.test(categories) && outbound && item.departureTime) {
    return `Departs ${item.departureTime}`;
  }
  if (/BYOD Train/i.test(categories) && outbound && item.departureTime) {
    return `Train departs ${item.departureTime}`;
  }
  if (/BYOD Train/i.test(categories) && !outbound && item.arrivalTime) {
    return `Train arrives ${item.arrivalTime}`;
  }
  if (/BYOD Bus/i.test(categories) && item.arrivalTime) {
    return `Bus arrives ${item.arrivalTime}`;
  }
  if (item.windowStart && item.windowEnd) {
    return `Demand window ${item.windowStart}–${item.windowEnd}`;
  }
  return null;
}

export function getDemandFirstDeadline(item) {
  const categories = categoriesFor(item);
  const outbound = /Outbound/i.test(categories);
  if (item.type === "flight" && !outbound && item.leaveBy) {
    return { label: item.leaveBy, instruction: `Leave for ALB by ${item.leaveBy}` };
  }
  if (/BYOD Flight/i.test(categories) && outbound && item.leaveBy) {
    return { label: item.leaveBy, instruction: `Complete ALB drop-off by ${item.leaveBy}` };
  }
  if (/BYOD Train/i.test(categories) && outbound && item.leaveBy) {
    return {
      label: item.leaveBy,
      instruction: `Be at Empire State Plaza by ${item.leaveBy}`,
    };
  }
  if (/BYOD Train/i.test(categories) && !outbound && item.leaveBy) {
    const deadline = subtractMinutes(item.leaveBy, 14) || item.leaveBy;
    return { label: deadline, instruction: `Be at Rensselaer by ${deadline}` };
  }
  if (/BYOD Bus/i.test(categories) && item.leaveBy) {
    const deadline = subtractMinutes(item.leaveBy, 12) || item.leaveBy;
    return { label: deadline, instruction: `Be at Downtown Bus Terminal by ${deadline}` };
  }
  if (item.type === "train" && item.hourBucket) {
    const deadline = subtractMinutes(item.hourBucket, 14) || item.hourBucket;
    return { label: deadline, instruction: `Be at Rensselaer by ${deadline}` };
  }
  if (item.leaveBy) {
    return { label: item.leaveBy, instruction: `Be there by ${item.leaveBy}` };
  }
  return null;
}

export function formatDemandFirstTiming(item) {
  if (!item || typeof item !== "object") return null;
  const service = formatSuggestedServiceTiming(item);
  const deadline = getDemandFirstDeadline(item);
  return [service, deadline?.instruction].filter(Boolean).join(" | ") || null;
}
