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

function pinColor(type) {
  return PIN_HEX[type] || "#facc15";
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
          // Sprint 40: Ghosting Effect. Weak items (sub-1.0 surge revealed
          // via the X-Ray toggle) drop to a muted gray teardrop at 50%
          // opacity so the eye filters them from the strong picks.
          const color = item.isWeak ? "#737373" : pinColor(item.type);
          return (
            <Marker
              key={i}
              longitude={lng}
              latitude={lat}
              color={color}
              style={item.isWeak ? { opacity: 0.5 } : undefined}
              onClick={(e) => {
                e.originalEvent.stopPropagation();
                setSelectedItem(item);
              }}
            />
          );
        })}

        {selectedItem && Number.isFinite(selectedItem.lat) && Number.isFinite(selectedItem.lng) && (
          <Popup
            longitude={selectedItem.lng}
            latitude={selectedItem.lat}
            anchor="top"
            closeOnClick={false}
            onClose={() => setSelectedItem(null)}
          >
            <div className="text-neutral-900 text-sm">
              <div className="font-semibold uppercase tracking-wide text-xs mb-1">
                {selectedItem.type}
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
