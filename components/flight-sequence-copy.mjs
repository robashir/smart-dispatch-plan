export function inboundFlightOriginLabels(data) {
  const candidates =
    Array.isArray(data?.originLabels) && data.originLabels.length > 0
      ? data.originLabels
      : data?.originLabel
        ? [data.originLabel]
        : Array.isArray(data?.origins)
          ? data.origins
          : [];
  return [...new Set(candidates.map((value) => String(value).trim()).filter(Boolean))];
}

export function formatInboundFlightSequenceHeading(data) {
  const origins = inboundFlightOriginLabels(data);
  return origins.length > 0
    ? `Inbound — ALB Flight Arrivals from ${origins.join(", ")}`
    : "Inbound — ALB Flight Arrivals";
}

export function formatInboundFlightArrivalWindow(data) {
  const origins = inboundFlightOriginLabels(data);
  return origins.length > 0
    ? `Stay near ALB for the arrival window from ${origins.join(", ")}.`
    : "Stay near ALB for the next arrival window.";
}

export function formatOutboundFlightNextWindow(data) {
  const destination = data?.destination || data?.destinationIata;
  return destination
    ? `Look for an ALB-bound ride ahead of the ${destination} departure window.`
    : "Look for an ALB-bound ride ahead of the next departure window.";
}
