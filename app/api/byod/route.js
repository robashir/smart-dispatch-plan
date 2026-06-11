import { saveByodSnapshot } from "../../lib/byod-store";

function isSameOriginWrite(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    if (!isSameOriginWrite(request)) {
      return Response.json({ error: "Forbidden." }, { status: 403 });
    }
    const body = (await request.json()) || {};
    const snapshot = await saveByodSnapshot(body);
    return Response.json({ ok: true, snapshot });
  } catch (err) {
    console.error("BYOD save failed:", err);
    return Response.json(
      { error: err.message || "Unable to save BYOD snapshot." },
      { status: 500 }
    );
  }
}
