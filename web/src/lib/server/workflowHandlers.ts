/**
 * Workflow run + approve on Vercel (avoids Nhost Functions "Unhandled" lambda).
 */
import { userIdFromRequest } from './hasura';
// Engine is shared JS (same as Nhost functions/_lib/engine.js)
// eslint-disable-next-line @typescript-eslint/no-require-imports
import {
  createAndStartRun,
  approveStepRun,
} from './engine.js';

type Body = {
  input?: Record<string, unknown>;
  session_variables?: Record<string, string>;
  workflow_id?: string;
  step_run_id?: string;
  context?: unknown;
};

function inputOf(body: Body) {
  return (body.input || body || {}) as Record<string, unknown>;
}

export async function handleTriggerWorkflowRun(
  authHeader: string | null,
  body: Body
) {
  const userId = userIdFromRequest(authHeader, body);
  const input = inputOf(body);
  const workflowId = String(
    input.workflow_id || body.workflow_id || ''
  ).trim();

  const runInput =
    input.input !== undefined
      ? input.input
      : input.context !== undefined
        ? input.context
        : body.context;

  if (!workflowId) {
    return {
      status: 200,
      data: {
        success: false,
        message: 'workflow_id is required',
        workflow_run_id: null,
        status: null,
      },
    };
  }
  if (!userId) {
    return {
      status: 401,
      data: {
        success: false,
        message: 'Unauthorized: missing user session — sign out and sign in again',
        workflow_run_id: null,
        status: null,
      },
    };
  }

  const initialContext =
    runInput !== undefined && runInput !== null
      ? typeof runInput === 'object' &&
        !Array.isArray(runInput) &&
        (runInput as { input?: unknown }).input !== undefined
        ? (runInput as Record<string, unknown>)
        : { input: runInput }
      : {};

  try {
    const result = await createAndStartRun({
      workflowId,
      userId,
      triggerType: 'manual',
      initialContext,
    });

    if (!result.success) {
      const status = String(result.message || '').includes('Forbidden')
        ? 403
        : 200;
      return {
        status,
        data: {
          success: false,
          message: result.message,
          workflow_run_id: null,
          status: null,
        },
      };
    }

    return {
      status: 200,
      data: {
        success: true,
        message: result.message,
        workflow_run_id: result.workflow_run_id,
        status: result.status,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[trigger-workflow-run]', message);
    return {
      status: 200,
      data: {
        success: false,
        message,
        workflow_run_id: null,
        status: null,
      },
    };
  }
}

export async function handleApproveStep(
  authHeader: string | null,
  body: Body
) {
  const userId = userIdFromRequest(authHeader, body);
  const input = inputOf(body);
  const stepRunId = String(
    input.step_run_id || body.step_run_id || ''
  ).trim();

  if (!stepRunId) {
    return {
      status: 200,
      data: {
        success: false,
        message: 'step_run_id is required',
        workflow_run_id: null,
        status: null,
      },
    };
  }
  if (!userId) {
    return {
      status: 401,
      data: {
        success: false,
        message: 'Unauthorized — sign out and sign in again',
        workflow_run_id: null,
        status: null,
      },
    };
  }

  try {
    const result = await approveStepRun({ stepRunId, userId });
    return {
      status: 200,
      data: {
        success: result.success,
        message: result.message,
        workflow_run_id: result.workflow_run_id || null,
        status: result.status || null,
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[approve-step]', message);
    return {
      status: 200,
      data: {
        success: false,
        message,
        workflow_run_id: null,
        status: null,
      },
    };
  }
}
