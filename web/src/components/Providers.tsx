'use client';

import { NhostProvider } from '@nhost/react';
import { nhost } from '@/lib/nhost';
import { OrgProvider } from '@/components/OrgContext';
import { AuthSessionGuard } from '@/components/AuthSessionGuard';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <AuthSessionGuard>
        <OrgProvider>{children}</OrgProvider>
      </AuthSessionGuard>
    </NhostProvider>
  );
}
