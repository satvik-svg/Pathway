/**
 * Pure graph-rule tests (mirrors workflow-canvas/graph.ts rules).
 * Run: node scripts/test-graph.mjs
 */
let passed = 0;
let failed = 0;
function ok(name, cond, detail = '') {
  if (cond) {
    passed++;
    console.log('  ✅', name);
  } else {
    failed++;
    console.log('  ❌', name, detail);
  }
}

function wouldCreateCycle(edges, source, target) {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push(e.target);
  }
  const stack = [target];
  const seen = new Set();
  while (stack.length) {
    const n = stack.pop();
    if (n === source) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    for (const t of adj.get(n) || []) stack.push(t);
  }
  return false;
}

function validateConnection(conn, steps, edges) {
  const { source, target } = conn;
  if (!source || !target) return 'Missing ends';
  if (source === target) return 'A step cannot connect to itself';
  const src = steps.find((s) => s.id === source);
  const tgt = steps.find((s) => s.id === target);
  if (!src || !tgt) return 'Unknown';
  const handle = conn.sourceHandle || 'out';
  if (src.type === 'conditional_branch') {
    if (handle !== 'then' && handle !== 'else') {
      return 'Decision steps must connect from Yes or No ports';
    }
  }
  // merges allowed
  if (wouldCreateCycle(edges, source, target)) {
    return 'loop';
  }
  return null;
}

const steps = [
  { id: 'a', type: 'llm_call', name: 'AI' },
  { id: 'b', type: 'http_request', name: 'HTTP' },
  { id: 'c', type: 'conditional_branch', name: 'Branch' },
  { id: 'd', type: 'approval_gate', name: 'Approve' },
  { id: 'e', type: 'notify', name: 'Notify' },
];
const edges = [
  { source: 'a', target: 'b', sourceHandle: 'out' },
  { source: 'b', target: 'c', sourceHandle: 'out' },
  { source: 'c', target: 'd', sourceHandle: 'then' },
  { source: 'c', target: 'e', sourceHandle: 'else' },
  { source: 'd', target: 'e', sourceHandle: 'out' },
];

console.log('=== Connection rules ===');
ok(
  'rejects self-loop',
  validateConnection(
    { source: 'a', target: 'a', sourceHandle: 'out' },
    steps,
    edges
  )?.includes('itself')
);
// Merges allowed (e.g. Yes + No both into Notify) — only block self/cycle/branch ports
ok(
  'allows second input (merge into notify)',
  validateConnection(
    { source: 'a', target: 'e', sourceHandle: 'out' },
    steps,
    edges.filter((e) => e.source !== 'a') // a already has out to b; use free a
  ) === null ||
    validateConnection(
      { source: 'd', target: 'b', sourceHandle: 'out' },
      steps,
      edges.filter((e) => !(e.source === 'd'))
    ) === null
);
ok(
  'detects cycle e→a',
  wouldCreateCycle(edges, 'e', 'a') === true
);
ok(
  'branch rejects out handle',
  validateConnection(
    { source: 'c', target: 'd', sourceHandle: 'out' },
    steps,
    edges
  )?.includes('Yes')
);
ok(
  'valid then is ok (if we clear old then first)',
  validateConnection(
    { source: 'c', target: 'd', sourceHandle: 'then' },
    steps,
    edges.filter((e) => !(e.source === 'c' && e.sourceHandle === 'then'))
  ) === null
);

// serialize positions simulation
function serialize(steps, edges) {
  const inCount = new Map(steps.map((s) => [s.id, 0]));
  for (const e of edges) inCount.set(e.target, (inCount.get(e.target) || 0) + 1);
  const starts = steps.filter((s) => (inCount.get(s.id) || 0) === 0);
  if (starts.length !== 1) return { error: 'bad starts' };
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source).push({ target: e.target, handle: e.sourceHandle || 'out' });
  }
  const order = [];
  const seen = new Set();
  const q = [starts[0].id];
  while (q.length) {
    const id = q.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const { target } of adj.get(id) || []) if (!seen.has(target)) q.push(target);
  }
  const idToPos = new Map(order.map((id, i) => [id, i]));
  const branch = steps.find((s) => s.type === 'conditional_branch');
  const outs = adj.get(branch.id) || [];
  const thenE = outs.find((o) => o.handle === 'then');
  const elseE = outs.find((o) => o.handle === 'else');
  return {
    order,
    then: idToPos.get(thenE.target),
    else: idToPos.get(elseE.target),
  };
}
const ser = serialize(steps, edges);
ok('serialize order starts with a', ser.order[0] === 'a');
ok('branch then points to approve', ser.then === ser.order.indexOf('d'));
ok('branch else points to notify', ser.else === ser.order.indexOf('e'));

console.log('\nResult:', passed, 'passed,', failed, 'failed');
process.exit(failed ? 1 : 0);
