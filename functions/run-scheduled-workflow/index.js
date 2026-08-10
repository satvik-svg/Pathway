import { adminGql, getUserIdFromRequest, ok, fail } from '../_lib/hasura.js';
import { createAndStartRun, getMembership, canTrigger } from '../_lib/engine.js';

/**
 * Manually fire the "scheduled" path for one workflow (demo / test button).
 * Same code path as cron: trigger_type = scheduled.
 * Also verifies caller is owner/editor when session present.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req, body);
    const workflowId = body?.input?.workflow_id || body?.workflow_id;

    if (!workflowId) {
      return ok({ success: false, message: 'workflow_id is required' });
    }

    // Load workflow org
    const wf = await adminGql(
      `
      query W($id: uuid!) {
        workflows_by_pk(id: $id) { id org_id }
        workflow_triggers(
          where: {
            workflow_id: { _eq: $id }
            type: { _eq: "scheduled" }
            is_active: { _eq: true }
          }
          limit: 1
        ) { id config }
      }
    `,
      { id: workflowId }
    );

    const workflow = wf.workflows_by_pk;
    if (!workflow) {
      return ok({ success: false, message: 'Workflow not found' });
    }

    if (!wf.workflow_triggers?.length) {
      return ok({
        success: false,
        message:
          'This workflow has no active Scheduled trigger. Edit it and enable “Scheduled”.',
      });
    }

    if (userId) {
      const member = await getMembership(workflow.org_id, userId);
      if (!member || !canTrigger(member.role)) {
        return ok({
          success: false,
          message:
            'Forbidden: only owner/editor can fire a scheduled run from the UI',
        });
      }
    }

    const result = await createAndStartRun({
      workflowId,
      userId: userId || null,
      triggerType: 'scheduled',
      initialContext: {
        scheduled_at: new Date().toISOString(),
        source: 'manual_schedule_button',
        cron_config: wf.workflow_triggers[0].config || {},
      },
      skipAuth: true, // already checked above
    });

    return ok({
      success: result.success,
      message: result.message || (result.success ? 'Scheduled run started' : 'Failed'),
      workflow_run_id: result.workflow_run_id || null,
      status: result.status || null,
      trigger_type: 'scheduled',
    });
  } catch (err) {
    console.error('run-scheduled-workflow', err);
    return ok({
      success: false,
      message: String(err.message || err),
      workflow_run_id: null,
    });
  }
}
