export const DEMAND_FIRST_AREAS = [
  { key: "downtown", label: "Downtown" },
  { key: "uptown", label: "Uptown" },
  { key: "other", label: "Other Areas" },
];

export const DEFAULT_DEMAND_FIRST_AREA_FILTERS = Object.freeze({
  downtown: true,
  uptown: true,
  other: true,
});

function itemSearchText(item) {
  return [
    item?.location,
    item?.hub,
    item?.destination,
    ...(Array.isArray(item?.categories) ? item.categories : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function demandFirstAreaFor(item) {
  const text = itemSearchText(item);

  // Rensselaer Station is intentionally grouped with Downtown for the
  // driver's operating view, even though it sits across the Hudson River.
  if (
    /rensselaer|albany med\s*&\s*st\.? peter'?s hospitals|empire state plaza|mvp arena|palace theatre|the egg|empire live|downtown bus terminal|trailways|greyhound|city beer hall|mcgeary|lark street|downtown albany/.test(
      text
    )
  ) {
    return "downtown";
  }

  if (/albany med|st\.? peter|hospital|\balb\b|airport|colonie|wolf road/.test(text)) {
    return "other";
  }

  if (
    /ualbany|university at albany|harriman|crossgates|western avenue|washington avenue extension|uptown/.test(
      text
    )
  ) {
    return "uptown";
  }

  const lat = Number(item?.lat);
  const lng = Number(item?.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    if (lat < 42.68 && lng > -73.79) return "downtown";
    if (lng <= -73.79 && lat >= 42.63 && lat <= 42.72) return "uptown";
  }

  return "other";
}

export function normalizeDemandFirstAreaFilters(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    DEMAND_FIRST_AREAS.map(({ key }) => [
      key,
      typeof source[key] === "boolean"
        ? source[key]
        : DEFAULT_DEMAND_FIRST_AREA_FILTERS[key],
    ])
  );
}
