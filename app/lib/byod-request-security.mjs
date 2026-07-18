function sameRequestHost(request, value) {
  if (!value) return false;
  try {
    return new URL(value).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

export function isTrustedByodWrite(request) {
  if (sameRequestHost(request, request.headers.get("origin"))) return true;
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  return sameRequestHost(request, request.headers.get("referer"));
}

export function isTrustedByodRead(request) {
  if (isTrustedByodWrite(request)) return true;
  return request.headers.get("sec-fetch-site") === "same-site";
}
