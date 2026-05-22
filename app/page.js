"use client";

import { useEffect, useState } from "react";
import { FlightCard, TrainCard, HotspotCard, EventCard } from "../components/DispatchCards";
import { TopPickBanner } from "../components/TopPickBanner";

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

function computeDecayMod(itemTimeLabel) {
  if (!itemTimeLabel) return 1.0;
  const now = new Date();
  const offsetMin = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offsetMin * 60 * 1000);
  const currentMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const itemMin = parseTimeLabel(itemTimeLabel);
  if (!Number.isFinite(itemMin)) return 1.0;
  let delta = itemMin - currentMin;
  if (delta < -360) delta += 1440;
  if (delta < 45) return 1.0;
  if (delta <= 90) return 0.7;
  return 0.4;
}

function computeSurgeScore(item, finalRideMod, finalFoodMod) {
  let base = 0;
  if (item.type === "event") {
    base = (Number(item.volume) || 0) * finalRideMod * (Number(item.egressMod) || 1.0);
  } else if (item.type === "flight") {
    base =
      (Number(item.volume) || 0) *
      finalRideMod *
      (Number(item.fatigueMod) || 1.0) *
      (Number(item.leisureMod) || 1.0);
  } else if (item.type === "train") {
    base = (Number(item.volume) || 0) * finalRideMod;
  } else if (item.type === "food" || item.type === "grocery") {
    const qualityMod = Number(item.qualityMod) || 1.0;
    const campusMod = Number(item.campusMod) || 1.0;
    base =
      (Number(item.volume) || 0) * finalFoodMod * qualityMod * campusMod +
      (item.tier === "High-Value ($$$)" ? 2 : 0);
  } else {
    return 0;
  }
  return base * computeDecayMod(item.leaveBy || item.hourBucket);
}

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [itinerary, setItinerary] = useState([]);
  const [error, setError] = useState("");
  const [hours, setHours] = useState(4);
  const [platforms, setPlatforms] = useState({
    rideshare: true,
    food: false,
    grocery: false,
  });
  const [includeAirport, setIncludeAirport] = useState(true);
  const [includeAmtrak, setIncludeAmtrak] = useState(true);
  const [routingStrategy, setRoutingStrategy] = useState("hybrid");
  const [activeTab, setActiveTab] = useState("transit");
  const [finalMods, setFinalMods] = useState({ ride: 1.0, food: 1.0 });
  // Sprint 34: BYOD semester calendar. Persisted in localStorage so a driver
  // uploads once per semester and forgets it. Each entry is { date, eventType }.
  const [campusCalendar, setCampusCalendar] = useState([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("campusCalendar");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setCampusCalendar(parsed);
      }
    } catch (e) {
      console.warn("campusCalendar hydrate failed:", e.message);
    }
  }, []);

  function todayLocalISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function handleCsvUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const parsed = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, eventType] = line.split(",").map((s) => (s || "").trim());
          return { date, eventType };
        })
        // Drop header rows / malformed lines — only keep YYYY-MM-DD entries.
        .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.eventType);
      setCampusCalendar(parsed);
      try {
        localStorage.setItem("campusCalendar", JSON.stringify(parsed));
      } catch (err) {
        console.warn("campusCalendar persist failed:", err.message);
      }
    };
    reader.readAsText(file);
  }

  // Expiration check — latest stored date is in the past.
  const calendarExpired =
    campusCalendar.length > 0 &&
    campusCalendar.every((row) => row.date < todayLocalISO());

  async function handleClick() {
    setError("");
    setItinerary([]);
    setStatus("locating");

    // Sprint 35: Intent-Driven Intercept. Await the device's live coordinates
    // here (browser shows the permission prompt on first click). On any
    // failure — denial, timeout, no GPS — fall back to Roessleville so the
    // dispatch still runs.
    let latitude = ROESSLEVILLE_COORDS.latitude;
    let longitude = ROESSLEVILLE_COORDS.longitude;
    try {
      const coords = await getGeolocation();
      latitude = coords.latitude;
      longitude = coords.longitude;
    } catch (geoErr) {
      console.warn(
        "Geolocation unavailable — falling back to Roessleville:",
        geoErr.message
      );
    }

    setStatus("dispatching");

    const timezoneOffsetMinutes = new Date().getTimezoneOffset();

    try {
      // Sprint 34: only inject campusEvent when today's local date is
      // listed in the BYOD calendar. Missing key means the backend sees
      // a vanilla payload (back-compat).
      const today = todayLocalISO();
      const todaysEvent = campusCalendar.find((row) => row.date === today);
      const body = {
        latitude,
        longitude,
        hours,
        timezoneOffsetMinutes,
        platforms,
        includeAirport,
        includeAmtrak,
        routingStrategy,
      };
      if (todaysEvent?.eventType) body.campusEvent = todaysEvent.eventType;

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
      setFinalMods({
        ride: Number(data.finalRideMod) || 1.0,
        food: Number(data.finalFoodMod) || 1.0,
      });
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

  // Sprint 33: global Top Pick. Run BEFORE the tab filter so the banner
  // can name a winner in the inactive tab if it deserves the crown.
  // .flat() is a defensive no-op against any future nested-group payload.
  const flatItinerary = itinerary.flat().map((item) => ({
    ...item,
    surgeScore: computeSurgeScore(item, finalMods.ride, finalMods.food),
  }));
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
      (max, item) => (item.surgeScore > (max?.surgeScore || 0) ? item : max),
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
            Location/Hub Filtering
          </span>
          <div className="flex flex-col gap-2 rounded-xl bg-neutral-900 border border-neutral-700 p-4">
            <label className="flex items-center gap-3 text-lg">
              <input
                type="checkbox"
                checked={includeAirport}
                onChange={(e) => setIncludeAirport(e.target.checked)}
                disabled={isBusy}
                className="h-5 w-5 accent-yellow-400 disabled:opacity-60"
              />
              <span>Airport (ALB)</span>
            </label>
            <label className="flex items-center gap-3 text-lg">
              <input
                type="checkbox"
                checked={includeAmtrak}
                onChange={(e) => setIncludeAmtrak(e.target.checked)}
                disabled={isBusy}
                className="h-5 w-5 accent-yellow-400 disabled:opacity-60"
              />
              <span>Amtrak (Rensselaer)</span>
            </label>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <span className="text-sm uppercase tracking-wide text-neutral-400">
            Institution Settings
          </span>
          <div className="flex flex-col gap-2 rounded-xl bg-neutral-900/60 border border-neutral-800 p-4">
            <label className="text-sm text-neutral-400">
              Upload semester calendar (CSV: Date, EventType)
            </label>
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              disabled={isBusy}
              className="text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-neutral-800 file:text-neutral-200 file:cursor-pointer disabled:opacity-60"
            />
            {campusCalendar.length > 0 && (
              <div className="text-xs text-neutral-500">
                {campusCalendar.length} dates loaded.
              </div>
            )}
            {calendarExpired && (
              <div className="text-sm text-red-400">
                Calendar expired. Please upload a new CSV.
              </div>
            )}
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

        {status === "done" && topPick && <TopPickBanner data={topPick} />}

        {status === "done" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-sm uppercase tracking-wide text-neutral-400">
              Your Plan
            </h2>

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

            {filteredItinerary.length === 0 ? (
              <div className="rounded-xl bg-neutral-900 border border-neutral-700 p-5 text-neutral-300">
                No active surges detected for this window. Stand by or expand your search.
              </div>
            ) : (
              filteredItinerary.map((item, i) => {
                switch (item.type) {
                  case "flight":
                    return <FlightCard key={i} data={item} />;
                  case "train":
                    return <TrainCard key={i} data={item} />;
                  case "food":
                  case "grocery":
                    return <HotspotCard key={i} data={item} />;
                  case "event":
                    return <EventCard key={i} data={item} />;
                  default:
                    return null;
                }
              })
            )}
          </div>
        )}
      </div>
    </main>
  );
}
