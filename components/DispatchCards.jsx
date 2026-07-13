import {
  formatByodTrainDemandLabel,
  formatByodTrainHeading,
} from "./byod-train-labels.mjs";

// Sprint 24: typed UI cards for the deterministic itinerary array.
// Each card is a pure function component receiving { data } per PO spec.

// Sprint 70: Raw Yield Engine. The `densityScore` field now carries
// "expected riders" (volume × yield × mod) instead of a percent-of-capacity
// reading. Cards expose a platform-aware expected-demand label so food and
// grocery hotspots don't read like rideshare work.
function formatExpectedDemand(score, type) {
  if (!Number.isFinite(score)) return null;
  if (type === "food") return `Expected Food Deliveries: ${Math.round(score)}`;
  if (type === "grocery") return `Expected Grocery Deliveries: ${Math.round(score)}`;
  return `Expected Riders: ${Math.round(score)}`;
}

function formatOpportunity(data) {
  const opportunity = Number(data?.opportunityScore);
  if (!Number.isFinite(opportunity)) return null;
  return `Opportunity Now: ${Math.round(opportunity)}`;
}

function formatDriverSupply(data) {
  const pressure = Number(data?.driverSupplyPressureMod);
  if (!Number.isFinite(pressure) || pressure <= 0) return null;
  if (pressure >= 1.5) return "Driver Supply: Very Tight";
  if (pressure >= 1.2) return "Driver Supply: Tight";
  if (pressure >= 1.1) return "Driver Supply: Slightly Tight";
  return "Driver Supply: Normal";
}

export function FlightCard({ data }) {
  const density = formatExpectedDemand(data.densityScore, data.type);
  const opportunity = formatOpportunity(data);
  const driverSupply = formatDriverSupply(data);
  // Sprint 68: prefer human-readable city names (originLabels) when the
  // backend supplied them; fall back to the raw IATA list for older payloads.
  const labels =
    Array.isArray(data.originLabels) && data.originLabels.length > 0
      ? data.originLabels
      : Array.isArray(data.origins)
        ? data.origins
        : [];
  const isFlightLevel = Boolean(data.arrivalTime || data.curbTime || data.originLabel);
  const originText = data.originLabel || labels.join(", ");
  const flightTitle = data.flightNumber
    ? `${data.flightNumber} from ${originText}`
    : `Flight from ${originText || data.hub}`;
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-blue-400 p-4`}>
      <div className="text-xs uppercase tracking-wide text-blue-400 mb-1">Flight Surge</div>
      <div className="text-2xl font-bold mb-2">Leave by {data.leaveBy}</div>
      {isFlightLevel ? (
        <>
          <div className="text-lg">{flightTitle}</div>
          <div className="text-sm text-neutral-300 mt-1">
            Arrival {data.arrivalTime} | Curb {data.curbTime}
          </div>
          <div className="text-sm text-neutral-400 mt-1">
            Status: {data.status || "Scheduled"}
            {Number.isFinite(data.delayMinutes) && data.delayMinutes > 0
              ? ` | Delay ${data.delayMinutes}m`
              : ""}
          </div>
        </>
      ) : (
        <>
          <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
          <div className="text-sm text-neutral-400 mt-1">From: {labels.join(", ")}</div>
        </>
      )}
      {density && <div className="text-sm font-semibold text-blue-300 mt-2">{density}</div>}
      {driverSupply && <div className="text-sm text-neutral-400 mt-1">{driverSupply}</div>}
      {opportunity && <div className="text-sm font-semibold text-blue-200 mt-1">{opportunity}</div>}
    </div>
  );
}

export function TrainCard({ data }) {
  const density = formatExpectedDemand(data.densityScore, data.type);
  const opportunity = formatOpportunity(data);
  const driverSupply = formatDriverSupply(data);
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-emerald-400 p-4`}>
      <div className="text-xs uppercase tracking-wide text-emerald-400 mb-1">Train Surge</div>
      <div className="text-2xl font-bold mb-2">{data.hourBucket}</div>
      <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
      <div className="text-sm text-neutral-400 mt-1">From: {data.origins.join(", ")}</div>
      {/* Sprint 65: stateless relative-time stamp from the backend. Falls
          through cleanly when the field is missing (older payloads). */}
      {data.relativeTime && (
        <div className="text-sm text-neutral-400 mt-1">{data.relativeTime}</div>
      )}
      {density && <div className="text-sm font-semibold text-emerald-300 mt-2">{density}</div>}
      {driverSupply && <div className="text-sm text-neutral-400 mt-1">{driverSupply}</div>}
      {opportunity && <div className="text-sm font-semibold text-emerald-200 mt-1">{opportunity}</div>}
    </div>
  );
}

// Sprint 32: Event Egress card. Surfaces venue + egressMod the moment the
// surge window opens (Standard 2.0x / Mega-Venue 2.5x). Purple accent so it
// reads distinct from FlightCard (blue) / TrainCard (emerald) / HotspotCard (rose).
export function EventCard({ data }) {
  const density = formatExpectedDemand(data.densityScore, data.type);
  const opportunity = formatOpportunity(data);
  const driverSupply = formatDriverSupply(data);
  const isLastCall =
    Array.isArray(data.categories) &&
    data.categories.some((c) => /last call|nightlife/i.test(String(c)));
  const isByodTrain =
    Array.isArray(data.categories) &&
    data.categories.some((c) => /byod train/i.test(String(c)));
  const isLocalAnchor =
    Array.isArray(data.categories) &&
    data.categories.some((c) => /local anchor/i.test(String(c)));
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-purple-400 p-4`}>
      <div className="text-xs uppercase tracking-wide text-purple-400 mb-1">
        {isLocalAnchor ? "Local Anchor" : "Event Egress"}
      </div>
      <div className="text-2xl font-bold mb-2">
        {isByodTrain ? formatByodTrainHeading(data) : data.location}
      </div>
      <div className="text-lg">
        {isByodTrain
          ? formatByodTrainDemandLabel(data)
          : isLocalAnchor
            ? "Routine Demand Pulse"
            : isLastCall
              ? `${data.egressMod}x Demand Window`
              : `${data.egressMod}x Egress Demand`}
      </div>
      {/* Sprint 54: BYOD-parsed trains carry the raw "5:47p" arrivalTime
          field. Other event types (Hospital / State Commuter / Holiday /
          Crossgates) omit it, so the line is conditional. */}
      {data.arrivalTime && (
        <div className="text-sm text-neutral-300 mt-1">Arrives: {data.arrivalTime}</div>
      )}
      {/* Sprint 65: stateless relative-time stamp from the backend (BYOD
          inbound + outbound trains both carry it). Falls through cleanly
          when the field is missing (non-train event egress cards). */}
      {data.relativeTime && (
        <div className="text-sm text-neutral-400 mt-1">{data.relativeTime}</div>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        {data.categories.map((c) => (
          <span key={c} className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded">
            {c}
          </span>
        ))}
      </div>
      {density && <div className="text-sm font-semibold text-purple-300 mt-2">{density}</div>}
      {driverSupply && <div className="text-sm text-neutral-400 mt-1">{driverSupply}</div>}
      {opportunity && <div className="text-sm font-semibold text-purple-200 mt-1">{opportunity}</div>}
    </div>
  );
}

export function HotspotCard({ data }) {
  const density = formatExpectedDemand(data.densityScore, data.type);
  const opportunity = formatOpportunity(data);
  const driverSupply = formatDriverSupply(data);
  const nearbyNames = Array.isArray(data.nearbyNames) ? data.nearbyNames.filter(Boolean) : [];
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-rose-400 p-4`}>
      <div className="text-xs uppercase tracking-wide text-rose-400 mb-1">
        {data.type === "grocery" ? "Grocery Hotspot" : "Food Hotspot"}
      </div>
      <div className="text-2xl font-bold mb-2">{data.location}</div>
      {data.anchorName && (
        <div className="text-sm italic text-neutral-400 mb-2">Anchored by {data.anchorName}</div>
      )}
      {nearbyNames.length > 0 && (
        <div className="text-sm text-neutral-400 mb-2">Nearby: {nearbyNames.join(", ")}</div>
      )}
      <div className="text-lg">{data.tier}</div>
      <div className="text-sm text-neutral-400 mb-2">Volume: {data.volume}</div>
      <div className="flex flex-wrap gap-2">
        {data.categories.map((c) => (
          <span key={c} className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded">
            {c}
          </span>
        ))}
      </div>
      {density && <div className="text-sm font-semibold text-rose-300 mt-2">{density}</div>}
      {driverSupply && <div className="text-sm text-neutral-400 mt-1">{driverSupply}</div>}
      {opportunity && <div className="text-sm font-semibold text-rose-200 mt-1">{opportunity}</div>}
    </div>
  );
}
