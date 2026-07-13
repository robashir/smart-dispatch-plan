export const BYOD_CONFIG_KEYS = [
  "trainConfigInbound",
  "trainConfigOutbound",
  "busConfigInbound",
  "flightConfigInbound",
  "weatherConfig",
];

const TRAIN_CONFIG_KEYS = new Set(["trainConfigInbound", "trainConfigOutbound"]);

function cleanUpdatedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function cleanTrainConfig(value) {
  if (!value || typeof value !== "object") {
    return { savedDate: null, trains: [], updatedAt: null };
  }
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    trains: Array.isArray(value.trains) ? value.trains : [],
    updatedAt: cleanUpdatedAt(value.updatedAt),
  };
}

function cleanRawTextConfig(value) {
  if (!value || typeof value !== "object") {
    return { savedDate: null, rawText: "", updatedAt: null };
  }
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    rawText: typeof value.rawText === "string" ? value.rawText : "",
    updatedAt: cleanUpdatedAt(value.updatedAt),
  };
}

export function cleanByodConfig(key, value) {
  return TRAIN_CONFIG_KEYS.has(key) ? cleanTrainConfig(value) : cleanRawTextConfig(value);
}

export function normalizeByodSnapshot(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    savedAt: cleanUpdatedAt(source.savedAt),
    ...Object.fromEntries(
      BYOD_CONFIG_KEYS.map((key) => [key, cleanByodConfig(key, source[key])])
    ),
  };
}

function configHasData(key, value) {
  if (!value || typeof value !== "object") return false;
  return TRAIN_CONFIG_KEYS.has(key)
    ? Array.isArray(value.trains) && value.trains.length > 0
    : typeof value.rawText === "string" && value.rawText.trim().length > 0;
}

function categoryTimestamp(snapshot, key) {
  const config = snapshot?.[key];
  const configTime = cleanUpdatedAt(config?.updatedAt);
  if (configTime) return Date.parse(configTime);
  const snapshotTime = cleanUpdatedAt(snapshot?.savedAt);
  return snapshotTime && configHasData(key, config) ? Date.parse(snapshotTime) : null;
}

export function mergeByodUpdates(currentValue, updatesValue, now = new Date().toISOString()) {
  const current = normalizeByodSnapshot(currentValue);
  const updates = updatesValue && typeof updatesValue === "object" ? updatesValue : {};
  const merged = { ...current, savedAt: now };

  for (const key of BYOD_CONFIG_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(updates, key)) continue;
    const incoming = cleanByodConfig(key, updates[key]);
    const suppliedTime = cleanUpdatedAt(incoming.updatedAt);
    incoming.updatedAt = suppliedTime || now;
    const currentTime = categoryTimestamp(current, key);
    const incomingTime = Date.parse(incoming.updatedAt);
    if (currentTime === null || incomingTime >= currentTime) merged[key] = incoming;
  }

  return merged;
}

export function reconcileByodSnapshots(localValue, cloudValue) {
  const local = normalizeByodSnapshot(localValue);
  const cloud = normalizeByodSnapshot(cloudValue);
  const snapshot = { ...cloud };
  const pendingUpdates = {};

  for (const key of BYOD_CONFIG_KEYS) {
    const localTime = categoryTimestamp(local, key);
    const cloudTime = categoryTimestamp(cloud, key);
    const localHasData = configHasData(key, local[key]);
    const cloudHasData = configHasData(key, cloud[key]);
    const localWins =
      (localTime !== null && (cloudTime === null || localTime > cloudTime)) ||
      (localTime === null && cloudTime === null && localHasData && !cloudHasData);

    if (localWins) {
      snapshot[key] = local[key];
      pendingUpdates[key] = local[key];
    }
  }

  return { snapshot, pendingUpdates };
}
