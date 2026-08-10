import { getUserIdFromRequest, ok, fail, corsPreflight } from '../_lib/hasura.js';
import { approveStepRun } from '../_lib/engine.js';

/**
 * Hasura Action: approveStep(step_run_id)
 * Layer 2: checks approver is owner/editor in the run's org, then resumes.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return corsPreflight();
  }

  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req, body);
    const stepRunId = body?.input?.step_run_id || body?.step_run_id;

    if (!stepRunId) {
      return fail('step_run_id is required');
    }
    if (!userId) {
      return fail('Unauthorized: missing user session', 401);
    }

    const result = await approveStepRun({ stepRunId, userId });

    return ok({
      success: result.success,
      message: result.message,
      workflow_run_id: result.workflow_run_id || null,
      status: result.status || null,
    });
  } catch (err) {
    console.error('approve-step error', err);
    return ok({
      success: false,
      message: String(err.message || err),
      workflow_run_id: null,
      status: null,
    });
  }
}
