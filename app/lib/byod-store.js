import { getStore } from "@netlify/blobs";

const STORE_NAME = "smart-dispatch-byod";
const LATEST_KEY = "latest";

function cleanTrainConfig(value) {
  if (!value || typeof value !== "object") return { savedDate: null, trains: [] };
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    trains: Array.isArray(value.trains) ? value.trains : [],
  };
}

function cleanRawTextConfig(value) {
  if (!value || typeof value !== "object") return { savedDate: null, rawText: "" };
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    rawText: typeof value.rawText === "string" ? value.rawText : "",
  };
}

export function normalizeByodSnapshot(value = {}) {
  return {
    savedAt: typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString(),
    trainConfigInbound: cleanTrainConfig(value.trainConfigInbound),
    trainConfigOutbound: cleanTrainConfig(value.trainConfigOutbound),
    busConfigInbound: cleanRawTextConfig(value.busConfigInbound),
    flightConfigInbound: cleanRawTextConfig(value.flightConfigInbound),
  };
}

function getByodStore() {
  return getStore(STORE_NAME);
}

export async function saveByodSnapshot(snapshot) {
  const store = getByodStore();
  const clean = normalizeByodSnapshot({
    ...snapshot,
    savedAt: new Date().toISOString(),
  });
  await store.setJSON(LATEST_KEY, clean);
  return clean;
}

export async function readByodSnapshot() {
  const store = getByodStore();
  const snapshot = await store.get(LATEST_KEY, { type: "json" });
  return snapshot ? normalizeByodSnapshot(snapshot) : null;
}
