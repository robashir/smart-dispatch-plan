function isOutbound(item) {
  const categories = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  return /Outbound/i.test(categories);
}

export function formatDemandFirstTiming(item) {
  if (!item || typeof item !== "object") return null;

  const outbound = isOutbound(item);
  const serviceTime = outbound
    ? item.departureTime || item.time
    : item.arrivalTime || item.curbTime ||
      ((item.type === "flight" || item.type === "train") ? item.hourBucket : null);
  const beThereBy = item.beThereBy || item.leaveBy ||
    ((item.type === "flight" || item.type === "train") ? item.hourBucket : null);

  const serviceLabel = outbound ? "Departure time" : "Arrival time";
  if (serviceTime && beThereBy) {
    return `${serviceLabel} ${serviceTime} | Be there by ${beThereBy}`;
  }
  if (serviceTime) return `${serviceLabel} ${serviceTime}`;
  if (beThereBy) return `Be there by ${beThereBy}`;
  return null;
}
