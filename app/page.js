"use client";

import { useState } from "react";

export default function Home() {
  const [status, setStatus] = useState("idle");
  const [plan, setPlan] = useState("");
  const [error, setError] = useState("");
  const [hours, setHours] = useState(4);
  const [platforms, setPlatforms] = useState({
    rideshare: true,
    food: false,
    grocery: false,
  });
  const [includeAirport, setIncludeAirport] = useState(true);
  const [includeAmtrak, setIncludeAmtrak] = useState(true);

  async function handleClick() {
    setError("");
    setPlan("");

    if (!("geolocation" in navigator)) {
      setError("Geolocation is not supported on this device.");
      return;
    }

    setStatus("locating");

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setStatus("dispatching");

        const timezoneOffsetMinutes = new Date().getTimezoneOffset();

        try {
          const res = await fetch("https://beamish-salamander-98efb1.netlify.app/api/dispatch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              latitude,
              longitude,
              hours,
              timezoneOffsetMinutes,
              platforms,
              includeAirport,
              includeAmtrak,
            }),
          });

          const data = await res.json();

          if (!res.ok) {
            throw new Error(data.error || "Dispatch failed.");
          }

          setPlan(data.plan);
          setStatus("done");
        } catch (err) {
          setError(err.message);
          setStatus("idle");
        }
      },
      (geoErr) => {
        setError(`Location error: ${geoErr.message}`);
        setStatus("idle");
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  const buttonLabel =
    status === "locating"
      ? "Getting your location..."
      : status === "dispatching"
      ? "Dispatching AI..."
      : "What's happening?";

  const isBusy = status === "locating" || status === "dispatching";

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

        {plan && (
          <div className="rounded-2xl bg-neutral-900 border border-neutral-700 p-5">
            <h2 className="text-sm uppercase tracking-wide text-neutral-400 mb-3">
              Your Plan
            </h2>
            <pre className="whitespace-pre-wrap font-sans text-lg leading-relaxed">
              {plan}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
