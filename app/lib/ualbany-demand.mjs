export const UALBANY_COORDS = { lat: 42.6868, lng: -73.8238 };
export const DOWNTOWN_ALBANY_COORDS = { lat: 42.6506, lng: -73.7529 };
export const PINE_HILLS_COORDS = { lat: 42.663, lng: -73.776 };

export const ACADEMIC_SESSION_MODES = new Set([
  "auto",
  "in-session",
  "out-of-session",
]);

// Regular semester-length instruction only. Summer and winter sessions are
// intentionally excluded because they do not support the normal campus-wide
// arrival/exit pulse. Dates follow UAlbany's official academic calendar.
export const UALBANY_REGULAR_TERMS = [
  {
    start: "2026-08-24",
    end: "2026-12-07",
    breaks: [
      ["2026-09-07", "2026-09-07"],
      ["2026-10-12", "2026-10-13"],
      ["2026-11-25", "2026-11-29"],
    ],
  },
  {
    start: "2027-01-20",
    end: "2027-05-04",
    breaks: [["2027-03-13", "2027-03-19"]],
  },
  {
    start: "2027-08-23",
    end: "2027-12-06",
    breaks: [
      ["2027-09-06", "2027-09-06"],
      ["2027-10-11", "2027-10-12"],
      ["2027-11-24", "2027-11-28"],
    ],
  },
  {
    start: "2028-01-19",
    end: "2028-05-02",
    breaks: [["2028-03-11", "2028-03-17"]],
  },
  {
    start: "2028-08-28",
    end: "2028-12-11",
    breaks: [
      ["2028-09-04", "2028-09-04"],
      ["2028-10-09", "2028-10-10"],
      ["2028-11-22", "2028-11-26"],
    ],
  },
  {
    start: "2029-01-17",
    end: "2029-05-01",
    breaks: [["2029-03-17", "2029-03-23"]],
  },
  {
    start: "2029-08-27",
    end: "2029-12-10",
    breaks: [
      ["2029-09-03", "2029-09-03"],
      ["2029-10-08", "2029-10-09"],
      ["2029-11-21", "2029-11-25"],
    ],
  },
];

const ACADEMIC_EVENT_POLICIES = [
  { pattern: /move[- ]?in|move[- ]?out/i, anchorKey: "ualbany", peakDemand: 35 },
  { pattern: /commencement/i, anchorKey: "ualbany", peakDemand: 40 },
  { pattern: /exodus|return/i, anchorKey: "ualbany", peakDemand: 20 },
  { pattern: /homecoming/i, anchorKey: "ualbany", peakDemand: 25 },
  { pattern: /halloweekend/i, anchorKey: "downtown", peakDemand: 20 },
  { pattern: /kegs\s*&\s*eggs/i, anchorKey: "pine-hills", peakDemand: 20 },
];

const ANCHORS = {
  ualbany: { location: "UAlbany Uptown Campus", ...UALBANY_COORDS },
  downtown: { location: "Downtown Albany", ...DOWNTOWN_ALBANY_COORDS },
  "pine-hills": { location: "Pine Hills Student Corridor", ...PINE_HILLS_COORDS },
};

export function normalizeAcademicSessionMode(value) {
  return ACADEMIC_SESSION_MODES.has(value) ? value : "auto";
}

function wallDateKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return [
    value.getUTCFullYear(),
    String(value.getUTCMonth() + 1).padStart(2, "0"),
    String(value.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function within(dateKey, start, end) {
  return dateKey >= start && dateKey <= end;
}

export function isUAlbanyRegularSession(value, mode = "auto") {
  const resolvedMode = normalizeAcademicSessionMode(mode);
  if (resolvedMode === "in-session") return true;
  if (resolvedMode === "out-of-session") return false;
  const dateKey = wallDateKey(value);
  if (!dateKey) return false;
  return UALBANY_REGULAR_TERMS.some(
    (term) =>
      within(dateKey, term.start, term.end) &&
      !(term.breaks || []).some(([start, end]) => within(dateKey, start, end))
  );
}

export function academicEventPolicy(name, entry = {}) {
  if (String(entry?.type).toLowerCase() !== "academic") return null;
  const policy = ACADEMIC_EVENT_POLICIES.find(({ pattern }) => pattern.test(String(name)));
  const anchorKey = policy?.anchorKey || "ualbany";
  const anchor = ANCHORS[anchorKey];
  return {
    anchorKey,
    peakDemand: policy?.peakDemand || 20,
    location: `${anchor.location} — ${name}`,
    lat: anchor.lat,
    lng: anchor.lng,
  };
}

export function isUAlbanyNode(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lng = Number(value?.lng ?? value?.longitude);
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat - UALBANY_COORDS.lat) <= 0.012 &&
    Math.abs(lng - UALBANY_COORDS.lng) <= 0.015
  );
}
