# Chain AI — AI Agent Workflow Builder

Mini **n8n** for chaining AI agent steps. Built for the full-stack assignment:

**nhost (Postgres + Hasura + Auth + Functions) · GraphQL subscriptions · Next.js · two permission layers**

---

## What’s implemented

| Area | Status |
|------|--------|
| Schema: orgs, members, workflows, steps, triggers, runs, step_runs | ✅ |
| Step types: llm_call, http_request, db_write, notify, conditional_branch, approval_gate | ✅ |
| Triggers: manual, webhook, scheduled, database_event | ✅ |
| Hasura org-scoped permissions (Layer 1) | ✅ |
| Step-level owner gates + Action role checks (Layer 2) | ✅ |
| Actions: `triggerWorkflowRun`, `approveStep`, `webhookStartRun` | ✅ |
| Live `step_runs` subscription + pause/approve UI | ✅ |
| Quota + retry on LLM/HTTP | ✅ |
| Aggregation view `org_usage_stats` | ✅ |
| Next.js auth, builder, run panel, quota indicator | ✅ |

---

## Repo layout

```
Chain_AI/
  ASSIGNMENT.md          # Full assignment text
  README.md              # This file
  docs/WRITEUP.md        # ~1 page design write-up
  nhost/
    migrations/          # Postgres schema
    metadata/            # Hasura tables, permissions, actions, cron, events
    nhost.toml
  functions/             # Action + event handlers + workflow engine
    _lib/engine.js       # Core executor
    local-server.mjs     # Dev server for handlers
  web/                   # Next.js frontend
  scripts/seed.mjs       # Seed Org A / Org B memberships
  docker-compose.yml     # Optional local Postgres + Hasura
```

---

## Prerequisites

- Node 18+
- [Nhost CLI](https://docs.nhost.io/getting-started/installation) **or** Docker (compose file included)
- Optional: [Groq](https://console.groq.com/) / OpenRouter / Gemini API key (else **stub LLM** with delay)

---

## Quick start (recommended: Nhost)

### 1. Backend

```bash
# From repo root
# Install nhost CLI if needed: https://docs.nhost.io

cd nhost
nhost up
# Applies migrations + metadata when linked; or use nhost cloud project
```

If using **Nhost Cloud**: create a project, connect the repo’s `nhost/` folder, deploy migrations/metadata/functions, set secrets.

**Function env vars** (Nhost project → Settings / Functions):

| Variable | Purpose |
|----------|---------|
| `NHOST_ADMIN_SECRET` / admin secret | Engine Hasura access |
| `NHOST_GRAPHQL_URL` | GraphQL endpoint |
| `GROQ_API_KEY` or `OPENROUTER_API_KEY` or `GEMINI_API_KEY` | Real LLM |
| `LLM_STUB=true` | Force stub LLM (disclosed artificial delay) |
| `LLM_STUB_DELAY_MS=600` | Stub latency |
| `SLACK_WEBHOOK_URL` | Optional real Slack notify |
| `NHOST_WEBHOOK_SECRET` | Event/cron shared secret |

Apply Hasura **metadata** so Actions point at:

- `{{NHOST_FUNCTIONS_URL}}/trigger-workflow-run`
- `{{NHOST_FUNCTIONS_URL}}/approve-step`
- `{{NHOST_FUNCTIONS_URL}}/webhook-trigger`
- etc.

### 2. Seed two orgs (Final Task)

1. Start the frontend and **sign up** four users (or at least two):
   - `owner-a@example.com` / `password123`
   - `editor-a@example.com` / `password123`
   - `viewer-a@example.com` / `password123`
   - `owner-b@example.com` / `password123`
2. Get their UUIDs from Nhost Auth dashboard or SQL: `SELECT id, email FROM auth.users;`
3. Run:

```bash
export HASURA_GRAPHQL_URL="https://<subdomain>.graphql.<region>.nhost.run/v1/graphql"
export HASURA_GRAPHQL_ADMIN_SECRET="<admin-secret>"
export USER_A_OWNER="<uuid>"
export USER_A_EDITOR="<uuid>"   # optional
export USER_A_VIEWER="<uuid>"   # optional
export USER_B_OWNER="<uuid>"
node scripts/seed.mjs
```

### 3. Frontend

```bash
cd web
cp .env.example .env.local
# Fill NEXT_PUBLIC_NHOST_* from Nhost dashboard
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Optional: Docker Hasura only + local functions

Useful for engine testing without full Auth:

```bash
docker compose up -d
cd functions && npm install
export NHOST_GRAPHQL_URL=http://localhost:8080/v1/graphql
export NHOST_ADMIN_SECRET=devadminsecret
export LLM_STUB=true
node local-server.mjs
```

Hasura console: [http://localhost:8080/console](http://localhost:8080/console) (admin secret `devadminsecret`).  
Track tables / import metadata from `nhost/metadata`, set Action handlers to `http://host.docker.internal:4001/...`.

> Full browser auth still needs nhost Auth (or custom JWT). Prefer **Nhost** for the graded demo.

---

## Final Task walkthrough

1. Log in as **Org A owner** → create default workflow (llm + http + branch + approval + notify/webhook).
2. Click **Run** → watch live steps; run **pauses** on approval_gate.
3. Click **Approve & resume** (owner/editor only).
4. Click **Start via webhook** for the second start path (or **Start via DB event** if that trigger is attached).
5. Log in as **Org B owner** → confirm **no Org A workflows**; guessing IDs returns empty/null.
6. As Org A **viewer** → Run button hidden; Action rejects if called.

See in-app **Final Task** page and `docs/WRITEUP.md`.

---

## GraphQL surface (assignment)

```graphql
# Org workflows + steps + triggers + latest run
query { workflows(where: { org_id: { _eq: $org_id } }) { steps triggers runs(limit: 1) { status } } }

# Manual start
mutation { triggerWorkflowRun(workflow_id: $id) { success workflow_run_id status message } }

# Approve paused gate
mutation { approveStep(step_run_id: $id) { success status message } }

# Live progress
subscription { step_runs(where: { workflow_run_id: { _eq: $run_id } }) { status step_type output } }
```

---

## LLM note

If no API key is set, the engine uses **`LLM_STUB`** with a short artificial delay and a configurable `stub_response` (default `"positive"`) so conditional branches still work offline. Set `GROQ_API_KEY` for a real free-tier call.

---

## Deploy

1. **Nhost Cloud** — deploy `nhost/` + functions.  
2. **Vercel** (or similar) — deploy `web/` with `NEXT_PUBLIC_NHOST_*` env vars.  
3. Submit: **GitHub URL** + **hosted app URL**.

---

## Local eval (no Nhost CLI) — verified

Automated Final Task scorecard against `ASSIGNMENT.md`:

```bash
docker compose up -d
node scripts/apply-hasura-metadata.mjs

# Terminal A — engine
cd functions && npm i
export NHOST_GRAPHQL_URL=http://localhost:8080/v1/graphql
export NHOST_ADMIN_SECRET=devadminsecret
export LLM_STUB=true
node local-server.mjs

# Terminal B — eval
export HASURA_GRAPHQL_URL=http://localhost:8080/v1/graphql
export HASURA_GRAPHQL_ADMIN_SECRET=devadminsecret
export FUNCTIONS_URL=http://localhost:4001
export JWT_SECRET='dev-jwt-secret-key-at-least-32-chars!'
node scripts/eval-final-task.mjs
# → OVERALL FINAL TASK: ✅ PASS (27/27)
```

| # | Final Task item | Result |
|---|-----------------|--------|
| 1 | Two orgs + roles | PASS |
| 2 | ≥3 step types (llm + http + branch) | PASS |
| 3 | Manual + webhook start | PASS |
| 4 | Approval gate pause / role-checked approve | PASS |
| 5 | Live step status (step_runs updates) | PASS |
| 6 | Cross-org isolation (list + by-id + trigger) | PASS |

Hasura console: http://localhost:8080/console (secret `devadminsecret`)

> Full browser login needs **Nhost Auth**. Docker eval uses signed Hasura JWTs + Action handlers. Wire a Nhost project for the UI demo.

---

## License

Assignment / portfolio use.
