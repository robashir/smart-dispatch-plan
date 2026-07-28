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
  "holidayAcademicCalendarConfig",
];

const TRAIN_CONFIG_KEYS = new Set(["trainConfigInbound", "trainConfigOutbound"]);
const ACADEMIC_SESSION_KEY = "academicSessionConfig";
const BYOD_EVENT_KEY = "byodEventConfig";
const HOLIDAY_ACADEMIC_CALENDAR_KEY = "holidayAcademicCalendarConfig";

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

function cleanHolidayAcademicCalendarConfig(value) {
  const source = value && typeof value === "object" ? value : {};
  const events = {};
  const entryUpdatedAt = {};
  if (source.events && typeof source.events === "object") {
    for (const [name, entry] of Object.entries(source.events)) {
      if (name.trim() && entry && typeof entry === "object" && !Array.isArray(entry)) {
        events[name] = { ...entry };
      }
    }
  }
  if (source.entryUpdatedAt && typeof source.entryUpdatedAt === "object") {
    for (const [name, value] of Object.entries(source.entryUpdatedAt)) {
      const timestamp = cleanUpdatedAt(value);
      if (timestamp && Object.prototype.hasOwnProperty.call(events, name)) {
        entryUpdatedAt[name] = timestamp;
      }
    }
  }
  return {
    events,
    entryUpdatedAt,
    updatedAt: cleanUpdatedAt(source.updatedAt),
    revision: cleanRevision(source.revision),
  };
}

export function cleanByodConfig(key, value) {
  if (TRAIN_CONFIG_KEYS.has(key)) return cleanTrainConfig(value);
  if (key === ACADEMIC_SESSION_KEY) return cleanAcademicSessionConfig(value);
  if (key === BYOD_EVENT_KEY) return cleanByodEventConfig(value);
  if (key === HOLIDAY_ACADEMIC_CALENDAR_KEY) {
    return cleanHolidayAcademicCalendarConfig(value);
  }
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

  if (key === HOLIDAY_ACADEMIC_CALENDAR_KEY) {
    const events = { ...current.events };
    const entryUpdatedAt = { ...current.entryUpdatedAt };
    for (const [name, entry] of Object.entries(incoming.events || {})) {
      const currentTime = cleanUpdatedAt(current.entryUpdatedAt?.[name]);
      const incomingTime = cleanUpdatedAt(incoming.entryUpdatedAt?.[name]);
      const shouldApply =
        !Object.prototype.hasOwnProperty.call(events, name) ||
        (incomingTime &&
          (!currentTime || Date.parse(incomingTime) >= Date.parse(currentTime)));
      if (!shouldApply) continue;
      events[name] = entry;
      if (incomingTime) entryUpdatedAt[name] = incomingTime;
    }
    return { events, entryUpdatedAt, updatedAt: now, revision };
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
  if (key === HOLIDAY_ACADEMIC_CALENDAR_KEY) {
    return Object.keys(value.events || {}).length > 0;
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
    if (key === HOLIDAY_ACADEMIC_CALENDAR_KEY) {
      const localCalendar = local[key];
      const cloudCalendar = cloud[key];
      const events = { ...cloudCalendar.events };
      const entryUpdatedAt = { ...cloudCalendar.entryUpdatedAt };
      const pendingEvents = {};
      const pendingEntryUpdatedAt = {};

      for (const [name, entry] of Object.entries(localCalendar.events || {})) {
        const localTime = cleanUpdatedAt(localCalendar.entryUpdatedAt?.[name]);
        const cloudTime = cleanUpdatedAt(cloudCalendar.entryUpdatedAt?.[name]);
        const localWins =
          !Object.prototype.hasOwnProperty.call(cloudCalendar.events, name) ||
          (localTime &&
            (!cloudTime || Date.parse(localTime) > Date.parse(cloudTime)));
        if (!localWins) continue;
        events[name] = entry;
        pendingEvents[name] = entry;
        if (localTime) {
          entryUpdatedAt[name] = localTime;
          pendingEntryUpdatedAt[name] = localTime;
        }
      }

      const localCategoryTime = categoryTimestamp(local, key);
      const cloudCategoryTime = categoryTimestamp(cloud, key);
      const latestCategoryTime = Math.max(
        localCategoryTime || 0,
        cloudCategoryTime || 0
      );
      snapshot[key] = {
        events,
        entryUpdatedAt,
        updatedAt:
          latestCategoryTime > 0
            ? new Date(latestCategoryTime).toISOString()
            : null,
        revision: Math.max(localCalendar.revision, cloudCalendar.revision),
      };
      if (Object.keys(pendingEvents).length > 0) {
        pendingUpdates[key] = {
          events: pendingEvents,
          entryUpdatedAt: pendingEntryUpdatedAt,
          updatedAt: localCalendar.updatedAt,
          revision: localCalendar.revision,
        };
      }
      continue;
    }

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
