import { adminGql, ok, fail } from '../_lib/hasura.js';
import { createAndStartRun } from '../_lib/engine.js';

const FIND_TRIGGER = `
  query FindWebhook($secret: String!) {
    workflow_triggers(
      where: {
        webhook_secret: { _eq: $secret }
        type: { _eq: "webhook" }
        is_active: { _eq: true }
      }
      limit: 1
    ) {
      id
      workflow_id
      config
    }
  }
`;

/**
 * Hasura Action: webhookStartRun(webhook_secret, payload)
 * External systems start a run without a UI button.
 * Auth is the webhook secret (not user JWT) — Layer 2: only owners can create webhook triggers.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  try {
    const body = await req.json();
    const secret =
      body?.input?.webhook_secret ||
      body?.webhook_secret ||
      req.headers?.get?.('x-webhook-secret') ||
      req.headers?.['x-webhook-secret'];
    const payload = body?.input?.payload ?? body?.payload ?? {};

    if (!secret) {
      return fail('webhook_secret is required');
    }

    const data = await adminGql(FIND_TRIGGER, { secret });
    const trigger = data.workflow_triggers?.[0];
    if (!trigger) {
      return ok({
        success: false,
        message: 'Invalid or inactive webhook secret',
        workflow_run_id: null,
        status: null,
      });
    }

    const result = await createAndStartRun({
      workflowId: trigger.workflow_id,
      userId: null,
      triggerType: 'webhook',
      initialContext: {
        webhook_payload: payload,
        // Also surface as input for {{input}} templates
        input:
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? payload.input ?? payload.text ?? payload.message ?? payload
            : payload,
      },
      skipAuth: true, // secret auth already validated
    });

    return ok({
      success: result.success,
      message: result.message,
      workflow_run_id: result.workflow_run_id || null,
      status: result.status || null,
    });
  } catch (err) {
    console.error('webhook-trigger error', err);
    return ok({
      success: false,
      message: String(err.message || err),
      workflow_run_id: null,
      status: null,
    });
  }
}
