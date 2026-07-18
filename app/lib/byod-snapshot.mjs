import { normalizeAcademicSessionMode } from "./ualbany-demand.mjs";
import { mergeByodEventText } from "./byod-events.mjs";

export const BYOD_CONFIG_KEYS = [
  "trainConfigInbound",
  "trainConfigOutbound",
  "busConfigInbound",
  "flightConfigInbound",
  "flightConfigOutbound",
  "weatherConfig",
  "byodEventConfig",
  "academicSessionConfig",
];

const TRAIN_CONFIG_KEYS = new Set(["trainConfigInbound", "trainConfigOutbound"]);
const ACADEMIC_SESSION_KEY = "academicSessionConfig";
const BYOD_EVENT_KEY = "byodEventConfig";

function cleanUpdatedAt(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}

function cleanRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision >= 0 ? revision : 0;
}

function cleanTrainConfig(value) {
  if (!value || typeof value !== "object") {
    return { savedDate: null, trains: [], updatedAt: null, revision: 0 };
  }
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    trains: Array.isArray(value.trains) ? value.trains : [],
    updatedAt: cleanUpdatedAt(value.updatedAt),
    revision: cleanRevision(value.revision),
  };
}

function cleanRawTextConfig(value) {
  if (!value || typeof value !== "object") {
    return { savedDate: null, rawText: "", updatedAt: null, revision: 0 };
  }
  return {
    savedDate: typeof value.savedDate === "string" ? value.savedDate : null,
    rawText: typeof value.rawText === "string" ? value.rawText : "",
    updatedAt: cleanUpdatedAt(value.updatedAt),
    revision: cleanRevision(value.revision),
  };
}

function cleanAcademicSessionConfig(value) {
  return {
    mode: normalizeAcademicSessionMode(value?.mode),
    updatedAt: cleanUpdatedAt(value?.updatedAt),
    revision: cleanRevision(value?.revision),
  };
}

function cleanByodEventConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const eventsByDate = {};
  if (source.eventsByDate && typeof source.eventsByDate === "object") {
    for (const [date, rawText] of Object.entries(source.eventsByDate)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && typeof rawText === "string" && rawText.trim()) {
        eventsByDate[date] = rawText;
      }
    }
  }
  // Legacy snapshots used the upload day as the event day. Preserve that
  // data under its original date so schema migration never deletes it.
  if (
    /^\d{4}-\d{2}-\d{2}$/.test(String(source.savedDate || "")) &&
    typeof source.rawText === "string" &&
    source.rawText.trim() &&
    !eventsByDate[source.savedDate]
  ) {
    eventsByDate[source.savedDate] = source.rawText;
  }
  return {
    eventsByDate,
    updatedAt: cleanUpdatedAt(source.updatedAt),
    revision: cleanRevision(source.revision),
  };
}

export function cleanByodConfig(key, value) {
  if (TRAIN_CONFIG_KEYS.has(key)) return cleanTrainConfig(value);
  if (key === ACADEMIC_SESSION_KEY) return cleanAcademicSessionConfig(value);
  if (key === BYOD_EVENT_KEY) return cleanByodEventConfig(value);
  return cleanRawTextConfig(value);
}

export function mergeByodCategoryUpdate(key, currentValue, incomingValue, now) {
  const current = cleanByodConfig(key, currentValue);
  const incoming = cleanByodConfig(key, incomingValue);
  const revision = current.revision + 1;

  if (key === BYOD_EVENT_KEY) {
    const eventsByDate = { ...current.eventsByDate };
    for (const [date, rawText] of Object.entries(incoming.eventsByDate || {})) {
      eventsByDate[date] =
        incoming.revision < current.revision
          ? mergeByodEventText(rawText, eventsByDate[date] || "", date)
          : mergeByodEventText(eventsByDate[date] || "", rawText, date);
    }
    return { eventsByDate, updatedAt: now, revision };
  }

  return { ...incoming, updatedAt: now, revision };
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
  if (key === ACADEMIC_SESSION_KEY) return value.mode !== "auto";
  if (key === BYOD_EVENT_KEY) {
    return Object.values(value.eventsByDate || {}).some(
      (rawText) => typeof rawText === "string" && rawText.trim().length > 0
    );
  }
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
