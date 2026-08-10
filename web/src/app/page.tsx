'use client';

import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/components/OrgContext';
import { WorkflowBuilder } from '@/components/WorkflowBuilder';
import { RunViewer } from '@/components/RunViewer';
import {
  ORG_WORKFLOWS,
  TRIGGER_RUN,
  WEBHOOK_START,
  INSERT_WATCHED_ROW,
  gql,
} from '@/lib/graphql';
import type { StepType, Workflow } from '@/lib/types';
import { formatMessage, userFacingMessage } from '@/lib/format';
import { callFunction } from '@/lib/functions';
import { NODE_META } from '@/components/workflow-canvas/nodeMeta';
import { STATUS_LABEL } from '@/lib/stepSummary';

const RUN_BADGE: Record<string, string> = {
  completed: 'text-emerald-400/90 bg-emerald-500/10',
  failed: 'text-red-400/90 bg-red-500/10',
  paused: 'text-amber-400/90 bg-amber-500/10',
  running: 'text-sky-400/90 bg-sky-500/10',
  pending: 'text-zinc-400 bg-zinc-800/80',
};

const TRIGGER_LABEL: Record<string, string> = {
  manual: 'Manual',
  webhook: 'Webhook',
  scheduled: 'Schedule',
  database_event: 'DB event',
};

/** Calm step label — no neon gradients */
function stepLabel(type: string, name?: string) {
  const meta = NODE_META[type as StepType];
  return name || meta?.label || type;
}

/** True if any step config references run payload {{input}} (or nested paths). */
function configUsesInput(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') {
    return /\{\{\s*input(\.[^}]+)?\s*\}\}/i.test(value);
  }
  if (Array.isArray(value)) return value.some(configUsesInput);
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(configUsesInput);
  }
  return false;
}

/**
 * Decide if manual Run should ask for a payload.
 * - Any {{input}} in step configs → yes
 * - First step is Ask AI (typical classifier) → yes (uses input even if prompt was edited poorly)
 */
function workflowNeedsRunInput(wf: Workflow): boolean {
  const steps = wf.steps || [];
  if (steps.some((s) => configUsesInput(s.config))) return true;
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  if (ordered[0]?.type === 'llm_call') return true;
  return false;
}

export default function HomePage() {
  const { org, canRun, canEdit, loading, refresh, setOrgId } = useOrg();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [mode, setMode] = useState<'list' | 'create' | 'edit'>('list');
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState('');
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgSetupErr, setOrgSetupErr] = useState<string | null>(null);
  /** Workflow id waiting for run input */
  const [runInputFor, setRunInputFor] = useState<string | null>(null);
  const [runInputText, setRunInputText] = useState('');

  const load = useCallback(async () => {
    if (!org) {
      setWorkflows([]);
      return;
    }
    try {
      const data = await gql<{ workflows: Workflow[] }>(ORG_WORKFLOWS, {
        org_id: org.id,
      });
      setWorkflows(data.workflows || []);
    } catch (e) {
      {
        const m = userFacingMessage(e);
        if (m) setMessage(m);
      }
    }
  }, [org]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runWorkflow(id: string, inputText?: string) {
    setBusy(id);
    setMessage(null);
    try {
      let payload: unknown = inputText?.trim() ?? '';
      if (typeof payload === 'string' && payload.startsWith('{')) {
        try {
          payload = JSON.parse(payload);
        } catch {
          /* keep as string */
        }
      }
      const input =
        payload === '' || payload === undefined
          ? null
          : payload;

      let r: {
        success: boolean;
        message: string;
        workflow_run_id: string;
        status: string;
      };

      // Prefer Vercel /api/functions (engine runs on Vercel; Nhost lambda often Unhandled)
      try {
        r = await callFunction('/trigger-workflow-run', {
          workflow_id: id,
          input,
        });
      } catch {
        const data = await gql<{
          triggerWorkflowRun: typeof r;
        }>(TRIGGER_RUN, {
          workflow_id: id,
          input,
        });
        r = data.triggerWorkflowRun;
      }

      {
        const m = userFacingMessage(r.message) ?? (r.success ? formatMessage(r.message) : null);
        if (m) setMessage(m);
        else if (r.success) setMessage(formatMessage(r.message) || 'OK');
      }
      if (r.workflow_run_id) setActiveRunId(r.workflow_run_id);
      setRunInputFor(null);
      setRunInputText('');
      await refresh();
      await load();
    } catch (e) {
      {
        const m = userFacingMessage(e);
        if (m) setMessage(m);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runViaWebhook(wf: Workflow, bodyText?: string) {
    const secret = wf.triggers?.find((t) => t.type === 'webhook')?.webhook_secret;
    if (!secret) {
      setMessage(
        'No webhook on this workflow. Edit it and turn on the “webhook” trigger, then save.'
      );
      return;
    }
    setBusy(`wh-${wf.id}`);
    setMessage(null);
    try {
      // Prefer real payload when testing “with input”; else minimal meta only
      let payload: unknown = {
        source: 'ui-webhook-test',
        at: new Date().toISOString(),
      };
      if (bodyText != null && bodyText.trim()) {
        const t = bodyText.trim();
        try {
          payload = t.startsWith('{') || t.startsWith('[') ? JSON.parse(t) : t;
        } catch {
          payload = t;
        }
      }

      let success = false;
      let message = '';
      let runId: string | null = null;

      try {
        const data = await gql<{
          webhookStartRun: {
            success: boolean;
            message: string;
            workflow_run_id: string;
          };
        }>(WEBHOOK_START, {
          webhook_secret: secret,
          payload,
        });
        success = data.webhookStartRun.success;
        message = formatMessage(data.webhookStartRun.message);
        runId = data.webhookStartRun.workflow_run_id || null;
      } catch {
        const json = await callFunction<{
          success?: boolean;
          message?: string;
          workflow_run_id?: string;
        }>('/webhook-trigger', {
          webhook_secret: secret,
          payload,
        });
        success = !!json.success;
        message = formatMessage(json.message);
        runId = json.workflow_run_id || null;
      }

      if (success) {
        setMessage(
          `Webhook started the workflow (external-style start). ${message}`
        );
        if (runId) setActiveRunId(runId);
        setRunInputFor(null);
        setRunInputText('');
      } else {
        setMessage(
          `Webhook failed: ${message || 'unknown'}. Secret: ${secret.slice(0, 16)}…`
        );
      }
      await load();
    } catch (e) {
      {
        const m = userFacingMessage(e);
        if (m) setMessage(m);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runViaDbEvent(wf: Workflow) {
    if (!org) return;
    setBusy(`db-${wf.id}`);
    setMessage(null);
    try {
      // 1) Write a row (what a real DB event looks like)
      let rowId: string | null = null;
      try {
        const inserted = await gql<{
          insert_watched_rows_one: { id: string };
        }>(INSERT_WATCHED_ROW, {
          object: {
            org_id: org.id,
            workflow_id: wf.id,
            payload: {
              source: 'ui-db-event',
              at: new Date().toISOString(),
            },
          },
        });
        rowId = inserted.insert_watched_rows_one?.id || null;
      } catch (insertErr) {
        // insert may fail without permission — still try direct handler
        console.warn('watched_rows insert', insertErr);
      }

      // 2) Same path as Hasura Event Trigger (direct call so demo always works)
      const data = await callFunction<{
        success: boolean;
        message?: string;
        results?: Array<{
          workflow_id: string;
          success?: boolean;
          workflow_run_id?: string;
          status?: string;
          message?: string;
        }>;
      }>('/db-event-trigger', {
        org_id: org.id,
        workflow_id: wf.id,
        payload: {
          source: 'ui-db-event',
          watched_row_id: rowId,
          at: new Date().toISOString(),
        },
      });

      const first = data.results?.[0];
      if (first?.workflow_run_id) {
        setActiveRunId(first.workflow_run_id);
        setMessage(
          `Database event started a run (trigger_type=database_event). Status: ${first.status || 'started'}`
        );
      } else if (data.success && data.results?.length) {
        setMessage(
          `Database event processed: ${formatMessage(first?.message || data.message || 'ok')}`
        );
      } else {
        setMessage(
          `Database event failed: ${formatMessage(data.message || first?.message || 'unknown')}`
        );
      }
      await refresh();
      await load();
    } catch (e) {
      {
        const m = userFacingMessage(e);
        if (m) setMessage(m);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runViaSchedule(wf: Workflow) {
    setBusy(`sch-${wf.id}`);
    setMessage(null);
    try {
      const data = await callFunction<{
        success: boolean;
        message?: string;
        workflow_run_id?: string;
        status?: string;
        trigger_type?: string;
      }>('/run-scheduled-workflow', { workflow_id: wf.id });

      if (data.success && data.workflow_run_id) {
        setActiveRunId(data.workflow_run_id);
        setMessage(
          `Scheduled trigger fired (same path as cron). Status: ${data.status || 'started'}`
        );
      } else {
        setMessage(
          `Scheduled run failed: ${formatMessage(data.message || 'Enable “Scheduled” on the workflow and save.')}`
        );
      }
      await refresh();
      await load();
    } catch (e) {
      {
        const m = userFacingMessage(e);
        if (m) setMessage(m);
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="text-zinc-400">Loading organization…</p>;
  }

  if (!org) {
    async function createOrgHere(e: FormEvent) {
      e.preventDefault();
      setCreatingOrg(true);
      setOrgSetupErr(null);
      setMessage(null);
      try {
        const data = await callFunction<{
          success: boolean;
          message?: string;
          org_id?: string;
        }>('/create-organization', {
          name: newOrgName.trim(),
          quota_limit: 100,
        });
        if (!data.success) throw new Error(data.message || 'Failed to create org');
        setMessage(data.message || 'Organization created');
        setNewOrgName('');
        await refresh();
        if (data.org_id) setOrgId(data.org_id);
      } catch (err) {
        {
          const m = userFacingMessage(err);
          if (m) setOrgSetupErr(m);
        }
      } finally {
        setCreatingOrg(false);
      }
    }

    return (
      <div className="max-w-xl mx-auto space-y-6 py-6">
        <div className="space-y-2">
          <p className="text-[11px] uppercase tracking-wider text-amber-500/90 font-medium">
            Setup required
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-50">
            You’re signed in, but have no workspace yet
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            Workflows live inside an <strong className="text-zinc-300">organization</strong>.
            Create one below (you become the <strong className="text-emerald-400">owner</strong>),
            then you can build and run AI workflows.
          </p>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-medium text-emerald-200">
              Step 1 — Create your organization
            </h2>
            <p className="text-xs text-zinc-500 mt-1">
              Pick any name (e.g. your company or “My workspace”).
            </p>
          </div>
          <form onSubmit={createOrgHere} className="flex flex-col sm:flex-row gap-2">
            <input
              required
              minLength={2}
              placeholder="e.g. My workspace"
              className="flex-1 rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
            />
            <button
              type="submit"
              disabled={creatingOrg || newOrgName.trim().length < 2}
              className="bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm px-5 py-2.5 rounded-lg disabled:opacity-50 shrink-0"
            >
              {creatingOrg ? 'Creating…' : 'Create organization'}
            </button>
          </form>
          {orgSetupErr && (
            <p className="text-sm text-red-400">{orgSetupErr}</p>
          )}
          {message && !orgSetupErr && (
            <p className="text-sm text-emerald-300">{message}</p>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">Other options</h2>
          <ol className="list-decimal list-inside space-y-2 text-sm text-zinc-400">
            <li>
              Open{' '}
              <Link href="/org" className="text-emerald-400 hover:underline font-medium">
                Organization
              </Link>{' '}
              in the top nav (same create form + member management later).
            </li>
            <li>
              Ask an existing <strong className="text-zinc-300">owner</strong> to add your email
              as editor or viewer.
            </li>
            <li>
              For local demos only: sign in as a seeded user (see README) that already belongs
              to Org A.
            </li>
          </ol>
        </div>

        <p className="text-xs text-zinc-600">
          After you create an org, this page will show your workflows list automatically.
        </p>
      </div>
    );
  }

  if (mode === 'create' || mode === 'edit') {
    return (
      <WorkflowBuilder
        initial={mode === 'edit' ? editing : null}
        onCancel={() => {
          setMode('list');
          setEditing(null);
        }}
        onSaved={async () => {
          setMode('list');
          setEditing(null);
          await load();
        }}
      />
    );
  }

  const pausedCount = workflows.filter((w) => w.runs?.[0]?.status === 'paused')
    .length;
  const totalSteps = workflows.reduce(
    (n, w) => n + (w.steps?.length || 0),
    0
  );

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 via-zinc-900 to-sky-950/25 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -left-20 top-0 h-56 w-56 rounded-full bg-emerald-500/8 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-10 bottom-0 h-40 w-40 rounded-full bg-sky-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-5">
          <div className="space-y-2 min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-sky-400/90">
              Workflows
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-50">
              Automations
            </h1>
            <p className="text-sm text-zinc-400 max-w-lg leading-relaxed">
              Build multi-step pipelines for{' '}
              <span className="text-zinc-200 font-medium">{org.name}</span>
              — AI, APIs, rules, approvals — then run and monitor live.
            </p>
          </div>
          {canEdit && (
            <button
              onClick={() => setMode('create')}
              className="shrink-0 inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm px-5 py-2.5 rounded-xl shadow-lg shadow-emerald-950/30 transition-colors"
            >
              <span className="text-lg leading-none">+</span>
              New workflow
            </button>
          )}
        </div>

        <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Workflows', value: String(workflows.length) },
            { label: 'Steps total', value: String(totalSteps) },
            {
              label: 'Needs approval',
              value: String(pausedCount),
              accent: pausedCount > 0 ? 'text-amber-300' : undefined,
            },
            {
              label: 'Quota used',
              value: `${org.quota_used ?? 0}/${org.quota_limit ?? 100}`,
            },
          ].map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-zinc-800/80 bg-zinc-950/45 px-4 py-3"
            >
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">
                {s.label}
              </p>
              <p
                className={`mt-1 text-xl font-semibold tabular-nums ${
                  s.accent || 'text-zinc-100'
                }`}
              >
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </header>

      {message && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-zinc-700/60 bg-zinc-900/90 px-4 py-3 text-sm text-zinc-200"
        >
          <span className="mt-0.5 text-zinc-500 text-xs">●</span>
          <span className="flex-1 break-words">{message}</span>
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => setMessage(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-5 items-start">
        {/* List */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-sm font-medium text-zinc-300">
              {workflows.length === 0
                ? 'Get started'
                : `${workflows.length} workflow${workflows.length === 1 ? '' : 's'}`}
            </h2>
            {canEdit && workflows.length > 0 && (
              <button
                type="button"
                onClick={() => setMode('create')}
                className="text-xs text-emerald-400 hover:text-emerald-300 font-medium"
              >
                + Add another
              </button>
            )}
          </div>

          {workflows.length === 0 && (
            <div className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900/80 to-zinc-950 p-8 sm:p-10">
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.35]"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 20% 20%, rgba(16,185,129,0.12), transparent 45%), radial-gradient(circle at 80% 60%, rgba(14,165,233,0.1), transparent 40%)',
                }}
                aria-hidden
              />
              <div className="relative max-w-md mx-auto text-center space-y-5">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-zinc-700/80 bg-zinc-900 text-emerald-400 text-lg shadow-inner">
                  ⚡
                </div>
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-zinc-50">
                    No workflows yet
                  </h3>
                  <p className="text-sm text-zinc-500 leading-relaxed">
                    Create a pipeline that chains AI, HTTP, decisions, human
                    approval, and notifications — then run it from this page.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
                  {['Ask AI', 'HTTP', 'Branch', 'Approve', 'Notify'].map(
                    (label, i) => (
                      <span key={label} className="flex items-center gap-1.5">
                        {i > 0 && (
                          <span className="text-zinc-700">→</span>
                        )}
                        <span className="rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2 py-1 text-zinc-400">
                          {label}
                        </span>
                      </span>
                    )
                  )}
                </div>
                {canEdit ? (
                  <button
                    onClick={() => setMode('create')}
                    className="inline-flex items-center gap-2 text-sm bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold px-5 py-2.5 rounded-xl transition-colors"
                  >
                    Create your first workflow
                  </button>
                ) : (
                  <p className="text-xs text-zinc-500">
                    You need editor or owner role to create workflows.
                  </p>
                )}
              </div>
            </div>
          )}

          {workflows.map((wf) => {
            const latest = wf.runs?.[0];
            const hasWebhook = wf.triggers?.some(
              (t) => t.type === 'webhook' && t.is_active !== false
            );
            const hasDb = wf.triggers?.some(
              (t) => t.type === 'database_event' && t.is_active !== false
            );
            const hasScheduled = wf.triggers?.some(
              (t) => t.type === 'scheduled' && t.is_active !== false
            );
            const status = latest?.status || '';
            const sortedSteps = [...(wf.steps || [])].sort(
              (a, b) => a.position - b.position
            );
            const isLive = Boolean(activeRunId && latest?.id === activeRunId);
            const triggerList = wf.triggers?.length
              ? wf.triggers
              : [{ type: 'none' as const }];

            return (
              <article
                key={wf.id}
                className={`rounded-xl border transition-colors ${
                  isLive
                    ? 'border-zinc-600 bg-zinc-900/80'
                    : 'border-zinc-800/90 bg-zinc-900/35 hover:border-zinc-700 hover:bg-zinc-900/55'
                }`}
              >
                <div className="p-4 sm:p-5">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-[15px] font-medium text-zinc-100 truncate">
                        {wf.name}
                      </h2>
                      {wf.description ? (
                        <p className="mt-1 text-[13px] text-zinc-500 leading-snug line-clamp-2">
                          {wf.description}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`shrink-0 text-[11px] px-2 py-0.5 rounded-md ${
                        latest
                          ? RUN_BADGE[status] || RUN_BADGE.pending
                          : 'text-zinc-500 bg-zinc-800/60'
                      }`}
                    >
                      {latest
                        ? STATUS_LABEL[status] || status
                        : 'Never run'}
                    </span>
                  </div>

                  {/* Steps — quiet numbered list, single line wrap */}
                  {sortedSteps.length > 0 && (
                    <ol className="mt-3.5 flex flex-wrap items-center gap-x-1 gap-y-1 text-[12px] text-zinc-400">
                      {sortedSteps.map((s, i) => (
                        <li
                          key={s.id || `${s.position}-${s.type}`}
                          className="inline-flex items-center gap-1 max-w-full"
                          title={NODE_META[s.type as StepType]?.description}
                        >
                          {i > 0 && (
                            <span className="text-zinc-700 mx-0.5" aria-hidden>
                              /
                            </span>
                          )}
                          <span className="text-zinc-600 tabular-nums">
                            {i + 1}.
                          </span>
                          <span className="text-zinc-400 truncate max-w-[140px] sm:max-w-[180px]">
                            {stepLabel(s.type, s.name)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}

                  {runInputFor === wf.id && (
                    <div className="mt-4 rounded-lg border border-zinc-700 bg-zinc-950/60 p-3 space-y-2">
                      <p className="text-[12px] text-zinc-400">
                        This workflow uses run input (e.g.{' '}
                        <code className="text-zinc-300">{'{{input}}'}</code> or
                        starts with Ask AI). Paste the data this run should
                        process — same role as a webhook body in production.
                      </p>
                      <textarea
                        className="w-full min-h-[88px] rounded-lg bg-zinc-950 border border-zinc-700 px-3 py-2 text-[13px] text-zinc-200 outline-none focus:border-zinc-500 font-mono"
                        placeholder="Text or JSON…"
                        value={runInputText}
                        onChange={(e) => setRunInputText(e.target.value)}
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={busy === wf.id || !runInputText.trim()}
                          onClick={() => void runWorkflow(wf.id, runInputText)}
                          className="text-[13px] font-medium bg-zinc-100 text-zinc-900 px-3.5 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          {busy === wf.id ? 'Starting…' : 'Start run'}
                        </button>
                        {hasWebhook && (
                          <button
                            type="button"
                            disabled={
                              busy === `wh-${wf.id}` || !runInputText.trim()
                            }
                            onClick={() =>
                              void runViaWebhook(wf, runInputText)
                            }
                            className="text-[13px] text-zinc-300 border border-zinc-600 px-3 py-1.5 rounded-lg hover:bg-zinc-800 disabled:opacity-50"
                          >
                            {busy === `wh-${wf.id}`
                              ? '…'
                              : 'As webhook body'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRunInputFor(null);
                            setRunInputText('');
                          }}
                          className="text-[13px] text-zinc-500 px-3 py-1.5 rounded-lg hover:text-zinc-300"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Meta + actions */}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 mr-auto text-[11px] text-zinc-600">
                      <span className="tabular-nums">
                        {sortedSteps.length} steps
                      </span>
                      {triggerList.map((t) => (
                        <Fragment key={String(t.type)}>
                          <span className="text-zinc-800">·</span>
                          <span>{TRIGGER_LABEL[t.type] || '—'}</span>
                        </Fragment>
                      ))}
                      {workflowNeedsRunInput(wf) && (
                        <>
                          <span className="text-zinc-800">·</span>
                          <span className="text-zinc-500">needs input</span>
                        </>
                      )}
                    </div>

                    {canRun && (
                      <button
                        disabled={busy === wf.id}
                        onClick={() => {
                          if (workflowNeedsRunInput(wf)) {
                            setRunInputFor(wf.id);
                            setRunInputText('');
                          } else {
                            setRunInputFor(null);
                            void runWorkflow(wf.id);
                          }
                        }}
                        className="text-[13px] font-medium bg-zinc-100 hover:bg-white text-zinc-900 px-3.5 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
                        title={
                          workflowNeedsRunInput(wf)
                            ? 'This workflow expects input — enter it next'
                            : 'Start now'
                        }
                      >
                        {busy === wf.id ? 'Starting…' : 'Run'}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => {
                          setEditing(wf);
                          setMode('edit');
                        }}
                        className="text-[13px] text-zinc-400 hover:text-zinc-200 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/80 transition-colors"
                      >
                        Edit
                      </button>
                    )}
                    {latest && (
                      <button
                        onClick={() => setActiveRunId(latest.id)}
                        className="text-[13px] text-zinc-500 hover:text-zinc-300 px-2.5 py-1.5 rounded-lg hover:bg-zinc-800/80 transition-colors"
                      >
                        Last run
                      </button>
                    )}
                    {canRun && hasWebhook && (
                      <button
                        disabled={busy === `wh-${wf.id}`}
                        onClick={() => void runViaWebhook(wf)}
                        className="text-[12px] text-zinc-500 hover:text-zinc-300 px-2 py-1.5 rounded-lg hover:bg-zinc-800/80"
                        title="Start via webhook (empty/meta payload)"
                      >
                        Webhook
                      </button>
                    )}
                    {canRun && hasScheduled && (
                      <button
                        disabled={busy === `sch-${wf.id}`}
                        onClick={() => void runViaSchedule(wf)}
                        className="text-[12px] text-zinc-500 hover:text-zinc-300 px-2 py-1.5 rounded-lg hover:bg-zinc-800/80"
                      >
                        {busy === `sch-${wf.id}` ? '…' : 'Schedule'}
                      </button>
                    )}
                    {canRun && hasDb && (
                      <button
                        disabled={busy === `db-${wf.id}`}
                        onClick={() => void runViaDbEvent(wf)}
                        className="text-[12px] text-zinc-500 hover:text-zinc-300 px-2 py-1.5 rounded-lg hover:bg-zinc-800/80"
                      >
                        {busy === `db-${wf.id}` ? '…' : 'DB event'}
                      </button>
                    )}
                    {!canRun && (
                      <span className="text-[12px] text-zinc-600">
                        View only
                      </span>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {/* Live panel */}
        <div className="lg:col-span-2 lg:sticky lg:top-24 space-y-3">
          <div className="flex items-center justify-between px-0.5">
            <h2 className="text-sm font-medium text-zinc-300">Live run</h2>
            {activeRunId && (
              <button
                type="button"
                onClick={() => setActiveRunId(null)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                Clear
              </button>
            )}
          </div>
          {activeRunId ? (
            <div className="rounded-2xl border border-zinc-800 overflow-hidden shadow-xl shadow-black/20 min-h-[320px]">
              <RunViewer runId={activeRunId} />
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 min-h-[280px] flex flex-col items-center justify-center text-center">
              <div className="h-10 w-10 rounded-xl border border-zinc-700/80 bg-zinc-950 flex items-center justify-center text-zinc-500 text-sm mb-4">
                ▶
              </div>
              <p className="text-sm font-medium text-zinc-300">
                No active run
              </p>
              <p className="text-xs text-zinc-500 mt-2 max-w-[220px] leading-relaxed">
                Press <span className="text-zinc-400">Run now</span> on a
                workflow. Step status streams here live, including approval
                pauses.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
