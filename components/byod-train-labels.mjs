export function getByodTrainDirection(data) {
  const categories = Array.isArray(data?.categories) ? data.categories : [];
  if (categories.some((category) => /^outbound$/i.test(String(category).trim()))) {
    return "Outbound";
  }
  if (categories.some((category) => /^inbound$/i.test(String(category).trim()))) {
    return "Inbound";
  }
  return null;
}

export function formatByodTrainHeading(data) {
  const direction = getByodTrainDirection(data);
  const rawLocation = String(data?.location || "Train").trim();
  if (!direction) return rawLocation;

  const location = rawLocation
    .replace(new RegExp(`\\b${direction}\\s+Train\\b`, "i"), "Train")
    .replace(/\s+/g, " ")
    .trim();
  return `${direction} — ${location}`;
}

export function formatByodTrainDemandLabel(data) {
  const direction = getByodTrainDirection(data);
  return direction ? `${direction} Train Demand` : "Train Demand";
}
