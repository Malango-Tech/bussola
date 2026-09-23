/**
 * Read an API response body without letting a bad one throw.
 *
 * Every route answers with JSON, `{ error }` included — a 403 from
 * `withTenant` carries the sentence the person should read. But a proxy's HTML
 * error page, an empty 204 or a dropped connection has no JSON at all, and
 * `res.json()` throwing there would lose the toast that explains what
 * happened. Anything unreadable comes back as an empty object, so callers can
 * always write `body.error || "fallback"`.
 */
export async function readJson<T extends object>(
  res: Response,
): Promise<Partial<T> & { error?: string }> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === "object"
      ? (body as Partial<T> & { error?: string })
      : {};
  } catch {
    return {};
  }
}
