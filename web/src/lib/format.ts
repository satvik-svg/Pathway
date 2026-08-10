/** Safe string for UI messages (avoids [object Object]). */
export function formatMessage(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message || String(value);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
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
