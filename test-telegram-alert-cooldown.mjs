import assert from "node:assert/strict";
import {
  readTelegramAlertCooldown,
  recordTelegramAlertCooldown,
  telegramAlertCooldownStorageKey,
} from "./app/lib/telegram-alert-cooldown.mjs";

function fakeStore() {
  const records = new Map();
  return {
    async get(key) {
      return records.get(key) || null;
    },
    async setJSON(key, value) {
      records.set(key, value);
    },
  };
}

const firstKey = telegramAlertCooldownStorageKey("event:Empire State Plaza:4:30 PM");
const repeatedKey = telegramAlertCooldownStorageKey("event:Empire State Plaza:4:30 PM");
const differentKey = telegramAlertCooldownStorageKey("flight:Albany Airport:5:15 PM");

assert.equal(firstKey, repeatedKey, "the same candidate must use the same storage key");
assert.notEqual(firstKey, differentKey, "different candidates must use different storage keys");
assert.match(firstKey, /^alerts\/[a-f0-9]{64}$/, "storage keys should be fixed-length hashes");

const store = fakeStore();
assert.equal(await readTelegramAlertCooldown("candidate", store), 0);
await recordTelegramAlertCooldown("candidate", 1_750_000_000_000, store);
assert.equal(await readTelegramAlertCooldown("candidate", store), 1_750_000_000_000);

await assert.rejects(
  recordTelegramAlertCooldown("candidate", 0, store),
  /valid cooldown timestamp/
);

console.log("Telegram alert cooldown storage tests passed.");
