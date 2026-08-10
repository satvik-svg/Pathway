'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthenticationStatus } from '@nhost/react';
import { ensureFreshSession } from '@/lib/session';

/**
 * On load: validate refresh token. If Nhost returns invalid-refresh-token,
 * clear local session and send user to /login (fixes org page half-logged-in state).
 */
export function AuthSessionGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const router = useRouter();
  const pathname = usePathname();
  const ran = useRef(false);

  useEffect(() => {
    if (isLoading || ran.current) return;
    if (pathname === '/login') return;

    ran.current = true;
    void (async () => {
      // Only probe when client thinks we have a session
      if (!isAuthenticated && !isLoading) return;

      const result = await ensureFreshSession();
      if (result === 'cleared') {
        router.replace('/login?reason=session');
      }
    })();
  }, [isLoading, isAuthenticated, pathname, router]);

  return <>{children}</>;
}
