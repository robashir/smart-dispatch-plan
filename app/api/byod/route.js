import { readByodSnapshot, saveByodSnapshot } from "../../lib/byod-store";

function isSameOriginWrite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

function isSameOriginRead(request) {
  if (isSameOriginWrite(request)) return true;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-origin" || fetchSite === "same-site") return true;
  const referer = request.headers.get("referer");
  if (!referer) return false;
  try {
    return new URL(referer).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function GET(request) {
  try {
    if (!isSameOriginRead(request)) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const snapshot = await readByodSnapshot();
    return Response.json(
      { ok: true, snapshot },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("BYOD read failed:", err);
    return Response.json(
      { error: err.message || "Unable to read BYOD snapshot." },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    if (!isSameOriginWrite(request)) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const body = (await request.json()) || {};
    const updates = body.updates && typeof body.updates === "object" ? body.updates : body;
    const snapshot = await saveByodSnapshot(updates);
    return Response.json({ ok: true, snapshot });
  } catch (err) {
    console.error("BYOD save failed:", err);
    return Response.json(
      { error: err.message || "Unable to save BYOD snapshot." },
      { status: 500 }
    );
  }
}
