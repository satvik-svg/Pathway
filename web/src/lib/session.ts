'use client';

import { nhost } from './nhost';

/**
 * Clear stale Nhost session storage (dead refresh tokens leave the UI half-logged-in).
 */
export function clearNhostLocalSession() {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (
        /nhost/i.test(k) ||
        /refresh.?token/i.test(k) ||
        k.includes('hasura-auth')
      ) {
        keys.push(k);
      }
    }
    for (const k of keys) localStorage.removeItem(k);
    // sessionStorage copies if any
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && /nhost/i.test(k)) sessionStorage.removeItem(k);
    }
  } catch {
    /* ignore */
  }
}

export async function forceSignOutLocal() {
  try {
    await nhost.auth.signOut();
  } catch {
    /* ignore network errors during cleanup */
  }
  clearNhostLocalSession();
}

/**
 * If the browser has a session, refresh it. On invalid/expired refresh token,
 * clear storage so the user can sign in cleanly.
 */
export async function ensureFreshSession(): Promise<'ok' | 'none' | 'cleared'> {
  const session = nhost.auth.getSession();
  if (!session?.refreshToken && !session?.accessToken) {
    return 'none';
  }

  try {
    const res = await nhost.auth.refreshSession();
    if (res.error) {
      // Any refresh failure → start clean (invalid/expired refresh is unusable)
      await forceSignOutLocal();
      return 'cleared';
    }
    return 'ok';
  } catch {
    await forceSignOutLocal();
    return 'cleared';
  }
}

export function isAuthErrorMessage(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes('invalid-refresh-token') ||
    m.includes('invalid or expired refresh') ||
    m.includes('jwt expired') ||
    m.includes('invalid jwt') ||
    m.includes('authentication') ||
    m.includes('unauthorized') ||
    m.includes('not authenticated')
  );
}
