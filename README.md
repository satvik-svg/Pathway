# Pathway

**AI agent workflow builder** — a multi-tenant platform for designing, running, and monitoring automated pipelines that combine language models, HTTP APIs, branching logic, human approval, database writes, and notifications.

Inspired by tools such as n8n, Pathway focuses on a clear execution model, organization-scoped security, and live run visibility rather than a large integration marketplace.

---

## Overview

Users belong to **organizations** with roles (`owner`, `editor`, `viewer`). Within an organization they can:

1. **Design workflows** as a visual graph of steps  
2. **Start runs** manually, via webhook, on a schedule, or from a database event  
3. **Watch execution** in real time, including pauses for human approval  
4. **Inspect outcomes** such as notification outbox entries and saved results  

The product is built as a full-stack system: PostgreSQL and Hasura for data and GraphQL, server-side handlers for the execution engine, and a Next.js application for the UI.

---

## Core concepts

### Workflows and steps

A workflow is an ordered (and optionally branching) graph of steps. Supported step types include:

| Step | Purpose |
|------|---------|
| **Ask AI** | Call an LLM; prefer structured JSON (for example `{"answer":"yes"}`) for reliable branching |
| **HTTP request** | Call any external API |
| **Conditional branch** | Route on a field from a previous step (for example AI `answer`) |
| **Approval gate** | Pause the run until an authorized user continues |
| **Save to database** | Persist a payload for the organization (owner-only to add) |
| **Notification** | Write to an outbox and optionally deliver (log / Slack / email path) |

### Triggers

| Trigger | When it starts a run |
|---------|----------------------|
| **Manual** | User starts a run from the app |
| **Webhook** | External system posts with a secret |
| **Scheduled** | Periodic runner (cron-style) |
| **Database event** | Insert into a watched table |

### Execution model

- Runs create per-step records so progress can be streamed over GraphQL subscriptions.  
- LLM and HTTP steps support **retry** on failure.  
- Organizations have a **monthly run quota**.  
- Approval gates set the run to **paused**; resuming requires a server-side role check, not a client-only status update.  
- Approval cards can be **summarized by a short LLM pass** over run memory for readable UI copy.

### Security (two layers)

1. **Organization scope** — Hasura permissions limit all tenant data to members of the relevant organization. Viewers cannot start runs; editors and owners can.  
2. **Step and action gates** — Sensitive step types and mid-run approval are enforced in Action handlers (and definition-time rules for owners), not only in the UI.

Cross-organization isolation is a first-class requirement: membership in one org never grants access to another’s workflows or runs.

---

## Architecture

| Layer | Technology | Role |
|-------|------------|------|
| Data | PostgreSQL | Organizations, workflows, runs, outbox, usage |
| API | Hasura GraphQL | Queries, mutations, subscriptions, permissions, Actions, event triggers |
| Auth | Nhost Auth | Users and JWTs consumed by Hasura |
| Engine | Node handlers | Execute steps, enforce quota and roles, pause/resume |
| UI | Next.js | Org switcher, canvas builder, live run panel, activity |

```
Client (Next.js)
    → GraphQL (Hasura)  →  Postgres
    → Actions / Events  →  Functions (workflow engine)
```

---

## Repository layout

| Path | Contents |
|------|----------|
| `nhost/` | Migrations, Hasura metadata, project config |
| `functions/` | Workflow engine and Action / event handlers |
| `web/` | Next.js frontend |
| `scripts/` | Seed data, metadata apply, evaluation harness |

---

## Getting started

### Requirements

- Node.js 18 or later  
- [Nhost CLI](https://docs.nhost.io/getting-started/installation) **or** Docker for a local Hasura/Postgres stack  
- Optional: Groq, OpenRouter, or Gemini API key for live LLM calls (otherwise a stub mode is available for offline development)

### Recommended path (Nhost + app)

1. **Backend** — Start or link an Nhost project from `nhost/` so migrations and metadata apply. Deploy or run function handlers and set environment variables (admin secret, GraphQL URL, LLM keys, optional Slack webhook).  
2. **Seed** — Create users in Auth, then map them into two sample organizations with `scripts/seed.mjs` (see script header for required env vars).  
3. **Frontend** — In `web/`, configure public Nhost endpoints, install dependencies, and run the development server. Open the app, create or join an organization, and build a workflow.

### Local engine testing (Docker)

A `docker-compose.yml` file provides Postgres and Hasura for engine-focused work. Run the compose stack, apply metadata with `scripts/apply-hasura-metadata.mjs`, start `functions/local-server.mjs` with GraphQL admin credentials, then optionally run `scripts/eval-final-task.mjs` for an automated end-to-end scorecard.

Full browser sign-in still depends on Nhost Auth (or equivalent JWT configuration). Prefer a full Nhost project for interactive demos.

### Environment variables (summary)

**Functions / engine**

- GraphQL URL and admin secret for server-side execution  
- At least one LLM provider key, or explicit stub mode  
- Optional delivery secrets (for example Slack webhook)  
- Shared secret for Hasura event / cron webhooks  

**Frontend**

- Public Nhost subdomain, region, and related `NEXT_PUBLIC_*` settings  
- Optional local functions base URL for development  

Exact names vary by deployment; keep secrets out of the repository (see `.gitignore`).

---

## Using the product

1. **Sign in** and select or create an **organization**.  
2. Open **Workflows** and create a pipeline on the canvas (drag steps, connect Yes/No ports on branches).  
3. Choose how the workflow may start (manual, webhook, schedule, database event).  
4. **Run** — if the graph uses run input (for example `{{input}}` in an AI prompt), the UI asks for a payload; otherwise the run starts immediately.  
5. Follow progress in the **live run** panel; **approve** when a gate pauses.  
6. Review **Activity** for notifications and database saves for the current org.

Templates include a default AI-oriented graph, a simple HTTP → notify flow (no manual input), and a full multi-step HTTP → AI → branch → approval → save → notify path for end-to-end testing.

---

## Demonstrating multi-tenancy

A complete walkthrough typically shows:

- An owner building a multi-step workflow and running it through pause and approve  
- Starting the same workflow via webhook or database event  
- A second organization that cannot see or trigger the first org’s data  
- A viewer who can inspect but not run or approve  

The in-app **Final Task** and **Interview** pages outline demo accounts and isolation checks.

---

## Deployment (Vercel + Nhost Cloud)

The browser talks only to your Vercel app. Org/actions go through  
`https://your-app.vercel.app/api/functions/...`, which **proxies** to Nhost Functions  
(so you avoid CORS on `*.functions.*.nhost.run`).

### 1. Nhost

- Deploy / link the `nhost/` folder (migrations, metadata, functions).  
- In **Auth → Settings**, allow redirect URLs for your Vercel domain  
  (this repo’s `nhost.toml` includes `https://pathway-coral.vercel.app`).  
- Set **function secrets**: `NHOST_GRAPHQL_URL`, `NHOST_ADMIN_SECRET`, optional `GROQ_API_KEY`.

### 2. Vercel (`web/`)

Set environment variables (Production), then redeploy:

| Variable | Example |
|----------|---------|
| `NEXT_PUBLIC_NHOST_SUBDOMAIN` | your Nhost subdomain |
| `NEXT_PUBLIC_NHOST_REGION` | e.g. `ap-south-1` |
| `NEXT_PUBLIC_NHOST_AUTH_URL` | `https://<sub>.auth.<region>.nhost.run/v1` |
| `NEXT_PUBLIC_NHOST_GRAPHQL_URL` | `https://<sub>.graphql.<region>.nhost.run/v1` |
| `NEXT_PUBLIC_NHOST_STORAGE_URL` | `https://<sub>.storage.<region>.nhost.run/v1` |
| `NEXT_PUBLIC_NHOST_FUNCTIONS_URL` | `https://<sub>.functions.<region>.nhost.run/v1` |
| `NHOST_GRAPHQL_URL` | **Same as GraphQL URL** (server-only; required for create-org) |
| `NHOST_ADMIN_SECRET` | **Hasura admin secret** from Nhost (server-only; required) |
| `NHOST_FUNCTIONS_URL` | Functions base (optional; for engine proxy until fully on Vercel) |

**Critical:** Create organization runs **on Vercel** and needs `NHOST_GRAPHQL_URL` + `NHOST_ADMIN_SECRET`. Without them you get 500 / “Unhandled”.

Do **not** point server env at `localhost` or `local.functions` on Vercel.

### 3. After deploy

1. Open the Vercel URL and sign up / sign in.  
2. Create an organization (Network tab should show `POST /api/functions/create-organization`, not a CORS error on `nhost.run`).  
3. If auth returns 401, clear site data and sign in again after redirect URLs are updated.  

---

## Project status

This repository contains a working end-to-end implementation of the workflow builder: multi-org auth, visual canvas, execution engine with pause/approve, multiple triggers, and an activity feed for notifications and database saves. Local development typically runs the Next.js app against Nhost (or Docker Hasura) plus the Node functions server.

---

## License

Intended for assignment, portfolio, and educational use.
