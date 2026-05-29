// Sprint 57: Unified Event Database — seed script.
// Writes the default event-config.json to the project root with 2026 dates
// for all major holidays + all UAlbany academic-calendar surge events ported
// from the Sprint 56 hardcoded dictionary.
//
// Schema per event:
//   { date: "YYYY-MM-DD", type: "holiday" | "academic",
//     multiplier: number, activeWindows: null | [{ start, end }] }
//
// activeWindows uses decimal-hour wall-clock values; hours > 24 encode the
// cross-midnight tail of the SAME entry (e.g. 25.5 = 1:30 AM next day).
//
// Run: `node scripts/seed-events.js` from the project root.

const fs = require("fs");
const path = require("path");

const OUT_PATH = path.join(process.cwd(), "event-config.json");

const events = {
  // ----- Major Holidays (full-day, multiplier fires whenever date matches) -----
  "New Year's Day":    { date: "2026-01-01", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Super Bowl Sunday": { date: "2026-02-08", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Valentine's Day":   { date: "2026-02-14", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "St. Patrick's Day": { date: "2026-03-17", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Cinco de Mayo":     { date: "2026-05-05", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "4th of July":       { date: "2026-07-04", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Halloween":         { date: "2026-10-31", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Thanksgiving":      { date: "2026-11-26", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "Christmas":         { date: "2026-12-25", type: "holiday",  multiplier: 3.5, activeWindows: null },
  "New Year's Eve":    { date: "2026-12-31", type: "holiday",  multiplier: 3.5, activeWindows: null },

  // ----- Academic Surges (time-gated, ported from Sprint 56 dictionary) -----
  "Fall Move-In Day 1":    { date: "2026-08-22", type: "academic", multiplier: 3.5, activeWindows: [{ start: 9.0, end: 17.0 }] },
  "Fall Move-In Day 2":    { date: "2026-08-23", type: "academic", multiplier: 3.5, activeWindows: [{ start: 9.0, end: 17.0 }] },
  "Spring Move-Out Day 1": { date: "2026-05-15", type: "academic", multiplier: 3.5, activeWindows: [{ start: 9.0, end: 17.0 }] },
  "Spring Move-Out Day 2": { date: "2026-05-16", type: "academic", multiplier: 3.5, activeWindows: [{ start: 9.0, end: 17.0 }] },

  "Spring Break Exodus":   { date: "2026-03-13", type: "academic", multiplier: 3.5, activeWindows: [{ start: 15.0, end: 20.0 }] },
  "Labor Day Exodus":      { date: "2026-09-04", type: "academic", multiplier: 3.5, activeWindows: [{ start: 15.0, end: 20.0 }] },
  "Fall Break Exodus":     { date: "2026-10-09", type: "academic", multiplier: 3.5, activeWindows: [{ start: 15.0, end: 20.0 }] },
  "Thanksgiving Exodus":   { date: "2026-11-24", type: "academic", multiplier: 3.5, activeWindows: [{ start: 15.0, end: 20.0 }] },

  "Spring Break Return":   { date: "2026-03-22", type: "academic", multiplier: 3.5, activeWindows: [{ start: 18.0, end: 23.0 }] },
  "Labor Day Return":      { date: "2026-09-07", type: "academic", multiplier: 3.5, activeWindows: [{ start: 18.0, end: 23.0 }] },
  "Fall Break Return":     { date: "2026-10-13", type: "academic", multiplier: 3.5, activeWindows: [{ start: 18.0, end: 23.0 }] },
  "Thanksgiving Return":   { date: "2026-11-29", type: "academic", multiplier: 3.5, activeWindows: [{ start: 18.0, end: 23.0 }] },

  "Commencement":          { date: "2026-05-16", type: "academic", multiplier: 3.5, activeWindows: [{ start: 9.0, end: 17.0 }] },

  "Homecoming": {
    date: "2026-10-17",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [
      { start: 11.5, end: 14.5 },
      { start: 18.5, end: 20.0 },
      { start: 21.0, end: 23.0 },
      { start: 25.5, end: 27.0 },
    ],
  },

  "Halloweekend (Downtown)": {
    date: "2026-10-31",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [{ start: 21.0, end: 27.0 }],
  },

  "St. Patrick's (Kegs & Eggs)": {
    date: "2026-03-17",
    type: "academic",
    multiplier: 3.5,
    activeWindows: [{ start: 6.0, end: 14.0 }],
  },
};

fs.writeFileSync(OUT_PATH, JSON.stringify(events, null, 2) + "\n", "utf-8");
console.log(`Seeded ${Object.keys(events).length} events to ${OUT_PATH}`);
