// Sprint 24: typed UI cards for the deterministic itinerary array.
// Each card is a pure function component receiving { data } per PO spec.

export function FlightCard({ data }) {
  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-blue-400 p-4">
      <div className="text-xs uppercase tracking-wide text-blue-400 mb-1">Flight Surge</div>
      <div className="text-2xl font-bold mb-2">Leave by {data.leaveBy}</div>
      <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
      <div className="text-sm text-neutral-400 mt-1">From: {data.origins.join(", ")}</div>
    </div>
  );
}

export function TrainCard({ data }) {
  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-emerald-400 p-4">
      <div className="text-xs uppercase tracking-wide text-emerald-400 mb-1">Train Surge</div>
      <div className="text-2xl font-bold mb-2">{data.hourBucket}</div>
      <div className="text-lg">{data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}</div>
      <div className="text-sm text-neutral-400 mt-1">From: {data.origins.join(", ")}</div>
    </div>
  );
}

export function HotspotCard({ data }) {
  return (
    <div className="rounded-xl bg-neutral-900 border border-neutral-700 border-l-4 border-l-rose-400 p-4">
      <div className="text-xs uppercase tracking-wide text-rose-400 mb-1">
        {data.type === "grocery" ? "Grocery Hotspot" : "Food Hotspot"}
      </div>
      <div className="text-2xl font-bold mb-2">{data.location}</div>
      <div className="text-lg">{data.tier}</div>
      <div className="text-sm text-neutral-400 mb-2">Volume: {data.volume}</div>
      <div className="flex flex-wrap gap-2">
        {data.categories.map((c) => (
          <span key={c} className="px-2 py-1 text-xs bg-neutral-800 border border-neutral-700 rounded">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}
