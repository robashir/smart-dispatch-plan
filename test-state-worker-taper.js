// Sprint 113 - State Worker Commute Taper validator.

const STATE_WORKER_EVENING_TAPER = [
  { start: 960, end: 990, factor: 1.0, label: "Peak Exit Wave" },
  { start: 990, end: 1020, factor: 0.65, label: "Strong Exit Wave" },
  { start: 1020, end: 1040, factor: 0.35, label: "Fading Exit Wave" },
];

function computeStateWorkerCommuteTaper(dateObj) {
  if (!(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) {
    return { factor: 0, label: null };
  }
  const day = dateObj.getUTCDay();
  if (day < 1 || day > 5) return { factor: 0, label: null };

  const wallMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
  const activeWindow = STATE_WORKER_EVENING_TAPER.find(
    (slot) => wallMinutes >= slot.start && wallMinutes < slot.end
  );
  return activeWindow
    ? { factor: activeWindow.factor, label: activeWindow.label }
    : { factor: 0, label: null };
}

function at(day, hh, mm) {
  return new Date(Date.UTC(2026, 5, day, hh, mm, 0));
}

const cases = [
  ["Before pulse", at(12, 15, 59), 0, null],
  ["Peak starts at 4:00", at(12, 16, 0), 1.0, "Peak Exit Wave"],
  ["Peak ends before 4:30", at(12, 16, 29), 1.0, "Peak Exit Wave"],
  ["Strong starts at 4:30", at(12, 16, 30), 0.65, "Strong Exit Wave"],
  ["Fading starts at 5:00", at(12, 17, 0), 0.35, "Fading Exit Wave"],
  ["Gone at 5:20", at(12, 17, 20), 0, null],
  ["Weekend off", at(14, 16, 15), 0, null],
];

let allPass = true;
console.log("=== Sprint 113 State Worker Taper - Test Run ===\n");
for (const [name, date, expectedFactor, expectedLabel] of cases) {
  const got = computeStateWorkerCommuteTaper(date);
  const ok = got.factor === expectedFactor && got.label === expectedLabel;
  if (!ok) allPass = false;
  console.log(
    `${ok ? "PASS" : "FAIL"} - ${name}\n  expected ${expectedFactor} / ${expectedLabel}\n  got      ${got.factor} / ${got.label}`
  );
}

console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
