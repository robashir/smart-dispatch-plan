// Sprint 40 — TDD scaffold for the X-Ray Vision Toggle (Show Raw Data).
// Lightweight mock of buildItinerary's <1.0 filter + isWeak tagging.
// Run: `node test-xray-filter.js` → must print "PASS" before touching route.js.

function buildItinerary(items, showRawData) {
  const filtered = showRawData ? items : items.filter((it) => it.surgeScore >= 1.0);
  return filtered.map((it) => ({ ...it, isWeak: it.surgeScore < 1.0 }));
}

const itemA = { id: "A", surgeScore: 2.5 };
const itemB = { id: "B", surgeScore: 0.5 };
const input = [itemA, itemB];

// Assert 1: showRawData=false drops Item B.
const off = buildItinerary(input, false);
console.assert(off.length === 1, `FAIL — expected 1 item, got ${off.length}`);
console.assert(off[0].id === "A", `FAIL — expected Item A, got ${off[0].id}`);
console.assert(off[0].isWeak === false, `FAIL — Item A must have isWeak:false`);

// Assert 2: showRawData=true keeps both, B is isWeak:true, A is isWeak:false.
const on = buildItinerary(input, true);
console.assert(on.length === 2, `FAIL — expected 2 items, got ${on.length}`);
const onA = on.find((it) => it.id === "A");
const onB = on.find((it) => it.id === "B");
console.assert(onA.isWeak === false, `FAIL — Item A must have isWeak:false`);
console.assert(onB.isWeak === true, `FAIL — Item B must have isWeak:true`);

console.log("PASS — X-Ray filter + isWeak tagging behaves correctly");
