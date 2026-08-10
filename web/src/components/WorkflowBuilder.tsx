'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type OnSelectionChangeParams,
  type NodeChange,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  DELETE_STEPS,
  DELETE_TRIGGERS,
  INSERT_STEPS,
  INSERT_TRIGGERS,
  INSERT_WORKFLOW,
  UPDATE_WORKFLOW,
  gql,
} from '@/lib/graphql';
import { formatMessage } from '@/lib/format';
import {
  type StepType,
  type TriggerType,
  type Workflow,
  type WorkflowTrigger,
} from '@/lib/types';
import { useOrg } from '@/components/OrgContext';
import { StepNode, type StepNodeData } from '@/components/workflow-canvas/StepNode';
import { StepInspector } from '@/components/workflow-canvas/StepInspector';
import { NODE_META } from '@/components/workflow-canvas/nodeMeta';
import {
  type CanvasStep,
  applyConnection,
  defaultDemoGraph,
  starterGraph,
  type StarterTemplate,
  newCanvasStep,
  serializeGraph,
  stepsFromWorkflow,
  validateConnection,
  validateGraph,
  edge as makeEdge,
} from '@/components/workflow-canvas/graph';

function randomSecret() {
  return `whsec_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

interface Props {
  initial?: Workflow | null;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

const nodeTypes = { step: StepNode };

function buildDefaultTriggers(owner: boolean): WorkflowTrigger[] {
  const base: WorkflowTrigger[] = [
    { type: 'manual', config: {}, is_active: true },
  ];
  if (owner) {
    base.push({
      type: 'webhook',
      config: {},
      is_active: true,
      webhook_secret: randomSecret(),
    });
  }
  return base;
}

function canvasToRfNodes(steps: CanvasStep[]): Node[] {
  // positionIndex = order by y then x for display number
  const sorted = [...steps].sort(
    (a, b) => a.x - b.x || a.y - b.y
  );
  const orderIndex = new Map(sorted.map((s, i) => [s.clientId, i]));
  return steps.map((s) => ({
    id: s.clientId,
    type: 'step',
    position: { x: s.x, y: s.y },
    data: {
      stepType: s.type,
      label: s.name,
      positionIndex: orderIndex.get(s.clientId) ?? 0,
    } satisfies StepNodeData,
    dragHandle: undefined,
  }));
}

function styleEdges(edges: Edge[]): Edge[] {
  return edges.map((e) => {
    const h = e.sourceHandle || 'out';
    const isThen = h === 'then';
    const isElse = h === 'else';
    return {
      ...e,
      label: isThen ? 'yes' : isElse ? 'no' : e.label,
      animated: isThen || e.animated,
      style: {
        stroke: isThen ? '#34d399' : isElse ? '#fbbf24' : '#a1a1aa',
        strokeWidth: 2.5,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isThen ? '#34d399' : isElse ? '#fbbf24' : '#a1a1aa',
        width: 18,
        height: 18,
      },
      interactionWidth: 24,
    };
  });
}

export function WorkflowBuilder(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowBuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowBuilderInner({ initial, onSaved, onCancel }: Props) {
  const { org, canEdit, isOwner } = useOrg();
  const isNew = !initial?.id;
  const [template, setTemplate] = useState<StarterTemplate>('ai');
  const [name, setName] = useState(initial?.name || 'New workflow');
  const [description, setDescription] = useState(
    initial?.description ||
      'AI classifies run input → branch → approval → notify. Use Run when the flow needs {{input}}.'
  );

  const initialGraph = useMemo(() => {
    if (initial?.steps?.length) {
      return stepsFromWorkflow(initial.steps);
    }
    return defaultDemoGraph(isOwner);
  }, [initial, isOwner]);

  const [canvasSteps, setCanvasSteps] = useState<CanvasStep[]>(
    initialGraph.steps
  );
  const [nodes, setNodes, onNodesChangeBase] = useNodesState(
    canvasToRfNodes(initialGraph.steps)
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(
    styleEdges(initialGraph.edges)
  );

  function applyTemplate(t: StarterTemplate) {
    setTemplate(t);
    const g = starterGraph(t, isOwner);
    setCanvasSteps(g.steps);
    setNodes(canvasToRfNodes(g.steps));
    setEdges(styleEdges(g.edges));
    setSelectedId(g.steps[0]?.clientId ?? null);
    if (t === 'http') {
      setName('HTTP fetch → notify');
      setDescription(
        'Calls a public API (no run input). Result is notified / logged.'
      );
    } else if (t === 'full') {
      setName('Full stack HTTP test');
      setDescription(
        'No manual input. HTTP → AI (from API data) → branch → approval → db_write → notify. Every step type.'
      );
    } else {
      setName('AI classify → approve');
      setDescription(
        'Needs run input (or webhook body). AI returns {"answer":"yes"|"no"}, then branch / approval / notify.'
      );
    }
    setError(null);
  }

  const [triggers, setTriggers] = useState<WorkflowTrigger[]>(() => {
    if (initial?.triggers?.length) {
      return initial.triggers.map((t) => ({
        type: t.type as TriggerType,
        config: t.config || {},
        is_active: t.is_active,
        webhook_secret: t.webhook_secret,
      }));
    }
    return buildDefaultTriggers(isOwner);
  });

  const [selectedId, setSelectedId] = useState<string | null>(
    initialGraph.steps[0]?.clientId ?? null
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectHint, setConnectHint] = useState<string | null>(null);
  const [showMeta, setShowMeta] = useState(false);

  const issues = useMemo(
    () => validateGraph(canvasSteps, edges),
    [canvasSteps, edges]
  );
  const errors = issues.filter((i) => i.level === 'error');

  // Sync node labels from canvasSteps without resetting positions
  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => {
        const s = canvasSteps.find((c) => c.clientId === n.id);
        if (!s) return n;
        return {
          ...n,
          data: {
            ...n.data,
            label: s.name,
            stepType: s.type,
          },
        };
      })
    );
  }, [canvasSteps, setNodes]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChangeBase(changes);
      // Persist drag positions into canvasSteps
      for (const ch of changes) {
        if (ch.type === 'position' && ch.position && ch.id) {
          const { id, position } = ch;
          if (ch.dragging === false || ch.position) {
            setCanvasSteps((prev) =>
              prev.map((s) =>
                s.clientId === id
                  ? { ...s, x: position.x, y: position.y }
                  : s
              )
            );
          }
        }
      }
    },
    [onNodesChangeBase]
  );

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const msg = validateConnection(conn, canvasSteps, edges);
      return msg == null;
    },
    [canvasSteps, edges]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      const result = applyConnection(edges, conn, canvasSteps);
      if (result.error) {
        setConnectHint(result.error);
        setError(result.error);
        return;
      }
      setConnectHint(null);
      setError(null);
      setEdges(styleEdges(result.edges));
    },
    [edges, canvasSteps, setEdges]
  );

  const onSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    const n = params.nodes[0];
    if (n) setSelectedId(n.id);
  }, []);

  const selectedStep =
    canvasSteps.find((s) => s.clientId === selectedId) ?? null;
  const selectedIndex = selectedStep
    ? [...canvasSteps]
        .sort((a, b) => a.x - b.x)
        .findIndex((s) => s.clientId === selectedId)
    : -1;

  const palette = useMemo(
    () =>
      (Object.keys(NODE_META) as StepType[]).filter(
        (t) => !NODE_META[t].ownerOnly || isOwner
      ),
    [isOwner]
  );

  function addStep(type: StepType) {
    if ((type === 'db_write' || type === 'notify') && !isOwner) {
      setError('Only owners can add Save to database or Send a notification');
      return;
    }
    const step = newCanvasStep(type, canvasSteps.length, {
      x: 120 + canvasSteps.length * 40,
      y: 100 + (canvasSteps.length % 3) * 80,
    });
    setCanvasSteps((prev) => [...prev, step]);
    setNodes((nds) => [
      ...nds,
      {
        id: step.clientId,
        type: 'step',
        position: { x: step.x, y: step.y },
        data: {
          stepType: step.type,
          label: step.name,
          positionIndex: canvasSteps.length,
        } satisfies StepNodeData,
      },
    ]);
    setSelectedId(step.clientId);
    setError(null);
  }

  function updateStep(clientId: string, patch: Partial<CanvasStep>) {
    setCanvasSteps((prev) =>
      prev.map((s) => (s.clientId === clientId ? { ...s, ...patch } : s))
    );
  }

  function removeStep(clientId: string) {
    setCanvasSteps((prev) => prev.filter((s) => s.clientId !== clientId));
    setNodes((nds) => nds.filter((n) => n.id !== clientId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== clientId && e.target !== clientId)
    );
    setSelectedId((id) => (id === clientId ? null : id));
  }

  function toggleTrigger(type: TriggerType) {
    if (type === 'webhook' && !isOwner) {
      setError('Only owners can add webhook triggers');
      return;
    }
    setTriggers((prev) => {
      const exists = prev.find((t) => t.type === type);
      if (exists) {
        if (type === 'manual') return prev;
        return prev.filter((t) => t.type !== type);
      }
      return [
        ...prev,
        {
          type,
          config:
            type === 'database_event'
              ? { table: 'watched_rows' }
              : type === 'scheduled'
                ? { every: '5m' }
                : {},
          is_active: true,
          webhook_secret: type === 'webhook' ? randomSecret() : null,
        },
      ];
    });
  }

  async function save() {
    if (!org) return;
    setSaving(true);
    setError(null);
    try {
      const serialized = serializeGraph(canvasSteps, edges);
      if (serialized.error || !serialized.steps.length) {
        throw new Error(
          serialized.error || 'Fix the flow before saving (see errors below).'
        );
      }

      let workflowId = initial?.id;
      if (workflowId) {
        await gql(UPDATE_WORKFLOW, { id: workflowId, name, description });
        await gql(DELETE_STEPS, { workflow_id: workflowId });
        await gql(DELETE_TRIGGERS, { workflow_id: workflowId });
      } else {
        const created = await gql<{ insert_workflows_one: { id: string } }>(
          INSERT_WORKFLOW,
          { object: { org_id: org.id, name, description } }
        );
        workflowId = created.insert_workflows_one.id;
      }

      await gql(INSERT_STEPS, {
        objects: serialized.steps.map((s) => ({
          workflow_id: workflowId,
          position: s.position,
          type: s.type,
          name: s.name,
          config: s.config,
        })),
      });

      if (triggers.length) {
        await gql(INSERT_TRIGGERS, {
          objects: triggers.map((t) => ({
            workflow_id: workflowId,
            type: t.type,
            config: t.config,
            is_active: t.is_active,
            webhook_secret: t.webhook_secret || null,
          })),
        });
      }
      onSaved(workflowId!);
    } catch (e) {
      setError(formatMessage(e));
    } finally {
      setSaving(false);
    }
  }

  if (!canEdit) {
    return (
      <div className="text-zinc-400 text-sm">
        Viewers cannot create or edit workflows.
      </div>
    );
  }

  const TRIGGER_META: Record<TriggerType, string> = {
    manual: 'Manual',
    webhook: 'Webhook',
    scheduled: 'Schedule',
    database_event: 'DB event',
  };

  const webhookTrigger = triggers.find(
    (t) => t.type === 'webhook' && t.webhook_secret
  );

  return (
    <div className="flex flex-col h-[calc(100vh-6.5rem)] min-h-[560px] w-full">
      {/* Compact top bar — name + actions */}
      <div className="shrink-0 flex flex-wrap items-center gap-2 mb-2 px-0.5">
        <input
          className="flex-1 min-w-[200px] bg-transparent text-lg font-semibold text-zinc-50 outline-none placeholder:text-zinc-600 border-b border-transparent focus:border-zinc-600 py-1"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Workflow name"
        />
        {isNew && (
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5 flex-wrap">
            <button
              type="button"
              onClick={() => applyTemplate('ai')}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                template === 'ai'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="Default: AI → branch → approval (needs input)"
            >
              Default (AI)
            </button>
            <button
              type="button"
              onClick={() => applyTemplate('http')}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                template === 'http'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="HTTP → notify (no input)"
            >
              HTTP only
            </button>
            <button
              type="button"
              onClick={() => applyTemplate('full')}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                template === 'full'
                  ? 'bg-zinc-800 text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              }`}
              title="HTTP → AI → branch → approval → db → notify"
            >
              Full test (no input)
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowMeta((v) => !v)}
          className={`text-[12px] px-2.5 py-1.5 rounded-lg border transition-colors ${
            showMeta
              ? 'border-zinc-600 text-zinc-200 bg-zinc-900'
              : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'
          }`}
        >
          {showMeta ? 'Hide details' : 'Details & triggers'}
        </button>
        {errors.length > 0 && (
          <span className="text-[11px] text-red-400">
            {errors.length} error{errors.length === 1 ? '' : 's'}
          </span>
        )}
        <button
          type="button"
          onClick={onCancel}
          className="text-[13px] text-zinc-500 hover:text-zinc-200 px-3 py-1.5 rounded-lg"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving || errors.length > 0}
          onClick={() => void save()}
          className="text-[13px] font-semibold bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-1.5 rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : initial ? 'Save' : 'Create'}
        </button>
      </div>

      {/* Collapsible meta (description + triggers) */}
      {showMeta && (
        <div className="shrink-0 mb-2 rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 space-y-3">
          <input
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-[13px] text-zinc-300 outline-none focus:border-zinc-600"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description (optional)"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-zinc-600 mr-1">Starts via</span>
            {(
              [
                'manual',
                'webhook',
                'scheduled',
                'database_event',
              ] as TriggerType[]
            ).map((type) => {
              const active = triggers.some((t) => t.type === type);
              const locked = type === 'webhook' && !isOwner && !active;
              return (
                <button
                  key={type}
                  type="button"
                  disabled={locked}
                  onClick={() => toggleTrigger(type)}
                  className={`text-[12px] px-2.5 py-1 rounded-md border transition-colors ${
                    active
                      ? 'border-zinc-500 bg-zinc-800 text-zinc-100'
                      : 'border-zinc-800 text-zinc-600 hover:text-zinc-400'
                  } ${locked ? 'opacity-40' : ''}`}
                >
                  {TRIGGER_META[type]}
                </button>
              );
            })}
          </div>
          {webhookTrigger?.webhook_secret && (
            <button
              type="button"
              className="block w-full text-left text-[11px] font-mono text-zinc-500 hover:text-emerald-400/90 truncate"
              title="Click to copy webhook secret"
              onClick={() =>
                void navigator.clipboard?.writeText(
                  webhookTrigger.webhook_secret || ''
                )
              }
            >
              Secret: {webhookTrigger.webhook_secret}
            </button>
          )}
        </div>
      )}

      {(error || connectHint) && (
        <div className="shrink-0 mb-2 text-[13px] text-amber-200/90 px-1">
          {error || connectHint}
        </div>
      )}

      {errors.length > 0 && (
        <div className="shrink-0 mb-2 text-[12px] text-red-400/90 px-1 space-y-0.5 max-h-16 overflow-y-auto">
          {errors.map((i, idx) => (
            <p key={idx}>✕ {i.message}</p>
          ))}
        </div>
      )}

      {/* Centered workspace: palette | canvas | inspector */}
      <div className="flex-1 min-h-0 flex justify-center">
        <div className="w-full max-w-[1400px] h-full grid grid-cols-1 lg:grid-cols-[168px_minmax(0,1fr)_260px] rounded-xl border border-zinc-800 overflow-hidden bg-[#0c0c0f]">
          {/* Palette */}
          <aside className="hidden lg:flex flex-col border-r border-zinc-800/90 bg-zinc-950/80">
            <p className="px-3 pt-3 pb-2 text-[10px] uppercase tracking-wider text-zinc-600 font-medium">
              Add step
            </p>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
              {palette.map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => addStep(type)}
                  className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-zinc-900 transition-colors group"
                >
                  <span
                    className={`w-7 h-7 rounded-md bg-gradient-to-br ${NODE_META[type].color} text-white text-xs flex items-center justify-center shrink-0`}
                  >
                    {NODE_META[type].icon}
                  </span>
                  <span className="text-[12px] text-zinc-400 group-hover:text-zinc-200 truncate">
                    {NODE_META[type].title}
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <div className="lg:hidden border-b border-zinc-800 p-2 flex gap-1 overflow-x-auto bg-zinc-950">
            {palette.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addStep(type)}
                className={`shrink-0 text-[11px] px-2.5 py-1 rounded-md text-white bg-gradient-to-r ${NODE_META[type].color}`}
              >
                {NODE_META[type].title}
              </button>
            ))}
          </div>

          {/* Canvas — main focus */}
          <div className="relative min-h-[420px] h-full bg-[#0c0c0f]">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onSelectionChange={onSelectionChange}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.35, maxZoom: 1 }}
              proOptions={{ hideAttribution: true }}
              nodesDraggable
              nodesConnectable
              elementsSelectable
              edgesReconnectable
              deleteKeyCode={['Backspace', 'Delete']}
              connectionLineStyle={{ stroke: '#71717a', strokeWidth: 2 }}
              defaultEdgeOptions={{
                type: 'smoothstep',
                style: { strokeWidth: 2 },
              }}
              className="workflow-canvas"
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="#27272a"
              />
              <Controls className="!bg-zinc-900 !border-zinc-800 !rounded-lg !shadow-none" />
              <MiniMap
                className="!bg-zinc-900/90 !border-zinc-800 !rounded-lg"
                nodeColor={(n) => {
                  const t = (n.data as StepNodeData)?.stepType;
                  if (t === 'llm_call') return '#7c3aed';
                  if (t === 'http_request') return '#0284c7';
                  if (t === 'conditional_branch') return '#d97706';
                  if (t === 'approval_gate') return '#e11d48';
                  if (t === 'notify') return '#db2777';
                  return '#3f3f46';
                }}
                maskColor="rgba(0,0,0,0.7)"
              />
            </ReactFlow>
          </div>

          {/* Inspector */}
          <aside className="border-l border-zinc-800/90 bg-zinc-950/90 min-h-0 overflow-hidden flex flex-col">
            <StepInspector
              step={
                selectedStep
                  ? {
                      position: selectedIndex,
                      type: selectedStep.type,
                      name: selectedStep.name,
                      config: selectedStep.config,
                      id: selectedStep.id,
                    }
                  : null
              }
              index={Math.max(0, selectedIndex)}
              allSteps={[...canvasSteps]
                .sort((a, b) => a.x - b.x || a.y - b.y)
                .map((s, i) => ({
                  position: i,
                  name: s.name,
                  type: s.type,
                  config: s.config as Record<string, unknown>,
                }))}
              selectionKey={selectedId || 'none'}
              onChange={(patch) => {
                if (!selectedId) return;
                updateStep(selectedId, patch);
                if (
                  patch.config &&
                  selectedStep?.type === 'conditional_branch'
                ) {
                  const ordered = [...canvasSteps].sort(
                    (a, b) => a.x - b.x || a.y - b.y
                  );
                  const cfg = patch.config as Record<string, unknown>;
                  const thenPos = Number(cfg.then_skip_to);
                  const elsePos = Number(cfg.else_skip_to);
                  setEdges((eds) => {
                    let next = eds.filter(
                      (e) =>
                        !(
                          e.source === selectedId &&
                          (e.sourceHandle === 'then' ||
                            e.sourceHandle === 'else')
                        )
                    );
                    const thenTarget = ordered[thenPos]?.clientId;
                    const elseTarget = ordered[elsePos]?.clientId;
                    if (thenTarget) {
                      next = [
                        ...next,
                        makeEdge(selectedId, thenTarget, 'then'),
                      ];
                    }
                    if (elseTarget && elseTarget !== thenTarget) {
                      next = [
                        ...next,
                        makeEdge(selectedId, elseTarget, 'else'),
                      ];
                    }
                    return styleEdges(next);
                  });
                }
              }}
              onRemove={() => {
                if (!selectedId) return;
                removeStep(selectedId);
              }}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
