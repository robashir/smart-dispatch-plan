import assert from "node:assert/strict";
import {
  readTelegramAlertState,
  recordTelegramAlertState,
  telegramAlertStateStorageKey,
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

const firstKey = telegramAlertStateStorageKey("event:Empire State Plaza:4:30 PM");
const repeatedKey = telegramAlertStateStorageKey("event:Empire State Plaza:4:30 PM");
const differentKey = telegramAlertStateStorageKey("flight:Albany Airport:5:15 PM");

assert.equal(firstKey, repeatedKey, "the same candidate must use the same storage key");
assert.notEqual(firstKey, differentKey, "different candidates must use different storage keys");
assert.match(firstKey, /^alerts\/[a-f0-9]{64}$/, "storage keys should be fixed-length hashes");

const store = fakeStore();
assert.deepEqual(await readTelegramAlertState("candidate", store), {
  eligible: false,
  sentAt: 0,
});
await recordTelegramAlertState(
  "candidate",
  { eligible: true, sentAt: 1_750_000_000_000 },
  store
);
assert.deepEqual(await readTelegramAlertState("candidate", store), {
  eligible: true,
  sentAt: 1_750_000_000_000,
});
await recordTelegramAlertState(
  "candidate",
  { eligible: false, sentAt: 1_750_000_000_000 },
  store
);
assert.deepEqual(await readTelegramAlertState("candidate", store), {
  eligible: false,
  sentAt: 1_750_000_000_000,
});

await assert.rejects(
  recordTelegramAlertState("candidate", { eligible: "yes" }, store),
  /boolean alert eligibility/
);

console.log("Telegram alert state storage tests passed.");
