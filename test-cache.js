// Sprint 26 Phase 1 — Test-Driven Scaffolding for the TTL cache wrapper.
// Validates the withCache(key, ttlMinutes, fetchCallback) primitive in
// isolation BEFORE it is ported into app/api/dispatch/route.js.
//
// Run: node test-cache.js
// Expected: first call ~1000ms (executes the slow fetch), second call ~0ms
// (returns cached value without re-invoking the fetch).

const globalCache = new Map();

async function withCache(key, ttlMinutes, fetchCallback) {
  const now = Date.now();
  const entry = globalCache.get(key);
  if (entry && entry.expiresAt > now) {
    return entry.data;
  }
  const data = await fetchCallback();
  globalCache.set(key, { data, expiresAt: now + ttlMinutes * 60 * 1000 });
  return data;
}

let fetchInvocations = 0;
async function slowFetch() {
  fetchInvocations += 1;
  await new Promise((r) => setTimeout(r, 1000));
  return { payload: "external-data", builtAt: Date.now() };
}

(async () => {
  const KEY = "test_key";
  const TTL_MIN = 15;

  const t1 = Date.now();
  const r1 = await withCache(KEY, TTL_MIN, slowFetch);
  const d1 = Date.now() - t1;

  const t2 = Date.now();
  const r2 = await withCache(KEY, TTL_MIN, slowFetch);
  const d2 = Date.now() - t2;

  console.log(`First call:  ${d1}ms ->`, r1);
  console.log(`Second call: ${d2}ms ->`, r2);
  console.log(`Underlying fetch invocations: ${fetchInvocations}`);

  const failures = [];
  if (d1 < 950 || d1 > 1300) {
    failures.push(`first call took ${d1}ms, expected ~1000ms`);
  }
  if (d2 > 50) {
    failures.push(`second call took ${d2}ms, expected <50ms (cache hit)`);
  }
  if (r1 !== r2) {
    failures.push("cached object identity differs from first-call return");
  }
  if (fetchInvocations !== 1) {
    failures.push(`slowFetch ran ${fetchInvocations} times, expected 1`);
  }

  if (failures.length > 0) {
    console.error("\nFAIL:");
    for (const f of failures) console.error("  - " + f);
    process.exit(1);
  }
  console.log("\nPASS: all Sprint 26 cache assertions held.");
})();
