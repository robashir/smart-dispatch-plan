import { formatByodTrainHeading } from "./byod-train-labels.mjs";
import {
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./byod-flight-labels.mjs";
import {
  formatInboundFlightArrivalWindow,
  formatInboundFlightSequenceHeading,
  formatOutboundFlightNextWindow,
} from "./flight-sequence-copy.mjs";

function parseTimeLabel(label) {
  if (!label || typeof label !== "string") return Infinity;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return Infinity;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + min;
}

function currentLocalMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

function minutesUntil(targetMin, nowMin) {
  if (!Number.isFinite(targetMin) || !Number.isFinite(nowMin)) return Infinity;
  let delta = targetMin - nowMin;
  if (delta < -360) delta += 1440;
  return delta;
}

function normalizeMinute(minute) {
  if (!Number.isFinite(minute)) return null;
  return ((Math.round(minute) % 1440) + 1440) % 1440;
}

function formatMinute(minute) {
  const normalized = normalizeMinute(minute);
  if (normalized === null) return null;
  const h24 = Math.floor(normalized / 60);
  const min = normalized % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function anchorKey(item) {
  const title = itemTitle(item).toLowerCase();
  const cats = Array.isArray(item?.categories) ? item.categories.join("|").toLowerCase() : "";
  if (/rensselaer|amtrak/.test(title)) return "rensselaer";
  if (/empire state plaza|esp|outbound train/.test(title)) return "esp";
  if (/crossgates/.test(title)) return "crossgates";
  if (/hospital|albany med|st\.?\s*peter/.test(title) || /hospital|shift|nursing|clinic|admin/.test(cats)) {
    return "hospital";
  }
  if (/airport|\balb\b/.test(title) || item?.type === "flight") return "airport";
  if (/downtown/.test(title)) return "downtown";
  if (/wolf road|colonie/.test(title)) return "wolf-road";
  if (Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng))) {
    return `${Number(item.lat).toFixed(3)},${Number(item.lng).toFixed(3)}`;
  }
  return title || "unknown";
}

function estimateDriveMinutes(from, to) {
  if (anchorKey(from) === anchorKey(to)) return 0;
  if (
    !Number.isFinite(Number(from?.lat)) ||
    !Number.isFinite(Number(from?.lng)) ||
    !Number.isFinite(Number(to?.lat)) ||
    !Number.isFinite(Number(to?.lng))
  ) {
    return null;
  }
  return Math.max(
    15,
    Math.ceil((haversineMiles(Number(from.lat), Number(from.lng), Number(to.lat), Number(to.lng)) / 25) * 60)
  );
}

function itemTitle(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  const isByodTrain = categories.some((category) =>
    /byod train/i.test(String(category))
  );
  if (isByodOutboundFlight(item)) return formatByodFlightHeading(item);
  if (isByodTrain) return formatByodTrainHeading(item);
  if (item?.type === "flight") return formatInboundFlightSequenceHeading(item);
  if (item?.location) return item.location;
  if (item?.hub) return item.hub;
  if (item?.hourBucket) return item.hourBucket;
  return "Opportunity";
}

function itemWindowLabel(item) {
  if (item?.leaveBy) return item.leaveBy;
  if (item?.hourBucket) return item.hourBucket;
  return null;
}

function arrivalBufferMinutes(item) {
  const cats = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (isByodOutboundFlight(item)) return 0;
  if (item?.type === "flight" || /Flight|Airport/i.test(cats)) return 20;
  if (item?.type === "train" || /BYOD Train|Train/i.test(cats)) return 14;
  if (item?.type === "event" || /Egress|Last Call|Closing Surge/i.test(cats)) return 12;
  return 10;
}

function beThereByText(item, nowMin) {
  const targetMin = parseTimeLabel(itemWindowLabel(item));
  if (!Number.isFinite(targetMin)) return null;
  const delta = minutesUntil(targetMin, nowMin);
  if (isByodOutboundFlight(item)) {
    if (delta <= 3) return "Target ALB now";
    const time = formatMinute(targetMin);
    return time ? `Complete an ALB drop-off by ${time}` : null;
  }
  if (item?.type === "flight" && delta <= 3) return "Stay near ALB now";
  if (delta <= 3) return `Stay near ${itemTitle(item)} now`;
  const time = formatMinute(targetMin - arrivalBufferMinutes(item));
  if (!time) return null;
  const beThereDelta = minutesUntil(parseTimeLabel(time), nowMin);
  if (beThereDelta <= 0) return `Head there now`;
  return `Be there by ${time}`;
}

function returnByText(item) {
  const targetMin = parseTimeLabel(itemWindowLabel(item));
  if (!Number.isFinite(targetMin)) return "Return before the next window.";
  const time = formatMinute(targetMin - arrivalBufferMinutes(item));
  return time ? `Return by ${time}.` : "Return before the next window.";
}

function avoidLongTripsText(next, nowMin) {
  const targetMin = parseTimeLabel(itemWindowLabel(next));
  if (!Number.isFinite(targetMin)) return null;
  const time = formatMinute(targetMin - arrivalBufferMinutes(next) - 5);
  if (!time) return null;
  const avoidDelta = minutesUntil(parseTimeLabel(time), nowMin);
  if (avoidDelta <= 0) return "Avoid long trips now";
  return `Avoid long trips after ${time}`;
}

function shouldShowAvoidLongTrips(current, next) {
  if (!next) return false;
  if (current && anchorKey(current) === anchorKey(next)) return false;
  return true;
}

function itemAction(item) {
  const cats = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (isByodOutboundFlight(item)) return "Target an airport-bound drop-off";
  if (/BYOD Train/i.test(cats)) {
    return /Outbound/i.test(cats)
      ? "Work outbound station ingress"
      : "Work inbound train egress";
  }
  if (/Retail Egress|Closing Surge/i.test(cats)) return "Work retail closing demand";
  if (/Local Anchor/i.test(cats)) return "Work routine local demand";
  if (/Hospital|Shift|Nursing|Clinic|Admin/i.test(cats)) return "Work hospital shift movement";
  if (/Last Call|Nightlife/i.test(cats)) return "Work nightlife egress";
  if (item?.type === "flight") return "Work airport arrivals";
  if (item?.type === "train") return "Work train arrivals";
  return "Work this demand window";
}

function transitionText(current, next) {
  const currentMin = parseTimeLabel(itemWindowLabel(current));
  const nextMin = parseTimeLabel(itemWindowLabel(next));
  let gap = Number.isFinite(currentMin) && Number.isFinite(nextMin) ? nextMin - currentMin : null;
  if (gap !== null && gap < -360) gap += 1440;
  const target = itemTitle(next);
  const sameAnchor = anchorKey(current) === anchorKey(next);

  if (sameAnchor) {
    if (isByodOutboundFlight(next)) return formatOutboundFlightNextWindow(next);
    if (next?.type === "flight") return formatInboundFlightArrivalWindow(next);
    if (Number.isFinite(gap) && gap > 90) {
      return `Long gap before ${target}; work nearby demand instead of waiting. ${returnByText(next)}`;
    }
    return `Stay near ${target} for the next demand window.`;
  }

  const driveMin = estimateDriveMinutes(current, next);

  if (!Number.isFinite(driveMin) || !Number.isFinite(gap)) {
    return `Prefer rides that keep you moving toward ${target}.`;
  }
  if (gap >= driveMin + 15) {
    return `Feasible transition: about ${driveMin} min drive. Prefer trips toward ${target}.`;
  }
  if (gap >= driveMin) {
    return `Tight transition: head toward ${target} if no good ride appears quickly.`;
  }
  return `Too tight for ${target}; stay with the stronger current opportunity unless a trip naturally heads that way.`;
}

function isSequenceCandidate(item) {
  if (!item || item.type === "food" || item.type === "grocery") return false;
  if (!["flight", "train", "event", "flight_ripple", "train_ripple", "ride"].includes(item.type)) return false;
  if (!Number.isFinite(parseTimeLabel(itemWindowLabel(item)))) return false;
  if (!Number.isFinite(Number(item.densityScore)) || Number(item.densityScore) <= 0) return false;
  return true;
}

function isActiveNowCandidate(item) {
  if (!item || item.type === "food" || item.type === "grocery") return false;
  if (!["event", "ride", "flight_ripple", "train_ripple"].includes(item.type)) return false;
  if (Number.isFinite(parseTimeLabel(itemWindowLabel(item)))) return false;
  if (item.sequenceOnly) return opportunityValue(item) >= 4;
  return opportunityValue(item) >= 25;
}

function opportunityValue(item) {
  return Number(item?.opportunityScore) || Number(item?.densityScore) || 0;
}

function shouldAddAfter(last, candidate) {
  if (!last) return true;
  const gap = candidate.minute - last.minute;
  if (gap < 20) return false;

  const sameAnchor = anchorKey(last.item) === anchorKey(candidate.item);
  if (sameAnchor) return gap <= 75 || opportunityValue(candidate.item) >= opportunityValue(last.item) * 0.6;

  const driveMin = estimateDriveMinutes(last.item, candidate.item);
  const requiredGap = (Number.isFinite(driveMin) ? driveMin : 20) + 10;
  if (gap >= requiredGap) return true;

  return opportunityValue(candidate.item) >= opportunityValue(last.item) * 1.75;
}

function buildSuggestedSequence(itinerary) {
  const nowMin = currentLocalMinutes();
  const activeNow = Array.isArray(itinerary)
    ? itinerary
        .filter(isActiveNowCandidate)
        .sort((a, b) => opportunityValue(b) - opportunityValue(a))[0] || null
    : null;
  const candidates = Array.isArray(itinerary)
    ? itinerary
        .filter(isSequenceCandidate)
        .map((item) => {
          const minute = parseTimeLabel(itemWindowLabel(item));
          return { item, minute, delta: minutesUntil(minute, nowMin) };
        })
        .filter((candidate) => candidate.delta >= -15)
        .sort((a, b) => a.delta - b.delta)
    : [];

  if (candidates.length === 0 && !activeNow) return [];

  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= 4) break;
    const last = selected[selected.length - 1];
    if (shouldAddAfter(last, candidate)) {
      selected.push(candidate);
    }
  }
  if (selected.length < 2 && !activeNow) return [];

  const steps = selected.map(({ item }, idx) => {
    const next = selected[idx + 1]?.item || null;
    return {
      item,
      time: itemWindowLabel(item),
      title: itemTitle(item),
      action: itemAction(item),
      demand: Math.round(Number(item.densityScore) || 0),
      opportunity: Math.round(Number(item.opportunityScore) || Number(item.densityScore) || 0),
      beThereBy: beThereByText(item, nowMin),
      avoidLongTrips: shouldShowAvoidLongTrips(item, next)
        ? avoidLongTripsText(next, nowMin)
        : null,
      transition: next ? transitionText(item, next) : null,
    };
  });

  if (activeNow) {
    steps.unshift({
      item: activeNow,
      time: "Now",
      title: itemTitle(activeNow),
      action: itemAction(activeNow),
      demand: Math.round(Number(activeNow.densityScore) || 0),
      opportunity: Math.round(opportunityValue(activeNow)),
      beThereBy: null,
      avoidLongTrips: selected[0] ? avoidLongTripsText(selected[0].item, nowMin) : null,
      transition: selected[0]
        ? transitionText(activeNow, selected[0].item)
        : "Work this active demand while it remains strong.",
      isPositioning: false,
    });
  } else if (steps.length > 0 && selected[0].delta > 45) {
    steps.unshift({
      item: null,
      time: "Now",
      title: `Position toward ${itemTitle(selected[0].item)}`,
      action: "No immediate rideshare anchor; start drifting toward the next strongest timed opportunity.",
      demand: Math.round(Number(selected[0].item.densityScore) || 0),
      opportunity: Math.round(Number(selected[0].item.opportunityScore) || Number(selected[0].item.densityScore) || 0),
      beThereBy: null,
      avoidLongTrips: avoidLongTripsText(selected[0].item, nowMin),
      transition: `Avoid long trips away from ${itemTitle(selected[0].item)} until the window gets closer.`,
      isPositioning: true,
    });
  }

  return steps;
}

export function SuggestedSequence({ itinerary = [] }) {
  const steps = buildSuggestedSequence(itinerary);
  if (steps.length === 0) return null;

  return (
    <section className="rounded-xl bg-neutral-900 border border-neutral-700 p-4">
      <div className="text-xs uppercase tracking-wide text-yellow-400 font-semibold">
        Suggested Sequence
      </div>
      <div className="flex flex-col gap-3 mt-3">
        {steps.map((step, idx) => (
          <div
            key={`${step.title}-${step.time}-${idx}`}
            className={`border-l-2 ${step.isPositioning ? "border-l-blue-400" : "border-l-yellow-500"} pl-3`}
          >
            <div className="text-sm text-neutral-400">{step.time}</div>
            <div className="text-base font-semibold">{step.title}</div>
            <div className="text-sm text-neutral-300">{step.action}</div>
            <div className="text-xs text-neutral-400 mt-1">
              {step.isPositioning
                ? `Next Demand ${step.demand} | Opportunity Now ${step.opportunity}`
                : `Expected Demand ${step.demand} | Opportunity Now ${step.opportunity}`}
            </div>
            {(step.beThereBy || step.avoidLongTrips) && (
              <div className="text-xs text-yellow-300 mt-1">
                {[step.beThereBy, step.avoidLongTrips].filter(Boolean).join(" | ")}
              </div>
            )}
            {step.transition && (
              <div className="text-xs text-neutral-500 mt-1">{step.transition}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
