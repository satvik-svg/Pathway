'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthenticationStatus } from '@nhost/react';
import { clearNhostLocalSession } from '@/lib/session';

/**
 * Session hygiene without proactive refreshSession() (that causes
 * "could not find user by refresh token" 401 noise on half-stale storage).
 */
export function AuthSessionGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (isLoading) return;
    // Logged out: drop any leftover nhost keys so the next login is clean
    if (!isAuthenticated) {
      clearNhostLocalSession();
    }
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStorage = (e: StorageEvent) => {
      if (!e.key || !/nhost|refresh/i.test(e.key)) return;
      if (e.newValue == null && pathname !== '/login') {
        router.replace('/login?reason=session');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [pathname, router]);

  return <>{children}</>;
}
