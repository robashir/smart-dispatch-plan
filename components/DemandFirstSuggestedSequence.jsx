import {
  buildDemandFirstSelection,
  demandValue,
  opportunityValue,
} from "./demand-first-sequence.mjs";
import { formatByodTrainHeading } from "./byod-train-labels.mjs";
import {
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./byod-flight-labels.mjs";
import { formatInboundFlightSequenceHeading } from "./flight-sequence-copy.mjs";

function itemTitle(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  if (isByodOutboundFlight(item)) return formatByodFlightHeading(item);
  if (categories.some((category) => /byod train/i.test(String(category)))) {
    return formatByodTrainHeading(item);
  }
  if (item?.type === "flight") return formatInboundFlightSequenceHeading(item);
  return item?.location || item?.hub || item?.hourBucket || "Opportunity";
}

function itemAction(item) {
  const categories = Array.isArray(item?.categories) ? item.categories.join("|") : "";
  if (isByodOutboundFlight(item)) return "Target an airport-bound drop-off";
  if (/BYOD Train/i.test(categories)) {
    return /Outbound/i.test(categories)
      ? "Work outbound station ingress"
      : "Work inbound train egress";
  }
  if (/Retail Egress|Closing Surge/i.test(categories)) return "Work retail closing demand";
  if (/Hospital|Shift|Nursing|Clinic|Admin/i.test(categories)) return "Work hospital shift movement";
  if (/Last Call|Nightlife/i.test(categories)) return "Work nightlife egress";
  if (item?.type === "flight") return "Work airport arrivals";
  if (item?.type === "train") return "Work train arrivals";
  return "Work this demand window";
}

function selectionNote(count, active = false) {
  if (count > 1) {
    return `Highest reachable expected demand among ${count} competing ${active ? "current" : "timed"} options.`;
  }
  return active
    ? "Only qualifying current opportunity."
    : "No competing reachable opportunity in this time window.";
}

function Step({ item, time, competingOptions, active = false }) {
  return (
    <div className="border-l-2 border-l-cyan-400 pl-3">
      <div className="text-sm text-neutral-400">{time}</div>
      <div className="text-base font-semibold">{itemTitle(item)}</div>
      <div className="text-sm text-neutral-300">{itemAction(item)}</div>
      <div className="text-xs text-neutral-400 mt-1">
        Expected Demand {Math.round(demandValue(item))} | Opportunity Now {Math.round(opportunityValue(item))}
      </div>
      <div className="text-xs text-cyan-300 mt-1">
        {selectionNote(competingOptions, active)}
      </div>
    </div>
  );
}

export function DemandFirstSuggestedSequence({ itinerary = [], driverCoords = null }) {
  const { activeNow, activeCompetingOptions, selected } = buildDemandFirstSelection(itinerary, {
    driverCoords,
  });
  if (!activeNow && selected.length === 0) return null;

  return (
    <section className="rounded-xl bg-neutral-900 border border-cyan-800 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-400 font-semibold">
        Demand-First Sequence (Preview)
      </div>
      <div className="text-xs text-neutral-500 mt-1">
        Highest expected demand after overlap and reachability checks.
      </div>
      <div className="flex flex-col gap-3 mt-3">
        {activeNow && (
          <Step
            item={activeNow}
            time="Now"
            competingOptions={activeCompetingOptions}
            active
          />
        )}
        {selected.map((candidate, index) => (
          <Step
            key={`${itemTitle(candidate.item)}-${candidate.minute}-${index}`}
            item={candidate.item}
            time={candidate.item.leaveBy || candidate.item.hourBucket}
            competingOptions={candidate.competingOptions}
          />
        ))}
      </div>
    </section>
  );
}
