// Sprint 24: typed UI cards for the deterministic itinerary array.
// Each card is a pure function component receiving { data } per PO spec.

// Sprint 40: Ghosting Effect. When data.isWeak is true the item passed the
// X-Ray bypass but is below the cutoff — mute it so the eye filters it.
// (Sprint 48: floor moved from <1.0 surgeScore to <10.0 densityScore.)
const ghostCls = "opacity-40 grayscale";

// Sprint 48: Normalized Density Engine. Replaces the unbounded surgeScore
// with a 0-100+ percent-of-capacity reading. Cards expose it as
// "Density: X%" so the driver can compare apples-to-apples across surge
// families without doing arithmetic in their head.
function formatDensity(score) {
  if (!Number.isFinite(score)) return null;
  return `Density: ${Math.round(score)}%`;
}

export function FlightCard({ data }) {
  const density = formatDensity(data.densityScore);
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-blue-400 p-4 ${data.isWeak ? ghostCls : ""}`}>
      <div className="text-xs uppercase tracking-wide text-blue-400 mb-1">Flight Surge</div>
      <div className="text-2xl font-bold mb-2">Leave by {data.leaveBy}</div>
      <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
      <div className="text-sm text-neutral-400 mt-1">From: {data.origins.join(", ")}</div>
      {density && <div className="text-sm font-semibold text-blue-300 mt-2">{density}</div>}
    </div>
  );
}

export function TrainCard({ data }) {
  const density = formatDensity(data.densityScore);
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-emerald-400 p-4 ${data.isWeak ? ghostCls : ""}`}>
      <div className="text-xs uppercase tracking-wide text-emerald-400 mb-1">Train Surge</div>
      <div className="text-2xl font-bold mb-2">{data.hourBucket}</div>
      <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
      <div className="text-sm text-neutral-400 mt-1">From: {data.origins.join(", ")}</div>
      {density && <div className="text-sm font-semibold text-emerald-300 mt-2">{density}</div>}
    </div>
  );
}

// Sprint 32: Event Egress card. Surfaces venue + egressMod the moment the
// surge window opens (Standard 2.0x / Mega-Venue 2.5x). Purple accent so it
// reads distinct from FlightCard (blue) / TrainCard (emerald) / HotspotCard (rose).
export function EventCard({ data }) {
  const density = formatDensity(data.densityScore);
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-purple-400 p-4 ${data.isWeak ? ghostCls : ""}`}>
      <div className="text-xs uppercase tracking-wide text-purple-400 mb-1">Event Egress</div>
      <div className="text-2xl font-bold mb-2">{data.location}</div>
      <div className="text-lg">{data.egressMod}x Surge Active</div>
      {/* Sprint 54: BYOD-parsed trains carry the raw "5:47p" arrivalTime
          field. Other event types (Hospital / State Commuter / Holiday /
          Crossgates) omit it, so the line is conditional. */}
      {data.arrivalTime && (
        <div className="text-sm text-neutral-300 mt-1">Arrives: {data.arrivalTime}</div>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        {data.categories.map((c) => (
          <span key={c} className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded">
            {c}
          </span>
        ))}
      </div>
      {density && <div className="text-sm font-semibold text-purple-300 mt-2">{density}</div>}
    </div>
  );
}

export function HotspotCard({ data }) {
  const density = formatDensity(data.densityScore);
  return (
    <div className={`rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-rose-400 p-4 ${data.isWeak ? ghostCls : ""}`}>
      <div className="text-xs uppercase tracking-wide text-rose-400 mb-1">
        {data.type === "grocery" ? "Grocery Hotspot" : "Food Hotspot"}
      </div>
      <div className="text-2xl font-bold mb-2">{data.location}</div>
      {data.anchorName && (
        <div className="text-sm italic text-neutral-400 mb-2">Anchored by {data.anchorName}</div>
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
    </div>
  );
}
