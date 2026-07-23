const MINUTE_MS = 60 * 1000;

export const DEFAULT_DEMAND_PHASES = [
  { label: "Build", factor: 0.6 },
  { label: "Peak", factor: 1.0 },
  { label: "Taper", factor: 0.6 },
];

export function splitDemandWindow(
  start,
  end,
  { minimumMinutes = 30, phases = DEFAULT_DEMAND_PHASES } = {}
) {
  if (
    !(start instanceof Date) ||
    !(end instanceof Date) ||
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return [];
  }

  const durationMs = end.getTime() - start.getTime();
  const validPhases = Array.isArray(phases)
    ? phases.filter(
        (phase) =>
          phase &&
          typeof phase.label === "string" &&
          Number.isFinite(Number(phase.factor)) &&
          Number(phase.factor) > 0
      )
    : [];

  if (durationMs < Number(minimumMinutes) * MINUTE_MS || validPhases.length < 2) {
    return [{ start, end, label: "Peak", factor: 1.0 }];
  }

  return validPhases.map((phase, index) => ({
    start: new Date(start.getTime() + (durationMs * index) / validPhases.length),
    end: new Date(start.getTime() + (durationMs * (index + 1)) / validPhases.length),
    label: phase.label,
    factor: Number(phase.factor),
  }));
}
