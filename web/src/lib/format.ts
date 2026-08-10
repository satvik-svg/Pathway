/** Safe string for UI messages (avoids [object Object]). */
export function formatMessage(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string' && typeof o.message !== 'string') {
      // { error: 'invalid-refresh-token', message: '...' } already handled above
      return String(o.error);
    }
    if (Array.isArray(o) && o[0] && typeof (o[0] as { message?: string }).message === 'string') {
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
 * Nhost session/token noise — not useful to show as a red banner.
 * (Logged-out refresh attempts, single-use token races, etc.)
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
    m === 'invalid-refresh-token'
  );
}

/** Message for UI banners; null = do not show. */
export function userFacingMessage(value: unknown): string | null {
  const s = formatMessage(value).trim();
  if (!s || isSessionNoiseMessage(s)) return null;
  return s;
}
