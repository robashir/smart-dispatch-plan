// Sprint 29 Phase 1 — TDD scaffold for the Aviation Fatigue Engine.
// Validates the Late-Night Synergy multiplier BEFORE touching route.js.
//
// Rule (locked by PO):
//   delay >= 45 minutes AND local hour >= 21 (9 PM) OR < 4 (3 AM) → 1.3
//   otherwise → 1.0
//
// Local hour is extracted from the ISO string itself (preserves the
// airport's embedded offset). `new Date(iso).getUTCHours()` would drift
// for offsets other than +00:00 — we always want the wall-clock hour at
// the destination airport.

function computeFatigueMod(flight) {
  const delay = Number(flight?.arrival?.delay);
  if (!Number.isFinite(delay) || delay < 45) return 1.0;

  const scheduled = flight?.arrival?.scheduled;
  if (typeof scheduled !== "string") return 1.0;

  // Match the hour token immediately after the "T" separator.
  const match = scheduled.match(/T(\d{2}):/);
  if (!match) return 1.0;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour)) return 1.0;

  if (hour >= 21 || hour < 4) return 1.3;
  return 1.0;
}

const flightA_strandedPassenger = {
  arrival: {
    delay: 45,
    scheduled: "2026-05-21T22:30:00+00:00",
  },
};

const flightB_daytimeInconvenience = {
  arrival: {
    delay: 45,
    scheduled: "2026-05-21T14:00:00+00:00",
  },
};

const results = [];

function assert(label, actual, expected) {
  const pass = actual === expected;
  results.push({ label, actual, expected, pass });
  console.log(`${pass ? "PASS" : "FAIL"} | ${label} | actual=${actual} expected=${expected}`);
}

assert(
  "Flight A (delay 45m, 22:30 local) → 1.3x",
  computeFatigueMod(flightA_strandedPassenger),
  1.3
);

assert(
  "Flight B (delay 45m, 14:00 local) → 1.0x",
  computeFatigueMod(flightB_daytimeInconvenience),
  1.0
);

const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} assertion(s) failed.`);
  process.exit(1);
} else {
  console.log(`\nAll ${results.length} assertions passed.`);
}
