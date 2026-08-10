import type { Edge, Connection } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { StepType, WorkflowStep } from '@/lib/types';
import { defaultStepConfig } from '@/lib/types';
import { defaultStepName } from './nodeMeta';
// defaultStepName used when building practical support-triage graph

export type CanvasStep = WorkflowStep & {
  /** Stable React Flow id */
  clientId: string;
  /** Canvas position */
  x: number;
  y: number;
};

export type GraphIssue = {
  level: 'error' | 'warning';
  message: string;
};

function uid() {
  return `n_${Math.random().toString(36).slice(2, 10)}`;
}

export function newCanvasStep(
  type: StepType,
  index: number,
  pos?: { x: number; y: number }
): CanvasStep {
  return {
    clientId: uid(),
    position: index,
    type,
    name: defaultStepName(type),
    config: defaultStepConfig(type),
    x: pos?.x ?? 80 + index * 260,
    y: pos?.y ?? 140 + (index % 2) * 30,
  };
}

export type StarterTemplate = 'ai' | 'http' | 'full';

/**
 * HTTP-first starter — no run input needed.
 * Fetch public API → notify (Activity outbox).
 */
export function httpFirstGraph(_owner: boolean): {
  steps: CanvasStep[];
  edges: Edge[];
} {
  const steps: CanvasStep[] = [
    newCanvasStep('http_request', 0, { x: 120, y: 160 }),
    newCanvasStep('notify', 1, { x: 480, y: 160 }),
  ];
  steps[0].name = 'Fetch data (HTTP)';
  steps[0].config = {
    ...defaultStepConfig('http_request'),
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    method: 'GET',
  };
  steps[1].name = 'Notify result';
  steps[1].config = {
    channel: 'log',
    message:
      'HTTP workflow finished.\nTitle/data from API is in memory below.\n\n{{memory}}',
  };

  const edges: Edge[] = [edge(steps[0].clientId, steps[1].clientId)];
  return { steps, edges };
}

/**
 * AI classify starter — needs run input ({{input}}) or webhook body.
 * AI → branch → approval → notify
 */
export function aiClassifyGraph(_owner: boolean): {
  steps: CanvasStep[];
  edges: Edge[];
} {
  const steps: CanvasStep[] = [
    newCanvasStep('llm_call', 0, { x: 60, y: 160 }),
    newCanvasStep('conditional_branch', 1, { x: 360, y: 140 }),
    newCanvasStep('approval_gate', 2, { x: 660, y: 80 }),
    newCanvasStep('notify', 3, { x: 960, y: 180 }),
  ];
  steps[0].name = defaultStepName('llm_call');
  steps[1].name = defaultStepName('conditional_branch');
  steps[2].name = defaultStepName('approval_gate');
  steps[3].name = defaultStepName('notify');
  steps[1].config = {
    ...steps[1].config,
    from_step: 0,
    field: 'answer',
    equals: 'yes',
    then_skip_to: 2,
    else_skip_to: 3,
  };

  const edges: Edge[] = [
    edge(steps[0].clientId, steps[1].clientId),
    edge(steps[1].clientId, steps[2].clientId, 'then'),
    edge(steps[1].clientId, steps[3].clientId, 'else'),
    edge(steps[2].clientId, steps[3].clientId),
  ];
  return { steps, edges };
}

/** Default “New workflow” = AI classify (assignment-style demo). */
export function defaultDemoGraph(owner: boolean): {
  steps: CanvasStep[];
  edges: Edge[];
} {
  return aiClassifyGraph(owner);
}

/**
 * Full test graph: every step type, starts with HTTP (no manual run input).
 * HTTP → AI (reads step_0) → branch → approval → db_write → notify
 *                              ↘________________________→ notify
 */
export function fullStackHttpGraph(owner: boolean): {
  steps: CanvasStep[];
  edges: Edge[];
} {
  const steps: CanvasStep[] = [
    newCanvasStep('http_request', 0, { x: 40, y: 180 }),
    newCanvasStep('llm_call', 1, { x: 300, y: 180 }),
    newCanvasStep('conditional_branch', 2, { x: 560, y: 160 }),
    newCanvasStep('approval_gate', 3, { x: 820, y: 80 }),
    newCanvasStep('db_write', 4, { x: 1080, y: 80 }),
    newCanvasStep('notify', 5, { x: 1340, y: 200 }),
  ];

  steps[0].name = 'Fetch sample API';
  steps[0].config = {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    method: 'GET',
  };

  steps[1].name = 'AI decide from API data';
  steps[1].config = {
    system:
      'You output only valid JSON with key "answer" set to "yes" or "no". No markdown.',
    // Uses HTTP output {{step_0}} — not manual {{input}}
    prompt: `Look at the HTTP API JSON below.
If it has a non-empty "title" field, answer "yes". Otherwise "no".

API data:
"""
{{step_0}}
"""

ONLY JSON:
{"answer":"yes"}
or
{"answer":"no"}`,
    stub_response: '{"answer":"yes"}',
  };

  steps[2].name = 'Branch on AI answer';
  steps[2].config = {
    from_step: 1,
    field: 'answer',
    equals: 'yes',
    then_skip_to: 3,
    else_skip_to: 5,
  };

  steps[3].name = 'Human approval';
  steps[3].config = {
    message: 'AI said yes on the API data. Approve to save and notify?',
  };

  steps[4].name = 'Save to database';
  steps[4].config = { key: 'full_stack_http_test' };

  steps[5].name = 'Notify done';
  steps[5].config = {
    channel: 'log',
    message: 'Full-stack HTTP test finished.\n{{memory}}',
  };

  // If not owner, skip db_write in graph (replace with pass-through notify only path)
  if (!owner) {
    const slim = steps.filter((s) => s.type !== 'db_write');
    slim.forEach((s, i) => {
      s.position = i;
    });
    slim[2].config = {
      ...slim[2].config,
      then_skip_to: 3,
      else_skip_to: 4,
    };
    return {
      steps: slim,
      edges: [
        edge(slim[0].clientId, slim[1].clientId),
        edge(slim[1].clientId, slim[2].clientId),
        edge(slim[2].clientId, slim[3].clientId, 'then'),
        edge(slim[2].clientId, slim[4].clientId, 'else'),
        edge(slim[3].clientId, slim[4].clientId),
      ],
    };
  }

  const edges: Edge[] = [
    edge(steps[0].clientId, steps[1].clientId),
    edge(steps[1].clientId, steps[2].clientId),
    edge(steps[2].clientId, steps[3].clientId, 'then'),
    edge(steps[2].clientId, steps[5].clientId, 'else'),
    edge(steps[3].clientId, steps[4].clientId),
    edge(steps[4].clientId, steps[5].clientId),
  ];
  return { steps, edges };
}

export function starterGraph(
  template: StarterTemplate,
  owner: boolean
): { steps: CanvasStep[]; edges: Edge[] } {
  if (template === 'http') return httpFirstGraph(owner);
  if (template === 'full') return fullStackHttpGraph(owner);
  return aiClassifyGraph(owner);
}

export function edge(
  source: string,
  target: string,
  sourceHandle?: 'then' | 'else' | null
): Edge {
  const isThen = sourceHandle === 'then';
  const isElse = sourceHandle === 'else';
  return {
    id: `e_${source}_${sourceHandle || 'out'}_${target}`,
    source,
    target,
    sourceHandle: sourceHandle || 'out',
    targetHandle: 'in',
    label: isThen ? 'yes' : isElse ? 'no' : undefined,
    animated: isThen,
    style: {
      stroke: isThen ? '#34d399' : isElse ? '#fbbf24' : '#71717a',
      strokeWidth: 2,
    },
    type: 'smoothstep' as const,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: isThen ? '#34d399' : isElse ? '#fbbf24' : '#71717a',
      width: 18,
      height: 18,
    },
  };
}

/** Load saved linear steps → canvas graph */
export function stepsFromWorkflow(steps: WorkflowStep[]): {
  steps: CanvasStep[];
  edges: Edge[];
} {
  if (!steps.length) {
    return defaultDemoGraph(true);
  }
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const canvas: CanvasStep[] = sorted.map((s, i) => {
    const ui = (s.config as { _canvas?: { x?: number; y?: number } })?._canvas;
    return {
      ...s,
      clientId: s.id || uid(),
      config: { ...s.config },
      x: ui?.x ?? 60 + i * 260,
      y: ui?.y ?? 140 + (i % 2) * 40,
    };
  });

  const byPos = Object.fromEntries(canvas.map((s) => [s.position, s]));
  const edges: Edge[] = [];

  for (const s of canvas) {
    if (s.type === 'conditional_branch') {
      const thenTo = Number(s.config?.then_skip_to);
      const elseTo = Number(s.config?.else_skip_to);
      if (byPos[thenTo]) {
        edges.push(edge(s.clientId, byPos[thenTo].clientId, 'then'));
      }
      if (byPos[elseTo] && elseTo !== thenTo) {
        edges.push(edge(s.clientId, byPos[elseTo].clientId, 'else'));
      }
    } else {
      const next = byPos[s.position + 1];
      if (next) {
        edges.push(edge(s.clientId, next.clientId));
      }
    }
  }

  // Deduplicate edges that double-link branch then + sequential
  const seen = new Set<string>();
  const deduped = edges.filter((e) => {
    const k = `${e.source}|${e.sourceHandle}|${e.target}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Remove sequential edge from branch node if it has then/else
  const cleaned = deduped.filter((e) => {
    const src = canvas.find((s) => s.clientId === e.source);
    if (src?.type === 'conditional_branch' && e.sourceHandle === 'out') {
      return false;
    }
    return true;
  });

  return { steps: canvas, edges: cleaned };
}

export function wouldCreateCycle(
  edges: Edge[],
  source: string,
  target: string
): boolean {
  // Can we reach source from target already?
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  if (!adj.has(source)) adj.set(source, []);
  // tentative add
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length) {
    const n = stack.pop()!;
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const t of adj.get(n) || []) stack.push(t);
  }
  return false;
}

/**
 * Validate a proposed connection. Returns error message or null if OK.
 */
export function validateConnection(
  conn: Connection | Edge,
  steps: CanvasStep[],
  edges: Edge[]
): string | null {
  const source = conn.source;
  const target = conn.target;
  if (!source || !target) return 'Missing connection ends';
  if (source === target) return 'A step cannot connect to itself';

  const src = steps.find((s) => s.clientId === source);
  const tgt = steps.find((s) => s.clientId === target);
  if (!src || !tgt) return 'Unknown step';

  const handle = conn.sourceHandle || 'out';

  // Branch must use yes/no handles
  if (src.type === 'conditional_branch') {
    if (handle !== 'then' && handle !== 'else') {
      return 'Decision steps must connect from the “Yes” or “No” ports';
    }
  } else if (handle === 'then' || handle === 'else') {
    return 'Only decision steps have Yes/No ports';
  }

  // One input per node: reconnecting replaces the previous input (n8n-style).
  // One output per handle: reconnecting replaces previous wire from that port.

  if (wouldCreateCycle(edges, source, target)) {
    return 'That connection would create a loop. Loops are not allowed.';
  }

  // Terminal types: still can connect out if user wants
  return null;
}

/** Full graph health check */
export function validateGraph(
  steps: CanvasStep[],
  edges: Edge[]
): GraphIssue[] {
  const issues: GraphIssue[] = [];
  if (!steps.length) {
    issues.push({ level: 'error', message: 'Add at least one step.' });
    return issues;
  }

  const ids = new Set(steps.map((s) => s.clientId));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) {
      issues.push({
        level: 'error',
        message: 'Broken connection to a missing step. Delete the wire.',
      });
    }
  }

  // Incoming / outgoing counts (merges allowed — e.g. Yes and No both end at Notify)
  const inCount = new Map<string, number>();
  const outByHandle = new Map<string, number>();
  for (const s of steps) inCount.set(s.clientId, 0);
  for (const e of edges) {
    inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
    const k = `${e.source}::${e.sourceHandle || 'out'}`;
    outByHandle.set(k, (outByHandle.get(k) || 0) + 1);
  }

  const starts = steps.filter((s) => (inCount.get(s.clientId) || 0) === 0);
  if (starts.length === 0) {
    issues.push({
      level: 'error',
      message: 'No start step — every step has an input (possible loop).',
    });
  } else if (starts.length > 1) {
    issues.push({
      level: 'error',
      message: `Multiple start steps (${starts.map((s) => s.name).join(', ')}). Connect them into one flow, or remove extras.`,
    });
  }

  for (const s of steps) {
    if (s.type === 'conditional_branch') {
      const thenN = outByHandle.get(`${s.clientId}::then`) || 0;
      const elseN = outByHandle.get(`${s.clientId}::else`) || 0;
      if (thenN === 0 && elseN === 0) {
        issues.push({
          level: 'error',
          message: `"${s.name}" (decision) has no Yes/No connections.`,
        });
      } else if (thenN === 0 || elseN === 0) {
        issues.push({
          level: 'warning',
          message: `"${s.name}" should connect both Yes and No for a full branch.`,
        });
      }
      if (thenN > 1 || elseN > 1) {
        issues.push({
          level: 'error',
          message: `"${s.name}" has multiple Yes or No wires — only one each.`,
        });
      }
    } else {
      const outN = edges.filter((e) => e.source === s.clientId).length;
      if (outN > 1) {
        issues.push({
          level: 'error',
          message: `"${s.name}" has multiple next steps. Only decision steps can split.`,
        });
      }
    }
  }

  // Reachability from first start
  if (starts.length === 1) {
    const start = starts[0].clientId;
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      if (!adj.has(e.source)) adj.set(e.source, []);
      adj.get(e.source)!.push(e.target);
    }
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (seen.has(n)) continue;
      seen.add(n);
      for (const t of adj.get(n) || []) stack.push(t);
    }
    for (const s of steps) {
      if (!seen.has(s.clientId)) {
        issues.push({
          level: 'error',
          message: `"${s.name}" is not connected to the main flow (unreachable).`,
        });
      }
    }
  }

  // Cycle check via in-degrees Kahn
  const indeg = new Map(inCount);
  const q = steps
    .filter((s) => (indeg.get(s.clientId) || 0) === 0)
    .map((s) => s.clientId);
  let visited = 0;
  const adj2 = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj2.has(e.source)) adj2.set(e.source, []);
    adj2.get(e.source)!.push(e.target);
  }
  while (q.length) {
    const n = q.shift()!;
    visited++;
    for (const t of adj2.get(n) || []) {
      indeg.set(t, (indeg.get(t) || 1) - 1);
      if (indeg.get(t) === 0) q.push(t);
    }
  }
  if (visited < steps.length && steps.length > 0) {
    issues.push({
      level: 'error',
      message: 'Flow contains a loop. Remove the cycle.',
    });
  }

  return issues;
}

/**
 * Convert free graph → ordered WorkflowSteps for the engine.
 * Branch configs get then_skip_to / else_skip_to as positions.
 */
export function serializeGraph(
  steps: CanvasStep[],
  edges: Edge[]
): { steps: WorkflowStep[]; error?: string } {
  const issues = validateGraph(steps, edges);
  const hard = issues.filter((i) => i.level === 'error');
  if (hard.length) {
    return { steps: [], error: hard.map((i) => i.message).join(' ') };
  }

  const inCount = new Map<string, number>();
  for (const s of steps) inCount.set(s.clientId, 0);
  for (const e of edges) {
    inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
  }
  const start = steps.find((s) => (inCount.get(s.clientId) || 0) === 0)!;

  // BFS order for position assignment (prefer then before else for stability)
  const adj = new Map<string, { target: string; handle: string }[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push({
      target: e.target,
      handle: e.sourceHandle || 'out',
    });
  }
  for (const [, list] of adj) {
    list.sort((a, b) => {
      const rank = (h: string) =>
        h === 'then' ? 0 : h === 'out' ? 1 : h === 'else' ? 2 : 3;
      return rank(a.handle) - rank(b.handle);
    });
  }

  const order: string[] = [];
  const seen = new Set<string>();
  const queue = [start.clientId];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const { target } of adj.get(id) || []) {
      if (!seen.has(target)) queue.push(target);
    }
  }

  const idToPos = new Map(order.map((id, i) => [id, i]));
  const byId = Object.fromEntries(steps.map((s) => [s.clientId, s]));

  const out: WorkflowStep[] = order.map((id, position) => {
    const s = byId[id];
    const config = { ...(s.config || {}) };
    // persist canvas coords
    config._canvas = { x: s.x, y: s.y };

    if (s.type === 'conditional_branch') {
      const outs = adj.get(id) || [];
      const thenE = outs.find((o) => o.handle === 'then');
      const elseE = outs.find((o) => o.handle === 'else');
      const fallback = outs.find((o) => o.handle === 'out');
      config.then_skip_to = thenE
        ? idToPos.get(thenE.target)
        : fallback
          ? idToPos.get(fallback.target)
          : position + 1;
      config.else_skip_to = elseE
        ? idToPos.get(elseE.target)
        : fallback
          ? idToPos.get(fallback.target)
          : position + 1;
      // Prefer explicit config, else nearest Ask AI (llm_call) already in the order,
      // else the immediate predecessor (not always correct for “contains text”).
      if (config.from_step === undefined || config.from_step === null) {
        const llmPos = order.findIndex((oid) => byId[oid]?.type === 'llm_call');
        if (llmPos >= 0 && llmPos < position) {
          config.from_step = llmPos;
        } else {
          const preds = edges.filter((e) => e.target === id);
          if (preds[0]) {
            config.from_step = idToPos.get(preds[0].source) ?? 0;
          }
        }
      } else {
        // Remap old absolute from_step if it was a position in previous layout —
        // when set as number on the canvas step it already refers to intended step index
        // in the *saved* order; keep if still valid, else llm
        const fs = Number(config.from_step);
        if (Number.isNaN(fs) || fs < 0 || fs >= order.length) {
          const llmPos = order.findIndex((oid) => byId[oid]?.type === 'llm_call');
          config.from_step = llmPos >= 0 ? llmPos : 0;
        }
      }
    }

    return {
      id: s.id,
      position,
      type: s.type,
      name: s.name,
      config,
    };
  });

  return { steps: out };
}

/** After connect: replace existing edge from same source handle */
export function applyConnection(
  edges: Edge[],
  conn: Connection,
  steps: CanvasStep[]
): { edges: Edge[]; error?: string } {
  const err = validateConnection(conn, steps, edges);
  if (err) return { edges, error: err };

  const source = conn.source!;
  const target = conn.target!;
  const handle = (conn.sourceHandle || 'out') as 'then' | 'else' | 'out';
  const src = steps.find((s) => s.clientId === source)!;

  let next = edges.filter((e) => {
    // replace existing wire from the same output port
    if (e.source === source && (e.sourceHandle || 'out') === handle) {
      return false;
    }
    // non-branch: only one next step — replace any prior out
    if (src.type !== 'conditional_branch' && e.source === source) {
      return false;
    }
    // allow multiple inputs (merge) — e.g. Yes path and No path into Notify
    return true;
  });

  next = [
    ...next,
    edge(
      source,
      target,
      handle === 'then' || handle === 'else' ? handle : null
    ),
  ];
  return { edges: next };
}
