'use client';

import { useEffect, useState } from 'react';
import type { StepType, WorkflowStep } from '@/lib/types';
import { NODE_META } from './nodeMeta';

export type InspectorStepRef = {
  position: number;
  name: string;
  type: string;
  config?: Record<string, unknown>;
};

interface Props {
  step: WorkflowStep | null;
  index: number;
  /** All steps on the canvas (for friendly dropdowns) */
  allSteps?: InspectorStepRef[];
  /** Stable key for this selection (index+type) — remount local state only when node changes */
  selectionKey: string;
  onChange: (patch: Partial<WorkflowStep>) => void;
  onRemove: () => void;
}

/**
 * Local draft state so typing doesn't remount / steal focus when parent re-renders canvas.
 */
export function StepInspector({
  step,
  index,
  allSteps = [],
  selectionKey,
  onChange,
  onRemove,
}: Props) {
  const [name, setName] = useState(step?.name ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(
    step?.config ?? {}
  );
  // Reset local draft only when a different node is selected
  useEffect(() => {
    if (!step) return;
    setName(step.name);
    setConfig(step.config || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-sync on selectionKey
  }, [selectionKey]);

  const fromStep = Number(config.from_step ?? 0);
  const thenTo = Number(config.then_skip_to ?? (index || 0) + 1);
  const elseTo = Number(config.else_skip_to ?? (index || 0) + 1);

  if (!step) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500 p-6 text-center">
        Click a node on the canvas to edit its settings
      </div>
    );
  }

  const meta = NODE_META[step.type as StepType];

  function commitName(value: string) {
    setName(value);
    onChange({ name: value });
  }

  function commitConfig(key: string, value: unknown) {
    const next = { ...config, [key]: value };
    setConfig(next);
    onChange({ config: next });
  }

  function stepLabel(pos: number) {
    const s = allSteps.find((x) => x.position === pos);
    if (!s) return `Step #${pos}`;
    return `#${pos} ${s.name || s.type}`;
  }

  /** Steps that can be the source of a branch check (usually earlier ones). */
  const sourceOptions = allSteps.filter((s) => s.position !== index);
  const destOptions = allSteps.filter((s) => s.position !== index);

  return (
    <div className="h-full flex flex-col overflow-hidden" key={selectionKey}>
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <span
          className={`text-xs px-2 py-0.5 rounded text-white bg-gradient-to-r ${meta?.color || 'from-zinc-600 to-zinc-500'}`}
        >
          {meta?.label || step.type}
        </span>
        <span className="text-xs text-zinc-500 font-mono">#{index}</span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto text-xs text-red-400 hover:text-red-300"
        >
          Remove
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {step.type !== 'conditional_branch' && meta?.description && (
          <p className="text-xs text-zinc-400 leading-relaxed rounded-lg bg-zinc-950/80 border border-zinc-800 px-3 py-2">
            <span className="text-zinc-500">What this step does: </span>
            {meta.description}
          </p>
        )}
        <label className="block text-xs text-zinc-400">
          Your name for this step
          <input
            className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500"
            value={name}
            onChange={(e) => commitName(e.target.value)}
          />
        </label>

        {step.type === 'llm_call' && (
          <>
            <p className="text-[11px] text-zinc-500 leading-relaxed rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-2">
              Prefer <strong className="text-zinc-400">JSON</strong> so the
              branch can read a key (e.g.{' '}
              <code className="text-zinc-400">{`{"answer":"yes"}`}</code>
              ). Use <code className="text-zinc-400">{'{{input}}'}</code> for
              run payload.
            </p>
            <label className="block text-xs text-zinc-400">
              Prompt
              <textarea
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm min-h-[120px] font-mono text-zinc-200 outline-none focus:border-emerald-500"
                value={String(config.prompt ?? '')}
                onChange={(e) => commitConfig('prompt', e.target.value)}
              />
            </label>
            <label className="block text-xs text-zinc-400">
              Offline fallback JSON (only if no LLM API key)
              <input
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm font-mono outline-none focus:border-emerald-500"
                value={String(config.stub_response ?? '')}
                onChange={(e) => commitConfig('stub_response', e.target.value)}
                placeholder='{"answer":"no"}'
              />
            </label>
          </>
        )}

        {step.type === 'http_request' && (
          <>
            <label className="block text-xs text-zinc-400">
              Method
              <select
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
                value={String(config.method ?? 'GET')}
                onChange={(e) => commitConfig('method', e.target.value)}
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-zinc-400">
              URL (required — your API endpoint)
              <input
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm font-mono outline-none focus:border-emerald-500"
                value={String(config.url ?? '')}
                onChange={(e) => commitConfig('url', e.target.value)}
                placeholder="https://api.example.com/…"
              />
            </label>
            {!String(config.url ?? '').trim() && (
              <p className="text-[11px] text-amber-500/90">
                Set a URL or remove this step — empty URL will fail at run time.
              </p>
            )}
          </>
        )}

        {step.type === 'conditional_branch' && (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500 leading-relaxed">
              Reads a <strong className="text-zinc-400">JSON key</strong> from
              the AI step (default <code className="text-zinc-400">answer</code>
              ). If it equals the Yes value → green wire; else → yellow.
            </p>

            <label className="block text-xs text-zinc-400">
              Read from step
              <select
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
                value={fromStep}
                onChange={(e) =>
                  commitConfig('from_step', Number(e.target.value))
                }
              >
                {(sourceOptions.length
                  ? sourceOptions
                  : [{ position: 0, name: 'Ask AI', type: 'llm_call' }]
                ).map((s) => (
                  <option key={s.position} value={s.position}>
                    #{s.position} {s.name || s.type}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-zinc-400">
                JSON key
                <input
                  className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm font-mono outline-none focus:border-emerald-500"
                  value={String(config.field ?? 'answer')}
                  onChange={(e) => commitConfig('field', e.target.value)}
                  placeholder="answer"
                />
              </label>
              <label className="block text-xs text-zinc-400">
                Yes when equals
                <input
                  className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
                  value={String(config.equals ?? 'yes')}
                  onChange={(e) => commitConfig('equals', e.target.value)}
                  placeholder="yes"
                />
              </label>
            </div>
            <p className="text-[11px] text-zinc-600">
              Example: AI returns{' '}
              <code className="text-zinc-500">{`{"answer":"yes"}`}</code> → key{' '}
              <code className="text-zinc-500">answer</code>, equals{' '}
              <code className="text-zinc-500">yes</code> → Yes path.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-zinc-400">
                Yes →
                <select
                  className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                  value={thenTo}
                  onChange={(e) =>
                    commitConfig('then_skip_to', Number(e.target.value))
                  }
                >
                  {destOptions.map((s) => (
                    <option key={s.position} value={s.position}>
                      {stepLabel(s.position)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs text-zinc-400">
                No →
                <select
                  className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
                  value={elseTo}
                  onChange={(e) =>
                    commitConfig('else_skip_to', Number(e.target.value))
                  }
                >
                  {destOptions.map((s) => (
                    <option key={s.position} value={s.position}>
                      {stepLabel(s.position)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {step.type === 'approval_gate' && (
          <>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              Human pause. At run time a <strong className="text-zinc-400">short AI pass</strong>{' '}
              turns prior step memory into a clean card (title, summary, chips). Optional note
              below is a hint for that summarizer — not shown raw to the user.
            </p>
            <label className="block text-xs text-zinc-400">
              Hint for UI summary (optional)
              <textarea
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm min-h-[72px] outline-none focus:border-emerald-500"
                value={String(config.message ?? '')}
                onChange={(e) => commitConfig('message', e.target.value)}
                placeholder="e.g. Ask them to approve saving the API result"
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-500 cursor-pointer">
              <input
                type="checkbox"
                className="rounded border-zinc-600"
                checked={config.llm_ui_summary !== false}
                onChange={(e) =>
                  commitConfig('llm_ui_summary', e.target.checked)
                }
              />
              Use AI to write the approval card (recommended)
            </label>
          </>
        )}

        {step.type === 'notify' && (
          <>
            <label className="block text-xs text-zinc-400">
              Channel
              <select
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
                value={String(config.channel ?? 'log')}
                onChange={(e) => commitConfig('channel', e.target.value)}
              >
                <option value="log">log (console)</option>
                <option value="slack">slack</option>
                <option value="email">email</option>
              </select>
            </label>
            <label className="block text-xs text-zinc-400">
              Message (use {'{{memory}}'}, {'{{ai_decision}}'}, {'{{customer_email}}'}, …)
              <textarea
                className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm min-h-[72px] outline-none focus:border-emerald-500"
                value={String(config.message ?? '')}
                onChange={(e) => commitConfig('message', e.target.value)}
              />
            </label>
          </>
        )}

        {step.type === 'db_write' && (
          <label className="block text-xs text-zinc-400">
            Storage key
            <input
              className="mt-1 w-full rounded-md bg-zinc-950 border border-zinc-700 px-2.5 py-1.5 text-sm outline-none focus:border-emerald-500"
              value={String(config.key ?? 'result')}
              onChange={(e) => commitConfig('key', e.target.value)}
            />
          </label>
        )}
      </div>
    </div>
  );
}
