// Sprint 41 Phase 1 — TDD scaffold for the Holiday & Iftar Supply Engine.
// Validates computeSupplyDropMod BEFORE touching route.js.
//
// Rules (locked by PO):
//   localStart matches an Eid / Eid Eve date in ISLAMIC_HOLIDAYS         → 1.5
//   localStart inside a Ramadan window AND within ±30 min of sunset      → 1.5
//   localStart inside Ramadan but outside the ±30 min sunset window      → 1.0
//   Default (no Eid, no Ramadan)                                          → 1.0
//
// Date comparison is strict YYYY-MM-DD on the wall-clock-as-UTC localStart
// (same frame Sprint 18+ already uses). Sunset string comes from Open-Meteo
// `daily.sunset[0]` — ISO local-time, e.g. "2026-05-26T20:15".

// Locked 5-year holiday matrix (2026-2030). Includes Eid + Eid Eve / Chaand Raat.
const ISLAMIC_HOLIDAYS = [
  // 2026
  "2026-03-19", "2026-03-20", // Eid al-Fitr Eve + Day
  "2026-05-26", "2026-05-27", // Eid al-Adha Eve + Day
  // 2027
  "2027-03-08", "2027-03-09",
  "2027-05-16", "2027-05-17",
  // 2028
  "2028-02-25", "2028-02-26",
  "2028-05-04", "2028-05-05",
  // 2029
  "2029-02-13", "2029-02-14",
  "2029-04-23", "2029-04-24",
  // 2030
  "2030-02-03", "2030-02-04",
  "2030-04-13", "2030-04-14",
];

const RAMADAN_MONTHS = [
  { start: "2026-02-18", end: "2026-03-19" },
  { start: "2027-02-08", end: "2027-03-08" },
  { start: "2028-01-28", end: "2028-02-26" },
  { start: "2029-01-16", end: "2029-02-14" },
  { start: "2030-01-05", end: "2030-02-03" },
];

function toYmd(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isInRamadan(ymd) {
  for (const { start, end } of RAMADAN_MONTHS) {
    if (ymd >= start && ymd <= end) return true;
  }
  return false;
}

function computeSupplyDropMod(localStart, sunsetTimeStr) {
  if (!(localStart instanceof Date) || Number.isNaN(localStart.getTime())) return 1.0;
  const ymd = toYmd(localStart);

  if (ISLAMIC_HOLIDAYS.includes(ymd)) return 1.5;

  if (isInRamadan(ymd)) {
    if (typeof sunsetTimeStr !== "string") return 1.0;
    const match = sunsetTimeStr.match(/T(\d{2}):(\d{2})/);
    if (!match) return 1.0;
    const sunsetMin = Number(match[1]) * 60 + Number(match[2]);
    const nowMin = localStart.getUTCHours() * 60 + localStart.getUTCMinutes();
    const delta = Math.abs(nowMin - sunsetMin);
    if (delta <= 30) return 1.5;
  }

  return 1.0;
}

const results = [];

function assert(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, actual, expected, pass });
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | actual=${actual} expected=${expected}`);
}

// Assert 1: Normal day outside Ramadan/Eid → 1.0
assert(
  "Normal day (2026-04-15 14:00, sunset 19:30) → 1.0",
  computeSupplyDropMod(new Date("2026-04-15T14:00:00Z"), "2026-04-15T19:30"),
  1.0
);

// Assert 2: Eid Eve (May 26, 2026 — Eid al-Adha Eve) → 1.5
assert(
  "Eid al-Adha Eve (2026-05-26 10:00) → 1.5",
  computeSupplyDropMod(new Date("2026-05-26T10:00:00Z"), "2026-05-26T20:15"),
  1.5
);

// Assert 3: Ramadan, 15 min before sunset → 1.5
// 2026-03-10 is mid-Ramadan; sunset string 18:00 → driver clock 17:45
assert(
  "Ramadan pre-sunset (2026-03-10 17:45, sunset 18:00) → 1.5",
  computeSupplyDropMod(new Date("2026-03-10T17:45:00Z"), "2026-03-10T18:00"),
  1.5
);

// Assert 4: Ramadan, 3 hours before sunset (outside ±30 min) → 1.0
assert(
  "Ramadan out-of-window (2026-03-10 15:00, sunset 18:00) → 1.0",
  computeSupplyDropMod(new Date("2026-03-10T15:00:00Z"), "2026-03-10T18:00"),
  1.0
);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
