import type { StepRun } from './types';

/** Short human summary for a step (one line, calm copy). */
export function summarizeStep(step: StepRun): string {
  const out = step.output || {};
  const type = step.step_type;

  if (step.status === 'skipped') {
    return 'Skipped — branch took another path';
  }
  if (step.status === 'paused') {
    if (out.summary) return String(out.summary).slice(0, 100);
    if (out.highlights && typeof out.highlights === 'object') {
      const h = out.highlights as Record<string, unknown>;
      if (h['AI decision'] != null) return `Waiting — AI: ${h['AI decision']}`;
    }
    if (out.message && !/step_\d+/.test(String(out.message))) {
      return String(out.message).slice(0, 100);
    }
    return 'Waiting for approval';
  }
  if (step.status === 'failed') {
    return step.error || 'Failed';
  }
  if (step.status === 'pending') return 'Waiting';
  if (step.status === 'running') return 'Running…';

  switch (type) {
    case 'llm_call': {
      if (out.answer != null) {
        return `answer: ${String(out.answer)}`;
      }
      const text = out.text ?? out.stub_response;
      if (text != null) {
        return String(text).trim().slice(0, 80);
      }
      return 'AI finished';
    }
    case 'http_request': {
      const data = out.data as Record<string, unknown> | undefined;
      if (data && typeof data === 'object') {
        const name = data.name != null ? String(data.name) : '';
        const email = data.email != null ? String(data.email) : '';
        if (name || email) {
          return [name, email].filter(Boolean).join(' · ');
        }
      }
      if (out.status != null) return `HTTP ${out.status}`;
      return 'Request completed';
    }
    case 'conditional_branch': {
      const matched = out.matched === true || out.branch === 'then';
      const field = out.field ? String(out.field) : 'answer';
      const saw = String(out.evaluated ?? '').slice(0, 40);
      return matched
        ? `Yes path (${field}=${saw || '…'})`
        : `No path (${field}=${saw || '…'})`;
    }
    case 'approval_gate': {
      if (out.approved) return 'Approved';
      return String(out.message || 'Waiting for approval').slice(0, 80);
    }
    case 'notify': {
      const channel = out.channel || 'log';
      if (channel === 'log') {
        return 'Written to notification outbox (log channel)';
      }
      return `Sent via ${channel}`;
    }
    case 'db_write': {
      return `Saved (${out.key || 'result'})`;
    }
    default:
      return step.status === 'success' ? 'Done' : step.status;
  }
}

/** Extra detail line (optional) for notify / branch etc. */
export function stepDetailLine(step: StepRun): string | null {
  const out = step.output || {};
  if (step.status !== 'success') return null;

  if (step.step_type === 'notify' && out.message) {
    // First non-empty line of message only
    const first = String(out.message)
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    return first ? first.slice(0, 90) : null;
  }
  if (step.step_type === 'llm_call' && out.provider) {
    return String(out.provider);
  }
  return null;
}

export const STATUS_LABEL: Record<string, string> = {
  pending: 'Waiting',
  running: 'Running',
  success: 'Done',
  failed: 'Failed',
  paused: 'Approval',
  skipped: 'Skipped',
  completed: 'Completed',
};
