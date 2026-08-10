# AI Agent Workflow Builder — Full-Stack Assignment

**Tech stack:** nhost + Hasura + PostgreSQL + GraphQL + React/Next.js  
**Goal:** A mini n8n for chaining AI agent steps, with two permission layers, live subscriptions, and a working end-to-end scenario.

> This assignment is intentionally hard to finish fast. Build correctly under pressure: proper security, scalable design — not demo shortcuts.

---

## What You're Building

Users inside an organization:

1. Build workflows from multiple step types  
2. Start them multiple ways (manual, webhook, schedule, DB event)  
3. Every action is checked against **two separate permission layers**

The final deliverable is **one live scenario** that proves the whole system works — schema, Hasura config, both permission layers, Action handler, and subscriptions must all work together.

---

## Tech Stack

| Piece | Notes |
|--------|--------|
| **nhost** | Postgres + Hasura + Auth + Storage + Functions |
| **Hasura GraphQL Engine** | Queries, mutations, subscriptions, Actions, Event Triggers |
| **PostgreSQL** | Schema, relationships, views/computed fields |
| **LLM API** | Real API for `llm_call` (Groq, OpenRouter, Gemini free tier). Stub with artificial delay OK if no key |
| **React / Next.js** | **Required** frontend |

---

## Data Model (minimum)

| Table | Purpose |
|--------|---------|
| `organizations` | Org + usage quota (calls used / allowed per period) |
| `org_members` | `user_id`, `org_id`, `role` (`owner` \| `editor` \| `viewer`) |
| `workflows` | Belongs to an organization |
| `workflow_steps` | Ordered; `type` + `config` (JSONB OK) |
| `workflow_triggers` | Trigger type tied to a workflow |
| `workflow_runs` | One per execution; overall status (**must support paused**) |
| `step_runs` | One per step per run: status, input, output, error, attempt count; plus `approved_by` / `approved_at` for approval gates |

Field names can vary. Relationships that must hold:

```
org → members → workflows → steps / triggers
workflow → runs → step_runs
```

---

## Step Types (Nodes) — implement at least these

| Type | Behavior |
|------|----------|
| `llm_call` | Calls a real LLM API |
| `http_request` | Generic call to any external API |
| `db_write` | Saves a result into your own tables |
| `notify` | Slack/email alert via **Hasura Event Trigger** |
| `conditional_branch` | If/else based on previous step output |
| `approval_gate` | Pauses run until someone with the right role approves |

---

## Trigger Types — implement at least these

| Type | How it starts a run |
|------|---------------------|
| **Manual** | User clicks Run |
| **Webhook** | Hasura Action as inbound endpoint for external systems |
| **Scheduled** | Cron-based scheduled function |
| **Database event** | Row change on watched table → Hasura Event Trigger starts a run |

You need **at least one non-manual** trigger actually wired (webhook, scheduled, or event-based).

---

## Hasura Layer

- Track all tables; wire relationships above  
- **One aggregation** — e.g. org-level usage this month, or average run duration — as computed field or Postgres view  

---

## Permissions — two layers (not one)

### Layer 1 — Org + role scoping

Who can see or trigger a workflow at all.

- Role alone is **not** enough  
- Every permission must scope to the caller’s org via `org_members`  
- Editor in Org A must **never** see/touch Org B data (same role, different org)

| Role | Can do |
|------|--------|
| **owner** | Full control: workflows, steps, triggers, org membership |
| **editor** | Create/edit workflows & steps; trigger runs; **cannot** manage members |
| **viewer** | Read-only; **cannot** trigger a run |

### Layer 2 — Step-level gating

Who can act on specific step types / mid-run decisions.

- Only **owner** can add: `db_write`, webhook trigger, or `notify` step  
- Clearing an `approval_gate` requires the **Action handler** to check the approver’s role before resuming — **not** DB permissions alone (mid-execution decision)

---

## GraphQL Operations (required)

1. **Query** — org’s workflows with steps, triggers, and most recent run status  
2. **Mutation** — create/edit a workflow, its steps, and its triggers  
3. **Mutation** — approve a paused `approval_gate` step  
4. **Subscription** — `step_runs` filtered by `workflow_run_id` for live progress, including **“paused, awaiting approval”**

---

## The Integration — core of the assignment

### Hasura Action: `triggerWorkflowRun(workflow_id)`

Backed by a function that:

1. Verifies caller is **owner/editor** in the workflow’s org  
2. Checks org **quota** is not exhausted  
3. Creates `workflow_run`, then executes steps **in order**  
4. `llm_call` and `http_request` make **real** external calls, with **at least one retry** on failure  
5. On `approval_gate`: set run to **paused** and stop  
6. Second Action **`approveStep`**: checks approver role, then resumes  
7. Updates `step_runs` / `workflow_run` status throughout (subscription stays live)  
8. Increments org **quota usage** on completion  

Plus at least one non-manual trigger that starts a run **without** a button click.

---

## Frontend (Next.js + nhost)

- [ ] Auth via nhost + org context  
- [ ] Screen to **build** a workflow: add/reorder steps, attach trigger  
- [ ] **Run** button (hidden for viewers)  
- [ ] Live per-step status via **subscription**  
- [ ] Pause / approve UI for `approval_gate`  
- [ ] Usage / quota indicator  

---

## Final Task — what “done” means

Demonstrate **this exact scenario** live, end to end:

1. **Two orgs** exist, each with their own users and roles  
2. **Org A owner** builds a workflow with **≥ 3 step types**, including:
   - `llm_call`
   - `http_request`
   - `conditional_branch` (behavior changes based on LLM output)  
3. Workflow starts **two ways**: manual **and** webhook or event trigger  
4. One step is **`approval_gate`** — run pauses; only owner/editor **in that org** can approve  
5. While running, **live** step-by-step status with **no refresh**, including paused state  
6. Logged in as **Org B** user: cannot see, trigger, or approve anything from Org A — **even by guessing IDs**

If all six hold, schema + Hasura + both permission layers + Action handler + subscriptions all necessarily work.

---

## Deliverables

| # | Deliverable |
|---|-------------|
| 1 | **GitHub repo** with README: setup, run locally, API keys (or note if stubbed) |
| 2 | **Hosted URL** of deployed Next.js app (Vercel or similar) |
| 3 | **Hasura metadata/migrations** — schema, relationships, both permission layers |
| 4 | **~1 page write-up** — schema reasoning; how the two permission layers differ; how approval-gate pause/resume works |
| 5 | **Short recording** of Final Task scenario (strongly recommended) |

**Submit:** GitHub repo link + hosted app URL  

**Priority:** earliest solid submission wins; broken early submission does **not** beat a later working one.

---

## Evaluation Criteria (priority order)

1. **Final Task passes live** — weighted above everything  
2. Cross-org isolation airtight (including direct ID guessing)  
3. Step-level gating enforced in **Action handler**, not just assumed  
4. Retry / failure handling + quota enforcement  
5. Schema and Hasura relationship correctness  
6. Code and documentation clarity  

---

## Recommended Build Order (how to approach this)

Use this as your execution checklist under time pressure.

### Phase 0 — Bootstrap
- [ ] Init nhost project (local or cloud)
- [ ] Init Next.js app + nhost auth client
- [ ] Env vars: Hasura, Auth, LLM key (or stub flag)

### Phase 1 — Schema & migrations
- [ ] Create all tables + FKs + indexes
- [ ] Track tables in Hasura; define relationships
- [ ] Aggregation: view or computed field (usage this month / avg duration)

### Phase 2 — Permission Layer 1 (org scoping)
- [ ] Hasura permissions using session vars + `org_members` checks
- [ ] owner / editor / viewer rules on every relevant table
- [ ] Prove: Org A never sees Org B rows (including by ID)

### Phase 3 — Permission Layer 2 (step gating)
- [ ] Restrict create of `db_write`, webhook trigger, `notify` to **owner** (Hasura and/or Action validation)
- [ ] Plan Action-level checks for approve + privileged step types

### Phase 4 — Action: `triggerWorkflowRun`
- [ ] Authz: owner/editor in workflow’s org
- [ ] Quota check
- [ ] Create run + step_runs
- [ ] Execute pipeline: llm_call, http_request (+ retry), conditional_branch, approval_gate pause, notify (event), db_write
- [ ] Update statuses for live subscription
- [ ] Quota increment on completion

### Phase 5 — Action: `approveStep`
- [ ] Validate approver is owner/editor in same org
- [ ] Resume from paused gate; continue remaining steps
- [ ] Set `approved_by` / `approved_at`

### Phase 6 — Extra triggers
- [ ] Wire **at least one** of: webhook Action, scheduled function, or DB Event Trigger → start run

### Phase 7 — GraphQL API surface
- [ ] Workflows query (steps + triggers + latest run)
- [ ] Upsert workflow + steps + triggers mutation path
- [ ] Approve mutation → Action
- [ ] `step_runs` subscription by `workflow_run_id`

### Phase 8 — Frontend
- [ ] Login / org switcher context
- [ ] Workflow builder UI
- [ ] Run + live status + approve UI
- [ ] Quota indicator; hide Run for viewers

### Phase 9 — Final Task dry run
- [ ] Seed Org A + Org B users/roles
- [ ] Build Org A workflow (llm + http + branch + gate)
- [ ] Manual run + second start path
- [ ] Live pause → approve
- [ ] Org B isolation test
- [ ] Deploy + README + 1-page write-up + optional recording

---

## Notes / Constraints

- Not a piece-by-piece checklist grade — the **live Final Task** is the bar  
- Shortcuts that only work in demos will fail when isolation, pause/resume, or subscriptions break  
- Free LLM tier preferred; disclosed stub with delay is acceptable if access fails  
- Time limit: depends on you — speed matters **with** a working project  

---

## Submission Checklist

- [ ] Repo public (or shared) with clear README  
- [ ] App deployed and openable  
- [ ] Migrations + Hasura metadata in repo  
- [ ] Write-up included  
- [ ] Final Task recording (recommended)  
- [ ] Submit: **GitHub URL** + **hosted app URL**
