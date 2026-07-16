// Sprint 95 - Routine local anchor schedule validator.
// Mirrors the production schedule math for narrow peak windows plus
// 30-minute shoulders.

const YIELD_RATES = {
  local_anchor: 1,
};

const LOCAL_ANCHOR_SCHEDULES = [
  {
    name: "UAlbany Uptown Campus",
    days: [1, 2, 3, 4, 5],
    windows: [
      { start: 480, end: 525, expected: 8, label: "Morning Campus Arrival" },
      { start: 1245, end: 1290, expected: 6, label: "Evening Class Exit" },
    ],
  },
  {
    name: "Colonie Center / Wolf Road Corridor",
    days: [0, 1, 2, 3, 4, 5, 6],
    windows: [
      { start: 630, end: 675, expected: 5, label: "Hotel Checkout" },
      { start: 720, end: 765, expected: 5, label: "Lunch Movement" },
      { start: 1080, end: 1125, expected: 7, label: "Dinner / Retail Movement" },
      { start: 1275, end: 1320, expected: 6, label: "Retail Closing Pulse" },
    ],
  },
];

function mk(day, hour, minute = 0) {
  return new Date(Date.UTC(2026, 5, day, hour, minute));
}

function computeLocalAnchorPulse(anchor, dateObj) {
  if (!anchor || !(dateObj instanceof Date) || Number.isNaN(dateObj.getTime())) return null;
  const day = dateObj.getUTCDay();
  if (!Array.isArray(anchor.days) || !anchor.days.includes(day)) return null;

  const wallMinutes = dateObj.getUTCHours() * 60 + dateObj.getUTCMinutes();
  let best = null;
  for (const slot of anchor.windows || []) {
    const expected = Number(slot.expected) || 0;
    if (expected <= 0) continue;

    let factor = 0;
    let phase = null;
    if (wallMinutes >= slot.start && wallMinutes < slot.end) {
      factor = 1.0;
      phase = "Peak";
    } else if (wallMinutes >= slot.start - 30 && wallMinutes < slot.start) {
      factor = 0.6;
      phase = "Build";
    } else if (wallMinutes >= slot.end && wallMinutes < slot.end + 30) {
      factor = 0.6;
      phase = "Taper";
    }

    if (factor <= 0) continue;
    const activeExpected = Math.max(1, Math.round(expected * factor));
    if (!best || activeExpected > best.expected) {
      best = {
        expected: activeExpected,
        label: slot.label,
        phase,
      };
    }
  }
  return best;
}

function yieldRateFor(item) {
  const catsAll = Array.isArray(item.categories) ? item.categories.join("|") : "";
  if (/local anchor/i.test(catsAll)) return YIELD_RATES.local_anchor;
  return 50;
}

const colonie = LOCAL_ANCHOR_SCHEDULES[1];
const ualbany = LOCAL_ANCHOR_SCHEDULES[0];

const cases = [
  {
    name: "Hotel checkout shoulder before",
    anchor: colonie,
    date: mk(8, 10, 15),
    expect: { expected: 3, label: "Hotel Checkout", phase: "Build" },
  },
  {
    name: "Hotel checkout peak",
    anchor: colonie,
    date: mk(8, 10, 45),
    expect: { expected: 5, label: "Hotel Checkout", phase: "Peak" },
  },
  {
    name: "Hotel checkout shoulder after",
    anchor: colonie,
    date: mk(8, 11, 30),
    expect: { expected: 3, label: "Hotel Checkout", phase: "Taper" },
  },
  {
    name: "Hotel checkout inactive before shoulder",
    anchor: colonie,
    date: mk(8, 9, 59),
    expect: null,
  },
  {
    name: "UAlbany morning peak",
    anchor: ualbany,
    date: mk(8, 8, 15),
    expect: { expected: 8, label: "Morning Campus Arrival", phase: "Peak" },
  },
  {
    name: "UAlbany afternoon window removed",
    anchor: ualbany,
    date: mk(8, 16, 0),
    expect: null,
  },
];

const yieldCases = [
  {
    name: "Local anchor yield is literal",
    item: { categories: ["Local Anchor", "Hotel Checkout", "Peak"] },
    expect: 1,
  },
  {
    name: "Non-local event yield falls through",
    item: { categories: ["Music"] },
    expect: 50,
  },
];

let allPass = true;
console.log("=== Sprint 95 Local Anchor Schedule - Test Run ===\n");
for (const c of cases) {
  const got = computeLocalAnchorPulse(c.anchor, c.date);
  const ok = JSON.stringify(got) === JSON.stringify(c.expect);
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${JSON.stringify(c.expect)}\n  got      ${JSON.stringify(got)}`);
}
for (const c of yieldCases) {
  const got = yieldRateFor(c.item);
  const ok = got === c.expect;
  if (!ok) allPass = false;
  console.log(`${ok ? "PASS" : "FAIL"} - ${c.name}\n  expected ${c.expect}\n  got      ${got}`);
}
console.log("\n=== " + (allPass ? "ALL SCENARIOS PASS" : "FAILURES PRESENT") + " ===");
process.exit(allPass ? 0 : 1);
