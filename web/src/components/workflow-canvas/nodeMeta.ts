import type { StepType } from '@/lib/types';

export const NODE_META: Record<
  StepType,
  {
    /** Short chip title on the node header */
    label: string;
    /** Friendly name for palette + defaults */
    title: string;
    /** One-line “what does this do?” */
    description: string;
    color: string;
    ring: string;
    icon: string;
    ownerOnly?: boolean;
  }
> = {
  llm_call: {
    label: 'Ask AI',
    title: 'Ask AI',
    description: 'Sends a prompt to the AI (Groq) and gets a text answer',
    color: 'from-violet-600 to-violet-500',
    ring: 'ring-violet-500/40',
    icon: '✦',
  },
  http_request: {
    label: 'Call website / API',
    title: 'Call website / API',
    description: 'Fetches data from any URL (GET/POST, etc.)',
    color: 'from-sky-600 to-sky-500',
    ring: 'ring-sky-500/40',
    icon: '↗',
  },
  conditional_branch: {
    label: 'If this… then that',
    title: 'If this… then that',
    description:
      'Reads a JSON key from a previous step (e.g. AI answer=yes) and takes Yes or No',
    color: 'from-amber-600 to-amber-500',
    ring: 'ring-amber-500/40',
    icon: '⑂',
  },
  approval_gate: {
    label: 'Wait for approval',
    title: 'Wait for approval',
    description:
      'Human pause (not AI). Shows a live brief from prior steps (AI decision + CRM) via run memory',
    color: 'from-rose-600 to-rose-500',
    ring: 'ring-rose-500/40',
    icon: '⏸',
  },
  db_write: {
    label: 'Save to database',
    title: 'Save to database',
    description: 'Stores a result in your app’s database (owners only)',
    color: 'from-emerald-700 to-emerald-600',
    ring: 'ring-emerald-500/40',
    icon: '⧉',
    ownerOnly: true,
  },
  notify: {
    label: 'Send a notification',
    title: 'Send a notification',
    description: 'Logs or sends an alert (Slack / email / log)',
    color: 'from-pink-600 to-pink-500',
    ring: 'ring-pink-500/40',
    icon: '✉',
    ownerOnly: true,
  },
};

export const RUN_STATUS_RING: Record<string, string> = {
  pending: 'ring-zinc-600',
  running: 'ring-sky-400 animate-pulse',
  success: 'ring-emerald-400',
  failed: 'ring-red-500',
  paused: 'ring-amber-400 animate-pulse',
  skipped: 'ring-zinc-500',
};

/** Default human step name when adding a node */
export function defaultStepName(type: StepType): string {
  switch (type) {
    case 'llm_call':
      return 'Classify with AI';
    case 'http_request':
      return 'Fetch data (HTTP)';
    case 'conditional_branch':
      return 'Branch on AI result';
    case 'approval_gate':
      return 'Wait for approval';
    case 'db_write':
      return 'Save result';
    case 'notify':
      return 'Send notification';
    default:
      return String(type);
  }
}
