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
 * Do NOT call refreshSession proactively — that hits /v1/token and logs
 * "could not find user by refresh token" when storage is half-stale.
 * Only clear local state if we already know auth is broken.
 */
export function isAuthErrorMessage(message: string) {
  const m = message.toLowerCase();
  return (
    m.includes('invalid-refresh-token') ||
    m.includes('invalid or expired refresh') ||
    m.includes('could not find user by refresh') ||
    m.includes('jwt expired') ||
    m.includes('invalid jwt') ||
    m.includes('unauthorized') ||
    m.includes('not authenticated')
  );
}
