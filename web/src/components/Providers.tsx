'use client';

import { NhostProvider } from '@nhost/react';
import { nhost } from '@/lib/nhost';
import { OrgProvider } from '@/components/OrgContext';
import { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <NhostProvider nhost={nhost}>
      <OrgProvider>{children}</OrgProvider>
    </NhostProvider>
  );
}
