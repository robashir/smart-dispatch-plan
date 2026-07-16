export function isByodOutboundFlight(data) {
  const categories = Array.isArray(data?.categories) ? data.categories.join("|") : "";
  return /BYOD Flight/i.test(categories) && /Outbound/i.test(categories);
}

export function formatByodFlightHeading(data) {
  const destination = data?.destination || data?.destinationIata || "Destination";
  if (data?.isFlightWave) return `Outbound — ALB Flight Wave to ${destination}`;
  return `Outbound — ALB Flight to ${destination}`;
}

export function formatByodFlightDemandLabel() {
  return "Outbound Flight Demand";
}
