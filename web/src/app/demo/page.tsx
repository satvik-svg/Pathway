'use client';

import { useOrg } from '@/components/OrgContext';
import Link from 'next/link';

const CHECKS = [
  {
    title: 'Two organizations with separate users/roles',
    detail:
      'Seed creates Org A and Org B. Use the org switcher after logging in as each user. Cross-org GraphQL filters via org_members.',
  },
  {
    title: 'Org A owner builds ≥3 step types (llm + http + branch)',
    detail:
      'Use New workflow — defaults include llm_call, http_request, conditional_branch, approval_gate, notify.',
  },
  {
    title: 'Start more than one way: manual + webhook / schedule / DB event',
    detail:
      'Run = manual. Also enable triggers on the workflow: Webhook, Scheduled (cron + “Run scheduled now”), or Database event (“Start via DB event” inserts watched_rows).',
  },
  {
    title: 'approval_gate pauses; only same-org owner/editor approves',
    detail:
      'Live panel shows paused state. Approve & resume calls approveStep Action which re-checks role.',
  },
  {
    title: 'Live step-by-step status (no refresh)',
    detail:
      'GraphQL subscription on step_runs filtered by workflow_run_id streams pending → running → success/paused.',
  },
  {
    title: 'Org B cannot see/trigger/approve Org A (even by ID)',
    detail:
      'Log in as Org B user, switch org, confirm empty workflows. Hasura select permissions scope all tables by membership — direct PK queries return null.',
  },
];

export default function DemoPage() {
  const { org, role, memberships } = useOrg();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Final Task checklist</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Walk these six points live for the assignment demo.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 text-sm">
        <p>
          Current org:{' '}
          <strong className="text-emerald-400">{org?.name || '—'}</strong>
          {role && (
            <span className="text-zinc-500"> · role {role}</span>
          )}
        </p>
        <p className="text-zinc-500 mt-1">
          Memberships: {memberships.map((m) => m.organization.name).join(', ') || 'none'}
        </p>
      </div>

      <ol className="space-y-4">
        {CHECKS.map((c, i) => (
          <li
            key={c.title}
            className="rounded-xl border border-zinc-800 p-4 flex gap-3"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-medium text-emerald-400">
              {i + 1}
            </span>
            <div>
              <h2 className="font-medium text-sm">{c.title}</h2>
              <p className="text-sm text-zinc-500 mt-1">{c.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <Link
        href="/"
        className="inline-flex text-sm text-emerald-400 hover:underline"
      >
        ← Back to workflows
      </Link>
    </div>
  );
}
