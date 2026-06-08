// Sprint 18 / 72 - Temporal Baseline Engine (TDD scaffolding)
//
// Standalone validator for computeTemporalModifiers. The implementation here
// mirrors app/api/dispatch/route.js so temporal scoring changes stay explicit.
//
// Contract: input Date's UTC fields represent the driver's wall-clock time
// (mirrors the Sprint 3.1 timezone trick - localStart is built the same way
// and reads via getUTCHours / getUTCDay). Output: { foodMod, rideMod }.

function computeTemporalModifiers(dateObj) {
  const day = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const hour = dateObj.getUTCHours();

  let foodMod = 1.0;
  let rideMod = 1.0;

  // Weekend Brunch Shoulder (Sat-Sun, 10:00 AM - 10:59 AM).
  if ((day === 6 || day === 0) && hour === 10) foodMod = 1.3;

  // Lunch Rush (Every day, 11:00 AM - 1:59 PM).
  if (hour >= 11 && hour <= 13) foodMod = 1.5;

  // Dinner Rush (Every day, 5:00 PM - 8:59 PM).
  if (hour >= 17 && hour <= 20) foodMod = 1.5;

  // Weekend Bar Rush (Fri & Sat, 10:00 PM - 1:59 AM next day).
  // Sprint 72: mild ride behavior boost only; explicit demand engines carry
  // the heavy ride scoring. Late-night food is softened, not crushed.
  if ((day === 5 || day === 6) && hour >= 22) {
    rideMod = 1.15;
    foodMod = 0.8;
  }
  if ((day === 6 || day === 0) && hour < 2) {
    rideMod = 1.15;
    foodMod = 0.8;
  }

  return { foodMod, rideMod };
}

// Pick a stable reference week so day-of-week is deterministic:
// 2026-05-17 is a Sunday. Mon=18, Tue=19, Wed=20, Thu=21, Fri=22, Sat=23.
function mk(y, mo, d, h, mi = 0) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi));
}

const cases = [
  {
    name: "Baseline - Wednesday 3:00 PM",
    date: mk(2026, 5, 20, 15, 0),
    expect: { foodMod: 1.0, rideMod: 1.0 },
  },
  {
    name: "Morning commute no longer double-counts rides - Monday 7:30 AM",
    date: mk(2026, 5, 18, 7, 30),
    expect: { foodMod: 1.0, rideMod: 1.0 },
  },
  {
    name: "Weekend brunch shoulder - Sunday 10:30 AM",
    date: mk(2026, 5, 17, 10, 30),
    expect: { foodMod: 1.3, rideMod: 1.0 },
  },
  {
    name: "Lunch rush - Saturday 12:30 PM",
    date: mk(2026, 5, 23, 12, 30),
    expect: { foodMod: 1.5, rideMod: 1.0 },
  },
  {
    name: "Evening commute no longer double-counts rides - Friday 4:30 PM",
    date: mk(2026, 5, 22, 16, 30),
    expect: { foodMod: 1.0, rideMod: 1.0 },
  },
  {
    name: "Dinner rush - Sunday 6:30 PM",
    date: mk(2026, 5, 17, 18, 30),
    expect: { foodMod: 1.5, rideMod: 1.0 },
  },
  {
    name: "Extended dinner rush - Wednesday 8:30 PM",
    date: mk(2026, 5, 20, 20, 30),
    expect: { foodMod: 1.5, rideMod: 1.0 },
  },
  {
    name: "Weekend bar rush late - Friday 11:00 PM",
    date: mk(2026, 5, 22, 23, 0),
    expect: { foodMod: 0.8, rideMod: 1.15 },
  },
  {
    name: "Weekend bar rush wrap - Saturday 1:00 AM",
    date: mk(2026, 5, 23, 1, 0),
    expect: { foodMod: 0.8, rideMod: 1.15 },
  },
];

let allPass = true;
console.log("=== Sprint 72 Temporal Rebalance - Test Run ===\n");
for (const c of cases) {
  const got = computeTemporalModifiers(c.date);
  const ok = got.foodMod === c.expect.foodMod && got.rideMod === c.expect.rideMod;
  if (!ok) allPass = false;
  console.log(
    `${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(got)}`
  );
}
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
