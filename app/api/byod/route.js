import { readByodSnapshot, saveByodSnapshot } from "../../lib/byod-store";
import {
  isTrustedByodRead,
  isTrustedByodWrite,
} from "../../lib/byod-request-security.mjs";

export async function GET(request) {
  try {
    if (!isTrustedByodRead(request)) {
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
    if (!isTrustedByodWrite(request)) {
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
