import assert from "node:assert/strict";
import {
  isTrustedByodRead,
  isTrustedByodWrite,
} from "./app/lib/byod-request-security.mjs";

function request(headers = {}) {
  return {
    url: "https://beamish-salamander-98efb1.netlify.app/api/byod",
    headers: new Headers(headers),
  };
}

assert.equal(
  isTrustedByodWrite(request({ origin: "https://beamish-salamander-98efb1.netlify.app" })),
  true
);
assert.equal(isTrustedByodWrite(request({ "sec-fetch-site": "same-origin" })), true);
assert.equal(
  isTrustedByodWrite(request({ referer: "https://beamish-salamander-98efb1.netlify.app/" })),
  true
);
assert.equal(isTrustedByodWrite(request({ "sec-fetch-site": "same-site" })), false);
assert.equal(isTrustedByodWrite(request({ origin: "https://attacker.example" })), false);
assert.equal(isTrustedByodRead(request({ "sec-fetch-site": "same-site" })), true);
assert.equal(isTrustedByodRead(request()), false);

console.log("BYOD request security: 7 assertions passed.");
