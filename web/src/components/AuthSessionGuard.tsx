'use client';

/**
 * Intentionally minimal.
 *
 * Do NOT clear localStorage when isAuthenticated is false — that races with
 * Nhost session rehydrate and causes:
 *   POST /v1/token → invalid-refresh-token
 * even in incognito right after a successful sign-in.
 */
export function AuthSessionGuard({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
