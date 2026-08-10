'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSignInEmailPassword, useSignOut } from '@nhost/react';
import { useOrg } from '@/components/OrgContext';

const DEMO_ACCOUNTS = [
  {
    email: 'owner-a@example.com',
    password: 'password123',
    org: 'Org A',
    role: 'owner',
    purpose: 'Build workflows, manage members, approve gates, webhooks',
  },
  {
    email: 'editor-a@example.com',
    password: 'password123',
    org: 'Org A',
    role: 'editor',
    purpose: 'Edit & run workflows — cannot manage members',
  },
  {
    email: 'viewer-a@example.com',
    password: 'password123',
    org: 'Org A',
    role: 'viewer',
    purpose: 'Read-only — no Run button, cannot trigger',
  },
  {
    email: 'owner-b@example.com',
    password: 'password123',
    org: 'Org B',
    role: 'owner',
    purpose: 'Prove isolation — cannot see Org A workflows even by ID',
  },
] as const;

const CHECKLIST = [
  {
    title: '1. Two organizations',
    detail:
      'Header org switcher (or sign in as owner-a vs owner-b). Org A and Org B are separate tenants.',
  },
  {
    title: '2. Role hierarchy (same org)',
    detail:
      'owner-a: full. editor-a: run/edit, no member admin. viewer-a: list only, no Run.',
  },
  {
    title: '3. Cross-org isolation',
    detail:
      'As owner-b, Workflows list is empty of Org A data. Guessing IDs returns nothing.',
  },
  {
    title: '4. Create org + add member',
    detail:
      'Organization page: create a new org, sign up a colleague, add them as editor/viewer.',
  },
  {
    title: '5. Workflow + approval (owner/editor only)',
    detail:
      'As owner-a Run a flow with Wait for approval; as viewer cannot approve/run.',
  },
];

export default function InterviewPage() {
  const router = useRouter();
  const { signOut } = useSignOut();
  const { signInEmailPassword, isLoading } = useSignInEmailPassword();
  const { org, role, memberships, refresh } = useOrg();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function switchTo(email: string, password: string) {
    setBusy(email);
    setError(null);
    setNote(null);
    try {
      await signOut();
      const res = await signInEmailPassword(email, password);
      if (res.isError || res.error) {
        throw new Error(res.error?.message || 'Sign-in failed');
      }
      setNote(`Signed in as ${email}`);
      await refresh();
      router.push('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Interviewer walkthrough
        </h1>
        <p className="text-sm text-zinc-400 mt-1">
          One-click account switching to prove multi-org isolation and role
          hierarchy (assignment Final Task).
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
        <p>
          Currently:{' '}
          <strong className="text-emerald-400">{org?.name || 'no org'}</strong>
          {role && <span className="text-zinc-500"> · {role}</span>}
        </p>
        <p className="text-zinc-500 text-xs mt-1">
          Memberships:{' '}
          {memberships.map((m) => `${m.organization.name}(${m.role})`).join(', ') ||
            'none'}
        </p>
      </div>

      {error && (
        <div className="text-sm text-red-400 border border-red-900/40 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {note && (
        <div className="text-sm text-emerald-300 border border-emerald-900/40 rounded-lg px-3 py-2">
          {note}
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-300">
          Demo accounts (password for all: password123)
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {DEMO_ACCOUNTS.map((a) => (
            <div
              key={a.email}
              className="rounded-xl border border-zinc-800 bg-zinc-950/50 p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {a.org}
                </span>
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-emerald-800/50 text-emerald-400/90">
                  {a.role}
                </span>
              </div>
              <div className="text-sm font-medium text-zinc-100">{a.email}</div>
              <p className="text-xs text-zinc-500 leading-snug flex-1">
                {a.purpose}
              </p>
              <button
                type="button"
                disabled={isLoading || busy === a.email}
                onClick={() => void switchTo(a.email, a.password)}
                className="mt-1 text-sm bg-sky-500 hover:bg-sky-400 text-zinc-950 font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
              >
                {busy === a.email ? 'Signing in…' : 'Sign in as this user'}
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-zinc-300">
          Final Task checklist
        </h2>
        <ol className="space-y-3">
          {CHECKLIST.map((c) => (
            <li
              key={c.title}
              className="rounded-xl border border-zinc-800 p-4 flex gap-3"
            >
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{c.title}</h3>
                <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                  {c.detail}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href="/org"
          className="text-emerald-400 hover:underline"
        >
          → Organization (create org / manage roles)
        </Link>
        <Link href="/" className="text-zinc-400 hover:text-white">
          → Workflows
        </Link>
        <Link href="/demo" className="text-zinc-400 hover:text-white">
          → Final Task notes
        </Link>
      </div>
    </div>
  );
}
