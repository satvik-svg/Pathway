'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuthenticationStatus, useSignOut, useUserData } from '@nhost/react';
import { useOrg } from '@/components/OrgContext';

const NAV = [
  { href: '/', label: 'Workflows' },
  { href: '/activity', label: 'Activity' },
  { href: '/org', label: 'Organization' },
  { href: '/interview', label: 'Interview' },
  { href: '/demo', label: 'Final Task' },
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isAuthenticated, isLoading } = useAuthenticationStatus();
  const user = useUserData();
  const { signOut } = useSignOut();
  const { memberships, org, role, setOrgId, loading: orgLoading } = useOrg();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login') {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-300">
        Loading…
      </div>
    );
  }

  if (!isAuthenticated && pathname !== '/login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-300">
        Redirecting to login…
      </div>
    );
  }

  if (pathname === '/login') {
    return <>{children}</>;
  }

  const quotaPct = org
    ? Math.min(100, Math.round((org.quota_used / Math.max(org.quota_limit, 1)) * 100))
    : 0;

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-md">
        {/* Row 1: brand + nav + user */}
        <div className="mx-auto max-w-[1600px] px-4 sm:px-6">
          <div className="flex h-14 items-center gap-4">
            <Link
              href="/"
              className="shrink-0 flex items-center gap-2 font-semibold tracking-tight"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 text-zinc-950 text-sm font-bold">
                C
              </span>
              <span className="hidden sm:inline text-zinc-100">
                Chain <span className="text-emerald-400">AI</span>
              </span>
            </Link>

            <nav className="flex items-center gap-1 overflow-x-auto scrollbar-none min-w-0">
              {NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    isActive(item.href)
                      ? 'bg-zinc-800 text-white font-medium'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2 sm:gap-3 shrink-0">
              {role && (
                <span
                  className={`hidden sm:inline text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                    role === 'owner'
                      ? 'border-emerald-700/60 text-emerald-400 bg-emerald-950/40'
                      : role === 'editor'
                        ? 'border-sky-700/60 text-sky-400 bg-sky-950/40'
                        : 'border-zinc-600 text-zinc-400 bg-zinc-900'
                  }`}
                >
                  {role}
                </span>
              )}
              <span
                className="hidden lg:inline text-xs text-zinc-500 truncate max-w-[160px]"
                title={user?.email || ''}
              >
                {user?.email}
              </span>
              <button
                onClick={() => signOut()}
                className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded-lg px-2.5 py-1.5 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>

          {/* Row 2: org context + quota */}
          <div className="flex flex-wrap items-center gap-3 pb-3 -mt-0.5">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[10px] uppercase tracking-wider text-zinc-600 shrink-0">
                Workspace
              </span>
              {!orgLoading && memberships.length > 0 ? (
                <select
                  className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1 text-sm text-zinc-100 max-w-[220px] focus:outline-none focus:border-emerald-600"
                  value={org?.id || ''}
                  onChange={(e) => setOrgId(e.target.value)}
                  aria-label="Organization"
                >
                  {memberships.map((m) => (
                    <option key={m.org_id} value={m.org_id}>
                      {m.organization.name} · {m.role}
                    </option>
                  ))}
                </select>
              ) : (
                <Link
                  href="/org"
                  className="text-xs text-amber-400/90 hover:text-amber-300 underline-offset-2 hover:underline"
                >
                  No organization — create one
                </Link>
              )}
            </div>

            {org && (
              <div
                className="flex items-center gap-2 min-w-[160px] sm:min-w-[200px] ml-auto sm:ml-0"
                title={`Usage this period: ${org.quota_used} of ${org.quota_limit} runs`}
              >
                <span className="text-[10px] uppercase tracking-wider text-zinc-600">
                  Usage
                </span>
                <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden min-w-[64px]">
                  <div
                    className={`h-full rounded-full transition-all ${
                      quotaPct > 90 ? 'bg-red-500' : 'bg-emerald-500'
                    }`}
                    style={{ width: `${quotaPct}%` }}
                  />
                </div>
                <span className="text-xs text-zinc-400 tabular-nums shrink-0">
                  {org.quota_used}/{org.quota_limit}
                </span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main
        className={
          pathname === '/'
            ? 'w-full max-w-none px-3 sm:px-4 py-3 sm:py-4'
            : 'mx-auto max-w-5xl px-4 sm:px-6 py-6 sm:py-8'
        }
      >
        {children}
      </main>
    </div>
  );
}
