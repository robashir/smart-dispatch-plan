function parseClockMinute(label) {
  const match = String(label || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return Infinity;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (hour === 12) hour = 0;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + minute;
}

function forwardDelta(label, nowMinute) {
  const minute = parseClockMinute(label);
  if (!Number.isFinite(minute)) return Infinity;
  let delta = minute - nowMinute;
  if (delta < -360) delta += 1440;
  return delta;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} & ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} & ${labels.at(-1)}`;
}

function flightDetail(event) {
  return {
    flightNumber: event.flightNumber || null,
    origin: event.origin || null,
    originLabel: event.originLabel || event.origin || null,
    arrivalTime: event.arrivalTime || null,
    curbTime: event.curbTime || null,
    status: event.status || "Scheduled",
  };
}

export function aggregateInboundFlightEvents(
  events,
  { nowMinute, windowMinutes = 20, demandCap = 45 } = {}
) {
  if (!Array.isArray(events) || events.length === 0) return [];
  const now = Number.isFinite(nowMinute) ? nowMinute : 0;
  const sorted = events
    .map((event) => ({ event, delta: forwardDelta(event?.curbTime, now) }))
    .filter(({ delta }) => Number.isFinite(delta))
    .sort((a, b) => a.delta - b.delta);
  const groups = [];
  let index = 0;

  while (index < sorted.length) {
    const anchor = sorted[index].delta;
    const group = [];
    while (index < sorted.length && sorted[index].delta - anchor <= windowMinutes) {
      group.push(sorted[index].event);
      index += 1;
    }
    groups.push(group);
  }

  return groups.map((group) => {
    if (group.length === 1) return group[0];
    const byLeaveBy = [...group].sort(
      (a, b) => forwardDelta(a.leaveBy, now) - forwardDelta(b.leaveBy, now)
    );
    const byArrival = [...group].sort(
      (a, b) => forwardDelta(a.arrivalTime, now) - forwardDelta(b.arrivalTime, now)
    );
    const byCurb = [...group].sort(
      (a, b) => forwardDelta(a.curbTime, now) - forwardDelta(b.curbTime, now)
    );
    const earliest = byLeaveBy[0];
    const origins = unique(group.flatMap((event) => event.origins || [event.origin]));
    const originLabels = unique(
      group.flatMap((event) => event.originLabels || [event.originLabel || event.origin])
    );
    const flightDetails = byArrival.map(flightDetail);
    const statuses = flightDetails.map(({ status }) => status);

    return {
      ...earliest,
      volume: group.reduce((sum, event) => sum + (Number(event.volume) || 0), 0),
      demandCap,
      flightNumber: null,
      origin: origins[0] || null,
      origins,
      originLabel: joinLabels(originLabels),
      originLabels,
      arrivalTime: byArrival[0].arrivalTime,
      curbTime: byCurb.at(-1).curbTime,
      leaveBy: earliest.leaveBy,
      status: statuses.some((status) => /delay/i.test(status))
        ? "Includes Delayed"
        : statuses.every((status) => /on time/i.test(status))
          ? "On Time"
          : "Scheduled",
      delayMinutes: Math.max(0, ...group.map((event) => Number(event.delayMinutes) || 0)),
      fatigueMod: Math.max(1, ...group.map((event) => Number(event.fatigueMod) || 1)),
      leisureMod: Math.max(1, ...group.map((event) => Number(event.leisureMod) || 1)),
      flightDetails,
      flightCount: group.length,
      isFlightWave: true,
    };
  });
}
