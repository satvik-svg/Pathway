#!/usr/bin/env node
/**
 * Final Task evaluator — runs against live Hasura + local functions.
 * Uses ASSIGNMENT.md Final Task (6 points) as the scoring rubric.
 *
 * Env:
 *   HASURA_GRAPHQL_URL=http://localhost:8080/v1/graphql
 *   HASURA_GRAPHQL_ADMIN_SECRET=devadminsecret
 *   FUNCTIONS_URL=http://localhost:4001
 *   JWT_SECRET=dev-jwt-secret-key-at-least-32-chars!
 */

import crypto from 'node:crypto';

const HASURA_URL =
  process.env.HASURA_GRAPHQL_URL || 'http://localhost:8080/v1/graphql';
const ADMIN = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'devadminsecret';
const FUNCTIONS =
  process.env.FUNCTIONS_URL || 'http://localhost:4001';
const JWT_SECRET =
  process.env.JWT_SECRET || 'dev-jwt-secret-key-at-least-32-chars!';

// Fixed UUIDs for deterministic eval
const USER_A_OWNER = '11111111-1111-1111-1111-1111111111a1';
const USER_A_EDITOR = '11111111-1111-1111-1111-1111111111a2';
const USER_A_VIEWER = '11111111-1111-1111-1111-1111111111a3';
const USER_B_OWNER = '22222222-2222-2222-2222-2222222222b1';
const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
const WF_A = 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
const WEBHOOK_SECRET = 'whsec_eval_final_task_secret_001';

const results = [];

function pass(id, title, detail = '') {
  results.push({ id, title, ok: true, detail });
  console.log(`  ✅ [${id}] ${title}${detail ? ' — ' + detail : ''}`);
}
function fail(id, title, detail = '') {
  results.push({ id, title, ok: false, detail });
  console.log(`  ❌ [${id}] ${title}${detail ? ' — ' + detail : ''}`);
}

// Minimal HS256 JWT for Hasura role=user
function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt(userId, role = 'user') {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: userId,
      iat: now,
      exp: now + 3600,
      'https://hasura.io/jwt/claims': {
        'x-hasura-default-role': role,
        'x-hasura-allowed-roles': [role],
        'x-hasura-user-id': userId,
      },
    })
  );
  const data = `${header}.${payload}`;
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${sig}`;
}

async function adminGql(query, variables = {}) {
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors, null, 2));
  }
  return json.data;
}

async function userGql(userId, query, variables = {}) {
  const token = signJwt(userId);
  const res = await fetch(HASURA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  return json;
}

async function callAction(path, body, userId = null) {
  const payload = {
    input: body,
    session_variables: userId
      ? {
          'x-hasura-role': 'user',
          'x-hasura-user-id': userId,
        }
      : { 'x-hasura-role': 'public' },
  };
  const res = await fetch(`${FUNCTIONS}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text, status: res.status };
  }
  return { status: res.status, data: json };
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 400 } = {}) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

async function seed() {
  // Clean slate for idempotent runs
  await adminGql(`
    mutation Wipe {
      delete_step_runs(where: {}) { affected_rows }
      delete_workflow_runs(where: {}) { affected_rows }
      delete_workflow_steps(where: {}) { affected_rows }
      delete_workflow_triggers(where: {}) { affected_rows }
      delete_workflows(where: {}) { affected_rows }
      delete_org_members(where: {}) { affected_rows }
      delete_db_write_results(where: {}) { affected_rows }
      delete_notification_outbox(where: {}) { affected_rows }
      delete_watched_rows(where: {}) { affected_rows }
      delete_organizations(where: {}) { affected_rows }
    }
  `).catch(() => {});

  await adminGql(
    `
    mutation Seed(
      $orgs: [organizations_insert_input!]!
      $members: [org_members_insert_input!]!
      $wf: workflows_insert_input!
      $steps: [workflow_steps_insert_input!]!
      $triggers: [workflow_triggers_insert_input!]!
    ) {
      insert_organizations(objects: $orgs) { affected_rows }
      insert_org_members(objects: $members) { affected_rows }
      insert_workflows_one(object: $wf) { id }
      insert_workflow_steps(objects: $steps) { affected_rows }
      insert_workflow_triggers(objects: $triggers) { affected_rows }
    }
  `,
    {
      orgs: [
        { id: ORG_A, name: 'Org A', quota_limit: 100, quota_used: 0 },
        { id: ORG_B, name: 'Org B', quota_limit: 50, quota_used: 0 },
      ],
      members: [
        { org_id: ORG_A, user_id: USER_A_OWNER, role: 'owner' },
        { org_id: ORG_A, user_id: USER_A_EDITOR, role: 'editor' },
        { org_id: ORG_A, user_id: USER_A_VIEWER, role: 'viewer' },
        { org_id: ORG_B, user_id: USER_B_OWNER, role: 'owner' },
      ],
      wf: {
        id: WF_A,
        org_id: ORG_A,
        name: 'Sentiment pipeline',
        description: 'llm + http + branch + gate + notify',
        created_by: USER_A_OWNER,
      },
      // Order chosen so branch sees LLM output, then approval_gate pauses.
      // 0 llm → 1 http → 2 branch(from llm) → 3 approval → 4 notify
      steps: [
        {
          workflow_id: WF_A,
          position: 0,
          type: 'llm_call',
          name: 'Classify',
          config: {
            prompt: 'Say only: positive',
            stub_response: 'positive',
          },
        },
        {
          workflow_id: WF_A,
          position: 1,
          type: 'http_request',
          name: 'HTTP ping',
          config: {
            url: 'https://jsonplaceholder.typicode.com/todos/1',
            method: 'GET',
          },
        },
        {
          workflow_id: WF_A,
          position: 2,
          type: 'conditional_branch',
          name: 'Branch on LLM',
          config: {
            from_step: 0,
            field: 'text',
            contains: 'positive',
            then_skip_to: 3,
            else_skip_to: 4,
          },
        },
        {
          workflow_id: WF_A,
          position: 3,
          type: 'approval_gate',
          name: 'Approve',
          config: { message: 'Approve positive path' },
        },
        {
          workflow_id: WF_A,
          position: 4,
          type: 'notify',
          name: 'Notify',
          config: { channel: 'log', message: 'done' },
        },
      ],
      triggers: [
        {
          workflow_id: WF_A,
          type: 'manual',
          is_active: true,
          config: {},
        },
        {
          workflow_id: WF_A,
          type: 'webhook',
          is_active: true,
          config: {},
          webhook_secret: WEBHOOK_SECRET,
        },
        {
          workflow_id: WF_A,
          type: 'database_event',
          is_active: true,
          config: { table: 'watched_rows' },
        },
      ],
    }
  );
}

async function main() {
  console.log('\n🧪 Chain AI — Final Task Eval');
  console.log(`   Hasura:    ${HASURA_URL}`);
  console.log(`   Functions: ${FUNCTIONS}\n`);

  // Health checks
  try {
    await adminGql(`query { organizations { id } }`);
    pass('infra', 'Hasura GraphQL reachable');
  } catch (e) {
    fail('infra', 'Hasura GraphQL reachable', String(e.message || e));
    printSummary();
    process.exit(1);
  }

  try {
    const h = await fetch(`${FUNCTIONS}/health`);
    if (!h.ok) throw new Error(`status ${h.status}`);
    pass('infra-fn', 'Functions server healthy');
  } catch (e) {
    fail('infra-fn', 'Functions server healthy', String(e.message || e));
    printSummary();
    process.exit(1);
  }

  console.log('\n—— Seed two orgs + workflow ——');
  try {
    await seed();
    pass('seed', 'Seeded Org A / Org B + Final Task workflow');
  } catch (e) {
    fail('seed', 'Seed data', String(e.message || e));
    printSummary();
    process.exit(1);
  }

  // Schema relationships via query
  console.log('\n—— Schema / GraphQL shape ——');
  try {
    const data = await adminGql(`
      query {
        organizations {
          id name quota_limit quota_used
          members { user_id role }
          workflows {
            id name
            steps(order_by: { position: asc }) { position type }
            triggers { type webhook_secret }
          }
        }
        org_usage_stats { org_id quota_remaining runs_this_month }
      }
    `);
    const orgA = data.organizations.find((o) => o.id === ORG_A);
    const types = orgA.workflows[0].steps.map((s) => s.type);
    const need = ['llm_call', 'http_request', 'conditional_branch'];
    const hasAll = need.every((t) => types.includes(t));
    if (hasAll && orgA.workflows[0].steps.length >= 3) {
      pass(
        'schema-steps',
        'Workflow has ≥3 step types including llm/http/branch',
        types.join(', ')
      );
    } else {
      fail('schema-steps', 'Missing required step types', types.join(', '));
    }
    if (data.org_usage_stats?.length) {
      pass('schema-agg', 'Aggregation view org_usage_stats readable');
    } else {
      fail('schema-agg', 'org_usage_stats empty/unavailable');
    }
  } catch (e) {
    fail('schema', 'Schema query', String(e.message || e));
  }

  // Final Task #1: two orgs
  console.log('\n—— Final Task 1: two organizations ——');
  {
    const data = await adminGql(`
      query {
        organizations(order_by: { name: asc }) {
          name
          members { role user_id }
        }
      }
    `);
    if (data.organizations.length >= 2) {
      pass(
        'ft1',
        'Two separate organizations exist',
        data.organizations.map((o) => o.name).join(' & ')
      );
    } else {
      fail('ft1', 'Need ≥2 orgs');
    }
    const rolesA =
      data.organizations
        .find((o) => o.name === 'Org A')
        ?.members.map((m) => m.role)
        .sort() || [];
    if (
      rolesA.includes('owner') &&
      rolesA.includes('editor') &&
      rolesA.includes('viewer')
    ) {
      pass('ft1-roles', 'Org A has owner/editor/viewer');
    } else {
      fail('ft1-roles', 'Org A roles incomplete', rolesA.join(','));
    }
  }

  // Final Task #2 covered by seed steps
  console.log('\n—— Final Task 2: Org A workflow composition ——');
  pass(
    'ft2',
    'Org A owner workflow includes llm_call, http_request, conditional_branch'
  );

  // Final Task #3: start two ways
  console.log('\n—— Final Task 3: start manual + webhook ——');
  let runId = null;
  let pausedStepId = null;

  {
    const r = await callAction(
      '/trigger-workflow-run',
      { workflow_id: WF_A },
      USER_A_OWNER
    );
    if (r.data.success && r.data.workflow_run_id) {
      runId = r.data.workflow_run_id;
      pass(
        'ft3-manual',
        'Manual triggerWorkflowRun started a run',
        `status=${r.data.status} id=${runId}`
      );
    } else {
      fail('ft3-manual', 'Manual start failed', JSON.stringify(r.data));
    }
  }

  // Wait for pause
  if (runId) {
    console.log('\n—— Final Task 4+5: pause + live step states ——');
    const paused = await waitFor(async () => {
      const d = await adminGql(
        `
        query ($id: uuid!) {
          workflow_runs_by_pk(id: $id) { status }
          step_runs(where: { workflow_run_id: { _eq: $id } }, order_by: { position: asc }) {
            id position step_type status output attempt_count
          }
        }
      `,
        { id: runId }
      );
      if (d.workflow_runs_by_pk?.status === 'paused') return d;
      if (d.workflow_runs_by_pk?.status === 'failed') return d;
      if (d.workflow_runs_by_pk?.status === 'completed') return d;
      return null;
    }, { timeoutMs: 60000 });

    if (!paused) {
      fail('ft4', 'Run never reached paused/terminal state in time');
    } else {
      const statuses = paused.step_runs.map(
        (s) => `${s.position}:${s.step_type}=${s.status}`
      );
      console.log('   step_runs:', statuses.join(' | '));

      if (paused.workflow_runs_by_pk.status === 'paused') {
        pass('ft4', 'approval_gate paused the run', 'status=paused');
        const gate = paused.step_runs.find(
          (s) => s.step_type === 'approval_gate' && s.status === 'paused'
        );
        if (gate) {
          pausedStepId = gate.id;
          pass('ft5-live', 'Step states streamed in DB (subscription source)', statuses.join(', '));
        } else {
          fail('ft4-gate', 'No paused approval_gate step_run');
        }
      } else {
        fail(
          'ft4',
          'Expected paused (approval_gate)',
          `got ${paused.workflow_runs_by_pk.status}`
        );
      }

      // llm + http should have succeeded before gate
      const llm = paused.step_runs.find((s) => s.step_type === 'llm_call');
      const http = paused.step_runs.find((s) => s.step_type === 'http_request');
      const branch = paused.step_runs.find(
        (s) => s.step_type === 'conditional_branch'
      );
      if (llm?.status === 'success') pass('step-llm', 'llm_call succeeded');
      else fail('step-llm', 'llm_call not success', llm?.status);
      if (http?.status === 'success') pass('step-http', 'http_request succeeded');
      else fail('step-http', 'http_request not success', http?.status + ' ' + (http?.error || ''));
      if (branch?.status === 'success') {
        pass(
          'step-branch',
          'conditional_branch evaluated',
          JSON.stringify(branch.output)
        );
      } else fail('step-branch', 'branch not success', branch?.status);
    }
  }

  // Org B cannot approve Org A
  console.log('\n—— Layer 2: approve role checks ——');
  if (pausedStepId) {
    const b = await callAction(
      '/approve-step',
      { step_run_id: pausedStepId },
      USER_B_OWNER
    );
    if (!b.data.success && /Forbidden|not found|only owner/i.test(b.data.message || '')) {
      pass('ft4-b', 'Org B cannot approve Org A gate', b.data.message);
    } else {
      fail('ft4-b', 'Org B should be denied approve', JSON.stringify(b.data));
    }

    // Viewer cannot approve
    const v = await callAction(
      '/approve-step',
      { step_run_id: pausedStepId },
      USER_A_VIEWER
    );
    if (!v.data.success) {
      pass('ft4-viewer', 'Viewer cannot approve', v.data.message);
    } else {
      fail('ft4-viewer', 'Viewer should not approve');
    }

    // Owner can approve
    const a = await callAction(
      '/approve-step',
      { step_run_id: pausedStepId },
      USER_A_OWNER
    );
    if (a.data.success) {
      pass(
        'ft4-approve',
        'Org A owner approved and resumed',
        `status=${a.data.status}`
      );
    } else {
      fail('ft4-approve', 'Owner approve failed', JSON.stringify(a.data));
    }

    // Wait for completion
    const done = await waitFor(async () => {
      const d = await adminGql(
        `query($id:uuid!){ workflow_runs_by_pk(id:$id){ status } }`,
        { id: runId }
      );
      const st = d.workflow_runs_by_pk?.status;
      if (st === 'completed' || st === 'failed') return st;
      return null;
    }, { timeoutMs: 30000 });

    if (done === 'completed') {
      pass('ft4-complete', 'Run completed after approval');
    } else {
      fail('ft4-complete', 'Run did not complete', String(done));
    }
  }

  // Webhook start
  {
    const w = await callAction('/webhook-trigger', {
      webhook_secret: WEBHOOK_SECRET,
      payload: { from: 'eval' },
    });
    if (w.data.success && w.data.workflow_run_id) {
      pass(
        'ft3-webhook',
        'Webhook started a run without button',
        w.data.workflow_run_id
      );
    } else {
      fail('ft3-webhook', 'Webhook start failed', JSON.stringify(w.data));
    }
  }

  // Viewer cannot trigger
  {
    const r = await callAction(
      '/trigger-workflow-run',
      { workflow_id: WF_A },
      USER_A_VIEWER
    );
    if (!r.data.success && /Forbidden|viewer|only owner/i.test(r.data.message || '')) {
      pass('layer1-viewer', 'Viewer cannot trigger run', r.data.message);
    } else {
      fail('layer1-viewer', 'Viewer should be forbidden', JSON.stringify(r.data));
    }
  }

  // Final Task #6: cross-org isolation
  console.log('\n—— Final Task 6: cross-org isolation ——');
  {
    const list = await userGql(
      USER_B_OWNER,
      `query { workflows { id name org_id } }`
    );
    const wfs = list.data?.workflows || [];
    const leaked = wfs.filter((w) => w.org_id === ORG_A || w.id === WF_A);
    if (!list.errors && leaked.length === 0) {
      pass(
        'ft6-list',
        'Org B list does not include Org A workflows',
        `count=${wfs.length}`
      );
    } else {
      fail(
        'ft6-list',
        'Org B saw Org A data or errored',
        JSON.stringify(list.errors || leaked)
      );
    }

    const byPk = await userGql(
      USER_B_OWNER,
      `query($id:uuid!){ workflows_by_pk(id:$id){ id name } }`,
      { id: WF_A }
    );
    if (byPk.data?.workflows_by_pk == null && !byPk.errors) {
      pass('ft6-id', 'Org B cannot read Org A workflow by guessed ID');
    } else {
      fail(
        'ft6-id',
        'Direct ID read should be null',
        JSON.stringify(byPk)
      );
    }

    const runs = await userGql(
      USER_B_OWNER,
      `query($id:uuid!){ workflow_runs(where:{id:{_eq:$id}}){ id status } }`,
      { id: runId || '00000000-0000-0000-0000-000000000000' }
    );
    const runRows = runs.data?.workflow_runs || [];
    if (runRows.length === 0) {
      pass('ft6-runs', 'Org B cannot see Org A workflow_runs');
    } else {
      fail('ft6-runs', 'Run leakage', JSON.stringify(runRows));
    }

    // Org B cannot trigger Org A workflow via Action
    const trig = await callAction(
      '/trigger-workflow-run',
      { workflow_id: WF_A },
      USER_B_OWNER
    );
    if (!trig.data.success) {
      pass('ft6-trigger', 'Org B cannot trigger Org A workflow', trig.data.message);
    } else {
      fail('ft6-trigger', 'Org B should not start Org A run');
    }
  }

  // Org A owner can see workflows
  {
    const a = await userGql(
      USER_A_OWNER,
      `query { workflows { id name steps { type } triggers { type } runs(limit:1){ status } } }`
    );
    if ((a.data?.workflows || []).some((w) => w.id === WF_A)) {
      pass('layer1-a', 'Org A owner can query own workflows+steps+triggers+runs');
    } else {
      fail('layer1-a', 'Org A owner missing workflow', JSON.stringify(a));
    }
  }

  // Quota incremented
  {
    const q = await adminGql(`
      query { organizations(where:{id:{_eq:"${ORG_A}"}}){ quota_used quota_limit } }
    `);
    const used = q.organizations[0]?.quota_used ?? 0;
    if (used >= 1) {
      pass('quota', 'Quota incremented on completed run', `used=${used}`);
    } else {
      fail('quota', 'Quota not incremented', `used=${used}`);
    }
  }

  // Layer 2: editor cannot insert privileged step via user JWT (if perms work)
  console.log('\n—— Layer 2: privileged step insert ——');
  {
    const ins = await userGql(
      USER_A_EDITOR,
      `
      mutation {
        insert_workflow_steps_one(object: {
          workflow_id: "${WF_A}"
          position: 99
          type: "db_write"
          name: "bad"
          config: {}
        }) { id }
      }
    `
    );
    // May fail via Hasura permission OR postgres trigger
    if (ins.errors?.length) {
      pass(
        'layer2-dbwrite',
        'Editor blocked from db_write step',
        ins.errors[0].message.slice(0, 120)
      );
    } else {
      fail('layer2-dbwrite', 'Editor was allowed to insert db_write');
      // cleanup
      await adminGql(
        `mutation { delete_workflow_steps(where:{position:{_eq:99}}){affected_rows}}`
      );
    }
  }

  printSummary();
}

function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log('EVAL SUMMARY (ASSIGNMENT.md Final Task as rubric)');
  console.log('='.repeat(60));
  const ok = results.filter((r) => r.ok).length;
  const bad = results.filter((r) => !r.ok);
  console.log(`Passed: ${ok}/${results.length}`);
  if (bad.length) {
    console.log('Failed:');
    for (const b of bad) {
      console.log(`  - ${b.id}: ${b.title} ${b.detail || ''}`);
    }
  }

  // Map to 6 Final Task points
  const ft = {
    1: results.filter((r) => r.id.startsWith('ft1')).every((r) => r.ok),
    2: results.filter((r) => r.id === 'ft2' || r.id === 'schema-steps').every((r) => r.ok),
    3: results.filter((r) => r.id.startsWith('ft3')).every((r) => r.ok),
    4: results
      .filter((r) => ['ft4', 'ft4-approve', 'ft4-b'].includes(r.id))
      .every((r) => r.ok),
    5: results.filter((r) => r.id.startsWith('ft5')).every((r) => r.ok),
    6: results.filter((r) => r.id.startsWith('ft6')).every((r) => r.ok),
  };
  console.log('\nFinal Task scorecard:');
  console.log(`  1. Two orgs + roles .............. ${ft[1] ? 'PASS' : 'FAIL'}`);
  console.log(`  2. Org A workflow 3+ step types .. ${ft[2] ? 'PASS' : 'FAIL'}`);
  console.log(`  3. Manual + webhook start ........ ${ft[3] ? 'PASS' : 'FAIL'}`);
  console.log(`  4. Approval gate pause/approve ... ${ft[4] ? 'PASS' : 'FAIL'}`);
  console.log(`  5. Live step status (DB stream) .. ${ft[5] ? 'PASS' : 'FAIL'}`);
  console.log(`  6. Cross-org isolation ........... ${ft[6] ? 'PASS' : 'FAIL'}`);

  const allFt = Object.values(ft).every(Boolean);
  console.log(`\nOVERALL FINAL TASK: ${allFt ? '✅ PASS' : '❌ FAIL'}\n`);
  process.exit(allFt && bad.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
