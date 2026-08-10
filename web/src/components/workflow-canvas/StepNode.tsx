'use client';

import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { StepType } from '@/lib/types';
import { NODE_META, RUN_STATUS_RING } from './nodeMeta';

export type StepNodeData = {
  stepType: StepType;
  label: string;
  positionIndex: number;
  selected?: boolean;
  runStatus?: string | null;
};

function StepNodeComponent({ data, selected }: NodeProps) {
  const d = data as StepNodeData;
  const meta = NODE_META[d.stepType] || NODE_META.llm_call;
  const runRing = d.runStatus ? RUN_STATUS_RING[d.runStatus] || '' : '';
  const isBranch = d.stepType === 'conditional_branch';

  return (
    <div
      className={`relative w-[230px] rounded-xl border bg-zinc-900 shadow-xl shadow-black/50 overflow-visible ring-2 transition-shadow ${
        selected
          ? 'border-emerald-400/80 ring-emerald-400/30'
          : `border-zinc-700 ${meta.ring}`
      } ${runRing}`}
    >
      {/* Input */}
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className="!-left-1.5 !w-3 !h-3 !bg-zinc-300 !border-2 !border-zinc-900 hover:!bg-emerald-400"
        title="Drop a connection here (input)"
      />

      <div
        className={`px-3 py-1.5 text-[11px] font-semibold text-white bg-gradient-to-r ${meta.color} flex items-center gap-1.5 rounded-t-xl`}
      >
        <span className="opacity-90">{meta.icon}</span>
        {meta.label}
      </div>
      <div className="px-3 py-2.5 space-y-1 rounded-b-xl bg-zinc-900">
        <div className="text-[10px] text-zinc-500">Step {d.positionIndex + 1}</div>
        <div className="text-sm font-medium text-zinc-100 leading-snug line-clamp-2">
          {d.label || meta.title}
        </div>
        <div className="text-[11px] text-zinc-500 leading-snug line-clamp-2">
          {meta.description}
        </div>
        {d.runStatus && (
          <div className="mt-1 text-[10px] uppercase tracking-wide text-zinc-400">
            {d.runStatus}
          </div>
        )}
      </div>

      {isBranch ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="then"
            style={{ top: '38%' }}
            className="!-right-1.5 !w-3 !h-3 !bg-emerald-400 !border-2 !border-zinc-900"
            title="Yes — when condition matches"
          />
          <div
            className="pointer-events-none absolute right-[-36px] text-[9px] font-medium text-emerald-400"
            style={{ top: '32%' }}
          >
            Yes
          </div>
          <Handle
            type="source"
            position={Position.Right}
            id="else"
            style={{ top: '68%' }}
            className="!-right-1.5 !w-3 !h-3 !bg-amber-400 !border-2 !border-zinc-900"
            title="No — when condition fails"
          />
          <div
            className="pointer-events-none absolute right-[-32px] text-[9px] font-medium text-amber-400"
            style={{ top: '62%' }}
          >
            No
          </div>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="out"
          className="!-right-1.5 !w-3 !h-3 !bg-emerald-400 !border-2 !border-zinc-900 hover:!bg-sky-400"
          title="Drag to next step"
        />
      )}
    </div>
  );
}

export const StepNode = memo(StepNodeComponent);
