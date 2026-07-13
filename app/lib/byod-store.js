import { getStore } from "@netlify/blobs";
import {
  mergeByodUpdates,
  normalizeByodSnapshot,
} from "./byod-snapshot.mjs";

const STORE_NAME = "smart-dispatch-byod";
const LATEST_KEY = "latest";

function getByodStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function saveByodSnapshot(updates) {
  const store = getByodStore();
  const current = await store.get(LATEST_KEY, { type: "json" });
  const merged = mergeByodUpdates(current, updates);
  await store.setJSON(LATEST_KEY, merged);
  return merged;
}

export async function readByodSnapshot() {
  const store = getByodStore();
  const snapshot = await store.get(LATEST_KEY, { type: "json" });
  return snapshot ? normalizeByodSnapshot(snapshot) : null;
}

export { normalizeByodSnapshot };
