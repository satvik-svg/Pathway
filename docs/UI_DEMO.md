# Full UI Demo (local Nhost Auth)

## Running stack

| Service | URL |
|---------|-----|
| **App** | http://localhost:3000 |
| Auth | http://local.auth.nhost.run:1337/v1 |
| GraphQL | http://local.hasura.nhost.run:1337/v1/graphql |
| Hasura console | http://local.hasura.nhost.run:1337/console (secret: `nhost-admin-secret`) |
| Functions engine | http://localhost:4001 |

## Test users (password for all: `password123`)

| Email | Org | Role |
|-------|-----|------|
| `owner-a@example.com` | Org A | owner |
| `editor-a@example.com` | Org A | editor |
| `viewer-a@example.com` | Org A | viewer |
| `owner-b@example.com` | Org B | owner |

### Interviewer tools (in-app)

| Page | URL | Purpose |
|------|-----|---------|
| **Interview** | http://localhost:3000/interview | One-click switch between demo accounts + Final Task checklist |
| **Organization** | http://localhost:3000/org | Create org, list members, change roles, add by email |
| **Login chips** | Login page | Prefill demo emails |

**Org APIs (functions):** `create-organization`, `list-org-members`, `manage-org-member`

## Walkthrough (Final Task)

1. Open http://localhost:3000 → **Sign in** as `owner-a@example.com`
2. Confirm org **Org A**, role **owner**, quota bar visible
3. **New workflow** (defaults: llm + http + branch + approval + notify + webhook) → Create
4. Click **Run** → live panel: steps go success → **paused** on approval_gate
5. Click **Approve & resume** → run **completed**
6. Click **Start via webhook** for second start path
7. Sign out → sign in as `owner-b@example.com`
8. Confirm empty workflows; cannot see Org A (even guessing IDs fails via GraphQL)

## Restart services

```bash
# Nhost (from repo root) — if stack is down:
export PATH="$HOME/.local/bin:$PATH"
nhost up --http-port 1337 --disable-tls
# If console health fails but auth/graphql are healthy, leave containers running.

# Functions
cd functions
export NHOST_GRAPHQL_URL=http://local.hasura.nhost.run:1337/v1/graphql
export NHOST_ADMIN_SECRET=nhost-admin-secret
export LLM_STUB=true
node local-server.mjs

# Frontend
cd web
# .env.local already points at local.auth / local.hasura
npm run dev
```

## Verified automated path (real Auth JWTs)

```
owner A create workflow + steps + triggers  ✅
triggerWorkflowRun → paused at approval_gate ✅
Org B list empty / by_pk null / cannot trigger ✅
approveStep → completed ✅
webhookStartRun → paused ✅
```
