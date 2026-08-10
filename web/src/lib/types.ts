export type OrgRole = 'owner' | 'editor' | 'viewer';

export type StepType =
  | 'llm_call'
  | 'http_request'
  | 'db_write'
  | 'notify'
  | 'conditional_branch'
  | 'approval_gate';

export type TriggerType = 'manual' | 'webhook' | 'scheduled' | 'database_event';

export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepRunStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'paused'
  | 'skipped';

export interface Organization {
  id: string;
  name: string;
  quota_limit: number;
  quota_used: number;
  quota_period_start: string;
}

export interface OrgMember {
  id: string;
  role: OrgRole;
  org_id: string;
  organization: Organization;
}

export interface WorkflowStep {
  id?: string;
  position: number;
  type: StepType;
  name: string;
  config: Record<string, unknown>;
}

export interface WorkflowTrigger {
  id?: string;
  type: TriggerType;
  config: Record<string, unknown>;
  is_active: boolean;
  webhook_secret?: string | null;
}

export interface WorkflowRun {
  id: string;
  status: RunStatus;
  trigger_type: string;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  created_at: string;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  org_id: string;
  created_at?: string;
  updated_at?: string;
  steps: WorkflowStep[];
  triggers: WorkflowTrigger[];
  runs?: WorkflowRun[];
}

export interface StepRun {
  id: string;
  position: number;
  step_type: StepType | string;
  step_name: string;
  status: StepRunStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string | null;
  attempt_count: number;
  approved_by?: string | null;
  approved_at?: string | null;
}

export const STEP_TYPES: { type: StepType; label: string; ownerOnly?: boolean }[] = [
  { type: 'llm_call', label: 'Ask AI' },
  { type: 'http_request', label: 'Call website / API' },
  { type: 'conditional_branch', label: 'If this… then that' },
  { type: 'approval_gate', label: 'Wait for approval' },
  { type: 'db_write', label: 'Save to database', ownerOnly: true },
  { type: 'notify', label: 'Send a notification', ownerOnly: true },
];

/**
 * Default configs use templates + run input — nothing domain-specific baked in.
 * At run time: `{{input}}` comes from manual run payload, webhook body, or DB event.
 */
export const defaultStepConfig = (type: StepType): Record<string, unknown> => {
  switch (type) {
    case 'llm_call':
      return {
        // Strict JSON so the branch can read `answer` reliably (any domain).
        prompt: `Based on the input, decide yes or no for this question:
Does this need the high-priority path (human approval / escalate)?

Reply with ONLY valid JSON (no markdown, no extra text):
{"answer":"yes"}
or
{"answer":"no"}

Input:
"""
{{input}}
"""`,
        stub_response: '{"answer":"no"}',
        system:
          'You are a classifier. Output only valid JSON with key "answer" set to "yes" or "no".',
      };
    case 'http_request':
      return {
        // Public demo API — replace with your own. No run {{input}} required.
        url: 'https://jsonplaceholder.typicode.com/todos/1',
        method: 'GET',
      };
    case 'conditional_branch':
      return {
        from_step: 0,
        // Read AI JSON key `answer`; Yes path when value is yes/true
        field: 'answer',
        equals: 'yes',
        then_skip_to: 2,
        else_skip_to: 3,
      };
    case 'approval_gate':
      return {
        // Keep short — engine also attaches summary + highlight chips
        message: 'AI decision: {{ai_decision}}. Approve to continue?',
      };
    case 'db_write':
      return { key: 'workflow_result' };
    case 'notify':
      return {
        channel: 'log',
        message: 'Workflow finished.\n{{memory}}',
      };
    default:
      return {};
  }
};
