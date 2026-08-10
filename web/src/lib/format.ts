/** Safe string for UI messages (avoids [object Object]). */
export function formatMessage(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string' && typeof o.message !== 'string') {
      return String(o.error);
    }
    if (
      Array.isArray(o) &&
      o[0] &&
      typeof (o[0] as { message?: string }).message === 'string'
    ) {
      return (o as { message: string }[]).map((e) => e.message).join('; ');
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

/**
 * Transient / config noise — do not show as red banners.
 * Includes session refresh failures and HTML-instead-of-JSON parse errors.
 */
export function isSessionNoiseMessage(value: unknown): boolean {
  const m = formatMessage(value).toLowerCase();
  if (!m) return true;
  return (
    m.includes('invalid-refresh-token') ||
    m.includes('invalid or expired refresh') ||
    m.includes('could not find user by refresh') ||
    (m.includes('refresh token') &&
      (m.includes('invalid') ||
        m.includes('expired') ||
        m.includes('not found'))) ||
    // HTML page returned where JSON expected (wrong GraphQL URL, Next 404 HTML, etc.)
    m.includes('unexpected token') ||
    m.includes('is not valid json') ||
    m.includes('unexpected end of json') ||
    m.includes('<!doctype') ||
    m.includes('<html') ||
    m.includes('server returned non-json') ||
    m.includes('graphql bad response') ||
    m.includes('graphql non-json') ||
    m.includes('graphql got html') ||
    m.includes('api returned html') ||
    m.includes('api returned non-json') ||
    m.includes('returned non-json')
  );
}

/** Message for UI banners; null = do not show. */
export function userFacingMessage(value: unknown): string | null {
  const s = formatMessage(value).trim();
  if (!s || isSessionNoiseMessage(s)) return null;
  return s;
}
