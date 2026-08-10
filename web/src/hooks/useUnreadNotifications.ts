'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { gql, UNREAD_NOTIFICATIONS } from '@/lib/graphql';
import { getActivitySeenAt, markActivitySeen } from '@/lib/activitySeen';
import { useOrg } from '@/components/OrgContext';

/**
 * Poll notification_outbox for items newer than last Activity visit.
 * Clears when user is on /activity (marks seen).
 */
export function useUnreadNotifications() {
  const { org } = useOrg();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    if (!org?.id) {
      setUnread(0);
      return;
    }
    // On Activity page: mark read and zero badge
    if (pathname.startsWith('/activity')) {
      markActivitySeen(org.id);
      setUnread(0);
      return;
    }
    try {
      const since = getActivitySeenAt(org.id);
      const data = await gql<{
        notification_outbox: { id: string }[];
      }>(UNREAD_NOTIFICATIONS, { org_id: org.id, since });
      setUnread((data.notification_outbox || []).length);
    } catch {
      // silent — badge is best-effort
    }
  }, [org?.id, pathname]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    const onSeen = () => void refresh();
    window.addEventListener('chainai-activity-seen', onSeen);
    return () => {
      clearInterval(t);
      window.removeEventListener('chainai-activity-seen', onSeen);
    };
  }, [refresh]);

  return { unread, refresh };
}
