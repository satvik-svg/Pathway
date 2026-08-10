import { adminGql, ok } from '../_lib/hasura.js';
import { createAndStartRun } from '../_lib/engine.js';

const FIND_DB_TRIGGERS = `
  query FindDbTriggers($workflow_id: uuid, $org_id: uuid!) {
    workflow_triggers(
      where: {
        type: { _eq: "database_event" }
        is_active: { _eq: true }
        _or: [
          { workflow_id: { _eq: $workflow_id } }
          {
            workflow: { org_id: { _eq: $org_id } }
            config: { _contains: { table: "watched_rows" } }
          }
        ]
      }
    ) {
      id
      workflow_id
      config
    }
  }
`;

/**
 * Hasura Event Trigger: INSERT on watched_rows starts matching workflows.
 * Also accepts a direct demo payload: { input: { org_id, workflow_id, payload } }
 * so the UI can fire the same path without waiting on event delivery.
 */
export default async function handler(req) {
  try {
    const body = await req.json();
    let row = body?.event?.data?.new;

    // Direct / UI fallback
    if (!row && (body?.input || body?.org_id || body?.workflow_id)) {
      const input = body.input || body;
      row = {
        id: input.id || null,
        org_id: input.org_id,
        workflow_id: input.workflow_id,
        payload: input.payload || { source: 'direct' },
        created_at: new Date().toISOString(),
      };
    }

    if (!row) {
      return ok({ success: false, message: 'No row' });
    }

    if (!row.org_id && !row.workflow_id) {
      return ok({
        success: false,
        message: 'org_id or workflow_id required',
      });
    }

    const workflowId = row.workflow_id;
    const orgId = row.org_id;

    // If row targets a workflow, start that; else start all org database_event triggers
    let workflowIds = [];
    if (workflowId) {
      workflowIds = [workflowId];
    } else {
      const data = await adminGql(FIND_DB_TRIGGERS, {
        workflow_id: workflowId,
        org_id: orgId,
      });
      workflowIds = (data.workflow_triggers || []).map((t) => t.workflow_id);
    }

    // Always try the row's workflow_id if set
    if (workflowId && !workflowIds.includes(workflowId)) {
      workflowIds.push(workflowId);
    }

    // Fallback: any database_event trigger on workflows in this org
    if (workflowIds.length === 0) {
      const all = await adminGql(
        `
        query AllDb($org_id: uuid!) {
          workflow_triggers(
            where: {
              type: { _eq: "database_event" }
              is_active: { _eq: true }
              workflow: { org_id: { _eq: $org_id } }
            }
          ) {
            workflow_id
          }
        }
      `,
        { org_id: orgId }
      );
      workflowIds = (all.workflow_triggers || []).map((t) => t.workflow_id);
    }

    const results = [];
    for (const wf of [...new Set(workflowIds)]) {
      const r = await createAndStartRun({
        workflowId: wf,
        userId: null,
        triggerType: 'database_event',
        initialContext: {
          watched_row: row,
          input: row?.payload ?? row?.data ?? row?.message ?? row,
        },
        skipAuth: true,
      });
      results.push({ workflow_id: wf, ...r });
    }

    return ok({ success: true, results });
  } catch (err) {
    console.error('db-event-trigger error', err);
    return ok({ success: false, message: String(err.message || err) });
  }
}
