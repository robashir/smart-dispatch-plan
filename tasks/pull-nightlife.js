// Sprint 50 — Phase 1: The Automated Data Pull.
//
// Standalone Node script. Pulls the top 50 Albany, NY nightlife/bar venues
// from Yelp (sorted by review_count) and writes a "7-Day Matrix" dictionary
// to ./nightlife_dictionary.json at the repo root.
//
// Run: `node tasks/pull-nightlife.js`
// Then manually edit closingTimes[0..6] per venue before Phase 2.
// Day index: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env");
const OUT_PATH = path.join(ROOT, "nightlife_dictionary.json");

// Tiny .env loader so we don't pull in a dotenv dep for a one-shot script.
function loadEnv(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

async function main() {
  const env = loadEnv(ENV_PATH);
  const apiKey = env.YELP_API_KEY || process.env.YELP_API_KEY;
  if (!apiKey) {
    console.error("ERROR: YELP_API_KEY missing from .env and process.env.");
    process.exit(1);
  }

  const url = new URL("https://api.yelp.com/v3/businesses/search");
  url.searchParams.set("location", "Albany,NY");
  url.searchParams.set("categories", "nightlife,bars");
  url.searchParams.set("sort_by", "review_count");
  url.searchParams.set("limit", "50");

  console.log(`Fetching: ${url.toString()}`);
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`Yelp API ${res.status}:`, body.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();
  // L1 — defensive extraction.
  const businesses = Array.isArray(data?.businesses) ? data.businesses : [];
  if (!businesses.length) {
    console.error("Yelp returned 0 businesses. Raw shape keys:", Object.keys(data || {}));
    process.exit(1);
  }

  // 7-Day Matrix: key by day index (0 = Sunday ... 6 = Saturday).
  // Placeholder pattern mirrors the spec sample (Sun–Wed = 00:00, Thu–Sat = 02:00).
  // Driver MUST edit per-venue before Phase 2.
  const dictionary = businesses.map((b) => ({
    name: b.name || "Unknown",
    yelpId: b.id || "",
    lat: b.coordinates?.latitude ?? null,
    lng: b.coordinates?.longitude ?? null,
    closingTimes: {
      "0": "00:00",
      "1": "00:00",
      "2": "00:00",
      "3": "00:00",
      "4": "02:00",
      "5": "02:00",
      "6": "02:00",
    },
  }));

  fs.writeFileSync(OUT_PATH, JSON.stringify(dictionary, null, 2) + "\n", "utf8");
  console.log(`Wrote ${dictionary.length} venues -> ${OUT_PATH}`);
  console.log("Next: open the JSON, fill in real closingTimes[0..6] per venue (0=Sun, 6=Sat), then say 'Proceed to Phase 2'.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
