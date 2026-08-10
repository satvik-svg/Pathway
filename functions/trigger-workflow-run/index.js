import { getUserIdFromRequest, ok, fail } from '../_lib/hasura.js';
import { createAndStartRun } from '../_lib/engine.js';

/**
 * Hasura Action: triggerWorkflowRun(workflow_id)
 * Verifies org membership (owner/editor), quota, then executes the engine.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req, body);
    const workflowId =
      body?.input?.workflow_id || body?.workflow_id;
    // Optional run payload — becomes {{input}} in AI prompts / templates
    const runInput =
      body?.input?.input !== undefined
        ? body.input.input
        : body?.input?.context !== undefined
          ? body.input.context
          : body?.context;

    if (!workflowId) {
      return fail('workflow_id is required');
    }
    if (!userId) {
      return fail('Unauthorized: missing user session', 401);
    }

    const initialContext =
      runInput !== undefined && runInput !== null
        ? typeof runInput === 'object' && !Array.isArray(runInput) && runInput.input !== undefined
          ? runInput
          : { input: runInput }
        : {};

    const result = await createAndStartRun({
      workflowId,
      userId,
      triggerType: 'manual',
      initialContext,
    });

    if (!result.success) {
      const status = result.message?.includes('Forbidden') ? 403 : 400;
      return ok({
        success: false,
        message: result.message,
        workflow_run_id: null,
        status: null,
      }, status);
    }

    return ok({
      success: true,
      message: result.message,
      workflow_run_id: result.workflow_run_id,
      status: result.status,
    });
  } catch (err) {
    console.error('trigger-workflow-run error', err);
    return ok({
      success: false,
      message: String(err.message || err),
      workflow_run_id: null,
      status: null,
    });
  }
}
