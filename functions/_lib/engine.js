/**
 * Workflow execution engine.
 * Runs steps in order, updates step_runs / workflow_runs for live subscriptions,
 * supports approval_gate pause/resume, retries, and quota.
 */

import { adminGql } from './hasura.js';

const MAX_RETRIES = 1; // "at least one retry on failure"
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// GraphQL fragments
// ---------------------------------------------------------------------------

const GET_WORKFLOW = `
  query GetWorkflow($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      org_id
      name
      organization {
        id
        quota_limit
        quota_used
        quota_period_start
      }
      steps(order_by: { position: asc }) {
        id
        position
        type
        name
        config
      }
    }
  }
`;

const GET_MEMBERSHIP = `
  query GetMembership($org_id: uuid!, $user_id: uuid!) {
    org_members(
      where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }
      limit: 1
    ) {
      id
      role
    }
  }
`;

const INSERT_RUN = `
  mutation InsertRun($object: workflow_runs_insert_input!) {
    insert_workflow_runs_one(object: $object) {
      id
      status
    }
  }
`;

const INSERT_STEP_RUNS = `
  mutation InsertStepRuns($objects: [step_runs_insert_input!]!) {
    insert_step_runs(objects: $objects) {
      returning { id position status step_type }
    }
  }
`;

const UPDATE_RUN = `
  mutation UpdateRun($id: uuid!, $set: workflow_runs_set_input!) {
    update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
      status
    }
  }
`;

const UPDATE_STEP_RUN = `
  mutation UpdateStepRun($id: uuid!, $set: step_runs_set_input!) {
    update_step_runs_by_pk(pk_columns: { id: $id }, _set: $set) {
      id
      status
    }
  }
`;

const GET_RUN = `
  query GetRun($id: uuid!) {
    workflow_runs_by_pk(id: $id) {
      id
      workflow_id
      org_id
      status
      context
      current_step_position
      started_by
      workflow {
        id
        name
        steps(order_by: { position: asc }) {
          id
          position
          type
          name
          config
        }
      }
      step_runs(order_by: { position: asc }) {
        id
        position
        status
        step_type
        step_name
        output
        attempt_count
        workflow_step_id
      }
    }
  }
`;

const GET_STEP_RUN = `
  query GetStepRun($id: uuid!) {
    step_runs_by_pk(id: $id) {
      id
      status
      position
      step_type
      workflow_run_id
      workflow_run {
        id
        org_id
        status
        workflow_id
      }
    }
  }
`;

const INC_QUOTA = `
  mutation IncQuota($id: uuid!) {
    update_organizations_by_pk(
      pk_columns: { id: $id }
      _inc: { quota_used: 1 }
    ) {
      id
      quota_used
      quota_limit
    }
  }
`;

const RESET_QUOTA_PERIOD = `
  mutation ResetQuota($id: uuid!, $start: timestamptz!) {
    update_organizations_by_pk(
      pk_columns: { id: $id }
      _set: { quota_used: 0, quota_period_start: $start }
    ) {
      id
      quota_used
    }
  }
`;

const INSERT_DB_WRITE = `
  mutation InsertDbWrite($object: db_write_results_insert_input!) {
    insert_db_write_results_one(object: $object) {
      id
    }
  }
`;

const INSERT_NOTIFY = `
  mutation InsertNotify($object: notification_outbox_insert_input!) {
    insert_notification_outbox_one(object: $object) {
      id
    }
  }
`;

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

export async function getMembership(orgId, userId) {
  if (!userId) return null;
  const data = await adminGql(GET_MEMBERSHIP, {
    org_id: orgId,
    user_id: userId,
  });
  return data.org_members?.[0] || null;
}

export function canTrigger(role) {
  return role === 'owner' || role === 'editor';
}

export function canApprove(role) {
  return role === 'owner' || role === 'editor';
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

function startOfMonthISO() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function ensureQuotaPeriod(org) {
  const periodStart = new Date(org.quota_period_start);
  const monthStart = new Date(startOfMonthISO());
  if (periodStart < monthStart) {
    await adminGql(RESET_QUOTA_PERIOD, {
      id: org.id,
      start: startOfMonthISO(),
    });
    return { ...org, quota_used: 0, quota_period_start: startOfMonthISO() };
  }
  return org;
}

export async function assertQuotaAvailable(org) {
  const refreshed = await ensureQuotaPeriod(org);
  if (refreshed.quota_used >= refreshed.quota_limit) {
    const err = new Error(
      `Organization quota exhausted (${refreshed.quota_used}/${refreshed.quota_limit})`
    );
    err.code = 'QUOTA_EXCEEDED';
    throw err;
  }
  return refreshed;
}

// ---------------------------------------------------------------------------
// Run memory — prior step outputs available to later steps
// ---------------------------------------------------------------------------

function safeJson(value, maxLen = 1200) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value, null, 0);
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return String(value);
  }
}

function getByPath(obj, path) {
  if (obj == null) return undefined;
  if (!path) return obj;
  const parts = String(path).split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

/** One-line human summary of a single step output (for memory + approval brief). */
function summarizeStepOutput(position, output) {
  if (output == null) return `step_${position}: (empty)`;
  if (typeof output !== 'object') return `step_${position}: ${String(output).slice(0, 200)}`;

  // LLM (prefer structured answer)
  if (output.answer != null && (output.provider || output.json || output.text)) {
    return `step_${position} (AI): answer=${String(output.answer).slice(0, 80)}`;
  }
  if (output.text != null && (output.provider || output.model || output.usage)) {
    return `step_${position} (AI): “${String(output.text).slice(0, 200)}”`;
  }
  if (output.text != null && Object.keys(output).length <= 5) {
    return `step_${position} (AI): “${String(output.text).slice(0, 200)}”`;
  }
  // HTTP / CRM
  if (output.status != null && output.data !== undefined) {
    const d = output.data;
    if (d && typeof d === 'object') {
      const name = d.name || d.username || d.email;
      const bits = [
        name && `customer=${name}`,
        d.email && `email=${d.email}`,
        d.phone && `phone=${d.phone}`,
        d.company?.name && `company=${d.company.name}`,
      ].filter(Boolean);
      if (bits.length) {
        return `step_${position} (HTTP ${output.status}): ${bits.join(', ')}`;
      }
    }
    return `step_${position} (HTTP ${output.status}): ${safeJson(output.data, 180)}`;
  }
  // Branch
  if (output.matched !== undefined && output.branch) {
    return `step_${position} (branch): ${output.branch} path (matched=${output.matched}, saw “${String(output.evaluated || '').slice(0, 80)}”)`;
  }
  // Approval
  if (output.awaiting_approval || output.approved) {
    return `step_${position} (approval): ${output.approved ? 'approved' : 'waiting'} — ${String(output.message || '').slice(0, 120)}`;
  }
  // Notify
  if (output.notification_id || output.channel) {
    return `step_${position} (notify/${output.channel || '?'}): ${String(output.message || '').slice(0, 120)}`;
  }
  // DB write
  if (output.saved_id || output.key) {
    return `step_${position} (db): key=${output.key || 'result'}`;
  }
  return `step_${position}: ${safeJson(output, 200)}`;
}

/**
 * Build structured memory from context.step_N (+ trigger payload).
 * Stored on context as memory (string) and memory_lines (array).
 */
function buildMemory(context = {}) {
  const lines = [];
  if (context.trigger || context.payload || context.ticket || context.input) {
    const trig = context.trigger ?? context.payload ?? context.ticket ?? context.input;
    lines.push(`trigger/input: ${safeJson(trig, 300)}`);
  }
  const stepKeys = Object.keys(context)
    .filter((k) => /^step_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  for (const key of stepKeys) {
    const pos = Number(key.slice(5));
    lines.push(summarizeStepOutput(pos, context[key]));
  }
  // Prefer named facts when present
  const facts = extractFacts(context);
  const factLines = Object.entries(facts)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return {
    memory: lines.length ? lines.join('\n') : '(no prior steps yet)',
    memory_lines: lines,
    facts,
    facts_text: factLines.length ? factLines.join('\n') : '',
  };
}

/** Pull high-signal fields for approval/notify UIs. */
function extractFacts(context = {}) {
  const facts = {};
  const stepKeys = Object.keys(context)
    .filter((k) => /^step_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));

  for (const key of stepKeys) {
    const out = context[key];
    if (!out || typeof out !== 'object') continue;
    if (out.answer != null && facts.ai_decision == null) {
      facts.ai_decision = String(out.answer).trim().slice(0, 200);
    } else if (out.text != null && facts.ai_decision == null) {
      facts.ai_decision = String(out.text).trim().slice(0, 200);
    }
    if (out.status != null && out.data && typeof out.data === 'object') {
      const d = out.data;
      if (d.name && !facts.customer_name) facts.customer_name = String(d.name);
      if (d.email && !facts.customer_email) facts.customer_email = String(d.email);
      if (d.phone && !facts.customer_phone) facts.customer_phone = String(d.phone);
      if (d.company?.name && !facts.customer_company) {
        facts.customer_company = String(d.company.name);
      }
      if (d.username && !facts.customer_username) {
        facts.customer_username = String(d.username);
      }
    }
    if (out.matched !== undefined && facts.branch == null) {
      facts.branch = out.branch || (out.matched ? 'then' : 'else');
      facts.branch_saw = String(out.evaluated || '').slice(0, 80);
    }
  }
  if (context.ticket) facts.ticket = safeJson(context.ticket, 200);
  return facts;
}

/**
 * Template vars for prompts/messages:
 *   {{input}} {{memory}} {{facts}} {{step_0}} {{step_0.text}} {{ai_decision}}
 *   {{customer_name}} {{customer_email}} … any fact key
 * Unmatched {{…}} left as-is.
 */
function renderTemplate(template, context) {
  if (template == null) return '';
  const mem = buildMemory(context);
  const vars = {
    input: safeJson(
      context.input !== undefined && context.input !== null && context.input !== ''
        ? context.input
        : (context.last_output ?? ''),
      2000
    ),
    memory: mem.memory,
    facts: mem.facts_text,
    last_output: safeJson(context.last_output, 2000),
    ...mem.facts,
  };

  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, raw) => {
    const key = raw.trim();
    if (Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null) {
      return String(vars[key]);
    }
    // step_N or step_N.field
    const stepMatch = key.match(/^(step_\d+)(?:\.(.+))?$/);
    if (stepMatch) {
      const base = context[stepMatch[1]];
      const val = stepMatch[2] ? getByPath(base, stepMatch[2]) : base;
      if (val === undefined) return `{{${key}}}`;
      return typeof val === 'string' ? val : safeJson(val, 1500);
    }
    // fact keys already spread; nested last_output.x
    if (key.startsWith('last_output.')) {
      const val = getByPath(context.last_output, key.slice('last_output.'.length));
      if (val === undefined) return `{{${key}}}`;
      return typeof val === 'string' ? val : safeJson(val, 800);
    }
    return `{{${key}}}`;
  });
}

/** Enrich context with memory fields before each step. */
function withMemory(context) {
  const mem = buildMemory(context);
  return {
    ...context,
    memory: mem.memory,
    memory_lines: mem.memory_lines,
    facts: mem.facts,
  };
}

/** Rebuild step_N map from step_runs (resume safety). */
function hydrateContextFromStepRuns(baseContext, stepRuns) {
  let context = { ...(baseContext || {}) };
  for (const sr of stepRuns || []) {
    if (
      (sr.status === 'success' || sr.status === 'skipped' || sr.status === 'paused') &&
      sr.output &&
      typeof sr.position === 'number'
    ) {
      context[`step_${sr.position}`] = sr.output;
      if (sr.status === 'success' || sr.status === 'paused') {
        context.last_output = sr.output;
      }
    }
  }
  return withMemory(context);
}

/**
 * Guess Yes-branch keyword from an llm_call step config.
 * Prefer labels declared in the prompt (not stub_response — stub is offline AI output only).
 */
function deriveYesLabelFromLlmConfig(config = {}) {
  const prompt = String(config.prompt ?? '');
  if (prompt) {
    const bullets = [
      ...prompt.matchAll(/^\s*[-*]\s*([A-Za-z][A-Za-z0-9_]{1,24})\b/gm),
    ].map((m) => m[1]);
    if (bullets.length) return bullets[0];
    const onlyOr = prompt.match(
      /(?:only|exactly)\s+([A-Za-z][A-Za-z0-9_]{1,24})\s+or\s+([A-Za-z][A-Za-z0-9_]{1,24})/i
    );
    if (onlyOr) return onlyOr[1];
    const plainOr = prompt.match(
      /\b([A-Z][A-Z0-9_]{1,24})\s+or\s+([A-Z][A-Z0-9_]{1,24})\b/
    );
    if (plainOr) return plainOr[1];
  }
  const stub = String(config.stub_response ?? '').trim();
  if (stub) {
    const token = stub.split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
    if (token) return token;
  }
  return null;
}

/** Normalize trigger payloads into a single `input` field for templates. */
function normalizeRunContext(raw = {}) {
  const ctx = { ...(raw || {}) };
  if (ctx.input !== undefined && ctx.input !== null) {
    return ctx;
  }
  if (ctx.webhook_payload !== undefined) {
    const p = ctx.webhook_payload;
    if (p && typeof p === 'object' && !Array.isArray(p) && p.input !== undefined) {
      ctx.input = p.input;
    } else if (p && typeof p === 'object' && !Array.isArray(p) && p.text !== undefined) {
      ctx.input = p.text;
    } else if (p && typeof p === 'object' && !Array.isArray(p) && p.message !== undefined) {
      ctx.input = p.message;
    } else {
      ctx.input = p;
    }
  } else if (ctx.watched_row !== undefined) {
    const row = ctx.watched_row;
    ctx.input =
      row?.payload ?? row?.data ?? row?.message ?? row?.text ?? row;
  } else if (ctx.payload !== undefined) {
    ctx.input = ctx.payload;
  } else if (ctx.ticket !== undefined) {
    ctx.input = ctx.ticket;
  }
  return ctx;
}

/**
 * Build approval UI copy. Prefer a small LLM pass so we don't hardcode
 * domain-specific formatting; fall back to a generic template if offline.
 */
async function buildApprovalBrief(context, configMessage, config = {}) {
  const ctx = withMemory(context);
  const facts = ctx.facts || {};
  const memorySnippet = String(ctx.memory || '').slice(0, 1800);

  // Optional: config.llm_ui_summary === false → skip LLM, template only
  const wantLlm = config.llm_ui_summary !== false;

  if (wantLlm) {
    try {
      const uiLlm = await callLlm(
        {
          system:
            'You write short, professional UI copy for a human approval screen. Output ONLY valid JSON. Never dump raw API JSON or step_N lines into title/summary.',
          prompt: `A workflow paused for human approval. Write clean card copy.

Return ONLY this JSON shape:
{
  "title": "one clear sentence for the human (max 120 characters)",
  "summary": "one supporting line of context (max 160 characters)",
  "highlights": { "Short label": "short value" }
}

Rules:
- highlights: at most 4 keys, human-readable labels, short values
- Do not paste full HTTP bodies or memory dumps
- Use facts/memory only to summarize

Workflow note (optional): ${String(configMessage || 'Approve to continue the workflow.')}

Structured facts:
${JSON.stringify(facts)}

Run memory (summarize, do not copy raw):
${memorySnippet || '(none)'}
`,
          // Offline / no key: generic JSON, not domain-specific prose
          stub_response: JSON.stringify({
            title: 'Approval required to continue this workflow',
            summary: facts.ai_decision
              ? `Prior AI result: ${String(facts.ai_decision).slice(0, 80)}`
              : 'Review prior steps, then approve if appropriate.',
            highlights: Object.fromEntries(
              [
                facts.ai_decision != null && [
                  'AI',
                  String(facts.ai_decision).slice(0, 40),
                ],
                facts.branch != null && ['Path', String(facts.branch)],
                facts.customer_name != null && [
                  'Name',
                  String(facts.customer_name).slice(0, 40),
                ],
              ].filter(Boolean)
            ),
          }),
          temperature: 0.2,
          max_tokens: 220,
        },
        ctx
      );

      const parsed =
        uiLlm.json && typeof uiLlm.json === 'object'
          ? uiLlm.json
          : parseLlmStructured(uiLlm.text).json;

      if (parsed && (parsed.title || parsed.message)) {
        const highlights =
          parsed.highlights && typeof parsed.highlights === 'object'
            ? Object.fromEntries(
                Object.entries(parsed.highlights)
                  .slice(0, 4)
                  .map(([k, v]) => [String(k).slice(0, 32), String(v ?? '').slice(0, 80)])
              )
            : {};
        return {
          message: String(parsed.title || parsed.message).slice(0, 200),
          summary: String(parsed.summary || '').slice(0, 240),
          highlights,
          facts,
          memory: ctx.memory,
          ui_source: uiLlm.provider || 'llm',
        };
      }
    } catch (e) {
      console.warn('[approval_gate] UI LLM summary failed:', e.message || e);
    }
  }

  // Minimal template fallback (no memory dump in the title)
  const title = renderTemplate(
    configMessage ||
      'Approval required. AI decision: {{ai_decision}}. Approve to continue?',
    {
      ...ctx,
      memory: '',
    }
  );
  return {
    message: String(title).replace(/\s+/g, ' ').trim().slice(0, 200) ||
      'Approval required to continue',
    summary: facts.ai_decision
      ? `AI: ${String(facts.ai_decision).slice(0, 100)}`
      : 'Review prior steps in the run timeline.',
    highlights: Object.fromEntries(
      [
        facts.ai_decision != null && [
          'AI',
          String(facts.ai_decision).slice(0, 40),
        ],
        facts.branch != null && ['Path', String(facts.branch)],
      ].filter(Boolean)
    ),
    facts,
    memory: ctx.memory,
    ui_source: 'template',
  };
}

// ---------------------------------------------------------------------------
// LLM call (Groq / OpenRouter / stub)
// ---------------------------------------------------------------------------

/**
 * Parse model text into JSON if possible (full string or first {...} block).
 * Used so branches can read keys like `answer` without string-guessing.
 */
function parseLlmStructured(text) {
  let raw = String(text ?? '').trim();
  if (!raw) return { text: '', json: null, answer: undefined };
  // Strip ```json ... ``` fences if the model adds them
  raw = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const tryParse = (s) => {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  };

  let json = tryParse(raw);
  if (!json) {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) json = tryParse(m[0]);
  }

  let answer;
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    if (json.answer !== undefined) answer = json.answer;
    else if (json.decision !== undefined) answer = json.decision;
    else if (json.label !== undefined) answer = json.label;
    else if (json.result !== undefined) answer = json.result;
  }

  return { text: raw, json, answer };
}

function shapeLlmOutput(base) {
  const structured = parseLlmStructured(base.text);
  const out = {
    ...base,
    text: structured.text || base.text,
  };
  if (structured.json && typeof structured.json === 'object') {
    out.json = structured.json;
    // Flatten top-level keys for easy branch field access (answer, etc.)
    for (const [k, v] of Object.entries(structured.json)) {
      if (out[k] === undefined) out[k] = v;
    }
  }
  if (structured.answer !== undefined) {
    out.answer = structured.answer;
  }
  return out;
}

async function callLlm(config, context) {
  const ctx = withMemory(context);
  // Ensure {{input}} has something useful
  if (ctx.input === undefined || ctx.input === null || ctx.input === '') {
    if (ctx.last_output != null) ctx.input = ctx.last_output;
  }
  const promptTemplate =
    config.prompt ||
    `Decide based on the input. Reply with ONLY valid JSON (no markdown):\n{"answer":"yes"}\nor\n{"answer":"no"}\n\nInput:\n{{input}}`;

  let prompt = renderTemplate(promptTemplate, ctx);

  // Append prior step memory if prompt didn't reference it
  const hasMemoryVars = /\{\{\s*(memory|facts|input|step_\d+)/.test(
    String(promptTemplate)
  );
  if (!hasMemoryVars && ctx.memory_lines?.length) {
    prompt = `${prompt}\n\n--- Run memory (prior steps) ---\n${ctx.memory}`;
  }

  const groqKey = process.env.GROQ_API_KEY;
  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const model =
    config.model ||
    process.env.LLM_MODEL ||
    'llama-3.1-8b-instant';

  const systemDefault =
    config.system ||
    'You output only valid JSON. No markdown fences, no extra text.';

  // Stub only when forced or no API keys
  if (process.env.LLM_STUB === 'true' || (!groqKey && !openRouterKey && !geminiKey)) {
    await sleep(Number(process.env.LLM_STUB_DELAY_MS || 600));
    let text =
      context.force_llm_text ||
      (config.stub_response != null && String(config.stub_response).trim() !== ''
        ? String(config.stub_response).trim()
        : '');
    // Accept bare yes/no stub → wrap as JSON for branch.field=answer
    if (text && !text.trim().startsWith('{')) {
      const token = text.trim().toLowerCase();
      if (token === 'yes' || token === 'no' || token === 'true' || token === 'false') {
        text = JSON.stringify({ answer: token === 'true' ? 'yes' : token === 'false' ? 'no' : token });
      }
    }
    if (!text) {
      text = JSON.stringify({ answer: 'no' });
    }
    return shapeLlmOutput({
      provider: 'stub',
      model: 'stub-model',
      text,
      usage: { stub: true },
      prompt_used: prompt.slice(0, 500),
    });
  }

  if (groqKey) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemDefault },
          { role: 'user', content: prompt },
        ],
        temperature: config.temperature ?? 0.1,
        max_tokens: config.max_tokens ?? 256,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Groq API error ${res.status}: ${t}`);
    }
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    return shapeLlmOutput({ provider: 'groq', model, text, raw: json });
  }

  if (openRouterKey) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model || 'openai/gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemDefault },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content?.trim() || '';
    return shapeLlmOutput({
      provider: 'openrouter',
      model: config.model,
      text,
      raw: json,
    });
  }

  // Gemini
  const gModel = config.model || 'gemini-1.5-flash';
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${gModel}:generateContent?key=${geminiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${systemDefault}\n\n${prompt}` }] }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return shapeLlmOutput({ provider: 'gemini', model: gModel, text, raw: json });
}

// ---------------------------------------------------------------------------
// HTTP request with retry
// ---------------------------------------------------------------------------

async function callHttp(config, context) {
  const url = config.url;
  if (!url) throw new Error('http_request step missing config.url');

  const method = (config.method || 'GET').toUpperCase();
  const headers = { ...(config.headers || {}) };
  let body;
  if (method !== 'GET' && method !== 'HEAD') {
    const rawBody = config.body ?? context.last_output ?? {};
    body = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
  }

  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  return {
    status: res.status,
    data: parsed,
  };
}

async function withRetry(fn, attempts = MAX_RETRIES + 1) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return { result: await fn(), attempts: i + 1 };
    } catch (e) {
      lastErr = e;
      if (i < attempts - 1) await sleep(RETRY_DELAY_MS * (i + 1));
    }
  }
  throw Object.assign(lastErr, { attempts });
}

// ---------------------------------------------------------------------------
// Step executors
// ---------------------------------------------------------------------------

async function executeStep(step, stepRun, run, context) {
  const config = step.config || {};

  switch (step.type) {
    case 'llm_call': {
      const { result, attempts } = await withRetry(() => callLlm(config, context));
      return { output: result, attempts, nextPosition: step.position + 1 };
    }
    case 'http_request': {
      const { result, attempts } = await withRetry(() => callHttp(config, context));
      return { output: result, attempts, nextPosition: step.position + 1 };
    }
    case 'db_write': {
      const key = config.key || 'result';
      const payload = config.payload ?? context.last_output ?? context;
      const data = await adminGql(INSERT_DB_WRITE, {
        object: {
          org_id: run.org_id,
          workflow_run_id: run.id,
          step_run_id: stepRun.id,
          key,
          payload,
        },
      });
      return {
        output: { saved_id: data.insert_db_write_results_one.id, key, payload },
        attempts: 1,
        nextPosition: step.position + 1,
      };
    }
    case 'notify': {
      const ctx = withMemory(context);
      const rawMessage =
        config.message ||
        `Workflow ${run.workflow?.name || run.workflow_id} step "${step.name}" finished.\n{{memory}}`;
      const message = renderTemplate(rawMessage, ctx);
      const channel = config.channel || 'log';
      const data = await adminGql(INSERT_NOTIFY, {
        object: {
          org_id: run.org_id,
          workflow_run_id: run.id,
          step_run_id: stepRun.id,
          channel,
          message,
          payload: {
            last_output: context.last_output,
            memory: ctx.memory,
            facts: ctx.facts,
            config,
          },
          delivery_status: 'pending',
        },
      });
      // Event Trigger on notification_outbox delivers via notify-handler
      return {
        output: {
          notification_id: data.insert_notification_outbox_one.id,
          channel,
          message,
          memory: ctx.memory,
          facts: ctx.facts,
        },
        attempts: 1,
        nextPosition: step.position + 1,
      };
    }
    case 'conditional_branch': {
      // Preferred (general): AI returns JSON {"answer":"yes"|"no"}; branch reads field `answer`.
      // config: { from_step?, field?: "answer", equals?: "yes", contains?, regex?,
      //           auto_from_ai?, then_skip_to?, else_skip_to? }
      let source = context.last_output || {};
      const fromPos =
        config.from_step !== undefined && config.from_step !== null
          ? Number(config.from_step)
          : null;
      if (fromPos !== null && !Number.isNaN(fromPos)) {
        source = context[`step_${fromPos}`] ?? source;
      } else if (
        typeof source === 'object' &&
        source !== null &&
        source.answer === undefined &&
        source.text === undefined &&
        (context.step_0?.answer !== undefined || context.step_0?.text !== undefined)
      ) {
        source = context.step_0;
      }

      // If source is LLM with only text, try parse JSON into a virtual object
      if (
        source &&
        typeof source === 'object' &&
        source.answer === undefined &&
        typeof source.text === 'string'
      ) {
        const parsed = parseLlmStructured(source.text);
        if (parsed.json && typeof parsed.json === 'object') {
          source = { ...source, ...parsed.json, answer: parsed.answer ?? source.answer };
        }
      }

      const field = config.field || 'answer';
      let value;
      if (typeof source === 'object' && source !== null) {
        value =
          getByPath(source, field) ??
          source[field] ??
          source.json?.[field] ??
          (field === 'answer' || field === 'text' ? source.answer ?? source.text : undefined);
        if (value === undefined) {
          value = JSON.stringify(source);
        }
      } else {
        value = source;
      }
      const valueStr = String(value).toLowerCase().trim();

      // Truthy yes values for JSON answer key
      const isYesValue = (s) =>
        /^(yes|true|1|y|approve|approved|urgent|high)$/i.test(String(s).trim()) ||
        String(s).toLowerCase() === 'yes';

      let matched = false;
      let matchedOn = null;
      const hasEquals =
        config.equals !== undefined && config.equals !== null && String(config.equals) !== '';
      const hasContains =
        config.contains !== undefined &&
        config.contains !== null &&
        String(config.contains).trim() !== '';

      if (hasEquals) {
        matched = valueStr === String(config.equals).toLowerCase().trim();
        matchedOn = `equals:${config.equals}`;
      } else if (hasContains) {
        matched = valueStr.includes(String(config.contains).toLowerCase());
        matchedOn = `contains:${config.contains}`;
      } else if (config.regex) {
        matched = new RegExp(config.regex, 'i').test(valueStr);
        matchedOn = `regex:${config.regex}`;
      } else if (field === 'answer' || field === 'decision' || field === 'label') {
        // Default for JSON answer key: yes/true → Yes path
        matched = isYesValue(valueStr);
        matchedOn = `json_key:${field}=yes-like`;
      } else {
        matched = isYesValue(valueStr);
        matchedOn = 'default:yes-like';
      }

      const nextPosition = matched
        ? config.then_skip_to ?? step.position + 1
        : config.else_skip_to ?? step.position + 1;

      return {
        output: {
          matched,
          evaluated: valueStr,
          field,
          matched_on: matchedOn,
          next_position: nextPosition,
          branch: matched ? 'then' : 'else',
        },
        attempts: 1,
        nextPosition,
      };
    }
    case 'approval_gate': {
      // Pause for a human. UI copy is generated by a small LLM pass over run
      // memory (unless config.llm_ui_summary === false).
      const approval = await buildApprovalBrief(
        context,
        config.message,
        config
      );
      return {
        output: {
          awaiting_approval: true,
          message: approval.message,
          summary: approval.summary,
          highlights: approval.highlights,
          facts: approval.facts,
          memory: approval.memory,
          ui_source: approval.ui_source,
        },
        attempts: 1,
        pause: true,
        nextPosition: step.position,
      };
    }
    default:
      throw new Error(`Unknown step type: ${step.type}`);
  }
}

// ---------------------------------------------------------------------------
// Run creation + execution loop
// ---------------------------------------------------------------------------

export async function createAndStartRun({
  workflowId,
  userId,
  triggerType = 'manual',
  initialContext = {},
  skipAuth = false,
}) {
  const wfData = await adminGql(GET_WORKFLOW, { id: workflowId });
  const workflow = wfData.workflows_by_pk;
  if (!workflow) {
    return { success: false, message: 'Workflow not found' };
  }

  if (!skipAuth) {
    const member = await getMembership(workflow.org_id, userId);
    if (!member || !canTrigger(member.role)) {
      return {
        success: false,
        message:
          'Forbidden: only owner/editor in this organization can trigger runs',
      };
    }
  }

  try {
    await assertQuotaAvailable(workflow.organization);
  } catch (e) {
    return { success: false, message: e.message };
  }

  if (!workflow.steps?.length) {
    return { success: false, message: 'Workflow has no steps' };
  }

  const seedContext = normalizeRunContext(initialContext);

  const runData = await adminGql(INSERT_RUN, {
    object: {
      workflow_id: workflowId,
      org_id: workflow.org_id,
      status: 'running',
      trigger_type: triggerType,
      started_by: userId || null,
      current_step_position: 0,
      context: seedContext,
      started_at: new Date().toISOString(),
    },
  });
  const runId = runData.insert_workflow_runs_one.id;

  await adminGql(INSERT_STEP_RUNS, {
    objects: workflow.steps.map((s) => ({
      workflow_run_id: runId,
      workflow_step_id: s.id,
      position: s.position,
      step_type: s.type,
      step_name: s.name || s.type,
      status: 'pending',
      input: {},
      output: {},
      attempt_count: 0,
    })),
  });

  // Continue execution (may pause at approval_gate)
  const result = await continueRun(runId, seedContext);
  return {
    success: true,
    message: result.message || 'Run started',
    workflow_run_id: runId,
    status: result.status,
  };
}

export async function continueRun(runId, extraContext = {}) {
  const data = await adminGql(GET_RUN, { id: runId });
  const run = data.workflow_runs_by_pk;
  if (!run) return { status: 'failed', message: 'Run not found' };

  if (run.status === 'completed' || run.status === 'failed') {
    return { status: run.status, message: `Run already ${run.status}` };
  }

  const steps = run.workflow.steps || [];
  const stepRuns = run.step_runs || [];
  const byPosition = Object.fromEntries(stepRuns.map((sr) => [sr.position, sr]));

  // Rebuild full step memory from prior step_runs (resume-safe) + any extra
  let context = hydrateContextFromStepRuns(
    normalizeRunContext({
      ...(run.context || {}),
      ...extraContext,
      last_output:
        extraContext.last_output ??
        (run.context || {}).last_output,
    }),
    stepRuns
  );

  // Find resume point
  let position =
    run.current_step_position ??
    stepRuns.find((s) => s.status === 'paused' || s.status === 'pending')
      ?.position ??
    0;

  // If resuming from paused, mark that step success after approval
  const paused = stepRuns.find((s) => s.status === 'paused');
  if (paused && run.status === 'running') {
    // Approver already flipped pause → continue; advance past gate
    position = paused.position + 1;
  }

  await adminGql(UPDATE_RUN, {
    id: runId,
    set: { status: 'running', error: null },
  });

  const maxPos = Math.max(...steps.map((s) => s.position), -1);

  while (position <= maxPos) {
    const step = steps.find((s) => s.position === position);
    if (!step) {
      // gap from branch skip — find next existing
      const next = steps.find((s) => s.position > position);
      if (!next) break;
      position = next.position;
      continue;
    }

    const stepRun = byPosition[position];
    if (!stepRun) {
      position += 1;
      continue;
    }

    // Skip already successful steps (resume)
    if (stepRun.status === 'success' || stepRun.status === 'skipped') {
      if (stepRun.output) {
        context.last_output = stepRun.output;
        context[`step_${position}`] = stepRun.output;
        context = withMemory(context);
      }
      position += 1;
      continue;
    }

    context = withMemory(context);

    // Mark running — store memory snapshot as step input for UI/debug
    await adminGql(UPDATE_STEP_RUN, {
      id: stepRun.id,
      set: {
        status: 'running',
        started_at: new Date().toISOString(),
        input: {
          last_output: context.last_output ?? null,
          memory: context.memory,
          facts: context.facts,
        },
        attempt_count: (stepRun.attempt_count || 0) + 1,
      },
    });
    await adminGql(UPDATE_RUN, {
      id: runId,
      set: { current_step_position: position },
    });

    try {
      const exec = await executeStep(step, stepRun, run, context);

      if (exec.pause) {
        const pausedCtx = withMemory({
          ...context,
          last_output: exec.output,
          [`step_${position}`]: exec.output,
        });
        await adminGql(UPDATE_STEP_RUN, {
          id: stepRun.id,
          set: {
            status: 'paused',
            output: exec.output,
            attempt_count: exec.attempts,
          },
        });
        await adminGql(UPDATE_RUN, {
          id: runId,
          set: {
            status: 'paused',
            current_step_position: position,
            context: pausedCtx,
          },
        });
        return {
          status: 'paused',
          message: 'Paused awaiting approval',
          step_run_id: stepRun.id,
        };
      }

      // Mark intermediate positions skipped if we jump ahead
      if (exec.nextPosition > position + 1) {
        for (const sr of stepRuns) {
          if (sr.position > position && sr.position < exec.nextPosition) {
            if (sr.status === 'pending') {
              await adminGql(UPDATE_STEP_RUN, {
                id: sr.id,
                set: {
                  status: 'skipped',
                  output: { reason: 'skipped_by_branch' },
                  completed_at: new Date().toISOString(),
                },
              });
            }
          }
        }
      }

      await adminGql(UPDATE_STEP_RUN, {
        id: stepRun.id,
        set: {
          status: 'success',
          output: exec.output,
          attempt_count: exec.attempts,
          completed_at: new Date().toISOString(),
          error: null,
        },
      });

      context.last_output = exec.output;
      context[`step_${position}`] = exec.output;
      context = withMemory(context);
      position = exec.nextPosition;
    } catch (err) {
      const attempts = err.attempts || 1;
      await adminGql(UPDATE_STEP_RUN, {
        id: stepRun.id,
        set: {
          status: 'failed',
          error: String(err.message || err),
          attempt_count: attempts,
          completed_at: new Date().toISOString(),
        },
      });
      await adminGql(UPDATE_RUN, {
        id: runId,
        set: {
          status: 'failed',
          error: String(err.message || err),
          completed_at: new Date().toISOString(),
          context,
        },
      });
      return { status: 'failed', message: String(err.message || err) };
    }
  }

  // Completed successfully — increment quota
  await adminGql(UPDATE_RUN, {
    id: runId,
    set: {
      status: 'completed',
      completed_at: new Date().toISOString(),
      context,
      current_step_position: position,
    },
  });
  await adminGql(INC_QUOTA, { id: run.org_id });

  return { status: 'completed', message: 'Run completed' };
}

export async function approveStepRun({ stepRunId, userId }) {
  const data = await adminGql(GET_STEP_RUN, { id: stepRunId });
  const stepRun = data.step_runs_by_pk;
  if (!stepRun) {
    return { success: false, message: 'Step run not found' };
  }
  if (stepRun.step_type !== 'approval_gate') {
    return { success: false, message: 'Step is not an approval_gate' };
  }
  if (stepRun.status !== 'paused') {
    return {
      success: false,
      message: `Step is not paused (status=${stepRun.status})`,
    };
  }

  const orgId = stepRun.workflow_run.org_id;
  const member = await getMembership(orgId, userId);
  // Layer 2: mid-execution role check in Action handler
  if (!member || !canApprove(member.role)) {
    return {
      success: false,
      message:
        'Forbidden: only owner/editor in this organization can approve steps',
    };
  }

  await adminGql(UPDATE_STEP_RUN, {
    id: stepRunId,
    set: {
      status: 'success',
      approved_by: userId,
      approved_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      output: {
        approved: true,
        approved_by: userId,
        message: 'Approved',
      },
    },
  });

  await adminGql(UPDATE_RUN, {
    id: stepRun.workflow_run_id,
    set: {
      status: 'running',
      current_step_position: stepRun.position + 1,
    },
  });

  const result = await continueRun(stepRun.workflow_run_id, {
    last_approval: { step_run_id: stepRunId, by: userId },
  });

  return {
    success: true,
    message: result.message || 'Approved and resumed',
    workflow_run_id: stepRun.workflow_run_id,
    status: result.status,
  };
}
