'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { useAuthenticationStatus, useUserId } from '@nhost/react';
import { gql, MY_MEMBERSHIPS } from '@/lib/graphql';
import type { OrgMember, OrgRole, Organization } from '@/lib/types';

interface OrgContextValue {
  memberships: OrgMember[];
  org: Organization | null;
  role: OrgRole | null;
  setOrgId: (id: string) => void;
  refresh: () => Promise<void>;
  loading: boolean;
  canEdit: boolean;
  canRun: boolean;
  isOwner: boolean;
}

const OrgContext = createContext<OrgContextValue | null>(null);

export function OrgProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading: authLoading } = useAuthenticationStatus();
  const userId = useUserId();
  const [memberships, setMemberships] = useState<OrgMember[]>([]);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAuthenticated || !userId) {
      setMemberships([]);
      setOrgId(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await gql<{ org_members: OrgMember[] }>(MY_MEMBERSHIPS, {
        user_id: userId,
      });
      const list = data.org_members || [];
      setMemberships(list);
      setOrgId((prev) => {
        if (prev && list.some((m) => m.org_id === prev)) return prev;
        return list[0]?.org_id ?? null;
      });
    } catch (e) {
      console.error(e);
      setMemberships([]);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, userId]);

  useEffect(() => {
    if (!authLoading) void refresh();
  }, [authLoading, refresh]);

  const membership = memberships.find((m) => m.org_id === orgId) || null;
  const org = membership?.organization ?? null;
  const role = membership?.role ?? null;

  const value = useMemo<OrgContextValue>(
    () => ({
      memberships,
      org,
      role,
      setOrgId: (id: string) => setOrgId(id),
      refresh,
      loading: authLoading || loading,
      canEdit: role === 'owner' || role === 'editor',
      canRun: role === 'owner' || role === 'editor',
      isOwner: role === 'owner',
    }),
    [memberships, org, role, refresh, authLoading, loading]
  );

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>;
}

export function useOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrg must be used within OrgProvider');
  return ctx;
}
