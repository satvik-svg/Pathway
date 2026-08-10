'use client';

import { getGraphqlUrl, getWsUrl, nhost } from './nhost';
import { createClient, type Client } from 'graphql-ws';
import { formatMessage } from './format';

export async function gql<T = unknown>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const url = getGraphqlUrl();
  if (!url) {
    throw new Error(
      'GraphQL URL not configured. Set NEXT_PUBLIC_NHOST_GRAPHQL_URL to https://<sub>.graphql.<region>.nhost.run/v1'
    );
  }

  const token = nhost.auth.getAccessToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new Error(
      `GraphQL network error: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const text = await res.text();
  const contentType = res.headers.get('content-type') || '';

  // HTML (Next 404, wrong host) — never surface raw JSON.parse SyntaxError
  if (
    contentType.includes('text/html') ||
    text.trimStart().startsWith('<!') ||
    text.trimStart().startsWith('<html')
  ) {
    throw new Error(
      `GraphQL got HTML instead of JSON (${res.status}). URL=${url}. Set Vercel NEXT_PUBLIC_NHOST_GRAPHQL_URL to …graphql…/v1 and redeploy.`
    );
  }

  let json: {
    data?: T;
    errors?: { message: string }[];
    error?: string;
    message?: string;
  };
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      res.status === 401 || res.status === 403
        ? 'Session expired — sign out and sign in again'
        : `GraphQL non-JSON (${res.status}) at ${url}`
    );
  }

  if (!res.ok && !json.data) {
    throw new Error(
      json.error || json.message || `GraphQL HTTP ${res.status}`
    );
  }
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e) => e.message).join('; ')
    );
  }
  if (json.data == null) {
    throw new Error('GraphQL returned no data');
  }
  return json.data as T;
}

let sharedWs: Client | null = null;

function getWsClient(): Client {
  if (sharedWs) return sharedWs;
  sharedWs = createClient({
    url: getWsUrl(),
    lazy: true,
    retryAttempts: 5,
    shouldRetry: () => true,
    connectionParams: () => {
      const token = nhost.auth.getAccessToken();
      return {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      };
    },
  });
  return sharedWs;
}

/** Subscribe via graphql-ws (Hasura subscriptions). */
export function subscribe<T = unknown>(
  query: string,
  variables: Record<string, unknown>,
  onNext: (data: T) => void,
  onError?: (err: Error) => void
): () => void {
  const client = getWsClient();
  let active = true;

  const dispose = client.subscribe(
    { query, variables },
    {
      next: (result) => {
        if (!active) return;
        if (result.errors?.length) {
          onError?.(
            new Error(result.errors.map((e) => e.message).join('; '))
          );
          return;
        }
        if (result.data) onNext(result.data as T);
      },
      error: (err) => {
        if (!active) return;
        onError?.(
          err instanceof Error ? err : new Error(formatMessage(err))
        );
      },
      complete: () => {},
    }
  );

  return () => {
    active = false;
    dispose();
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export const MY_MEMBERSHIPS = `
  query MyMemberships($user_id: uuid!) {
    org_members(where: { user_id: { _eq: $user_id } }) {
      id
      role
      org_id
      user_id
      organization {
        id
        name
        quota_limit
        quota_used
        quota_period_start
      }
    }
  }
`;

export const ORG_WORKFLOWS = `
  query OrgWorkflows($org_id: uuid!) {
    workflows(
      where: { org_id: { _eq: $org_id } }
      order_by: { updated_at: desc }
    ) {
      id
      name
      description
      org_id
      created_at
      updated_at
      steps(order_by: { position: asc }) {
        id
        position
        type
        name
        config
      }
      triggers {
        id
        type
        config
        is_active
        webhook_secret
      }
      runs(order_by: { created_at: desc }, limit: 1) {
        id
        status
        trigger_type
        started_at
        completed_at
        error
        created_at
      }
    }
  }
`;

export const WORKFLOW_DETAIL = `
  query WorkflowDetail($id: uuid!) {
    workflows_by_pk(id: $id) {
      id
      name
      description
      org_id
      steps(order_by: { position: asc }) {
        id
        position
        type
        name
        config
      }
      triggers {
        id
        type
        config
        is_active
        webhook_secret
      }
      runs(order_by: { created_at: desc }, limit: 10) {
        id
        status
        trigger_type
        started_by
        error
        created_at
        started_at
        completed_at
      }
    }
  }
`;

export const INSERT_WORKFLOW = `
  mutation InsertWorkflow($object: workflows_insert_input!) {
    insert_workflows_one(object: $object) {
      id
    }
  }
`;

export const UPDATE_WORKFLOW = `
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String!) {
    update_workflows_by_pk(
      pk_columns: { id: $id }
      _set: { name: $name, description: $description }
    ) {
      id
    }
  }
`;

export const DELETE_STEPS = `
  mutation DeleteSteps($workflow_id: uuid!) {
    delete_workflow_steps(where: { workflow_id: { _eq: $workflow_id } }) {
      affected_rows
    }
  }
`;

export const INSERT_STEPS = `
  mutation InsertSteps($objects: [workflow_steps_insert_input!]!) {
    insert_workflow_steps(objects: $objects) {
      affected_rows
    }
  }
`;

export const DELETE_TRIGGERS = `
  mutation DeleteTriggers($workflow_id: uuid!) {
    delete_workflow_triggers(where: { workflow_id: { _eq: $workflow_id } }) {
      affected_rows
    }
  }
`;

export const INSERT_TRIGGERS = `
  mutation InsertTriggers($objects: [workflow_triggers_insert_input!]!) {
    insert_workflow_triggers(objects: $objects) {
      affected_rows
      returning { id type webhook_secret }
    }
  }
`;

export const TRIGGER_RUN = `
  mutation TriggerRun($workflow_id: uuid!, $input: jsonb) {
    triggerWorkflowRun(workflow_id: $workflow_id, input: $input) {
      success
      message
      workflow_run_id
      status
    }
  }
`;

export const APPROVE_STEP = `
  mutation ApproveStep($step_run_id: uuid!) {
    approveStep(step_run_id: $step_run_id) {
      success
      message
      workflow_run_id
      status
    }
  }
`;

export const WEBHOOK_START = `
  mutation WebhookStart($webhook_secret: String!, $payload: jsonb) {
    webhookStartRun(webhook_secret: $webhook_secret, payload: $payload) {
      success
      message
      workflow_run_id
      status
    }
  }
`;

/** Hasura allows only ONE top-level field per subscription. */
export const STEP_RUNS_SUB = `
  subscription StepRuns($run_id: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $run_id } }
      order_by: { position: asc }
    ) {
      id
      position
      step_type
      step_name
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
    }
  }
`;

export const RUN_STATUS_SUB = `
  subscription RunStatus($run_id: uuid!) {
    workflow_runs_by_pk(id: $run_id) {
      id
      status
      error
      trigger_type
      current_step_position
    }
  }
`;

/** Polling fallback (and primary for run+steps together). */
export const STEP_RUNS_QUERY = `
  query StepRunsQuery($run_id: uuid!) {
    step_runs(
      where: { workflow_run_id: { _eq: $run_id } }
      order_by: { position: asc }
    ) {
      id
      position
      step_type
      step_name
      status
      input
      output
      error
      attempt_count
      approved_by
      approved_at
      started_at
      completed_at
    }
    workflow_runs_by_pk(id: $run_id) {
      id
      status
      error
      trigger_type
      current_step_position
    }
  }
`;

export const INSERT_WATCHED_ROW = `
  mutation InsertWatched($object: watched_rows_insert_input!) {
    insert_watched_rows_one(object: $object) {
      id
    }
  }
`;

/** Org activity: notifications + db writes (member-scoped via Hasura). */
export const ORG_ACTIVITY = `
  query OrgActivity($org_id: uuid!) {
    notification_outbox(
      where: { org_id: { _eq: $org_id } }
      order_by: { created_at: desc }
      limit: 50
    ) {
      id
      channel
      message
      delivery_status
      payload
      workflow_run_id
      created_at
    }
    db_write_results(
      where: { org_id: { _eq: $org_id } }
      order_by: { created_at: desc }
      limit: 50
    ) {
      id
      key
      payload
      workflow_run_id
      created_at
    }
  }
`;
