# 🧊 Icebox: Deferred Epics & Features

This file contains features, algorithmic optimizations, and technical debt items that have been prioritized out of the active development sprints.

- **[Sprint 31] The Widebody Capacity Engine:** Multi-factor multiplier (1.5x) based on `aircraft_iata` codes or Terminal-based proxies to identify high-capacity widebody arrivals.

- **Leisure Hub Expansion:** Adding secondary/tertiary vacation hubs to the `LEISURE_HUBS` dictionary beyond the initial MVP.

- **Frontend Dashboard Overhaul:** Transitioning from the current list-view UI to an interactive Mapbox/Leaflet-based interface.

- **Driver Session Persistence:** Implementing `localStorage` logic to ensure driver shift data/multipliers persist across browser refreshes.

- **The Gridlock Penalty (`velocityMod`):** A protective negative multiplier (e.g., 0.6x) applied to high-volume hotspots if the surrounding average traffic speed drops below 10 mph, preventing drivers from taking unprofitable rides in dead-stop traffic.

- **The Convention / Corporate Engine (`corporateMod`):** A premium rideshare multiplier targeting high-end restaurants ($$$$ Yelp rating) within a 1-mile radius of downtown convention centers and luxury business hotels on Tuesday, Wednesday, and Thursday evenings.
