export function createInFlightRequestGroup() {
  const requests = new Map();

  function runOnce(key, request) {
    if (requests.has(key)) return requests.get(key);

    let pending;
    pending = Promise.resolve()
      .then(request)
      .finally(() => {
        if (requests.get(key) === pending) requests.delete(key);
      });
    requests.set(key, pending);
    return pending;
  }

  runOnce.clear = () => requests.clear();
  return runOnce;
}

function canonicalizeUrl(requestUrl) {
  const url = new URL(requestUrl, "http://request.local");
  url.searchParams.sort();
  const canonicalUrl = `${url.pathname}${url.search}`;
  return url.origin === "http://request.local" ? canonicalUrl : `${url.origin}${canonicalUrl}`;
}

function buildGetRequestKey(options) {
  return JSON.stringify([
    canonicalizeUrl(options.requestUrl),
    options.credentials,
    options.timeoutMs,
    Boolean(options.suppressUnauthorizedEvent),
  ]);
}

export function createInFlightGetRequestGroup() {
  const runOnce = createInFlightRequestGroup();

  function run(options, request) {
    const method = String(options.method || "GET").toUpperCase();
    if (method !== "GET") {
      runOnce.clear();
      return request();
    }
    if (options.signal || options.hasBody) return request();
    return runOnce(buildGetRequestKey(options), request);
  }

  run.clear = runOnce.clear;
  return run;
}
