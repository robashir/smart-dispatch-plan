export function isByodEvent(item) {
  return Array.isArray(item?.categories) && item.categories.some((category) => /BYOD Event/i.test(String(category)));
}

export function formatByodEventHeading(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  const phase = categories.some((category) => /^Ingress$/i.test(String(category)))
    ? "Ingress"
    : "Egress";
  return `${phase} — ${item?.location || "Venue Event"}: ${item?.eventName || "Event"}`;
}
