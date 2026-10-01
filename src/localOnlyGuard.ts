/**
 * Everything runs in the browser, so the page has no reason to talk to any other origin.
 * The MediaPipe runtime ships a usage-logging call (odml.pa.googleapis.com); this guard makes
 * fetch / XHR / sendBeacon refuse any cross-origin request. The production build additionally
 * sets a Content-Security-Policy (see vite.config.ts) that the browser enforces itself.
 *
 * Three exceptions, all set by the build. The review service (VITE_REVIEW_API_URL), when there is one: the analyzed jumps
 * are posted there for a person to check. The asset host (VITE_ASSET_BASE_URL): models, wasm and the sample are
 * only read from it, nothing is sent. And Jev (VITE_JEV_API_URL): measurements of one jump, never a frame, sent only when
 * a person presses the button of the Classification tab. Those three origins are the only others let through.
 */
const originOf = (value: string | undefined): string | null => {
  try {
    return value ? new URL(value).origin : null;
  } catch {
    return null;
  }
};
const reviewOrigin = originOf(import.meta.env.VITE_REVIEW_API_URL as string | undefined);
const assetOrigin = originOf(import.meta.env.VITE_ASSET_BASE_URL as string | undefined);
const jevOrigin = originOf(import.meta.env.VITE_JEV_API_URL as string | undefined);

const isLocal = (url: string | URL | Request): boolean => {
  try {
    const raw = url instanceof Request ? url.url : url.toString();
    const u = new URL(raw, location.href);
    return (
      u.origin === location.origin ||
      (reviewOrigin !== null && u.origin === reviewOrigin) ||
      (assetOrigin !== null && u.origin === assetOrigin) ||
      (jevOrigin !== null && u.origin === jevOrigin) ||
      u.protocol === 'blob:' ||
      u.protocol === 'data:'
    );
  } catch {
    return false;
  }
};

const blocked: string[] = [];
export const blockedRequests = () => blocked.slice();

function block(url: unknown) {
  blocked.push(String(url));
  console.info('[local-only] blocked cross-origin request:', String(url));
}

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  if (isLocal(input)) return nativeFetch(input, init);
  block(input instanceof Request ? input.url : input);
  return Promise.reject(new TypeError('Blocked: cross-origin requests are disabled (local-only mode)'));
};

const nativeOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  if (!isLocal(url)) {
    block(url);
    throw new DOMException('Blocked: cross-origin requests are disabled (local-only mode)', 'NetworkError');
  }
  return (nativeOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

const nativeBeacon = navigator.sendBeacon?.bind(navigator);
if (nativeBeacon) {
  navigator.sendBeacon = (url, data) => {
    if (isLocal(url)) return nativeBeacon(url, data);
    block(url);
    return false;
  };
}
