"use client";

// Sprint 37: Mapbox radar. Replaces the vertical card list with a dark-mode
// Albany map showing color-coded surge pins + the driver's pulsing GPS dot.
// Itinerary items lacking lat/lng are skipped silently (Ticketmaster events
// from the structuring pass don't carry coords yet).

import { useState } from "react";
import Map, { Marker, Popup } from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";

// Sprint 37.4: hex palette for inline styles — Tailwind class names weren't
// reaching the Mapbox-injected marker DOM, so we hand the renderer raw colors.
const PIN_HEX = {
  flight: "#ffffff",
  flight_ripple: "#ffffff",
  train: "#10b981",
  train_ripple: "#10b981",
  food: "#f43f5e",
  grocery: "#f43f5e",
  event: "#a855f7",
};

// Sprint 62: Unified Situational Radar. Inbound (live + BYOD) trains carry
// `categories: ["Inbound", ...]`; Outbound (BYOD departures) carry
// `categories: [..., "Outbound", ...]`. The categories check wins over the
// type-based PIN_HEX fallback so an Outbound `type: "event"` paints orange
// instead of purple, and an Inbound `type: "train"` keeps its emerald.
function pinColor(item) {
  const cats = Array.isArray(item.categories) ? item.categories : [];
  if (cats.includes("Outbound")) return "#f97316";
  if (cats.includes("Inbound")) return "#10b981";
  return PIN_HEX[item.type] || "#facc15";
}

// Sprint 62: micro-offset to prevent Inbound/Outbound pins at the same
// coordinates from eclipsing each other. Every Outbound pin shifts +0.0005
// longitude (~40 m east) so it sits beside any non-Outbound pin at the same
// spot. Applied to BOTH the Marker and the Popup so the open popup tracks
// the offset pin.
const OUTBOUND_LNG_OFFSET = 0.0005;
function lngForItem(item, baseLng) {
  const cats = Array.isArray(item.categories) ? item.categories : [];
  return cats.includes("Outbound") ? baseLng + OUTBOUND_LNG_OFFSET : baseLng;
}

// Sprint 62: popup header now displays direction when the item is tagged
// Inbound / Outbound; returns null otherwise so the popup falls back to
// the existing uppercase `type` label for non-train surges.
function directionLabel(item) {
  const cats = Array.isArray(item.categories) ? item.categories : [];
  if (cats.includes("Outbound")) return "Departing";
  if (cats.includes("Inbound")) return "Arriving";
  return null;
}

export default function DispatchMap({ itinerary = [], driverCoords }) {
  const [selectedItem, setSelectedItem] = useState(null);

  return (
    <div className="w-full h-[600px] min-h-[50vh] rounded-xl overflow-hidden">
      <Map
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        initialViewState={{ longitude: -73.7562, latitude: 42.6526, zoom: 11 }}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        style={{ width: "100%", height: "100%" }}
      >
        {driverCoords && (
          // Sprint 37.5: native Mapbox SVG marker via the color prop. Custom
          // <div> children were being clipped inside the Mapbox-injected DOM.
          <Marker
            longitude={driverCoords.longitude}
            latitude={driverCoords.latitude}
            color="#3b82f6"
          />
        )}

        {itinerary.map((item, i) => {
          // Sprint 37.4: defensive Number() coercion before the finite guard.
          const lat = Number(item.lat);
          const lng = Number(item.lng);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          // Sprint 37.5: native SVG marker via the color prop — children were
          // being clipped, so we let Mapbox draw its own teardrop pin.
          // Sprint 62: color + longitude now derive from categories so
          // Inbound/Outbound trains paint dual-color and never eclipse.
          return (
            <Marker
              key={i}
              longitude={lngForItem(item, lng)}
              latitude={lat}
              color={pinColor(item)}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedItem(item);
              }}
            />
          );
        })}

        {selectedItem && Number.isFinite(selectedItem.lat) && Number.isFinite(selectedItem.lng) && (
          <Popup
            longitude={lngForItem(selectedItem, selectedItem.lng)}
            latitude={selectedItem.lat}
            anchor="top"
            closeOnClick={false}
            onClose={() => setSelectedItem(null)}
          >
            <div className="text-neutral-900 text-sm">
              <div className="font-semibold uppercase tracking-wide text-xs mb-1">
                {directionLabel(selectedItem) || selectedItem.type}
              </div>
              <div className="font-bold">
                {selectedItem.location || selectedItem.hub || "Surge"}
              </div>
              {Number.isFinite(selectedItem.volume) && (
                <div>Volume: {selectedItem.volume}</div>
              )}
              {Number.isFinite(selectedItem.densityScore) && (
                <div>Density: {Math.round(selectedItem.densityScore)}%</div>
              )}
              {Number.isFinite(selectedItem.egressMod) && selectedItem.egressMod > 1 && (
                <div>Egress: {selectedItem.egressMod}x</div>
              )}
            </div>
          </Popup>
        )}
      </Map>
    </div>
  );
}
