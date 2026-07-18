"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useState } from "react";
import { TopPickBanner } from "../components/TopPickBanner";
import { GlobalWeatherBanner } from "../components/GlobalWeatherBanner";
import { PeakSurgeBanner } from "../components/PeakSurgeBanner";
import { SuggestedSequence } from "../components/SuggestedSequence";
import { DemandFirstSuggestedSequence } from "../components/DemandFirstSuggestedSequence";
import DispatchMap from "../components/DispatchMap";
import { FlightCard, TrainCard, HotspotCard, EventCard } from "../components/DispatchCards";
import {
  BYOD_CONFIG_KEYS,
  normalizeByodSnapshot,
  reconcileByodSnapshots,
} from "./lib/byod-snapshot.mjs";
import { isUAlbanyRegularSession } from "./lib/ualbany-demand.mjs";
import { countSavedByodRecords } from "./lib/byod-counts.mjs";
import { mergeByodEventText, parseByodEventText } from "./lib/byod-events.mjs";
// Sprint 59: static seed for the Unified Event Database. Next.js bundles
// the 26-entry JSON at build time so a fresh browser (no localStorage)
// hydrates the dropdown without a network round-trip. Re-seeding requires
// `npm run build` + redeploy. This replaces the Sprint 57 /api/config/events
// GET fetch.
import EVENT_CONFIG_SEED from "../event-config.json";

// Sprint 59: BYOD Amtrak parser, relocated client-side from the deleted
// /api/config/trains route. Output shape is unchanged so the Sprint 54
// isTrainInWindow server gate keeps working off the body-passed array.
// Sprint 61: direction-aware. "outbound" anchors the time capture on the
// DEPARTS block instead of ARRIVES so the backend's outbound branch sees
// a departure time in `train.time`. Default stays inbound for back-compat.
function parseFareAvailabilitySection(section = "") {
  const text = String(section);
  const seatMatch = text.match(/Only\s+(\d+)\s+(?:seat|room)s?\s+left/i);
  if (/not\s+offered/i.test(text)) return { status: "notOffered" };
  if (/sold\s+out/i.test(text)) return { status: "soldOut" };
  if (seatMatch) return { status: "almostFull", remaining: Number(seatMatch[1]) };
  if (/\bfrom\b|\$\s*\d+/i.test(text)) return { status: "available" };
  return { status: "unknown" };
}

function parseFareAvailability(tail = "") {
  const text = String(tail).replace(/\r\n/g, "\n");
  const labels = [
    ["coach", "Coach"],
    ["business", "Business"],
    ["privateRooms", "Private Rooms"],
  ];
  const availability = {};
  for (const [key, label] of labels) {
    const pattern = new RegExp(
      `${label}\\s*([\\s\\S]*?)(?=\\n\\s*(?:Coach|Business|Private Rooms)\\s*(?:\\n|$)|$)`,
      "i"
    );
    const match = text.match(pattern);
    availability[key] = match
      ? parseFareAvailabilitySection(match[1])
      : { status: "unknown" };
  }
  return availability;
}

function deriveAmtrakStatus(availability, fallbackText = "") {
  const statuses = [
    availability?.coach?.status,
    availability?.business?.status,
    availability?.privateRooms?.status,
  ];
  if (statuses.includes("soldOut")) return "Sold Out";
  if (statuses.includes("almostFull")) return "Almost Full";
  if (/Sold Out/i.test(fallbackText)) return "Sold Out";
  if (/Only\s+\d+\s+(?:seat|room)/i.test(fallbackText)) return "Almost Full";
  return "On Time";
}

function parseAmtrakText(rawText, direction = "inbound") {
  if (typeof rawText !== "string" || !rawText.trim()) return [];
  const text = rawText.replace(/\r\n/g, "\n");
  const pattern =
    direction === "outbound"
      ? /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g
      : /(?:^|\n)\s*(\d{2,3})\s*\n[^\n]+\n\s*DEPARTS[\s\S]*?ARRIVES\s*\n\s*(\d{1,2}:\d{2})\s*\n\s*([ap])([\s\S]*?)(?=\n\s*\d{2,3}\s*\n[^\n]+\n\s*DEPARTS|$)/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const trainNumber = match[1];
    const rawTime = match[2];
    const ampmLetter = match[3].toUpperCase();
    const tail = match[4] || "";
    const time = `${rawTime} ${ampmLetter}M`;
    const arrivalTime = `${rawTime}${ampmLetter.toLowerCase()}`;
    const availability = parseFareAvailability(tail);
    const status = deriveAmtrakStatus(availability, tail);
    results.push({ trainNumber, status, time, arrivalTime, availability });
  }
  return results;
}

// Sprint 35: Promise wrapper around navigator.geolocation.getCurrentPosition.
// Resolves with the coords object, rejects on permission denial / timeout /
// missing API. Kept outside the component because it holds no React state.
function getGeolocation() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("Geolocation not supported."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos.coords),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  });
}

// Sprint 35: Roessleville fallback. If GPS is denied / times out, dispatch
// still computes a real itinerary instead of crashing.
const ROESSLEVILLE_COORDS = { latitude: 42.69516, longitude: -73.86063 };

// Sprint 57: Unified Event Database. The Sprint 49 hardcoded HOLIDAY_OPTIONS
// list is gone — the dropdown is populated from EVENT_CONFIG_SEED on first
// mount and from localStorage["eventConfig"] thereafter (Sprint 59).

// Sprint 33: pure helpers mirroring the backend's surgeScore + Sprint 32.1
// time-decay so the banner can recompute the same ranking score the API
// already used internally. Kept outside the component because they hold no
// React state and never need to re-init on render. Anti-goal forbids
// exposing the score from route.js, so this is the duplication price.
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

function readOpportunityScore(item) {
  return Number(item.opportunityScore) || Number(item.densityScore) || 0;
}

function readLocalByodSnapshot() {
  const snapshot = {};
  for (const key of BYOD_CONFIG_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) snapshot[key] = JSON.parse(raw);
    } catch (err) {
      console.warn(`${key} hydrate failed:`, err.message);
    }
  }
  return normalizeByodSnapshot(snapshot);
}

function persistLocalByodSnapshot(snapshot) {
  for (const key of BYOD_CONFIG_KEYS) {
    try {
      localStorage.setItem(key, JSON.stringify(snapshot[key]));
    } catch (err) {
      console.warn(`${key} cache failed:`, err.message);
    }
  }
}

function stampByodConfig(value) {
  return { ...value, updatedAt: new Date().toISOString() };
}

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [itinerary, setItinerary] = useState([]);
  const [sequenceCandidates, setSequenceCandidates] = useState([]);
  const [error, setError] = useState("");
  const [hours, setHours] = useState(4);
  const [platforms, setPlatforms] = useState({
    rideshare: true,
    food: true,
    grocery: false,
  });
  // Sprint 45: Mathematical ROI Filter. Driver's vehicle cost per mile
  // (fuel + depreciation + wear). Default 0.65 = the "Safe Sedan" baseline;
  // hydrated from localStorage so the driver only configures it once.
  const [costPerMile, setCostPerMile] = useState(0.65);
  const [routingStrategy, setRoutingStrategy] = useState("profitability");
  const [activeTab, setActiveTab] = useState("transit");
  // Sprint 46: live weather modifiers from the backend's predictive engine.
  // null until the first dispatch; GlobalWeatherBanner returns null on null
  // or on any combo that isn't a known Storm / Pre-Surge / Heatwave.
  const [weatherModifiers, setWeatherModifiers] = useState(null);
  // Sprint 66: Peak Overlap Engine payload. Stateless banner renders this
  // object verbatim (or hides when totalDensity <= 50). Null until first dispatch.
  const [peakSurgeWindow, setPeakSurgeWindow] = useState(null);
  // Sprint 37: live driver coords for the pulsing blue dot on the radar.
  // Reset on each dispatch so a stale fix never floats over the new plan.
  // Sprint 37.2: renamed coords → driverCoords for an unambiguous prop chain
  // (the blue dot was missing because state hydration was easy to misread).
  const [driverCoords, setDriverCoords] = useState(null);
  // Sprint 53: BYOD Amtrak Pipeline. Per-shift raw text dump from the
  // Amtrak booking page. NOT persisted to localStorage — the spec
  // explicitly calls this a per-shift input.
  // Sprint 54: the Sprint 39 CSV capacity calendar (trainCalendar +
  // dispatchTrainCalendar localStorage) has been fully excised; this
  // textarea is the sole BYOD train-data input.
  const [trainRawText, setTrainRawText] = useState("");
  // Sprint 58/59: BYOD Amtrak Persistence. Tracks the "Save Trains" button
  // label — "idle" | "saving" | "saved" | "error". Flips to "saved" for
  // ~2 s after a successful localStorage write, then resets.
  const [trainSaveStatus, setTrainSaveStatus] = useState("idle");
  // Sprint 61: BYOD Amtrak direction. "inbound" → existing Rensselaer
  // arrival path. "outbound" → ESP ingress path (60 min before departure,
  // <40 min hard drop).
  // Sprint 64: the radio still controls (a) how parseAmtrakText anchors
  // and (b) which split state/storage key receives the next save. The
  // radio choice is no longer persisted; both directions' saved trains
  // live in their own localStorage keys.
  const [direction, setDirection] = useState("inbound");
  // Sprint 64: Storage Split. Two independent React states — each holds
  // `{ savedDate, trains }` and hydrates from / persists to its own
  // localStorage key. Saving inbound trains no longer wipes the saved
  // outbound trains and vice-versa.
  const [trainConfigInbound, setTrainConfigInbound] = useState({
    savedDate: null,
    trains: [],
  });
  const [trainConfigOutbound, setTrainConfigOutbound] = useState({
    savedDate: null,
    trains: [],
  });
  // Sprint 67: BYOD Bus Inbound. Holds the raw pasted bus schedule text
  // alongside the savedDate so the lazy auto-wipe (savedDate !== today → "")
  // can collapse stale dumps without touching either train state. Backend
  // (parseBusSchedule) does the regex; client just persists the raw text.
  const [busConfigInbound, setBusConfigInbound] = useState({
    savedDate: null,
    rawText: "",
  });
  // Sprint 68: BYOD Flight Inbound. Same shape as busConfigInbound — backend
  // (parseFlightText) owns the regex + dictionary translation, client just
  // persists the raw text alongside today's date for the lazy auto-wipe.
  const [flightConfigInbound, setFlightConfigInbound] = useState({
    savedDate: null,
    rawText: "",
  });
  const [flightConfigOutbound, setFlightConfigOutbound] = useState({
    savedDate: null,
    rawText: "",
  });
  const [weatherConfig, setWeatherConfig] = useState({
    savedDate: null,
    rawText: "",
  });
  const [byodEventConfig, setByodEventConfig] = useState({
    eventsByDate: {},
  });
  const [byodEventDate, setByodEventDate] = useState("");
  const [academicSessionConfig, setAcademicSessionConfig] = useState({
    mode: "auto",
    updatedAt: null,
  });
  const [byodSyncStatus, setByodSyncStatus] = useState("loading");
  // Sprint 57/59: Unified Event Database. eventConfig is the object
  // hydrated from localStorage (seeded from EVENT_CONFIG_SEED) — keyed
  // by event name with
  // { date, type, multiplier, activeWindows } values. selectedEventName
  // drives the dropdown; dateInput is the value of the inline date picker
  // (initialized from the selected event's persisted date on each change).
  // saveStatus toggles the button label briefly to "Saved!" on success.
  const [eventConfig, setEventConfig] = useState({});
  const [selectedEventName, setSelectedEventName] = useState("");
  const [dateInput, setDateInput] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  // Sprint 38: global Map/List toggle. Default "map" so the SSR pass renders
  // the radar; the useEffect below replaces it with the driver's prior choice
  // once the browser hydrates.
  const [viewMode, setViewMode] = useState("map");

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem("dispatchViewMode");
      console.log("[Sprint38] hydrated viewMode from localStorage:", stored);
      if (stored === "map" || stored === "list") setViewMode(stored);
    } catch (e) {
      console.warn("dispatchViewMode hydrate failed:", e.message);
    }
  }, []);

  useEffect(() => {
    setByodEventDate((current) => current || todayLocalISO());
  }, []);

  function applyByodSnapshot(snapshot) {
    const clean = normalizeByodSnapshot(snapshot);
    setTrainConfigInbound(clean.trainConfigInbound);
    setTrainConfigOutbound(clean.trainConfigOutbound);
    setBusConfigInbound(clean.busConfigInbound);
    setFlightConfigInbound(clean.flightConfigInbound);
    setFlightConfigOutbound(clean.flightConfigOutbound);
    setWeatherConfig(clean.weatherConfig);
    setByodEventConfig(clean.byodEventConfig);
    setAcademicSessionConfig(clean.academicSessionConfig);
    return clean;
  }

  // Cloud-first BYOD hydration. The device cache renders immediately, then
  // the latest Blob snapshot reconciles each category by updatedAt.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    const localSnapshot = readLocalByodSnapshot();
    applyByodSnapshot(localSnapshot);

    async function hydrateFromCloud() {
      try {
        const res = await fetch("/api/byod", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "BYOD cloud load failed.");
        const { snapshot, pendingUpdates } = reconcileByodSnapshots(
          localSnapshot,
          data.snapshot
        );
        if (cancelled) return;
        applyByodSnapshot(snapshot);
        persistLocalByodSnapshot(snapshot);

        if (Object.keys(pendingUpdates).length > 0) {
          setByodSyncStatus("syncing");
          const syncRes = await fetch("/api/byod", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ updates: pendingUpdates }),
          });
          const syncData = await syncRes.json().catch(() => ({}));
          if (!syncRes.ok) {
            throw new Error(syncData.error || "BYOD cloud sync failed.");
          }
          if (cancelled) return;
          const synced = applyByodSnapshot(syncData.snapshot);
          persistLocalByodSnapshot(synced);
        }
        setByodSyncStatus("synced");
      } catch (err) {
        if (cancelled) return;
        console.warn("BYOD cloud hydration failed:", err.message);
        setByodSyncStatus("offline");
      }
    }
    hydrateFromCloud();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleViewModeChange(mode) {
    setViewMode(mode);
    try {
      localStorage.setItem("dispatchViewMode", mode);
      console.log("[Sprint38] persisted viewMode:", mode);
    } catch (e) {
      console.warn("dispatchViewMode persist failed:", e.message);
    }
  }

  useEffect(() => {
    // Sprint 45: hydrate the driver's cost-per-mile preference. Default
    // 0.65 already sits in state, so a missing/invalid value is a no-op.
    try {
      const rawCpm = localStorage.getItem("dispatchCostPerMile");
      if (rawCpm !== null) {
        const parsed = Number(rawCpm);
        if (Number.isFinite(parsed) && parsed >= 0) setCostPerMile(parsed);
      }
    } catch (e) {
      console.warn("dispatchCostPerMile hydrate failed:", e.message);
    }
  }, []);

  // Sprint 59: Unified Event Database — localStorage hydration.
  // Mount-time priority: localStorage["eventConfig"] (driver's saved
  // overrides) → bundled EVENT_CONFIG_SEED. On first visit the SEED is
  // persisted so subsequent reloads use the same object identity.
  // No network round-trip; Netlify-safe.
  useEffect(() => {
    if (typeof window === "undefined") return;
    let config = null;
    try {
      const raw = localStorage.getItem("eventConfig");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") config = parsed;
      }
    } catch (e) {
      console.warn("eventConfig hydrate failed:", e.message);
    }
    if (!config) {
      config = EVENT_CONFIG_SEED;
      try { localStorage.setItem("eventConfig", JSON.stringify(config)); } catch (e) {
        console.warn("eventConfig seed persist failed:", e.message);
      }
    }
    setEventConfig(config);
    const defaultName = pickNextUpcomingEventName(config);
    setSelectedEventName(defaultName);
    setDateInput(defaultName ? config[defaultName]?.date || "" : "");
  }, []);

  // Sprint 59: Save the selected event's new date to localStorage only.
  // The dispatch route receives the whole eventConfig object in the POST
  // body on the next click, so there's no server round-trip on Save.
  function handleSaveEvent() {
    if (!selectedEventName) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) return;
    setSaveStatus("saving");
    try {
      const updated = {
        ...eventConfig,
        [selectedEventName]: {
          ...eventConfig[selectedEventName],
          date: dateInput,
        },
      };
      localStorage.setItem("eventConfig", JSON.stringify(updated));
      setEventConfig(updated);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err) {
      console.warn("eventConfig save failed:", err.message);
      setSaveStatus("idle");
    }
  }

  async function syncByodSnapshot(updates = {}) {
    setByodSyncStatus("syncing");
    try {
      const res = await fetch("/api/byod", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "BYOD server sync failed.");
      }
      const synced = applyByodSnapshot(data.snapshot);
      persistLocalByodSnapshot(synced);
      setByodSyncStatus("synced");
      return true;
    } catch (err) {
      console.warn("BYOD server sync failed:", err.message);
      setByodSyncStatus("offline");
      return false;
    }
  }

  async function handleAcademicSessionModeChange(mode) {
    const config = stampByodConfig({ mode });
    setAcademicSessionConfig(config);
    try {
      localStorage.setItem("academicSessionConfig", JSON.stringify(config));
    } catch (err) {
      console.warn("academicSessionConfig cache failed:", err.message);
    }
    await syncByodSnapshot({ academicSessionConfig: config });
  }

  function buildMergedVenueEventPayload(text, eventDate, today) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || eventDate < today) {
      throw new Error("Choose today or a future event date.");
    }
    if (parseByodEventText(text, eventDate).length === 0) {
      throw new Error("No valid venue events found in the pasted text.");
    }
    const existingEventsByDate =
      byodEventConfig?.eventsByDate && typeof byodEventConfig.eventsByDate === "object"
        ? byodEventConfig.eventsByDate
        : {};
    const existingRawText =
      typeof existingEventsByDate[eventDate] === "string"
        ? existingEventsByDate[eventDate]
        : "";
    return stampByodConfig({
      eventsByDate: {
        ...existingEventsByDate,
        [eventDate]: mergeByodEventText(existingRawText, text, eventDate),
      },
    });
  }

  // Sprint 59: BYOD Amtrak Persistence — localStorage edition. Parses the
  // textarea client-side via parseAmtrakText, then writes the
  // { savedDate, trains } tuple to localStorage. Dispatch reads from
  // localStorage on each click and applies the lazy auto-wipe (savedDate
  // vs todayLocalISO) before forwarding the array in the body.
  //
  // Sprint 64: Storage Split. The active radio direction selects WHICH
  // state + localStorage key receives the save. The OTHER direction's
  // saved trains are left fully intact, so a driver can paste/save an
  // inbound dump, flip the radio to outbound, paste/save a different
  // dump, and dispatch with both arrays populated.
  async function handleSaveTrains() {
    setTrainSaveStatus("saving");
    try {
      // Sprint 67: BYOD Bus Inbound branch. The backend owns parseBusSchedule
      // (it's the sole consumer), so the client just persists the raw text
      // alongside today's date. Train states are untouched on a bus save.
      if (direction === "busInbound") {
        const payload = stampByodConfig({ savedDate: todayLocalISO(), rawText: trainRawText });
        localStorage.setItem("busConfigInbound", JSON.stringify(payload));
        setBusConfigInbound(payload);
        await syncByodSnapshot({ busConfigInbound: payload });
        setTrainSaveStatus("saved");
        setTimeout(() => setTrainSaveStatus("idle"), 2000);
        return;
      }
      // Sprint 68: BYOD Flight Inbound branch. Backend (parseFlightText)
      // owns the regex + dictionary, so client just persists raw text.
      // Train + bus states untouched on a flight save.
      if (direction === "flightInbound") {
        const payload = stampByodConfig({ savedDate: todayLocalISO(), rawText: trainRawText });
        localStorage.setItem("flightConfigInbound", JSON.stringify(payload));
        setFlightConfigInbound(payload);
        await syncByodSnapshot({ flightConfigInbound: payload });
        setTrainSaveStatus("saved");
        setTimeout(() => setTrainSaveStatus("idle"), 2000);
        return;
      }
      if (direction === "flightOutbound") {
        const payload = stampByodConfig({ savedDate: todayLocalISO(), rawText: trainRawText });
        localStorage.setItem("flightConfigOutbound", JSON.stringify(payload));
        setFlightConfigOutbound(payload);
        await syncByodSnapshot({ flightConfigOutbound: payload });
        setTrainSaveStatus("saved");
        setTimeout(() => setTrainSaveStatus("idle"), 2000);
        return;
      }
      if (direction === "weather") {
        const payload = stampByodConfig({ savedDate: todayLocalISO(), rawText: trainRawText });
        localStorage.setItem("weatherConfig", JSON.stringify(payload));
        setWeatherConfig(payload);
        await syncByodSnapshot({ weatherConfig: payload });
        setTrainSaveStatus("saved");
        setTimeout(() => setTrainSaveStatus("idle"), 2000);
        return;
      }
      if (direction === "venueEvents") {
        const today = todayLocalISO();
        const payload = buildMergedVenueEventPayload(
          trainRawText,
          byodEventDate || today,
          today
        );
        localStorage.setItem("byodEventConfig", JSON.stringify(payload));
        setByodEventConfig(payload);
        await syncByodSnapshot({ byodEventConfig: payload });
        setTrainSaveStatus("saved");
        setTimeout(() => setTrainSaveStatus("idle"), 2000);
        return;
      }
      const trains = parseAmtrakText(trainRawText, direction);
      if (trains.length === 0) {
        throw new Error("No Amtrak trains parsed from pasted text.");
      }
      const payload = stampByodConfig({ savedDate: todayLocalISO(), trains });
      const key = direction === "outbound" ? "trainConfigOutbound" : "trainConfigInbound";
      localStorage.setItem(key, JSON.stringify(payload));
      if (direction === "outbound") {
        setTrainConfigOutbound(payload);
        await syncByodSnapshot({ trainConfigOutbound: payload });
      } else {
        setTrainConfigInbound(payload);
        await syncByodSnapshot({ trainConfigInbound: payload });
      }
      setTrainSaveStatus("saved");
      setTimeout(() => setTrainSaveStatus("idle"), 2000);
    } catch (err) {
      console.warn("trainConfig save failed:", err.message);
      setTrainSaveStatus("error");
      setTimeout(() => setTrainSaveStatus("idle"), 2000);
    }
  }

  // Sprint 68 UX Overhaul: Drop-box model for the BYOD textarea. On every
  // radio toggle change, auto-save the current textarea content to the
  // OUTGOING toggle's localStorage (without touching the Save button's
  // status flicker), then blank the textarea so the next mode starts on
  // a clean slate. Saved data lives only in background state — it is
  // NEVER rehydrated into the textarea (per spec "No Rehydration").
  // Auto-save is skipped when the textarea is empty / whitespace-only so
  // a no-op toggle click can't wipe existing saved data.
  async function handleDirectionChange(newDir) {
    if (newDir === direction) return;
    const text = trainRawText;
    if (text && text.trim()) {
      const today = todayLocalISO();
      try {
        if (direction === "busInbound") {
          const payload = stampByodConfig({ savedDate: today, rawText: text });
          localStorage.setItem("busConfigInbound", JSON.stringify(payload));
          setBusConfigInbound(payload);
          await syncByodSnapshot({ busConfigInbound: payload });
        } else if (direction === "flightInbound") {
          const payload = stampByodConfig({ savedDate: today, rawText: text });
          localStorage.setItem("flightConfigInbound", JSON.stringify(payload));
          setFlightConfigInbound(payload);
          await syncByodSnapshot({ flightConfigInbound: payload });
        } else if (direction === "flightOutbound") {
          const payload = stampByodConfig({ savedDate: today, rawText: text });
          localStorage.setItem("flightConfigOutbound", JSON.stringify(payload));
          setFlightConfigOutbound(payload);
          await syncByodSnapshot({ flightConfigOutbound: payload });
        } else if (direction === "weather") {
          const payload = stampByodConfig({ savedDate: today, rawText: text });
          localStorage.setItem("weatherConfig", JSON.stringify(payload));
          setWeatherConfig(payload);
          await syncByodSnapshot({ weatherConfig: payload });
        } else if (direction === "venueEvents") {
          const payload = buildMergedVenueEventPayload(
            text,
            byodEventDate || today,
            today
          );
          localStorage.setItem("byodEventConfig", JSON.stringify(payload));
          setByodEventConfig(payload);
          await syncByodSnapshot({ byodEventConfig: payload });
        } else {
          const trains = parseAmtrakText(text, direction);
          if (trains.length === 0) {
            throw new Error("No Amtrak trains parsed from pasted text.");
          }
          const payload = stampByodConfig({ savedDate: today, trains });
          const key =
            direction === "outbound" ? "trainConfigOutbound" : "trainConfigInbound";
          localStorage.setItem(key, JSON.stringify(payload));
          if (direction === "outbound") {
            setTrainConfigOutbound(payload);
            await syncByodSnapshot({ trainConfigOutbound: payload });
          } else {
            setTrainConfigInbound(payload);
            await syncByodSnapshot({ trainConfigInbound: payload });
          }
        }
      } catch (e) {
        console.warn("BYOD toggle-switch auto-save failed:", e.message);
      }
    }
    setTrainRawText("");
    setDirection(newDir);
  }

  // Sprint 45: persist costPerMile on every change so the driver configures
  // it once. Mirrors handleViewModeChange — the setter + persistence stay
  // colocated to avoid drift between state and storage.
  function handleCostPerMileChange(value) {
    setCostPerMile(value);
    try {
      localStorage.setItem("dispatchCostPerMile", String(value));
    } catch (e) {
      console.warn("dispatchCostPerMile persist failed:", e.message);
    }
  }

  function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function pickNextUpcomingEventName(config) {
    if (!config || typeof config !== "object") return "";
    const today = todayLocalISO();
    const upcoming = Object.entries(config)
      .filter(([, entry]) => /^\d{4}-\d{2}-\d{2}$/.test(entry?.date || ""))
      .filter(([, entry]) => entry.date >= today)
      .sort((a, b) => a[1].date.localeCompare(b[1].date));
    if (upcoming.length > 0) return upcoming[0][0];
    return Object.keys(config)[0] || "";
  }

  async function handleClick() {
    setError("");
    setItinerary([]);
    setPeakSurgeWindow(null);
    setDriverCoords(null);
    setStatus("locating");

    // Sprint 35: Intent-Driven Intercept. Await the device's live coordinates
    // here (browser shows the permission prompt on first click). On any
    // failure — denial, timeout, no GPS — fall back to Roessleville so the
    // dispatch still runs.
    let latitude = ROESSLEVILLE_COORDS.latitude;
    let longitude = ROESSLEVILLE_COORDS.longitude;
    try {
      const fix = await getGeolocation();
      latitude = fix.latitude;
      longitude = fix.longitude;
    } catch (geoErr) {
      console.warn(
        "Geolocation unavailable — falling back to Roessleville:",
        geoErr.message
      );
    }
    // Sprint 37: stash whatever coords we ended up with (real or fallback)
    // so DispatchMap can render the blue dot.
    setDriverCoords({ latitude, longitude });

    setStatus("dispatching");

    const timezoneOffsetMinutes = new Date().getTimezoneOffset();

    try {
      // Sprint 60: hub filters are hardcoded true at the API contract —
      // the driver-facing UI no longer exposes the Airport/Amtrak toggles,
      // but the backend Synthetic Ripple Swap logic still honors the keys.
      const today = todayLocalISO();
      const body = {
        latitude,
        longitude,
        hours,
        timezoneOffsetMinutes,
        platforms,
        includeAirport: true,
        includeAmtrak: true,
        routingStrategy,
        // Sprint 45: backend uses this with haversineMiles to compute
        // each item's deadhead cost and drop unprofitable surges.
        costPerMile,
      };

      // Sprint 59: client-owned persistence. eventConfig comes from
      // localStorage (seeded from EVENT_CONFIG_SEED on first mount) and
      // ships with every dispatch click — replaces the deleted Sprint 57
      // fs read.
      body.eventConfig = eventConfig;
      body.academicSessionMode = academicSessionConfig.mode;
      // Sprint 64: split BYOD payload. Apply the lazy auto-wipe (savedDate
      // !== today → []) INDEPENDENTLY to each direction so a stale save
      // in one direction never collapses the other. The backend pre-merges
      // these into a single stamped array — no `direction` flag in the body.
      const liveArray = (cfg) =>
        cfg && cfg.savedDate === today && Array.isArray(cfg.trains)
          ? cfg.trains
          : [];
      body.inboundTrains = liveArray(trainConfigInbound);
      body.outboundTrains = liveArray(trainConfigOutbound);
      // Sprint 67: BYOD Bus Inbound. Same lazy auto-wipe as the trains —
      // a stale rawText from a prior day collapses to "" so the backend
      // parseBusSchedule short-circuits to []. Backend owns the regex; the
      // payload key matches Sprint 67 §3.B exactly.
      body.inboundBuses =
        busConfigInbound &&
        busConfigInbound.savedDate === today &&
        typeof busConfigInbound.rawText === "string"
          ? busConfigInbound.rawText
          : "";
      // Sprint 68: BYOD Flight Inbound. Same lazy auto-wipe — stale raw
      // text from a prior day collapses to "" so the backend parser
      // short-circuits to []. Backend owns the regex + dictionary lookup.
      body.inboundFlights =
        flightConfigInbound &&
        flightConfigInbound.savedDate === today &&
        typeof flightConfigInbound.rawText === "string"
          ? flightConfigInbound.rawText
          : "";
      body.outboundFlights =
        flightConfigOutbound &&
        flightConfigOutbound.savedDate === today &&
        typeof flightConfigOutbound.rawText === "string"
          ? flightConfigOutbound.rawText
          : "";
      body.weatherOverride =
        weatherConfig &&
        weatherConfig.savedDate === today &&
        typeof weatherConfig.rawText === "string"
          ? weatherConfig.rawText
          : "";
      body.byodEvents =
        typeof byodEventConfig?.eventsByDate?.[today] === "string"
          ? byodEventConfig.eventsByDate[today]
          : "";

      const res = await fetch("/api/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Dispatch failed.");
      }

      setItinerary(data.itinerary || []);
      setSequenceCandidates(data.sequenceCandidates || []);
      setWeatherModifiers(data.weatherModifiers || null);
      setPeakSurgeWindow(data.peakSurgeWindow || null);
      setStatus("done");
    } catch (err) {
      console.error(err);
      setError(err.message);
      setStatus("idle");
    }
  }

  const buttonLabel =
    status === "locating"
      ? "Getting your location..."
      : status === "dispatching"
      ? "Dispatching AI..."
      : "What's happening?";

  const isBusy = status === "locating" || status === "dispatching";
  const todayForSavedCounts = todayLocalISO();
  const savedInboundTrainCount =
    trainConfigInbound?.savedDate === todayForSavedCounts && Array.isArray(trainConfigInbound.trains)
      ? trainConfigInbound.trains.length
      : 0;
  const savedOutboundTrainCount =
    trainConfigOutbound?.savedDate === todayForSavedCounts && Array.isArray(trainConfigOutbound.trains)
      ? trainConfigOutbound.trains.length
      : 0;
  const savedBusCount =
    busConfigInbound?.savedDate === todayForSavedCounts &&
    typeof busConfigInbound.rawText === "string"
      ? countSavedByodRecords("bus", busConfigInbound.rawText)
      : 0;
  const savedInboundFlightCount =
    flightConfigInbound?.savedDate === todayForSavedCounts &&
    typeof flightConfigInbound.rawText === "string"
      ? countSavedByodRecords("flight", flightConfigInbound.rawText)
      : 0;
  const savedOutboundFlightCount =
    flightConfigOutbound?.savedDate === todayForSavedCounts &&
    typeof flightConfigOutbound.rawText === "string"
      ? countSavedByodRecords("flight", flightConfigOutbound.rawText)
      : 0;
  const savedWeatherCount =
    weatherConfig?.savedDate === todayForSavedCounts &&
    typeof weatherConfig.rawText === "string"
      ? countSavedByodRecords("weather", weatherConfig.rawText)
      : 0;
  const savedVenueEventCount =
    typeof byodEventConfig?.eventsByDate?.[todayForSavedCounts] === "string"
      ? countSavedByodRecords(
          "event",
          byodEventConfig.eventsByDate[todayForSavedCounts],
          todayForSavedCounts
        )
      : 0;
  const savedFutureVenueEventCount = Object.entries(byodEventConfig?.eventsByDate || {})
    .filter(([date]) => date > todayForSavedCounts)
    .reduce(
      (total, [date, rawText]) =>
        total + countSavedByodRecords("event", rawText, date),
      0
    );
  const byodSyncLabel =
    byodSyncStatus === "synced"
      ? "Cloud synced"
      : byodSyncStatus === "offline"
      ? "Offline — saved on this device"
      : byodSyncStatus === "syncing"
      ? "Syncing to cloud…"
      : "Loading cloud data…";

  // Sprint 33 + Sprint 48: global Top Pick. Run BEFORE the tab filter so
  // the banner can name a winner in the inactive tab if it deserves the
  // crown. .flat() is a defensive no-op against any future nested-group
  // payload. The backend now stamps densityScore on each item — read it
  // directly instead of recomputing the old surgeScore client-side.
  const flatItinerary = itinerary.flat();
  // Sprint 33.1: Actionable Time-Gate. The backend's decay tiers don't fully
  // suppress massive transit multipliers 3h+ out, so the banner ignores any
  // future item past 90 minutes. Items with no/invalid time label (ongoing
  // food/grocery) bypass the gate.
  const nowForGate = new Date();
  const localForGate = new Date(
    nowForGate.getTime() - nowForGate.getTimezoneOffset() * 60 * 1000
  );
  const currentLocalStart =
    localForGate.getUTCHours() * 60 + localForGate.getUTCMinutes();
  const topPick = flatItinerary
    .filter((item) => {
      const label = item.leaveBy || item.hourBucket;
      if (!label) return true;
      const itemMin = parseTimeLabel(label);
      if (!Number.isFinite(itemMin)) return true;
      let delta = itemMin - currentLocalStart;
      if (delta < -360) delta += 1440;
      return delta <= 90;
    })
    .reduce(
      (max, item) =>
        readOpportunityScore(item) > readOpportunityScore(max || {}) ? item : max,
      null
    );

  // Sprint 32.1: split the itinerary into Transit vs Food families. The
  // backend already applies the Routing Strategy ordering — this is a pure
  // visual filter so the two families never compete in the same sort.
  const TRANSIT_TYPES = ["flight", "train", "event", "flight_ripple", "train_ripple"];
  const FOOD_TYPES = ["food", "grocery"];
  const filteredItinerary = itinerary.filter((item) =>
    activeTab === "transit"
      ? TRANSIT_TYPES.includes(item.type)
      : FOOD_TYPES.includes(item.type)
  );

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 py-10">
      <div className="w-full max-w-md flex flex-col gap-6">
        <header className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">Smart Dispatch</h1>
          <p className="text-neutral-400 mt-1">Your live driving plan.</p>
        </header>

        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-400">
            Time window
          </span>
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            disabled={isBusy}
            className="w-full py-3 px-4 rounded-xl bg-neutral-900 border border-neutral-700 text-lg disabled:opacity-60"
          >
            <option value={1}>Next 1 Hour</option>
            <option value={2}>Next 2 Hours</option>
            <option value={3}>Next 3 Hours</option>
            <option value={4}>Next 4 Hours</option>
          </select>
        </label>

        <fieldset className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-400">
            Active Platforms
          </span>
          <div className="flex flex-col gap-2 rounded-xl bg-neutral-900 border border-neutral-700 p-4">
            {[
              { key: "rideshare", label: "Rideshare (Uber/Lyft)" },
              { key: "food", label: "Food Delivery (DoorDash/UberEats)" },
              { key: "grocery", label: "Grocery (Instacart/Spark)" },
            ].map(({ key, label }) => (
              <label key={key} className="flex items-center gap-3 text-lg">
                <input
                  type="checkbox"
                  checked={platforms[key]}
                  onChange={(e) =>
                    setPlatforms({ ...platforms, [key]: e.target.checked })
                  }
                  disabled={isBusy}
                  className="h-5 w-5 accent-yellow-400 disabled:opacity-60"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-400">
            BYOD Data Settings
          </span>
          <div className="flex flex-col gap-2 rounded-xl bg-neutral-900/60 border border-neutral-800 p-4">
            {/* Sprint 61: BYOD Amtrak direction. Radio sits directly above
                the textarea so the parser anchor (DEPARTS vs ARRIVES) is
                obviously a property of the same dump the driver pastes
                next. Persisted in trainConfig alongside the trains. */}
            <div className="flex flex-col gap-1">
              <span className="text-sm text-neutral-400">BYOD Mode</span>
              {/* Sprint 67: third radio option routes the "Save" button +
                  textarea contents to the new BYOD Bus pipeline (downtown
                  terminal anchor, strict SUNY drop on the backend). */}
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {[
                  { value: "inbound", label: "Amtrak Inbound" },
                  { value: "outbound", label: "Amtrak Outbound" },
                  { value: "busInbound", label: "Bus Inbound" },
                  { value: "flightInbound", label: "Flight Inbound" },
                  { value: "flightOutbound", label: "Flight Outbound" },
                  { value: "weather", label: "Weather Override" },
                  { value: "venueEvents", label: "Venue Events" },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="trainDirection"
                      value={opt.value}
                      checked={direction === opt.value}
                      onChange={() => handleDirectionChange(opt.value)}
                      disabled={isBusy || byodSyncStatus === "loading"}
                      className="accent-yellow-400 disabled:opacity-60"
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>
            {/* Sprint 53: BYOD Amtrak Pipeline. Per-shift raw text dump
                from the Amtrak booking page (NYP → ALB). Backend regex
                parses train number + arrival time + seat-availability
                status into synthetic events. Not persisted.
                Sprint 68 UX Overhaul: label now reflects the active radio. */}
            <label className="text-sm text-neutral-400">
              {direction === "flightInbound"
                ? "Paste Flight Arrival Status"
                : direction === "flightOutbound"
                ? "Paste Flight Departure Status"
                : direction === "busInbound"
                ? "Paste Bus Status"
                : direction === "weather"
                ? "Paste Weather Override"
                : direction === "venueEvents"
                ? "Paste Venue Events"
                : direction === "outbound"
                ? "Paste Amtrak Outbound Status"
                : "Paste Amtrak Inbound Status"}
            </label>
            {direction === "venueEvents" && (
              <label className="flex flex-col gap-1 text-sm text-neutral-400">
                Event Date
                <input
                  type="date"
                  min={todayForSavedCounts}
                  value={byodEventDate}
                  onChange={(event) => setByodEventDate(event.target.value)}
                  disabled={isBusy || byodSyncStatus === "loading"}
                  className="w-full py-2 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-neutral-100 disabled:opacity-60"
                />
              </label>
            )}
            <textarea
              value={trainRawText}
              onChange={(e) => setTrainRawText(e.target.value)}
              disabled={isBusy}
              placeholder={
                direction === "weather"
                  ? "Paste hourly weather table, or type: Moderate rain for 2 hours"
                  : direction === "venueEvents"
                  ? "MVP Arena | Event Name | Doors 6:30 PM | Starts 8:00 PM | Music"
                  : direction === "flightOutbound"
                  ? "Chicago 10:30 AM\nAtlanta 11:24 AM\nLaGuardia 12:47 PM"
                  : "Paste Amtrak status here..."
              }
              rows={6}
              className="w-full py-2 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-sm font-mono disabled:opacity-60"
            />
            {direction === "venueEvents" && (
              <div className="text-xs text-neutral-500">
                One event per line. New saves append to the selected date; a matching venue and start time updates the existing event. Doors and Ends are optional; categories: Music, Sports, Theatre, Arts, or Other.
              </div>
            )}
            {/* Sprint 58/59: BYOD Amtrak Persistence. Parses the textarea
                client-side and writes { savedDate, trains } to
                localStorage. Dispatch reads it with lazy auto-wipe. */}
            <button
              type="button"
              onClick={handleSaveTrains}
              disabled={
                isBusy ||
                byodSyncStatus === "loading" ||
                trainSaveStatus === "saving" ||
                !trainRawText.trim()
              }
              className="mt-2 py-2 px-4 rounded-lg bg-neutral-800 border border-neutral-600 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              {trainSaveStatus === "saved"
                ? "Saved!"
                : trainSaveStatus === "error"
                ? "Save Failed"
                : trainSaveStatus === "saving"
                ? "Saving..."
                : direction === "flightInbound" || direction === "flightOutbound"
                ? "Save Flights"
                : direction === "busInbound"
                ? "Save Buses"
                : direction === "weather"
                ? "Save Weather"
                : direction === "venueEvents"
                ? "Save Events"
                : "Save Trains"}
            </button>

            {/* Sprint 45: Mathematical ROI Filter — driver's vehicle cost
                per mile. Range slider 0.00–2.00 in $0.05 steps so EV /
                Sedan / SUV defaults all snap cleanly. Persisted to
                localStorage on every change. */}
            <div className="text-xs text-neutral-500">
              Saved today: Train In {savedInboundTrainCount} | Train Out {savedOutboundTrainCount} | Bus {savedBusCount} | Flight In {savedInboundFlightCount} | Flight Out {savedOutboundFlightCount} | Weather {savedWeatherCount} | Events Today {savedVenueEventCount} | Future Events {savedFutureVenueEventCount}
            </div>
            <div
              className={`text-xs ${
                byodSyncStatus === "offline" ? "text-amber-400" : "text-emerald-400"
              }`}
              role="status"
            >
              {byodSyncLabel}
            </div>

            <div className="flex flex-col gap-2 mt-3">
              <label className="text-sm text-neutral-400">
                Vehicle Cost Per Mile (${costPerMile.toFixed(2)})
              </label>
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={costPerMile}
                onChange={(e) => handleCostPerMileChange(Number(e.target.value))}
                disabled={isBusy}
                className="w-full accent-yellow-400 disabled:opacity-60"
              />
            </div>

            {/* Sprint 57/59: Unified Event Database. Dropdown is populated
                from localStorage (seeded from EVENT_CONFIG_SEED on first
                mount). Selecting an event reveals an inline date picker
                pre-loaded with the persisted date; Save writes the
                override back to localStorage. */}
            <div className="flex flex-col gap-2 mt-4 pt-3 border-t border-neutral-800">
              <label className="text-sm text-neutral-400">
                UAlbany Regular Session
              </label>
              <select
                value={academicSessionConfig.mode}
                onChange={(e) => handleAcademicSessionModeChange(e.target.value)}
                disabled={isBusy || byodSyncStatus === "loading" || byodSyncStatus === "syncing"}
                className="w-full py-2 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-sm disabled:opacity-60"
              >
                <option value="auto">Automatic — Regular Fall/Spring Terms</option>
                <option value="in-session">Force In Session</option>
                <option value="out-of-session">Force Out of Session</option>
              </select>
              <div className="text-xs text-neutral-500">
                Campus routine demand: {isUAlbanyRegularSession(
                  todayLocalISO(),
                  academicSessionConfig.mode
                ) ? "Active" : "Suppressed"}
              </div>

              <label className="text-sm text-neutral-400">
                Holiday & Academic Calendar
              </label>
              <select
                value={selectedEventName}
                onChange={(e) => {
                  const name = e.target.value;
                  setSelectedEventName(name);
                  setDateInput(eventConfig[name]?.date || "");
                  setSaveStatus("idle");
                }}
                disabled={isBusy || Object.keys(eventConfig).length === 0}
                className="w-full py-2 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-sm disabled:opacity-60"
              >
                {Object.keys(eventConfig).length === 0 && (
                  <option value="">Loading events…</option>
                )}
                {Object.keys(eventConfig).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
              {selectedEventName && (
                <>
                  <input
                    type="date"
                    value={dateInput}
                    onChange={(e) => {
                      setDateInput(e.target.value);
                      setSaveStatus("idle");
                    }}
                    disabled={isBusy}
                    className="w-full py-2 px-3 rounded-lg bg-neutral-900 border border-neutral-700 text-sm disabled:opacity-60"
                  />
                  <button
                    type="button"
                    onClick={handleSaveEvent}
                    disabled={isBusy || !dateInput || saveStatus === "saving"}
                    className="self-start py-2 px-4 rounded-lg bg-neutral-800 border border-neutral-700 text-sm font-semibold disabled:opacity-60"
                  >
                    {saveStatus === "saved"
                      ? "Saved!"
                      : saveStatus === "saving"
                      ? "Saving…"
                      : "Save Date"}
                  </button>
                </>
              )}
            </div>
          </div>
        </fieldset>

        <label className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-400">
            Routing Strategy
          </span>
          <select
            value={routingStrategy}
            onChange={(e) => setRoutingStrategy(e.target.value)}
            disabled={isBusy}
            className="w-full py-3 px-4 rounded-xl bg-neutral-900 border border-neutral-700 text-lg disabled:opacity-60"
          >
            <option value="chronological">Chronological</option>
            <option value="profitability">Profitability</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>

        <button
          onClick={handleClick}
          disabled={isBusy}
          className="w-full py-6 rounded-2xl bg-yellow-400 text-black text-xl font-bold shadow-lg active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition"
        >
          {buttonLabel}
        </button>

        {error && (
          <div className="rounded-xl bg-red-900/40 border border-red-700 p-4 text-red-200">
            {error}
          </div>
        )}

        {status === "done" && <PeakSurgeBanner data={peakSurgeWindow} />}

        {status === "done" && topPick && <TopPickBanner data={topPick} />}

        {status === "done" && (
          <SuggestedSequence itinerary={[...itinerary, ...sequenceCandidates]} />
        )}

        {status === "done" && (
          <DemandFirstSuggestedSequence
            itinerary={[...itinerary, ...sequenceCandidates]}
            driverCoords={driverCoords}
          />
        )}

        {status === "done" && (
          <GlobalWeatherBanner weatherModifiers={weatherModifiers} />
        )}

        {status === "done" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm uppercase tracking-wide text-neutral-400">
              Your Plan
            </h2>

            {/* Sprint 38: global Map/List segmented control. Sits above the
                Transit/Food tabs because it governs the entire plan view, not
                just one family. Strict conditional render below unmounts the
                Mapbox WebGL context when the driver chooses List. */}
            <div className="flex gap-1 rounded-full bg-neutral-900 border border-neutral-700 p-1">
              {[
                { key: "map", label: "Map" },
                { key: "list", label: "List" },
              ].map(({ key, label }) => {
                const isActive = viewMode === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleViewModeChange(key)}
                    className={`flex-1 py-2 text-sm font-semibold rounded-full transition ${
                      isActive
                        ? "bg-neutral-700 text-white"
                        : "bg-transparent text-neutral-400 hover:text-neutral-200"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex border-b border-neutral-700">
              {[
                { key: "transit", label: "Transit & Events" },
                { key: "food", label: "Food & Grocery" },
              ].map(({ key, label }) => {
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setActiveTab(key)}
                    className={`flex-1 py-2 text-sm font-semibold transition border-b-2 ${
                      isActive
                        ? "border-yellow-500 text-yellow-400"
                        : "border-transparent text-neutral-500 hover:text-neutral-300"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Sprint 37: vertical card list swapped for the Mapbox radar.
                Tabs above still filter the dataset that gets pinned, so the
                map respects the Transit/Food split. DispatchCards are kept
                in the repo for future popup reuse.
                Sprint 37.1: strictly-sized 600px wrapper — the Map collapses
                to 0 px and renders as an invisible canvas without an explicit
                height on its parent.
                Sprint 38: strict conditional render — Map and List never
                co-exist. Unmounting the Mapbox subtree releases the WebGL
                context and frees GPU memory on the driver's device. */}
            {viewMode === "map" && (
              <div className="w-full h-[600px] mt-4 rounded-xl overflow-hidden border border-neutral-700">
                <DispatchMap itinerary={filteredItinerary} driverCoords={driverCoords} />
              </div>
            )}

            {viewMode === "list" && (
              <div className="flex flex-col gap-3 mt-4">
                {filteredItinerary.map((item, i) => {
                  switch (item.type) {
                    case "flight":
                      return <FlightCard key={i} data={item} />;
                    case "train":
                      return <TrainCard key={i} data={item} />;
                    case "event":
                      return <EventCard key={i} data={item} />;
                    case "food":
                    case "grocery":
                      return <HotspotCard key={i} data={item} />;
                    default:
                      return null;
                  }
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
