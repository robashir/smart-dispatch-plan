// Sprint 33: Top Pick global banner. Renders ABOVE the Sprint 32.1 tab
// toggle so the driver sees their single best move regardless of which
// surge family (transit vs food) it belongs to. Type-aware body so the
// shown text matches the underlying item shape.
// Contrast fix: every text node uses Tailwind's `!` important modifier on
// text-black so dark-mode inheritance from globals.css can't override it.
// Sprint 48: Normalized Density Engine. Banner reads data.densityScore
// (the new apples-to-apples 0-100+ percent-of-capacity scale) and renders
// it as "Density: X%" so the global recommendation is comparable across
// surge families.
export function TopPickBanner({ data }) {
  if (!data) return null;

  const densityLine = Number.isFinite(data.densityScore)
    ? `Density: ${Math.round(data.densityScore)}%`
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
    case "event":
      body = (
        <>
          <div className="text-2xl font-bold !text-black">{data.location}</div>
          <div className="text-lg !text-black">{data.egressMod}x Surge Active</div>
          {Array.isArray(data.categories) && data.categories.length > 0 && (
            <div className="text-sm opacity-80 mt-1 !text-black">{data.categories.join(", ")}</div>
          )}
        </>
      );
      break;
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
    </div>
  );
}
