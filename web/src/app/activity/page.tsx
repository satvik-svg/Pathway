'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/components/OrgContext';
import { gql, ORG_ACTIVITY } from '@/lib/graphql';
import { formatMessage, userFacingMessage } from '@/lib/format';

type NotifyRow = {
  id: string;
  channel: string;
  message: string;
  delivery_status: string;
  payload: Record<string, unknown> | null;
  workflow_run_id: string | null;
  created_at: string;
};

type DbWriteRow = {
  id: string;
  key: string;
  payload: Record<string, unknown> | null;
  workflow_run_id: string | null;
  created_at: string;
};

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function statusTone(status: string): string {
  const s = (status || '').toLowerCase();
  if (s === 'delivered' || s === 'success') return 'text-emerald-400/90';
  if (s === 'failed' || s === 'error') return 'text-red-400/90';
  if (s === 'pending') return 'text-amber-400/90';
  return 'text-zinc-500';
}

export default function ActivityPage() {
  const { org, loading: orgLoading } = useOrg();
  const [notifies, setNotifies] = useState<NotifyRow[]>([]);
  const [writes, setWrites] = useState<DbWriteRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'notifications' | 'saves'>('notifications');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!org) {
      setNotifies([]);
      setWrites([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const data = await gql<{
        notification_outbox: NotifyRow[];
        db_write_results: DbWriteRow[];
      }>(ORG_ACTIVITY, { org_id: org.id });
      setNotifies(data.notification_outbox || []);
      setWrites(data.db_write_results || []);
    } catch (e) {
      setErr(userFacingMessage(e));
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    void load();
  }, [load]);

  if (orgLoading) {
    return <p className="text-sm text-zinc-500">Loading…</p>;
  }

  if (!org) {
    return (
      <div className="max-w-lg space-y-3">
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-sm text-zinc-500">
          Create or join an organization first, then notifications and saved
          results will show up here.
        </p>
        <Link href="/org" className="text-sm text-emerald-400 hover:underline">
          Go to Organization →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-12">
      <header className="space-y-1">
        <p className="text-[11px] uppercase tracking-wider text-zinc-600 font-medium">
          {org.name}
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
              Activity
            </h1>
            <p className="text-sm text-zinc-500 mt-1">
              Notifications and database saves from workflow runs in this
              workspace.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="text-[13px] text-zinc-400 border border-zinc-700 rounded-lg px-3 py-1.5 hover:bg-zinc-900 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {err && (
        <div className="rounded-lg border border-red-900/40 bg-red-950/20 px-3 py-2 text-sm text-red-300">
          {err}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800">
        <button
          type="button"
          onClick={() => setTab('notifications')}
          className={`px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
            tab === 'notifications'
              ? 'border-zinc-200 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Notifications
          <span className="ml-1.5 text-zinc-600 tabular-nums">
            {notifies.length}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setTab('saves')}
          className={`px-3 py-2 text-[13px] border-b-2 -mb-px transition-colors ${
            tab === 'saves'
              ? 'border-zinc-200 text-zinc-100'
              : 'border-transparent text-zinc-500 hover:text-zinc-300'
          }`}
        >
          Database saves
          <span className="ml-1.5 text-zinc-600 tabular-nums">
            {writes.length}
          </span>
        </button>
      </div>

      {tab === 'notifications' && (
        <section className="space-y-2">
          {loading && notifies.length === 0 && (
            <p className="text-sm text-zinc-600 py-8 text-center">Loading…</p>
          )}
          {!loading && notifies.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-800 px-6 py-12 text-center">
              <p className="text-sm text-zinc-400">No notifications yet</p>
              <p className="text-[13px] text-zinc-600 mt-2 max-w-sm mx-auto">
                When a workflow hits a <strong className="text-zinc-500">Send a notification</strong>{' '}
                step, it lands here (and on the server if channel is log).
              </p>
              <Link
                href="/"
                className="inline-block mt-4 text-[13px] text-emerald-400 hover:underline"
              >
                Run a workflow →
              </Link>
            </div>
          )}
          {notifies.map((n) => {
            const open = expanded === n.id;
            const firstLine = (n.message || '')
              .split('\n')
              .map((l) => l.trim())
              .find(Boolean);
            return (
              <article
                key={n.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-zinc-300 font-medium capitalize">
                        {n.channel || 'log'}
                      </span>
                      <span className={statusTone(n.delivery_status)}>
                        {n.delivery_status || '—'}
                      </span>
                      <span className="text-zinc-600">{timeAgo(n.created_at)}</span>
                    </div>
                    <p className="text-[13px] text-zinc-400 leading-snug line-clamp-2">
                      {firstLine || '(empty message)'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] text-zinc-600 hover:text-zinc-400 shrink-0"
                    onClick={() => setExpanded(open ? null : n.id)}
                  >
                    {open ? 'Less' : 'More'}
                  </button>
                </div>
                {open && (
                  <div className="mt-3 space-y-2 border-t border-zinc-800/80 pt-3">
                    <pre className="text-[11px] text-zinc-500 whitespace-pre-wrap font-sans leading-relaxed max-h-40 overflow-y-auto">
                      {n.message}
                    </pre>
                    {n.workflow_run_id && (
                      <p className="text-[11px] text-zinc-600 font-mono truncate">
                        run {n.workflow_run_id}
                      </p>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}

      {tab === 'saves' && (
        <section className="space-y-2">
          {loading && writes.length === 0 && (
            <p className="text-sm text-zinc-600 py-8 text-center">Loading…</p>
          )}
          {!loading && writes.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-800 px-6 py-12 text-center">
              <p className="text-sm text-zinc-400">No database saves yet</p>
              <p className="text-[13px] text-zinc-600 mt-2 max-w-sm mx-auto">
                Add a <strong className="text-zinc-500">Save to database</strong> step
                (owners) to store run results here.
              </p>
            </div>
          )}
          {writes.map((w) => {
            const open = expanded === w.id;
            return (
              <article
                key={w.id}
                className="rounded-xl border border-zinc-800 bg-zinc-900/30 px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="text-zinc-300 font-medium font-mono">
                        {w.key || 'result'}
                      </span>
                      <span className="text-zinc-600">{timeAgo(w.created_at)}</span>
                    </div>
                    <p className="text-[12px] text-zinc-500 font-mono truncate">
                      {typeof w.payload === 'object'
                        ? JSON.stringify(w.payload).slice(0, 80)
                        : String(w.payload ?? '')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-[11px] text-zinc-600 hover:text-zinc-400 shrink-0"
                    onClick={() => setExpanded(open ? null : w.id)}
                  >
                    {open ? 'Less' : 'More'}
                  </button>
                </div>
                {open && (
                  <pre className="mt-3 text-[11px] text-zinc-500 overflow-x-auto max-h-40 rounded-lg bg-zinc-950 border border-zinc-900 p-2">
                    {JSON.stringify(w.payload, null, 2)}
                  </pre>
                )}
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}
