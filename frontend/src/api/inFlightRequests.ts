export type RequestFn<T> = () => Promise<T>;

export interface InFlightRequestGroup {
  <T>(key: string, request: RequestFn<T>): Promise<T>;
  clear: () => void;
}

export function createInFlightRequestGroup(): InFlightRequestGroup {
  const requests = new Map<string, Promise<unknown>>();

  function runOnce<T>(key: string, request: RequestFn<T>): Promise<T> {
    const existing = requests.get(key);
    if (existing) return existing as Promise<T>;

    const pending: Promise<T> = Promise.resolve()
      .then(request)
      .finally(() => {
        if (requests.get(key) === pending) requests.delete(key);
      });
    requests.set(key, pending as Promise<unknown>);
    return pending;
  }

  runOnce.clear = () => requests.clear();
  return runOnce;
}

function canonicalizeUrl(requestUrl: string): string {
  const url = new URL(requestUrl, 'http://request.local');
  url.searchParams.sort();
  const canonicalUrl = `${url.pathname}${url.search}`;
  return url.origin === 'http://request.local' ? canonicalUrl : `${url.origin}${canonicalUrl}`;
}

export interface InFlightGetOptions {
  method?: string | undefined;
  requestUrl: string;
  credentials?: RequestCredentials | undefined;
  timeoutMs?: number | undefined;
  suppressUnauthorizedEvent?: boolean | undefined;
  signal?: AbortSignal | null | undefined;
  hasBody?: boolean | undefined;
}

function buildGetRequestKey(options: InFlightGetOptions): string {
  return JSON.stringify([
    canonicalizeUrl(options.requestUrl),
    options.credentials,
    options.timeoutMs,
    Boolean(options.suppressUnauthorizedEvent),
  ]);
}

export interface InFlightGetRequestGroup {
  <T>(options: InFlightGetOptions, request: RequestFn<T>): Promise<T>;
  clear: () => void;
}

export function createInFlightGetRequestGroup(): InFlightGetRequestGroup {
  const runOnce = createInFlightRequestGroup();

  function run<T>(options: InFlightGetOptions, request: RequestFn<T>): Promise<T> {
    const method = String(options.method || 'GET').toUpperCase();
    if (method !== 'GET') {
      runOnce.clear();
      return request();
    }
    if (options.signal || options.hasBody) return request();
    return runOnce(buildGetRequestKey(options), request);
  }

  run.clear = runOnce.clear;
  return run;
}
