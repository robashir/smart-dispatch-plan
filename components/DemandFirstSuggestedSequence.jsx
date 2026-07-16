import {
  buildDemandFirstTimeline,
  demandValue,
  opportunityValue,
} from "./demand-first-sequence.mjs";
import { formatDemandFirstByodTrainHeading } from "./byod-train-labels.mjs";
import {
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./byod-flight-labels.mjs";
import { formatInboundFlightSequenceHeading } from "./flight-sequence-copy.mjs";
import { formatDemandFirstTiming } from "./demand-first-timing.mjs";

function itemTitle(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  if (isByodOutboundFlight(item)) return formatByodFlightHeading(item);
  if (categories.some((category) => /byod train/i.test(String(category)))) {
    return formatDemandFirstByodTrainHeading(item);
  }
  if (item?.type === "flight") return formatInboundFlightSequenceHeading(item);
  if (categories.includes("Hospital Shift") && categories[0]) {
    return `${item?.location || "Hospital Demand"} — ${categories[0]}`;
  }
  if (categories.includes("State Worker Commute") && categories[1]) {
    return `${item?.location || "Government Staff Dismissal"} — ${categories[1]}`;
  }
  return item?.location || item?.hub || item?.hourBucket || "Opportunity";
}

function TimelineNote({ candidate }) {
  if (candidate.optionsInTimeWindow > 1) {
    return (
      <>
        Ranked #{candidate.rankInTimeWindow} of {candidate.optionsInTimeWindow} nearby-time options by expected demand.
        {candidate.conflictCount > 0 && " Potential timing conflict."}
      </>
    );
  }
  if (candidate.conflictCount > 0) {
    return <>Potential timing conflict with {candidate.conflictCount} overlapping option{candidate.conflictCount === 1 ? "" : "s"}.</>;
  }
  return <>Listed chronologically; no reserve-time exclusion.</>;
}

function TimelineRow({ candidate }) {
  const item = candidate.item;
  const timing = formatDemandFirstTiming(item);
  return (
    <div className="border-l-2 border-l-cyan-400 pl-3">
      <div className="text-sm text-neutral-400">{candidate.timeLabel}</div>
      <div className="text-base font-semibold">{itemTitle(item)}</div>
      <div className="text-xs text-neutral-400 mt-1">
        Expected Demand {Math.round(demandValue(item))} | Opportunity Now {Math.round(opportunityValue(item))}
      </div>
      {timing && <div className="text-xs text-yellow-300 mt-1">{timing}</div>}
      <div className="text-xs text-cyan-300 mt-1">
        <TimelineNote candidate={candidate} />
      </div>
    </div>
  );
}

export function DemandFirstSuggestedSequence({ itinerary = [] }) {
  const { current, timed } = buildDemandFirstTimeline(itinerary);
  if (current.length === 0 && timed.length === 0) return null;

  return (
    <section className="rounded-xl bg-neutral-900 border border-cyan-800 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-400 font-semibold">
        Demand-First Timeline
      </div>
      <div className="text-xs text-neutral-500 mt-1">
        All qualifying opportunities by time; higher demand ranks first when times are close.
      </div>
      <div className="flex flex-col gap-3 mt-3">
        {current.map((candidate, index) => (
          <TimelineRow
            key={`${itemTitle(candidate.item)}-now-${index}`}
            candidate={candidate}
          />
        ))}
        {timed.map((candidate, index) => (
          <TimelineRow
            key={`${itemTitle(candidate.item)}-${candidate.minute}-${index}`}
            candidate={candidate}
          />
        ))}
      </div>
    </section>
  );
}
