// Sprint 66: Golden Half-Hour banner. Stateless. Renders ABOVE the
// TopPickBanner so the driver sees the 30-minute window with the highest
// stacked density before anything else. Reads `peakSurgeWindow` exactly
// as the backend ships it — { timeWindow, totalDensity, topContributors }.
// Threshold lives here (not in the backend helper): when totalDensity <= 50
// the banner is silently hidden so dead shifts don't surface a "Golden
// Half-Hour" with weak overlap.
export function PeakSurgeBanner({ data }) {
  if (!data) return null;
  if (!Number.isFinite(data.totalDensity) || data.totalDensity <= 50) return null;

  const contributors = Array.isArray(data.topContributors) ? data.topContributors : [];

  return (
    <div className="!bg-amber-600 !text-black p-3 rounded-lg mb-3 shadow">
      <div className="text-xs uppercase font-extrabold tracking-widest !text-black">
        🔥 Golden Half-Hour
      </div>
      <div className="text-base font-bold !text-black mt-1">{data.timeWindow}</div>
      {contributors.length > 0 && (
        <div className="text-sm !text-black opacity-90 mt-1">
          Driven by {contributors.join(" & ")}
        </div>
      )}
    </div>
  );
}
