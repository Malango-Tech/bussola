/**
 * Uniform upstream fetch for every connector: bounded by a timeout so a hung
 * provider fails fast instead of hanging the widget, with a consistent
 * `<Name> API <status>: <body snippet>` error that `toUserFacingError` can map.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export type FetchJsonOptions = {
  /** Provider label used in the thrown error message, e.g. "Railway". */
  label: string;
  timeoutMs?: number;
};

export async function fetchJson<T>(
  url: string,
  init: RequestInit,
  { label, timeoutMs = DEFAULT_TIMEOUT_MS }: FetchJsonOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError") {
      throw new Error(`${label} API timed out after ${timeoutMs}ms`);
    }
    throw error;
  }

  if (!res.ok) {
    // The body only decorates the error thrown below; a failed read must not
    // replace the status, which is what `toUserFacingError` keys on.
    const text = await res.text().catch(() => "");
    throw new Error(`${label} API ${res.status}: ${text.slice(0, 160)}`);
  }

  return res.json() as Promise<T>;
}
