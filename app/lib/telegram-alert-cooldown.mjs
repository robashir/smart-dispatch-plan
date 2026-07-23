import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "smart-dispatch-alert-cooldowns";

export function telegramAlertStateStorageKey(candidateKey) {
  const digest = createHash("sha256")
    .update(String(candidateKey || "unknown"))
    .digest("hex");
  return `alerts/${digest}`;
}

export function getTelegramAlertStateStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function readTelegramAlertState(
  candidateKey,
  store = getTelegramAlertStateStore()
) {
  const record = await store.get(telegramAlertStateStorageKey(candidateKey), {
    type: "json",
  });
  const sentAt = Number(record?.sentAt);
  return {
    eligible: record?.eligible === true,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  };
}

export async function recordTelegramAlertState(
  candidateKey,
  state,
  store = getTelegramAlertStateStore()
) {
  if (!state || typeof state.eligible !== "boolean") {
    throw new TypeError("A boolean alert eligibility state is required.");
  }
  const sentAt = Number(state.sentAt);
  await store.setJSON(telegramAlertStateStorageKey(candidateKey), {
    eligible: state.eligible,
    sentAt: Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0,
  });
}
