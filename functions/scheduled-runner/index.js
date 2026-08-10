import { adminGql, ok } from '../_lib/hasura.js';
import { createAndStartRun } from '../_lib/engine.js';

const LIST_SCHEDULED = `
  query ListScheduled {
    workflow_triggers(
      where: {
        type: { _eq: "scheduled" }
        is_active: { _eq: true }
      }
    ) {
      id
      workflow_id
      config
    }
  }
`;

/**
 * Cron trigger (every 5 min): start runs for active scheduled workflows.
 * config.cron is informational; this poller is the actual schedule for the assignment.
 * Optional config: { "run_once_per_hour": true } uses a simple throttle key.
 */
export default async function handler(req) {
  try {
    // Optional webhook secret check for cron
    const secret =
      req.headers?.get?.('x-nhost-webhook-secret') ||
      req.headers?.['x-nhost-webhook-secret'];
    const expected = process.env.NHOST_WEBHOOK_SECRET;
    if (expected && secret && secret !== expected) {
      return ok({ success: false, message: 'Invalid webhook secret' });
    }

    const data = await adminGql(LIST_SCHEDULED);
    const triggers = data.workflow_triggers || [];
    const results = [];

    for (const t of triggers) {
      try {
        const r = await createAndStartRun({
          workflowId: t.workflow_id,
          userId: null,
          triggerType: 'scheduled',
          initialContext: { scheduled_at: new Date().toISOString() },
          skipAuth: true,
        });
        results.push({ trigger_id: t.id, ...r });
      } catch (e) {
        results.push({
          trigger_id: t.id,
          success: false,
          message: String(e.message || e),
        });
      }
    }

    return ok({ success: true, started: results.length, results });
  } catch (err) {
    console.error('scheduled-runner error', err);
    return ok({ success: false, message: String(err.message || err) });
  }
}
