import {
  buildDemandFirstSelection,
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
import { buildDemandFirstFlexWindows } from "./demand-first-flex.mjs";

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

function selectionNote(count, active = false) {
  if (count > 1) {
    return `Highest reachable expected demand among ${count} competing ${active ? "current" : "timed"} options.`;
  }
  return active
    ? "Only qualifying current opportunity."
    : "No competing reachable opportunity in this time window.";
}

function AlternativeRow({ alternative }) {
  const item = alternative.item;
  const time = item?.leaveBy || item?.hourBucket || "Now";
  return (
    <div className="border-l border-neutral-700 pl-2 py-1">
      <div className="text-xs text-neutral-300">
        {itemTitle(item)} — {time}
      </div>
      <div className="text-xs text-neutral-500">
        Expected Demand {Math.round(demandValue(item))} | Opportunity Now {Math.round(opportunityValue(item))}
      </div>
      <div className="text-xs text-neutral-500">Not selected: {alternative.reason}</div>
    </div>
  );
}

function Alternatives({ alternatives = [] }) {
  if (alternatives.length === 0) return null;
  const visible = alternatives.slice(0, 3);
  const remaining = alternatives.slice(3);
  return (
    <details className="mt-2">
      <summary className="text-xs text-neutral-400 cursor-pointer">
        Other options considered ({alternatives.length})
      </summary>
      <div className="flex flex-col gap-1 mt-2">
        {visible.map((alternative, index) => (
          <AlternativeRow
            key={`${itemTitle(alternative.item)}-${alternative.minute || "now"}-${index}`}
            alternative={alternative}
          />
        ))}
        {remaining.length > 0 && (
          <details>
            <summary className="text-xs text-cyan-400 cursor-pointer">
              View {remaining.length} more
            </summary>
            <div className="flex flex-col gap-1 mt-1">
              {remaining.map((alternative, index) => (
                <AlternativeRow
                  key={`${itemTitle(alternative.item)}-${alternative.minute || "more"}-${index}`}
                  alternative={alternative}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </details>
  );
}

function Step({
  item,
  time,
  competingOptions,
  alternatives = [],
  active = false,
  transition = null,
}) {
  const timing = formatDemandFirstTiming(item);
  return (
    <div className="border-l-2 border-l-cyan-400 pl-3">
      <div className="text-sm text-neutral-400">{time}</div>
      <div className="text-base font-semibold">{itemTitle(item)}</div>
      <div className="text-xs text-neutral-400 mt-1">
        Expected Demand {Math.round(demandValue(item))} | Opportunity Now {Math.round(opportunityValue(item))}
      </div>
      {timing && (
        <div className="text-xs text-yellow-300 mt-1">{timing}</div>
      )}
      {transition && (
        <div className="text-xs text-yellow-300 mt-1">
          Work this window briefly. Leave for {transition.target} by {transition.cutoffLabel}.
        </div>
      )}
      <div className="text-xs text-cyan-300 mt-1">
        {selectionNote(competingOptions, active)}
      </div>
      <Alternatives alternatives={alternatives} />
    </div>
  );
}

function FlexWindow({ data }) {
  return (
    <div className="border-l-2 border-l-blue-400 pl-3">
      <div className="text-sm text-neutral-400">
        {data.startLabel}–{data.cutoffLabel}
      </div>
      <div className="text-base font-semibold">Flex Window — Position toward {data.target}</div>
      <div className="text-sm text-neutral-300">Work only short nearby rideshare trips.</div>
      <div className="text-xs text-neutral-400 mt-1">
        Prefer trips that keep you moving toward {data.target}.
      </div>
      <div className="text-xs text-yellow-300 mt-1">
        Stop accepting trips that could delay you after {data.cutoffLabel}.
      </div>
      <div className="text-xs text-neutral-500 mt-1">{data.deadlineInstruction}</div>
    </div>
  );
}

export function DemandFirstSuggestedSequence({ itinerary = [], driverCoords = null }) {
  const {
    activeNow,
    activeCompetingOptions,
    activeAlternatives,
    activeTransition,
    selected,
  } =
    buildDemandFirstSelection(itinerary, { driverCoords });
  const flexWindows = buildDemandFirstFlexWindows({ activeNow, selected });
  const flexByIndex = new Map(flexWindows.map((window) => [window.beforeIndex, window]));
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
            alternatives={activeAlternatives}
            transition={activeTransition}
            active
          />
        )}
        {selected.map((candidate, index) => (
          <div key={`${itemTitle(candidate.item)}-${candidate.minute}-${index}`} className="contents">
            {flexByIndex.has(index) && <FlexWindow data={flexByIndex.get(index)} />}
            <Step
              item={candidate.item}
              time={candidate.item.leaveBy || candidate.item.hourBucket}
              competingOptions={candidate.competingOptions}
              alternatives={candidate.alternatives}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
