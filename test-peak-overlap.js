// Sprint 66 — TDD scaffold for the Peak Overlap Engine (Golden Half-Hour).
// Proves `findPeakSurgeWindow` correctly sweeps a 30-minute sliding window
// in 15-minute increments across an itinerary, sums densityScore per block,
// surfaces the winning window, and extracts the top 2-3 contributors.
//
// Run with: node test-peak-overlap.js
// Must exit with 0 failures BEFORE any edit to route.js or frontend files.

// --- Inlined siblings from route.js (kept identical so the helper math
//     can be ported byte-for-byte). parseTimeLabel + formatTimeLabel are
//     the same primitives the production helper will reuse. ---
function parseTimeLabel(label) {
  if (!label || typeof label !== "string") return Infinity;
  const m = label.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!m) return Infinity;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  return h * 60 + min;
}
function formatTimeLabel(minutes) {
  if (!Number.isFinite(minutes)) return null;
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h24 = Math.floor(wrapped / 60);
  const mm = wrapped % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

// --- The unit under test ---
function itemLabel(it) {
  return it?.location || it?.hub || it?.type || "Unknown";
}
function findPeakSurgeWindow(itinerary) {
  if (!Array.isArray(itinerary) || itinerary.length === 0) return null;

  const withTime = [];
  const noTime = [];
  for (const it of itinerary) {
    const ds = Number(it?.densityScore);
    if (!Number.isFinite(ds) || ds <= 0) continue;
    const label = it.leaveBy || it.hourBucket;
    const t = parseTimeLabel(label);
    if (Number.isFinite(t)) withTime.push({ item: it, t });
    else noTime.push(it);
  }

  if (withTime.length === 0 && noTime.length === 0) return null;

  if (withTime.length === 0) {
    const total = noTime.reduce((s, it) => s + (Number(it.densityScore) || 0), 0);
    const top = [...noTime]
      .sort((a, b) => (Number(b.densityScore) || 0) - (Number(a.densityScore) || 0))
      .slice(0, 3)
      .map(itemLabel);
    return { timeWindow: "Current / Ongoing", totalDensity: Math.round(total), topContributors: top };
  }

  const rawTimes = withTime.map((x) => x.t);
  const spans = Math.max(...rawTimes) - Math.min(...rawTimes) > 720;
  const norm = withTime.map(({ item, t }) => ({
    item,
    t: spans && t < 360 ? t + 1440 : t,
  }));

  const minT = Math.min(...norm.map((x) => x.t));
  const maxT = Math.max(...norm.map((x) => x.t));

  let best = null;
  for (let start = minT; start <= maxT; start += 15) {
    const end = start + 30;
    const inside = norm.filter((x) => x.t >= start && x.t < end).map((x) => x.item);
    const items = start === minT ? [...noTime, ...inside] : inside;
    if (items.length === 0) continue;
    const total = items.reduce((s, it) => s + (Number(it.densityScore) || 0), 0);
    if (!best || total > best.total) {
      best = { start, end, total, items };
    }
  }
  if (!best) return null;

  const top = [...best.items]
    .sort((a, b) => (Number(b.densityScore) || 0) - (Number(a.densityScore) || 0))
    .slice(0, 3)
    .map(itemLabel);

  return {
    timeWindow: `${formatTimeLabel(best.start)} - ${formatTimeLabel(best.end)}`,
    totalDensity: Math.round(best.total),
    topContributors: top,
  };
}

// --- Assertion harness ---
const results = [];
function assert(label, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  results.push({ label, pass });
  console.log(
    `${pass ? "PASS" : "FAIL"} | ${label} | actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`
  );
}

// === 1. Tightly-packed overlap — three items 15 min apart ===
// A 11:15 PM (1395) 200, B 11:30 PM (1410) 150, C 11:45 PM (1425) 100.
// [11:15, 11:45) → A + B = 350 (winner).
// [11:30, 12:00) → B + C = 250.
// [11:00, 11:30) → A = 200.
// brief-example match: { timeWindow: "11:15 PM - 11:45 PM", totalDensity: 350 }.
{
  const itin = [
    { type: "event", location: "MVP Arena Egress", leaveBy: "11:15 PM", densityScore: 200 },
    { type: "train", hub: "Rensselaer Train 284", hourBucket: "11:30 PM", densityScore: 150 },
    { type: "event", location: "Last Call Bars", leaveBy: "11:45 PM", densityScore: 100 },
  ];
  const out = findPeakSurgeWindow(itin);
  assert("Tight overlap winner is 11:15 PM - 11:45 PM, density 350", out.timeWindow, "11:15 PM - 11:45 PM");
  assert("Tight overlap totalDensity = 350", out.totalDensity, 350);
  assert(
    "Tight overlap top contributors sorted desc",
    out.topContributors,
    ["MVP Arena Egress", "Rensselaer Train 284"]
  );
}

// === 2. 15-min slide correctness — items 15 min apart, the winner is the
//        block where the two largest stack, not the chronologically first. ===
{
  const itin = [
    { type: "event", location: "Small", leaveBy: "8:00 PM", densityScore: 20 },
    { type: "event", location: "Big1",  leaveBy: "8:30 PM", densityScore: 100 },
    { type: "event", location: "Big2",  leaveBy: "8:45 PM", densityScore: 120 },
  ];
  // [8:00,8:30) → 20
  // [8:15,8:45) → 100
  // [8:30,9:00) → 100 + 120 = 220 (winner)
  // [8:45,9:15) → 120
  const out = findPeakSurgeWindow(itin);
  assert("Slide picks the stacked window, not the chronological first", out.timeWindow, "8:30 PM - 9:00 PM");
  assert("Slide-stacked totalDensity = 220", out.totalDensity, 220);
  assert("Slide-stacked contributors", out.topContributors, ["Big2", "Big1"]);
}

// === 3. Cross-midnight wrap — items at 11:45 PM and 12:00 AM. ===
{
  const itin = [
    { type: "event", location: "PreMidnight", leaveBy: "11:45 PM", densityScore: 60 },
    { type: "event", location: "PostMidnight", leaveBy: "12:00 AM", densityScore: 80 },
    { type: "event", location: "PostMidnight2", leaveBy: "12:15 AM", densityScore: 40 },
  ];
  // Spread 1425 → (0 + 1440)=1440 → 1455. Spread > 720 → shift early times +1440.
  // Times: 1425, 1440, 1455.
  // [1425,1455) → 60 + 80 = 140 (winner)
  // [1440,1470) → 80 + 40 = 120
  const out = findPeakSurgeWindow(itin);
  assert("Cross-midnight window label uses formatTimeLabel wrap", out.timeWindow, "11:45 PM - 12:15 AM");
  assert("Cross-midnight totalDensity = 140", out.totalDensity, 140);
}

// === 4. noTime items contribute to the earliest window only ===
{
  const itin = [
    { type: "food", location: "Ongoing Hub", densityScore: 50 }, // no time → earliest only
    { type: "event", location: "Early", leaveBy: "9:00 PM", densityScore: 30 },
    { type: "event", location: "Late",  leaveBy: "10:00 PM", densityScore: 200 },
  ];
  // Earliest window [9:00,9:30) = Ongoing(50) + Early(30) = 80
  // [9:45,10:15) and [10:00,10:30) both contain only Late(200) — tied.
  // Tie-break rule: earliest qualifying window wins → 9:45 PM - 10:15 PM.
  // The "no leak" guarantee is proved by totalDensity = 200 (NOT 250).
  const out = findPeakSurgeWindow(itin);
  assert("Late window wins, earliest-on-tie pick is 9:45 PM", out.timeWindow, "9:45 PM - 10:15 PM");
  assert("Late window totalDensity = 200 (no leak from ongoing)", out.totalDensity, 200);
  assert("Late window contributors only Late", out.topContributors, ["Late"]);
}

// === 5. noTime items DO count toward the earliest window when they
//        out-score a single scheduled item later. ===
{
  const itin = [
    { type: "food", location: "BigOngoing", densityScore: 500 },
    { type: "event", location: "ScheduledA", leaveBy: "9:00 PM", densityScore: 60 },
    { type: "event", location: "ScheduledB", leaveBy: "10:00 PM", densityScore: 70 },
  ];
  // Earliest window [9:00,9:30) = BigOngoing(500) + ScheduledA(60) = 560 (winner).
  const out = findPeakSurgeWindow(itin);
  assert("Ongoing item rides the earliest window", out.timeWindow, "9:00 PM - 9:30 PM");
  assert("Ongoing+scheduled total = 560", out.totalDensity, 560);
  assert(
    "Top contributors sorted: BigOngoing first",
    out.topContributors,
    ["BigOngoing", "ScheduledA"]
  );
}

// === 6. Top contributors capped at 3 ===
{
  const itin = [
    { type: "event", location: "A", leaveBy: "8:00 PM", densityScore: 100 },
    { type: "event", location: "B", leaveBy: "8:00 PM", densityScore: 90 },
    { type: "event", location: "C", leaveBy: "8:15 PM", densityScore: 80 },
    { type: "event", location: "D", leaveBy: "8:15 PM", densityScore: 70 },
    { type: "event", location: "E", leaveBy: "8:15 PM", densityScore: 60 },
  ];
  // [8:00,8:30) → all five = 400 (winner)
  const out = findPeakSurgeWindow(itin);
  assert("Top contributors capped at 3", out.topContributors.length, 3);
  assert("Top three are A, B, C", out.topContributors, ["A", "B", "C"]);
  assert("Cap window totalDensity = 400", out.totalDensity, 400);
}

// === 7. Empty / all-zero / null inputs return null ===
assert("Null input → null", findPeakSurgeWindow(null), null);
assert("Empty array → null", findPeakSurgeWindow([]), null);
assert(
  "All-zero density items → null",
  findPeakSurgeWindow([
    { type: "event", location: "Z", leaveBy: "8:00 PM", densityScore: 0 },
  ]),
  null
);
assert(
  "Items with non-finite density skipped → null",
  findPeakSurgeWindow([
    { type: "event", location: "X", leaveBy: "8:00 PM", densityScore: NaN },
  ]),
  null
);

// === 8. Single timed item produces a one-window result (smoke test) ===
{
  const out = findPeakSurgeWindow([
    { type: "event", location: "Solo", leaveBy: "5:00 PM", densityScore: 88 },
  ]);
  assert("Single item window label", out.timeWindow, "5:00 PM - 5:30 PM");
  assert("Single item totalDensity", out.totalDensity, 88);
  assert("Single item contributor", out.topContributors, ["Solo"]);
}

// === 9. All-ongoing (no times anywhere) returns a Current / Ongoing block ===
{
  const out = findPeakSurgeWindow([
    { type: "food", location: "Hub1", densityScore: 40 },
    { type: "food", location: "Hub2", densityScore: 30 },
  ]);
  assert("All-ongoing timeWindow label", out.timeWindow, "Current / Ongoing");
  assert("All-ongoing totalDensity sums", out.totalDensity, 70);
  assert("All-ongoing contributors sorted desc", out.topContributors, ["Hub1", "Hub2"]);
}

// === 10. Helper does NOT enforce the 50% banner threshold — that's the
//         frontend's job. A low-total result is still returned. ===
{
  const out = findPeakSurgeWindow([
    { type: "event", location: "Tiny", leaveBy: "3:00 PM", densityScore: 12 },
  ]);
  assert("Low-total result still returned (banner enforces threshold)", out.totalDensity, 12);
}

// === Summary ===
const failed = results.filter((r) => !r.pass);
console.log(`\n=== Sprint 66 peak-overlap tests: ${results.length - failed.length}/${results.length} PASS ===`);
if (failed.length > 0) {
  console.log("FAILED:");
  for (const r of failed) console.log(`  - ${r.label}`);
  process.exit(1);
}
