"use client";

import { useEffect, useState } from "react";
import {
  buildDemandFirstTimeline,
  demandValue,
  groupDemandFirstTimeSlots,
  opportunityValue,
} from "./demand-first-sequence.mjs";
import { formatDemandFirstByodTrainHeading } from "./byod-train-labels.mjs";
import {
  formatByodFlightHeading,
  isByodOutboundFlight,
} from "./byod-flight-labels.mjs";
import { formatInboundFlightSequenceHeading } from "./flight-sequence-copy.mjs";
import { formatDemandFirstTiming } from "./demand-first-timing.mjs";
import { formatByodEventHeading, isByodEvent } from "./byod-event-labels.mjs";
import {
  DEFAULT_DEMAND_FIRST_AREA_FILTERS,
  DEMAND_FIRST_AREAS,
  demandFirstAreaCounts,
  demandFirstAreaFor,
  normalizeDemandFirstAreaFilters,
} from "./demand-first-areas.mjs";

const AREA_FILTER_STORAGE_KEY = "demandFirstAreaFilters";

function itemTitle(item) {
  const categories = Array.isArray(item?.categories) ? item.categories : [];
  if (isByodEvent(item)) return formatByodEventHeading(item);
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
        Ranked #{candidate.rankInTimeWindow} of {candidate.optionsInTimeWindow} citywide nearby-time options by expected demand.
        {candidate.conflictCount > 0 && " Potential timing conflict."}
      </>
    );
  }
  if (candidate.conflictCount > 0) {
    return <>Potential timing conflict with {candidate.conflictCount} overlapping option{candidate.conflictCount === 1 ? "" : "s"}.</>;
  }
  return <>Listed chronologically; no reserve-time exclusion.</>;
}

function TimelineOpportunity({ candidate }) {
  const item = candidate.item;
  const timing = formatDemandFirstTiming(item);
  return (
    <div>
      <div className="text-base font-semibold">{itemTitle(item)}</div>
      <div className="text-xs text-neutral-400 mt-1">
        Expected Demand {Math.round(demandValue(item))} | Opportunity Now {Math.round(opportunityValue(item))}
      </div>
      {item?.isLastCallCluster && Number(item?.venueCount) > 1 && (
        <div className="text-xs text-neutral-400 mt-1">
          {item.venueCount} nearby venues contributing to this demand window.
        </div>
      )}
      {timing && <div className="text-xs text-yellow-300 mt-1">{timing}</div>}
      <div className="text-xs text-cyan-300 mt-1">
        <TimelineNote candidate={candidate} />
      </div>
    </div>
  );
}

function TimelineSlot({ group }) {
  const stacked = group.candidates.length > 1;
  return (
    <div className="border-l-2 border-l-cyan-400 pl-3">
      <div className="text-sm text-neutral-400">{group.timeLabel}</div>
      {stacked && (
        <div className="text-xs text-neutral-500 mt-1">
          {group.candidates.length} same-time alternatives — choose one.
        </div>
      )}
      <div className={stacked ? "flex flex-col gap-3 mt-2" : "mt-0"}>
        {group.candidates.map((candidate, index) => (
          <div
            key={`${itemTitle(candidate.item)}-${candidate.minute ?? "now"}-${index}`}
            className={stacked && index > 0 ? "border-t border-neutral-700 pt-3" : ""}
          >
            <TimelineOpportunity candidate={candidate} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DemandFirstSuggestedSequence({ itinerary = [], alertAreaCounts = null }) {
  const [areaFilters, setAreaFilters] = useState({
    ...DEFAULT_DEMAND_FIRST_AREA_FILTERS,
  });

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(AREA_FILTER_STORAGE_KEY) || "null");
      if (stored) setAreaFilters(normalizeDemandFirstAreaFilters(stored));
    } catch (err) {
      console.warn("Demand-first area filters hydrate failed:", err.message);
    }
  }, []);

  const { current, timed } = buildDemandFirstTimeline(itinerary);
  if (current.length === 0 && timed.length === 0) return null;

  const timelineAreaCounts = demandFirstAreaCounts([...current, ...timed]);
  const hasAlertAreaCounts = DEMAND_FIRST_AREAS.every((area) =>
    Number.isFinite(Number(alertAreaCounts?.[area.key]))
  );
  const areaCounts = hasAlertAreaCounts
    ? Object.fromEntries(
        DEMAND_FIRST_AREAS.map((area) => [
          area.key,
          Math.max(0, Number(alertAreaCounts[area.key])),
        ])
      )
    : timelineAreaCounts;

  function handleAreaFilterChange(key) {
    const next = { ...areaFilters, [key]: !areaFilters[key] };
    setAreaFilters(next);
    try {
      localStorage.setItem(AREA_FILTER_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn("Demand-first area filters persist failed:", err.message);
    }
  }

  const selectedAreas = DEMAND_FIRST_AREAS.filter((area) => areaFilters[area.key]);
  const selectedAreaKeys = new Set(selectedAreas.map((area) => area.key));
  const filteredCurrent = current.filter((candidate) =>
    selectedAreaKeys.has(demandFirstAreaFor(candidate.item))
  );
  const filteredTimed = timed.filter((candidate) =>
    selectedAreaKeys.has(demandFirstAreaFor(candidate.item))
  );
  const timelineSlots = [
    ...groupDemandFirstTimeSlots(filteredCurrent),
    ...groupDemandFirstTimeSlots(filteredTimed),
  ];
  const singleSelectedArea = selectedAreas.length === 1 ? selectedAreas[0] : null;

  return (
    <section className="rounded-xl bg-neutral-900 border border-cyan-800 p-4">
      <div className="text-xs uppercase tracking-wide text-cyan-400 font-semibold">
        Demand-First Timeline
      </div>
      <div className="text-xs text-neutral-500 mt-1">
        Area totals use the Telegram alert window (current + next 60 minutes); the timeline remains chronological.
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">
        {DEMAND_FIRST_AREAS.map((area) => (
          <label key={area.key} className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={areaFilters[area.key]}
              onChange={() => handleAreaFilterChange(area.key)}
              className="accent-cyan-400"
            />
            {area.label} ({areaCounts[area.key]})
          </label>
        ))}
      </div>
      <div className="mt-4">
        {singleSelectedArea && timelineSlots.length > 0 && (
          <div className="text-sm uppercase tracking-wide text-neutral-300 font-semibold mb-3">
            {singleSelectedArea.label}
          </div>
        )}
        {timelineSlots.length > 0 ? (
          <div className="flex flex-col gap-3">
            {timelineSlots.map((group, index) => (
              <TimelineSlot key={`${group.timeLabel}-${index}`} group={group} />
            ))}
          </div>
        ) : (
          <div className="text-sm text-neutral-500">
            {selectedAreas.length === 0
              ? "Select an area to show its timeline opportunities."
              : "No timeline opportunities in the selected area."}
          </div>
        )}
      </div>
    </section>
  );
}
