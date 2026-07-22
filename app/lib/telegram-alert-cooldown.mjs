import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";

const STORE_NAME = "smart-dispatch-alert-cooldowns";

export function telegramAlertCooldownStorageKey(candidateKey) {
  const digest = createHash("sha256")
    .update(String(candidateKey || "unknown"))
    .digest("hex");
  return `alerts/${digest}`;
}

export function getTelegramAlertCooldownStore() {
  return getStore({ name: STORE_NAME, consistency: "strong" });
}

export async function readTelegramAlertCooldown(
  candidateKey,
  store = getTelegramAlertCooldownStore()
) {
  const record = await store.get(telegramAlertCooldownStorageKey(candidateKey), {
    type: "json",
  });
  const sentAt = Number(record?.sentAt);
  return Number.isFinite(sentAt) && sentAt > 0 ? sentAt : 0;
}

export async function recordTelegramAlertCooldown(
  candidateKey,
  sentAt = Date.now(),
  store = getTelegramAlertCooldownStore()
) {
  const timestamp = Number(sentAt);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new TypeError("A valid cooldown timestamp is required.");
  }
  await store.setJSON(telegramAlertCooldownStorageKey(candidateKey), {
    sentAt: timestamp,
  });
}
