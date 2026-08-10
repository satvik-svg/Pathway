-- AI Agent Workflow Builder — initial schema
-- Relationships: org → members / workflows → steps & triggers
--                workflow → runs → step_runs

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  quota_limit integer NOT NULL DEFAULT 100,
  quota_used integer NOT NULL DEFAULT 0 CHECK (quota_used >= 0),
  quota_period_start timestamptz NOT NULL DEFAULT date_trunc('month', now()),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.organizations IS 'Tenant org with monthly LLM/run quota';

-- ---------------------------------------------------------------------------
-- org_members
-- ---------------------------------------------------------------------------
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE INDEX org_members_user_id_idx ON public.org_members (user_id);
CREATE INDEX org_members_org_id_idx ON public.org_members (org_id);

-- ---------------------------------------------------------------------------
-- workflows
-- ---------------------------------------------------------------------------
CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflows_org_id_idx ON public.workflows (org_id);

-- ---------------------------------------------------------------------------
-- workflow_steps
-- ---------------------------------------------------------------------------
CREATE TABLE public.workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  type text NOT NULL CHECK (
    type IN (
      'llm_call',
      'http_request',
      'db_write',
      'notify',
      'conditional_branch',
      'approval_gate'
    )
  ),
  name text NOT NULL DEFAULT '',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, position)
);

CREATE INDEX workflow_steps_workflow_id_idx ON public.workflow_steps (workflow_id);

-- ---------------------------------------------------------------------------
-- workflow_triggers
-- ---------------------------------------------------------------------------
CREATE TABLE public.workflow_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN ('manual', 'webhook', 'scheduled', 'database_event')
  ),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  webhook_secret text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, type)
);

CREATE INDEX workflow_triggers_workflow_id_idx ON public.workflow_triggers (workflow_id);
CREATE INDEX workflow_triggers_webhook_secret_idx ON public.workflow_triggers (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- ---------------------------------------------------------------------------
-- workflow_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows (id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled')
  ),
  trigger_type text NOT NULL DEFAULT 'manual',
  started_by uuid,
  current_step_position integer,
  error text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workflow_runs_workflow_id_idx ON public.workflow_runs (workflow_id);
CREATE INDEX workflow_runs_org_id_idx ON public.workflow_runs (org_id);
CREATE INDEX workflow_runs_status_idx ON public.workflow_runs (status);

-- ---------------------------------------------------------------------------
-- step_runs
-- ---------------------------------------------------------------------------
CREATE TABLE public.step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs (id) ON DELETE CASCADE,
  workflow_step_id uuid REFERENCES public.workflow_steps (id) ON DELETE SET NULL,
  position integer NOT NULL,
  step_type text NOT NULL,
  step_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'running', 'success', 'failed', 'paused', 'skipped')
  ),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  attempt_count integer NOT NULL DEFAULT 0,
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX step_runs_workflow_run_id_idx ON public.step_runs (workflow_run_id);
CREATE INDEX step_runs_status_idx ON public.step_runs (status);

-- ---------------------------------------------------------------------------
-- db_write_results — destination for db_write steps
-- ---------------------------------------------------------------------------
CREATE TABLE public.db_write_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs (id) ON DELETE SET NULL,
  step_run_id uuid REFERENCES public.step_runs (id) ON DELETE SET NULL,
  key text NOT NULL DEFAULT 'result',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX db_write_results_org_id_idx ON public.db_write_results (org_id);

-- ---------------------------------------------------------------------------
-- notification_outbox — insert triggers notify Event Trigger (Slack/email)
-- ---------------------------------------------------------------------------
CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  workflow_run_id uuid REFERENCES public.workflow_runs (id) ON DELETE SET NULL,
  step_run_id uuid REFERENCES public.step_runs (id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'log',
  message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_outbox_org_id_idx ON public.notification_outbox (org_id);

-- ---------------------------------------------------------------------------
-- watched_rows — database_event trigger source table
-- ---------------------------------------------------------------------------
CREATE TABLE public.watched_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.workflows (id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX watched_rows_org_id_idx ON public.watched_rows (org_id);

-- ---------------------------------------------------------------------------
-- Aggregation: org usage + avg run duration (view)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.org_usage_stats AS
SELECT
  o.id AS org_id,
  o.name AS org_name,
  o.quota_limit,
  o.quota_used,
  o.quota_period_start,
  GREATEST(o.quota_limit - o.quota_used, 0) AS quota_remaining,
  COUNT(wr.id) FILTER (
    WHERE wr.created_at >= date_trunc('month', now())
  ) AS runs_this_month,
  AVG(
    EXTRACT(EPOCH FROM (wr.completed_at - wr.started_at))
  ) FILTER (
    WHERE wr.completed_at IS NOT NULL AND wr.started_at IS NOT NULL
  ) AS avg_run_duration_seconds
FROM public.organizations o
LEFT JOIN public.workflow_runs wr ON wr.org_id = o.id
GROUP BY o.id, o.name, o.quota_limit, o.quota_used, o.quota_period_start;

COMMENT ON VIEW public.org_usage_stats IS
  'Org-level quota + runs this month + average completed run duration';

-- ---------------------------------------------------------------------------
-- Helpers for permissions / Layer 2 step gating
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_org_role(p_org_id uuid, p_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT role
  FROM public.org_members
  WHERE org_id = p_org_id AND user_id = p_user_id
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_is_org_member(p_org_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.user_can_edit_org(p_org_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id
      AND user_id = p_user_id
      AND role IN ('owner', 'editor')
  );
$$;

CREATE OR REPLACE FUNCTION public.user_is_org_owner(p_org_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id
      AND user_id = p_user_id
      AND role = 'owner'
  );
$$;

-- Layer 2: only owners may insert privileged step types / webhook triggers
CREATE OR REPLACE FUNCTION public.enforce_privileged_step_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_role text;
  v_claims text;
  v_raw text;
BEGIN
  v_user_id := NULL;

  -- hasura.user may be a plain UUID or a JSON claims bag
  BEGIN
    v_raw := NULLIF(current_setting('hasura.user', true), '');
    IF v_raw IS NOT NULL THEN
      IF left(v_raw, 1) = '{' THEN
        v_raw := (v_raw::jsonb ->> 'x-hasura-user-id');
      END IF;
      IF v_raw IS NOT NULL AND v_raw ~* '^[0-9a-f-]{36}$' THEN
        v_user_id := v_raw::uuid;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF v_user_id IS NULL THEN
    BEGIN
      v_claims := NULLIF(current_setting('request.jwt.claims', true), '');
      IF v_claims IS NOT NULL AND left(v_claims, 1) = '{' THEN
        v_raw := COALESCE(
          v_claims::jsonb ->> 'x-hasura-user-id',
          v_claims::jsonb #>> '{https://hasura.io/jwt/claims,x-hasura-user-id}'
        );
        IF v_raw IS NOT NULL AND v_raw ~* '^[0-9a-f-]{36}$' THEN
          v_user_id := v_raw::uuid;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  SELECT w.org_id INTO v_org_id
  FROM public.workflows w
  WHERE w.id = NEW.workflow_id;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'workflow not found';
  END IF;

  -- Service-role / admin path (Action engine) bypasses when claim missing
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.user_org_role(v_org_id, v_user_id);

  IF NEW.type IN ('db_write', 'notify') AND COALESCE(v_role, '') <> 'owner' THEN
    RAISE EXCEPTION 'Only org owners can add % steps', NEW.type
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_privileged_step_insert
  BEFORE INSERT OR UPDATE OF type ON public.workflow_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_privileged_step_insert();

CREATE OR REPLACE FUNCTION public.enforce_privileged_trigger_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_org_id uuid;
  v_user_id uuid;
  v_role text;
  v_claims text;
  v_raw text;
BEGIN
  v_user_id := NULL;

  BEGIN
    v_raw := NULLIF(current_setting('hasura.user', true), '');
    IF v_raw IS NOT NULL THEN
      IF left(v_raw, 1) = '{' THEN
        v_raw := (v_raw::jsonb ->> 'x-hasura-user-id');
      END IF;
      IF v_raw IS NOT NULL AND v_raw ~* '^[0-9a-f-]{36}$' THEN
        v_user_id := v_raw::uuid;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_user_id := NULL;
  END;

  IF v_user_id IS NULL THEN
    BEGIN
      v_claims := NULLIF(current_setting('request.jwt.claims', true), '');
      IF v_claims IS NOT NULL AND left(v_claims, 1) = '{' THEN
        v_raw := COALESCE(
          v_claims::jsonb ->> 'x-hasura-user-id',
          v_claims::jsonb #>> '{https://hasura.io/jwt/claims,x-hasura-user-id}'
        );
        IF v_raw IS NOT NULL AND v_raw ~* '^[0-9a-f-]{36}$' THEN
          v_user_id := v_raw::uuid;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_user_id := NULL;
    END;
  END IF;

  SELECT w.org_id INTO v_org_id
  FROM public.workflows w
  WHERE w.id = NEW.workflow_id;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_role := public.user_org_role(v_org_id, v_user_id);

  IF NEW.type = 'webhook' AND COALESCE(v_role, '') <> 'owner' THEN
    RAISE EXCEPTION 'Only org owners can add webhook triggers'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_privileged_trigger_insert
  BEFORE INSERT OR UPDATE OF type ON public.workflow_triggers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_privileged_trigger_insert();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_organizations_updated
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workflows_updated
  BEFORE UPDATE ON public.workflows
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_workflow_steps_updated
  BEFORE UPDATE ON public.workflow_steps
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Reset quota when period rolls (helper; called from Action as well)
CREATE OR REPLACE FUNCTION public.ensure_quota_period(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.organizations
  SET
    quota_used = 0,
    quota_period_start = date_trunc('month', now())
  WHERE id = p_org_id
    AND quota_period_start < date_trunc('month', now());
END;
$$;
