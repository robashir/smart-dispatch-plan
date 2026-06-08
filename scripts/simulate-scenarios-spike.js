// Sprint 68.5: Simulator Spike — Raw Yield Math.
//
// Time-boxed Spike to evaluate `score = volume × yield × modifiers` (no
// capacity normalization) against the 6 Sprint 68 scenarios. Addresses L11
// without touching production code.
//
// Imports `yieldRateFor`, `computeWeatherModifiers`, `computeTemporalModifiers`
// from app/api/dispatch/route.js so the yield table + mod functions stay
// in lockstep with production. `densityScore` and `capacityFor` are
// intentionally NOT imported — capacity is gone for this spike.
//
// Output: density-report-spike.csv (per-item rows, Excel-formula Total Score)
// at project root. Sprint 68's density-report.csv stays untouched for diff.
//
// Run: `node scripts/simulate-scenarios-spike.js` from project root.

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ROUTE_URL = "file://" + path.join(ROOT, "app", "api", "dispatch", "route.js").replace(/\\/g, "/");
const OUTPUT = path.join(ROOT, "density-report-spike.csv");

(async () => {
  // Note: NOT importing densityScore or capacityFor — capacity is dead for
  // this spike per Sprint 68.5 §3A.
  const {
    yieldRateFor,
    computeWeatherModifiers,
    computeTemporalModifiers,
  } = await import(ROUTE_URL);

  // ---- Scenarios (same shape as Sprint 68 for diff parity) ----
  const wallClock = (year, monthIdx, day, hour, minute = 0) =>
    new Date(Date.UTC(year, monthIdx, day, hour, minute));

  const clearWeather = [
    { tempF: 68, precipChancePct: 0, precipInches: 0 },
    { tempF: 68, precipChancePct: 0, precipInches: 0 },
  ];
  const blizzard = [
    { tempF: 22, precipChancePct: 100, precipInches: 0.8 },
    { tempF: 21, precipChancePct: 100, precipInches: 0.9 },
  ];

  const soloFlightItem = {
    type: "flight",
    volume: 1,
    hub: "ALB",
    description: "Solo flight from ALB",
  };
  const trainItem = {
    type: "train",
    volume: 1,
    hub: "Rensselaer",
    description: "Amtrak arrival at Rensselaer",
  };
  const lastCallNightlifeItem = {
    type: "event",
    volume: 1,
    location: "Downtown Bar Cluster",
    categories: ["Last Call", "Nightlife Egress"],
    egressMod: 3.5,
    description: "Last Call nightlife egress (egressMod 3.5x baked into yield)",
  };
  const mvpArenaEgressItem = {
    type: "event",
    volume: 1,
    location: "MVP Arena",
    categories: ["Sports"],
    egressMod: 2.5,
    description: "MVP Arena egress (mega_event, 15k stadium)",
  };

  const scenarios = [
    {
      name: "Calm Tuesday",
      dispatchDate: wallClock(2026, 5, 2, 14, 0),
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [soloFlightItem],
    },
    {
      name: "Friday Bar Rush",
      dispatchDate: wallClock(2026, 5, 5, 23, 30),
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [lastCallNightlifeItem],
    },
    {
      name: "MVP Arena Egress",
      dispatchDate: wallClock(2026, 5, 6, 22, 0),
      weatherArray: clearWeather,
      holidayMod: 1.0,
      items: [mvpArenaEgressItem],
    },
    {
      name: "Severe Winter Snowstorm",
      dispatchDate: wallClock(2026, 1, 3, 14, 0),
      weatherArray: blizzard,
      holidayMod: 1.0,
      items: [soloFlightItem],
    },
    {
      name: "Thanksgiving Eve",
      dispatchDate: wallClock(2026, 10, 25, 18, 0),
      weatherArray: clearWeather,
      holidayMod: 1.5,
      items: [soloFlightItem],
    },
    {
      name: "The Perfect Storm",
      dispatchDate: wallClock(2026, 1, 7, 22, 0),
      weatherArray: blizzard,
      holidayMod: 1.0,
      items: [mvpArenaEgressItem, trainItem, trainItem],
    },
  ];

  // ---- Mod-side picker: ride for transit/event/ride; food for food/grocery.
  const isFoodSide = (it) => it.type === "food" || it.type === "grocery";

  // ---- Build per-item rows ----
  const round4 = (n) => Math.round(n * 10000) / 10000;
  const round2 = (n) => Math.round(n * 100) / 100;

  // CSV quoting: wrap any cell containing a comma, quote, or newline in
  // double quotes and escape internal quotes by doubling them.
  const csvEscape = (cell) => {
    const s = String(cell);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const headers = [
    "Scenario",
    "Item Description",
    "Item Type",
    "Volume",
    "Yield Rate",
    "Temporal Mod",
    "Weather Mod",
    "Holiday Mod",
    "Total Score",
  ];

  const rows = [];
  for (const sc of scenarios) {
    const { foodMod: tFood, rideMod: tRide } = computeTemporalModifiers(sc.dispatchDate);
    const { weatherFoodMod, weatherRideMod } = computeWeatherModifiers(sc.weatherArray);

    for (const it of sc.items) {
      const useFood = isFoodSide(it);
      const tempMod = useFood ? tFood : tRide;
      const wxMod = useFood ? weatherFoodMod : weatherRideMod;
      const yieldRate = yieldRateFor(it);
      const volume = Number(it.volume) || 0;

      rows.push({
        scenario: sc.name,
        description: it.description || it.location || it.type,
        type: it.type,
        volume,
        yieldRate: round4(yieldRate),
        tempMod: round4(tempMod),
        wxMod: round4(wxMod),
        holidayMod: round4(sc.holidayMod),
        scriptComputedTotal: round2(volume * yieldRate * tempMod * wxMod * sc.holidayMod),
      });
    }
  }

  // ---- Emit CSV with formula-string Total column ----
  // Excel evaluates any CSV cell whose value starts with `=` as a live
  // formula. Row index in Excel = (array index + 2) — header is row 1.
  // Total formula refs: D=Volume, E=Yield, F=Temporal, G=Weather, H=Holiday.
  const lines = [headers.map(csvEscape).join(",")];
  rows.forEach((r, idx) => {
    const excelRow = idx + 2;
    const formula = `=D${excelRow}*E${excelRow}*F${excelRow}*G${excelRow}*H${excelRow}`;
    lines.push(
      [
        r.scenario,
        r.description,
        r.type,
        r.volume,
        r.yieldRate,
        r.tempMod,
        r.wxMod,
        r.holidayMod,
        formula,
      ]
        .map(csvEscape)
        .join(",")
    );
  });

  fs.writeFileSync(OUTPUT, lines.join("\n") + "\n", "utf8");

  // ---- Sanity trace (so the PO can spot-check script vs formula) ----
  console.log("Raw-yield spike — per-item breakdown:");
  console.log("  scenario | item | vol × yield × temp × wx × holiday = total");
  for (const r of rows) {
    console.log(
      `  ${r.scenario} | ${r.description} | ${r.volume} × ${r.yieldRate} × ${r.tempMod} × ${r.wxMod} × ${r.holidayMod} = ${r.scriptComputedTotal}`
    );
  }
  console.log(`\nWrote ${OUTPUT} (${rows.length} item rows).`);
})().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
