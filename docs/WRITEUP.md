# Chain AI — Design Write-up (~1 page)

## Schema reasoning

The data model is multi-tenant around **organizations**. Membership (`org_members`) links `auth` users to an org with a role (`owner` | `editor` | `viewer`). Workflows belong to an org; ordered `workflow_steps` and `workflow_triggers` define the graph; each execution is a `workflow_run` with child `step_runs`.

Denormalizing `org_id` onto `workflow_runs` makes permission filters and quota accounting cheap without joining through `workflows` on every subscription event. `step_runs` store status, I/O, `attempt_count`, and `approved_by` / `approved_at` so the UI can stream progress and prove approval provenance.

Supporting tables:

- `db_write_results` — sandbox target for `db_write` steps  
- `notification_outbox` — insert fires a Hasura **Event Trigger** (notify step)  
- `watched_rows` — insert fires a **database_event** workflow start  
- `org_usage_stats` view — monthly runs + average duration aggregation  

Statuses on `workflow_runs` explicitly include **`paused`** for approval gates.

## Two permission layers (enforced differently)

### Layer 1 — Org + role scoping (Hasura row permissions)

Every user-facing table is filtered by membership:

```text
organization.members.user_id = X-Hasura-User-Id
```

Role gates on mutations:

| Role   | Workflows / steps / triggers | Members     | Trigger runs (Action) |
|--------|------------------------------|-------------|------------------------|
| owner  | full                         | manage      | yes                    |
| editor | create/edit                  | no          | yes                    |
| viewer | read only                    | no          | no                     |

So an **editor in Org B never sees Org A rows**, including `workflows_by_pk(id: "<guessed>")` — Hasura returns null, not a row. Run/step tables have **no insert/update permissions for `user`**; only the Action service role mutates execution state. That prevents clients from forging run status or skipping the engine.

### Layer 2 — Step-level gating (Postgres + Action handlers)

Some capabilities leave the sandbox or control mid-flight execution:

1. **Definition time** — only **owners** may add `db_write`, `notify`, or **webhook** triggers. Enforced by Postgres `BEFORE INSERT` triggers (defense in depth) and mirrored in the UI. Editors can still build `llm_call` / `http_request` / `conditional_branch` / `approval_gate`.

2. **Runtime approval** — clearing an `approval_gate` is **not** a simple row update. The **`approveStep` Action** loads the step run, verifies the caller’s `org_members.role` is `owner` or `editor` **in that run’s org**, then marks approval fields and resumes the engine. Cross-org users fail the membership check even if they know the `step_run_id`.

`triggerWorkflowRun` similarly re-checks owner/editor + **quota** before creating a run.

## Approval-gate pause / resume

1. Engine creates `workflow_run` (`running`) and pending `step_runs`.  
2. Steps execute in order; `llm_call` / `http_request` use real APIs with **one retry** on failure.  
3. On `approval_gate`, the engine sets that `step_run` to **`paused`**, the parent run to **`paused`**, persists context, and **returns** (does not hang the HTTP request forever).  
4. Frontend **subscription** on `step_runs(where: { workflow_run_id })` shows “paused, awaiting approval” live.  
5. Approver calls **`approveStep`**: role check → `approved_by` / `approved_at` → step `success` → run `running` → **`continueRun`** from the next position (branch skips already applied).  
6. On full completion, org **`quota_used`** increments.

## Triggers beyond manual

- **Webhook** — Action `webhookStartRun(secret)` (owner-created secret).  
- **Scheduled** — Hasura cron → `scheduled-runner` function.  
- **Database event** — Event Trigger on `watched_rows` → `db-event-trigger`.  
- **Notify** — Event Trigger on `notification_outbox` → Slack/log handler.

Together, schema, Hasura permissions, Action authz, and subscriptions form one deliverable: the Final Task cannot pass if any layer is wrong.
