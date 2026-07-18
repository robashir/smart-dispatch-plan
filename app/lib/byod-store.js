import { getStore } from "@netlify/blobs";
import {
  BYOD_CONFIG_KEYS,
  cleanByodConfig,
  mergeByodCategoryUpdate,
  normalizeByodSnapshot,
} from "./byod-snapshot.mjs";

const STORE_NAME = "smart-dispatch-byod";
const LATEST_KEY = "latest";
const META_KEY = "meta/latest";

function categoryKey(key) {
  return `categories/${key}`;
}

function getByodStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function saveByodSnapshot(updates) {
  const store = getByodStore();
  const incoming = updates && typeof updates === "object" ? updates : {};
  const legacy = normalizeByodSnapshot(
    (await store.get(LATEST_KEY, { type: "json" })) || {}
  );

  for (const key of BYOD_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(incoming, key)) continue;
    const stored = await store.get(categoryKey(key), { type: "json" });
    const current = stored || legacy[key];
    const now = new Date().toISOString();
    const merged = mergeByodCategoryUpdate(key, current, incoming[key], now);
    await store.setJSON(categoryKey(key), merged);
  }

  await store.setJSON(META_KEY, { savedAt: new Date().toISOString() });
  return readByodSnapshot();
}

export async function readByodSnapshot() {
  const store = getByodStore();
  const [legacyValue, meta, ...storedCategories] = await Promise.all([
    store.get(LATEST_KEY, { type: "json" }),
    store.get(META_KEY, { type: "json" }),
    ...BYOD_CONFIG_KEYS.map((key) =>
      store.get(categoryKey(key), { type: "json" })
    ),
  ]);
  const legacy = normalizeByodSnapshot(legacyValue || {});
  const snapshot = { ...legacy };
  BYOD_CONFIG_KEYS.forEach((key, index) => {
    const stored = storedCategories[index];
    if (stored) snapshot[key] = cleanByodConfig(key, stored);
  });
  const categoryTimes = BYOD_CONFIG_KEYS.map((key) => snapshot[key]?.updatedAt)
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const savedCandidates = [meta?.savedAt, legacy.savedAt]
    .filter(Boolean)
    .map((value) => Date.parse(value))
    .filter(Number.isFinite);
  const latestTime = Math.max(0, ...categoryTimes, ...savedCandidates);
  snapshot.savedAt = latestTime > 0 ? new Date(latestTime).toISOString() : null;
  return normalizeByodSnapshot(snapshot);
}

export { normalizeByodSnapshot };
