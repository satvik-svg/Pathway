/** Per-org "last opened Activity" timestamp (localStorage). */

const prefix = 'chainai.activity.seen.';

/**
 * Returns last-seen ISO time. On first use for an org, seeds to *now*
 * so we only badge *new* notifications after this session (no 50-item dump).
 */
export function getActivitySeenAt(orgId: string): string {
  if (typeof window === 'undefined' || !orgId) {
    return new Date().toISOString();
  }
  try {
    const existing = localStorage.getItem(prefix + orgId);
    if (existing) return existing;
    const now = new Date().toISOString();
    localStorage.setItem(prefix + orgId, now);
    return now;
  } catch {
    return new Date().toISOString();
  }
}

/** Mark Activity tab as read for this org (now). */
export function markActivitySeen(orgId: string, at?: string) {
  if (typeof window === 'undefined' || !orgId) return;
  try {
    localStorage.setItem(prefix + orgId, at || new Date().toISOString());
  } catch {
    /* ignore */
  }
  // Notify Shell badge listeners in same tab
  try {
    window.dispatchEvent(
      new CustomEvent('chainai-activity-seen', { detail: { orgId } })
    );
  } catch {
    /* ignore */
  }
}
