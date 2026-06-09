// Sprint 80 - State Worker Commute Taper validator.
//
// Mirrors computeStateWorkerCommuteTaper from app/api/dispatch/route.js.
// UTC fields represent Albany wall-clock time, matching the dispatch route.

function computeStateWorkerCommuteTaper(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return { factor: 0, label: null };
  }
  const day = dateObj.getUTCDay();
  if (day < 1 || day > 5) return { factor: 0, label: null };

  const wallMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
  const windows = [
    { start: 975, end: 1005, factor: 1.0, label: "Peak Exit Wave" },
    { start: 1005, end: 1035, factor: 0.75, label: "Strong Exit Wave" },
    { start: 1035, end: 1065, factor: 0.5, label: "Fading Exit Wave" },
    { start: 1065, end: 1095, factor: 0.25, label: "Late Exit Tail" },
  ];
  const activeWindow = windows.find(
    (slot) => wallMinutes >= slot.start && wallMinutes < slot.end
  );
  return activeWindow
    ? { factor: activeWindow.factor, label: activeWindow.label }
    : { factor: 0, label: null };
}

function mk(day, hour, minute = 0) {
  // 2026-05-18 is Monday.
  return new Date(Date.UTC(2026, 4, day, hour, minute));
}

const cases = [
  { name: "Before evening wave", date: mk(18, 16, 14), factor: 0 },
  { name: "Peak start", date: mk(18, 16, 15), factor: 1.0 },
  { name: "Peak end inclusive minute", date: mk(18, 16, 44), factor: 1.0 },
  { name: "Strong wave start", date: mk(18, 16, 45), factor: 0.75 },
  { name: "Fading wave start", date: mk(18, 17, 15), factor: 0.5 },
  { name: "Late tail start", date: mk(18, 17, 45), factor: 0.25 },
  { name: "After tail", date: mk(18, 18, 15), factor: 0 },
  { name: "Weekend disabled", date: mk(23, 16, 30), factor: 0 },
];

let allPass = true;
console.log("=== Sprint 80 State Worker Taper - Test Run ===\n");
for (const c of cases) {
  const got = computeStateWorkerCommuteTaper(c.date);
  const expectedRides = Math.round(c.factor * 100);
  const gotRides = Math.round(got.factor * 100);
  const ok = got.factor === c.factor && gotRides === expectedRides;
  if (!ok) allPass = false;
  console.log(
    `${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected factor ${c.factor}, rides ${expectedRides}\n  got      factor ${got.factor}, rides ${gotRides}`
  );
}
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
