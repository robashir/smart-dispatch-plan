import assert from "node:assert/strict";
import { dispatchAlertAuthorization } from "./app/api/dispatch/route.js";

const endpoint = "https://example.com/api/dispatch";

assert.deepEqual(
  dispatchAlertAuthorization(new Request(endpoint), "shared-secret"),
  { requested: false, authorized: false },
  "public dispatch requests must not request Telegram alerts"
);

assert.deepEqual(
  dispatchAlertAuthorization(
    new Request(endpoint, {
      headers: { Authorization: "Bearer shared-secret" },
    }),
    "shared-secret"
  ),
  { requested: true, authorized: true },
  "the scheduler secret should authorize Telegram alerts"
);

assert.deepEqual(
  dispatchAlertAuthorization(
    new Request(endpoint, {
      headers: { Authorization: "Bearer wrong-secret" },
    }),
    "shared-secret"
  ),
  { requested: true, authorized: false },
  "an incorrect scheduler secret must be rejected"
);

assert.deepEqual(
  dispatchAlertAuthorization(
    new Request(endpoint, {
      headers: { Authorization: "Bearer undefined" },
    }),
    ""
  ),
  { requested: true, authorized: false },
  "a missing server secret must never authorize a request"
);

console.log("Dispatch alert authorization tests passed.");
