'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  APPROVE_STEP,
  gql,
  RUN_STATUS_SUB,
  STEP_RUNS_QUERY,
  STEP_RUNS_SUB,
  subscribe,
} from '@/lib/graphql';
import { callFunction } from '@/lib/functions';
import { formatMessage } from '@/lib/format';
import {
  STATUS_LABEL,
  stepDetailLine,
  summarizeStep,
} from '@/lib/stepSummary';
import type { RunStatus, StepRun } from '@/lib/types';
import { useOrg } from '@/components/OrgContext';

const statusBar: Record<string, string> = {
  pending: 'bg-zinc-600',
  running: 'bg-sky-500',
  success: 'bg-emerald-500',
  failed: 'bg-red-500',
  paused: 'bg-amber-500',
  skipped: 'bg-zinc-700',
  completed: 'bg-emerald-500',
};

const statusText: Record<string, string> = {
  pending: 'text-zinc-500',
  running: 'text-sky-400',
  success: 'text-zinc-500',
  failed: 'text-red-400',
  paused: 'text-amber-400',
  skipped: 'text-zinc-600',
  completed: 'text-emerald-400',
};

type StepsPayload = { step_runs: StepRun[] };
type RunPayload = {
  workflow_runs_by_pk: {
    id: string;
    status: string;
    error?: string | null;
  } | null;
};

export function RunViewer({ runId }: { runId: string }) {
  const { canRun } = useOrg();
  const [steps, setSteps] = useState<StepRun[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus | string>('running');
  const [runError, setRunError] = useState<string | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [live, setLive] = useState(false);

  const pollOnce = useCallback(async () => {
    if (!runId) return;
    try {
      const data = await gql<StepsPayload & RunPayload>(STEP_RUNS_QUERY, {
        run_id: runId,
      });
      setSteps(data.step_runs || []);
      if (data.workflow_runs_by_pk) {
        setRunStatus(data.workflow_runs_by_pk.status);
        setRunError(
          data.workflow_runs_by_pk.error
            ? formatMessage(data.workflow_runs_by_pk.error)
            : null
        );
      }
    } catch (e) {
      setMsg(formatMessage(e));
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;

    void pollOnce();

    const unsubSteps = subscribe<StepsPayload>(
      STEP_RUNS_SUB,
      { run_id: runId },
      (data) => {
        if (cancelled) return;
        setLive(true);
        setSteps(data.step_runs || []);
        setMsg(null);
      },
      () => {}
    );

    const unsubRun = subscribe<RunPayload>(
      RUN_STATUS_SUB,
      { run_id: runId },
      (data) => {
        if (cancelled) return;
        setLive(true);
        if (data.workflow_runs_by_pk) {
          setRunStatus(data.workflow_runs_by_pk.status);
          setRunError(
            data.workflow_runs_by_pk.error
              ? formatMessage(data.workflow_runs_by_pk.error)
              : null
          );
        }
      },
      () => {}
    );

    const pollTimer = setInterval(() => {
      if (cancelled) return;
      void pollOnce();
    }, 1500);

    return () => {
      cancelled = true;
      unsubSteps();
      unsubRun();
      clearInterval(pollTimer);
    };
  }, [runId, pollOnce]);

  async function approve(stepRunId: string) {
    setApproving(stepRunId);
    setMsg(null);
    try {
      try {
        const data = await callFunction<{
          success: boolean;
          message: string;
          status: string;
        }>('/approve-step', { step_run_id: stepRunId });
        setMsg(formatMessage(data.message));
      } catch {
        const data = await gql<{
          approveStep: { success: boolean; message: string; status: string };
        }>(APPROVE_STEP, { step_run_id: stepRunId });
        setMsg(formatMessage(data.approveStep.message));
      }
      await pollOnce();
    } catch (e) {
      setMsg(formatMessage(e));
    } finally {
      setApproving(null);
    }
  }

  const doneCount = steps.filter(
    (s) => s.status === 'success' || s.status === 'skipped'
  ).length;
  const progress = steps.length ? (doneCount / steps.length) * 100 : 0;
  const isFinished =
    runStatus === 'completed' ||
    runStatus === 'failed' ||
    runStatus === 'paused';

  return (
    <div className="h-full flex flex-col bg-zinc-950/40">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-zinc-800/90 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="text-sm font-medium text-zinc-100">Run</h3>
            <span
              className={`text-[11px] font-medium ${
                statusText[runStatus] || 'text-zinc-400'
              }`}
            >
              {STATUS_LABEL[runStatus] || runStatus}
            </span>
            {!isFinished && (
              <span className="text-[10px] text-zinc-600">
                {live ? 'live' : '…'}
              </span>
            )}
          </div>
          <span className="text-[11px] tabular-nums text-zinc-600 shrink-0">
            {doneCount}/{steps.length || '—'}
          </span>
        </div>
        <div className="h-1 rounded-full bg-zinc-800/90 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              runStatus === 'failed'
                ? 'bg-red-500'
                : runStatus === 'paused'
                  ? 'bg-amber-500'
                  : 'bg-zinc-300'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <p
          className="text-[10px] text-zinc-700 font-mono truncate"
          title={runId}
        >
          {runId.slice(0, 8)}…
        </p>
      </div>

      {runError && (
        <div className="px-4 py-2.5 text-[13px] text-red-400 border-b border-zinc-800 bg-red-500/5">
          {runError}
        </div>
      )}
      {msg && (
        <div className="px-4 py-2 text-[12px] text-zinc-400 border-b border-zinc-800">
          {msg}
        </div>
      )}

      {/* Timeline */}
      <ol className="flex-1 overflow-y-auto py-1">
        {steps.length === 0 && (
          <li className="px-4 py-10 text-center text-[13px] text-zinc-600">
            Starting…
          </li>
        )}
        {steps.map((s, idx) => {
          const open = expanded[s.id];
          const summary = summarizeStep(s);
          const detail = stepDetailLine(s);
          const hasDetails =
            (s.output && Object.keys(s.output).length > 0) || Boolean(s.error);
          const isSkipped = s.status === 'skipped';
          const isPaused = s.status === 'paused';

          return (
            <li
              key={s.id}
              className={`relative px-4 py-3 ${
                idx < steps.length - 1 ? 'border-b border-zinc-900' : ''
              } ${isSkipped ? 'opacity-50' : ''}`}
            >
              <div className="flex gap-3">
                {/* Index rail */}
                <div className="flex flex-col items-center shrink-0 w-5 pt-0.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      statusBar[s.status] || 'bg-zinc-600'
                    } ${s.status === 'running' || s.status === 'paused' ? 'animate-pulse' : ''}`}
                  />
                </div>

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`text-[13px] font-medium truncate ${
                        isSkipped ? 'text-zinc-600' : 'text-zinc-200'
                      }`}
                    >
                      <span className="text-zinc-600 font-normal tabular-nums mr-1.5">
                        {s.position + 1}.
                      </span>
                      {s.step_name || s.step_type}
                    </p>
                    <span
                      className={`text-[10px] uppercase tracking-wide shrink-0 ${
                        statusText[s.status] || 'text-zinc-600'
                      }`}
                    >
                      {STATUS_LABEL[s.status] || s.status}
                    </span>
                  </div>

                  <p
                    className={`text-[12px] leading-snug ${
                      isSkipped ? 'text-zinc-700' : 'text-zinc-500'
                    }`}
                  >
                    {summary}
                  </p>
                  {detail && !isSkipped && (
                    <p className="text-[11px] text-zinc-600 truncate" title={detail}>
                      {detail}
                    </p>
                  )}

                  {/* Approval — copy produced by engine (LLM summary of run memory) */}
                  {isPaused && (() => {
                    const out = s.output || {};
                    const highlights =
                      out.highlights &&
                      typeof out.highlights === 'object' &&
                      !Array.isArray(out.highlights)
                        ? (out.highlights as Record<string, unknown>)
                        : null;
                    const title = String(
                      out.message || 'Approval required to continue'
                    );
                    const summary =
                      out.summary != null ? String(out.summary) : '';
                    const fromLlm = out.ui_source && out.ui_source !== 'template';
                    return (
                      <div className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3.5 space-y-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-amber-400/90">
                              Needs your approval
                            </p>
                            {fromLlm ? (
                              <span className="text-[10px] text-zinc-600">
                                summarized by AI
                              </span>
                            ) : null}
                          </div>
                          <p className="text-[13px] text-zinc-200 leading-snug">
                            {title}
                          </p>
                          {summary && summary !== title && (
                            <p className="text-[12px] text-zinc-500 leading-snug">
                              {summary}
                            </p>
                          )}
                        </div>
                        {highlights && Object.keys(highlights).length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(highlights).map(([k, v]) => (
                              <span
                                key={k}
                                className="inline-flex items-center gap-1.5 text-[11px] rounded-md border border-zinc-700/80 bg-zinc-950/60 px-2 py-1"
                              >
                                <span className="text-zinc-600">{k}</span>
                                <span className="text-zinc-300 font-medium">
                                  {String(v ?? '')}
                                </span>
                              </span>
                            ))}
                          </div>
                        )}
                        {canRun ? (
                          <button
                            disabled={approving === s.id}
                            onClick={() => approve(s.id)}
                            className="text-[13px] font-semibold bg-amber-400 hover:bg-amber-300 text-zinc-950 px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
                          >
                            {approving === s.id
                              ? 'Approving…'
                              : 'Approve & continue'}
                          </button>
                        ) : (
                          <p className="text-[11px] text-zinc-600">
                            Only owner/editor can approve
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {hasDetails && (
                    <button
                      type="button"
                      className="text-[11px] text-zinc-600 hover:text-zinc-400 pt-0.5"
                      onClick={() =>
                        setExpanded((e) => ({ ...e, [s.id]: !e[s.id] }))
                      }
                    >
                      {open ? 'Hide raw' : 'Raw'}
                    </button>
                  )}
                  {open && (
                    <pre className="mt-1 text-[10px] text-zinc-600 overflow-x-auto max-h-28 rounded-lg bg-zinc-950 border border-zinc-900 p-2 leading-relaxed">
                      {s.error
                        ? formatMessage(s.error)
                        : JSON.stringify(s.output, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
