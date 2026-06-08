// Sprint 66: Golden Half-Hour banner. Stateless. Renders ABOVE the
// TopPickBanner so the driver sees the 30-minute window with the highest
// stacked density before anything else. Reads `peakSurgeWindow` exactly
// as the backend ships it — { timeWindow, totalDensity, topContributors }.
// Threshold lives here (not in the backend helper): when totalDensity <= 200
// the banner is silently hidden so dead shifts don't surface a "Golden
// Half-Hour" with weak overlap.
// Sprint 70: threshold bumped 50 → 200 to match the raw-yield score scale
// (densityScore is now expected riders, not a percentage).
export function PeakSurgeBanner({ data }) {
  if (!data) return null;
  if (!Number.isFinite(data.totalDensity) || data.totalDensity <= 200) return null;

  const contributors = Array.isArray(data.topContributors) ? data.topContributors : [];

  return (
    <div className="!bg-amber-600 !text-black p-3 rounded-lg mb-3 shadow">
      <div className="text-xs uppercase font-extrabold tracking-widest !text-black">
        🔥 Golden Half-Hour
      </div>
      <div className="text-base font-bold !text-black mt-1">{data.timeWindow}</div>
      {/* Sprint 70: totalDensity is now the summed raw-yield score across
          the window, i.e. expected riders during the half-hour. Surface it
          directly so the banner says WHY the window is golden. */}
      <div className="text-sm font-bold !text-black mt-1">
        Expected Demand: {Math.round(data.totalDensity)}
      </div>
      {contributors.length > 0 && (
        <div className="text-sm !text-black opacity-90 mt-1">
          Driven by {contributors.join(" & ")}
        </div>
      )}
    </div>
  );
}
