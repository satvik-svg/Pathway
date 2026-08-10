DROP TRIGGER IF EXISTS trg_workflow_steps_updated ON public.workflow_steps;
DROP TRIGGER IF EXISTS trg_workflows_updated ON public.workflows;
DROP TRIGGER IF EXISTS trg_organizations_updated ON public.organizations;
DROP TRIGGER IF EXISTS trg_privileged_trigger_insert ON public.workflow_triggers;
DROP TRIGGER IF EXISTS trg_privileged_step_insert ON public.workflow_steps;

DROP FUNCTION IF EXISTS public.ensure_quota_period(uuid);
DROP FUNCTION IF EXISTS public.set_updated_at();
DROP FUNCTION IF EXISTS public.enforce_privileged_trigger_insert();
DROP FUNCTION IF EXISTS public.enforce_privileged_step_insert();
DROP FUNCTION IF EXISTS public.user_is_org_owner(uuid, uuid);
DROP FUNCTION IF EXISTS public.user_can_edit_org(uuid, uuid);
DROP FUNCTION IF EXISTS public.user_is_org_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.user_org_role(uuid, uuid);

DROP VIEW IF EXISTS public.org_usage_stats;

DROP TABLE IF EXISTS public.watched_rows CASCADE;
DROP TABLE IF EXISTS public.notification_outbox CASCADE;
DROP TABLE IF EXISTS public.db_write_results CASCADE;
DROP TABLE IF EXISTS public.step_runs CASCADE;
DROP TABLE IF EXISTS public.workflow_runs CASCADE;
DROP TABLE IF EXISTS public.workflow_triggers CASCADE;
DROP TABLE IF EXISTS public.workflow_steps CASCADE;
DROP TABLE IF EXISTS public.workflows CASCADE;
DROP TABLE IF EXISTS public.org_members CASCADE;
DROP TABLE IF EXISTS public.organizations CASCADE;
