// Sprint 33: Top Pick global banner. Renders ABOVE the Sprint 32.1 tab
// toggle so the driver sees their single best move regardless of which
// surge family (transit vs food) it belongs to. Type-aware body so the
// shown text matches the underlying item shape.
// Contrast fix: every text node uses Tailwind's `!` important modifier on
// text-black so dark-mode inheritance from globals.css can't override it.
// Sprint 70: Raw Yield Engine. Banner reads data.densityScore (now carries
// expected demand, not a percentage) and renders a platform-aware label so
// food/grocery recommendations don't read like rideshare work.
export function TopPickBanner({ data }) {
  if (!data) return null;

  let densityLine = null;
  if (Number.isFinite(data.densityScore)) {
    if (data.type === "food") {
      densityLine = `Expected Food Deliveries: ${Math.round(data.densityScore)}`;
    } else if (data.type === "grocery") {
      densityLine = `Expected Grocery Deliveries: ${Math.round(data.densityScore)}`;
    } else {
      densityLine = `Expected Riders: ${Math.round(data.densityScore)}`;
    }
  }
  const opportunityLine =
    Number.isFinite(data.opportunityScore)
      ? `Opportunity Now: ${Math.round(data.opportunityScore)}`
      : null;
  const supplyPressure = Number(data.driverSupplyPressureMod);
  const supplyLine =
    Number.isFinite(supplyPressure) && supplyPressure > 0
      ? supplyPressure >= 1.5
        ? "Driver Supply: Very Tight"
        : supplyPressure >= 1.2
          ? "Driver Supply: Tight"
          : supplyPressure >= 1.1
            ? "Driver Supply: Slightly Tight"
            : "Driver Supply: Normal"
      : null;

  let body;
  switch (data.type) {
    case "flight":
      body = (
        <>
          <div className="text-2xl font-bold !text-black">Leave by {data.leaveBy}</div>
          <div className="text-lg !text-black">
            {data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}
          </div>
          {Array.isArray(data.origins) && data.origins.length > 0 && (
            <div className="text-sm opacity-80 mt-1 !text-black">From: {data.origins.join(", ")}</div>
          )}
        </>
      );
      break;
    case "train":
      body = (
        <>
          <div className="text-2xl font-bold !text-black">{data.hourBucket}</div>
          <div className="text-lg !text-black">
            {data.volume} Arrival{data.volume === 1 ? "" : "s"} at {data.hub}
          </div>
          {Array.isArray(data.origins) && data.origins.length > 0 && (
            <div className="text-sm opacity-80 mt-1 !text-black">From: {data.origins.join(", ")}</div>
          )}
        </>
      );
      break;
    case "event": {
      const isLastCall =
        Array.isArray(data.categories) &&
        data.categories.some((c) => /last call|nightlife/i.test(String(c)));
      const isByodTrain =
        Array.isArray(data.categories) &&
        data.categories.some((c) => /byod train/i.test(String(c)));
      body = (
        <>
          <div className="text-2xl font-bold !text-black">{data.location}</div>
          <div className="text-lg !text-black">
            {isByodTrain
              ? "Inbound Train Demand"
              : isLastCall
                ? `${data.egressMod}x Demand Window`
                : `${data.egressMod}x Egress Demand`}
          </div>
          {Array.isArray(data.categories) && data.categories.length > 0 && (
            <div className="text-sm opacity-80 mt-1 !text-black">{data.categories.join(", ")}</div>
          )}
        </>
      );
      break;
    }
    case "food":
    case "grocery":
      body = (
        <>
          <div className="text-2xl font-bold !text-black">{data.location}</div>
          <div className="text-lg !text-black">
            {data.tier} — Volume {data.volume}
          </div>
          {data.anchorName && (
            <div className="text-sm italic opacity-80 mt-1 !text-black">Anchored by {data.anchorName}</div>
          )}
        </>
      );
      break;
    default:
      return null;
  }

  return (
    <div className="!bg-yellow-500 !text-black p-4 rounded-lg mb-6 shadow-lg">
      <div className="text-xs uppercase font-extrabold tracking-widest mb-1 !text-black">
        🔥 Recommended Next Move
      </div>
      {body}
      {densityLine && (
        <div className="text-sm font-bold mt-2 !text-black">{densityLine}</div>
      )}
      {supplyLine && (
        <div className="text-sm font-semibold mt-1 !text-black">{supplyLine}</div>
      )}
      {opportunityLine && (
        <div className="text-sm font-bold mt-1 !text-black">{opportunityLine}</div>
      )}
    </div>
  );
}
