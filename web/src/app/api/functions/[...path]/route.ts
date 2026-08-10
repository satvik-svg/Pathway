import { NextRequest, NextResponse } from 'next/server';
import {
  handleCreateOrganization,
  handleListOrgMembers,
  handleManageOrgMember,
} from '@/lib/server/orgHandlers';
import {
  handleTriggerWorkflowRun,
  handleApproveStep,
} from '@/lib/server/workflowHandlers';

/** Workflow runs may call LLM — allow longer than default on Pro; Hobby caps lower. */
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * Browser → same-origin /api/functions/<name>
 *
 * Org + run/approve run on Vercel (avoids Nhost lambda "Unhandled").
 * Other paths proxy to Nhost Functions / local engine if configured.
 */

const LOCAL_HANDLERS = new Set([
  'create-organization',
  'list-org-members',
  'manage-org-member',
  'trigger-workflow-run',
  'approve-step',
]);

function functionsBase() {
  const raw =
    process.env.NHOST_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_FUNCTIONS_URL ||
    '';
  return raw ? raw.replace(/\/$/, '') : null;
}

function buildTarget(base: string, path: string) {
  if (base.endsWith('/v1') || base.includes('.nhost.run')) {
    const b = base.replace(/\/$/, '');
    if (b.endsWith('/v1')) return `${b}/${path}`;
    if (b.includes('/v1/')) return `${b.replace(/\/$/, '')}/${path}`;
    // https://xxx.functions.region.nhost.run → append /v1/name
    return `${b}/v1/${path}`;
  }
  return `${base}/${path}`;
}

async function runLocal(
  name: string,
  auth: string | null,
  body: Record<string, unknown>
) {
  try {
    if (name === 'create-organization') {
      return await handleCreateOrganization(auth, body);
    }
    if (name === 'list-org-members') {
      return await handleListOrgMembers(auth, body);
    }
    if (name === 'manage-org-member') {
      return await handleManageOrgMember(auth, body);
    }
    if (name === 'trigger-workflow-run') {
      return await handleTriggerWorkflowRun(auth, body);
    }
    if (name === 'approve-step') {
      return await handleApproveStep(auth, body);
    }
    return {
      status: 404,
      data: { success: false, message: `Unknown local handler: ${name}` },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[api/functions/${name}]`, message);
    return {
      status: 200,
      data: {
        success: false,
        message:
          message.includes('Missing NHOST_') || message.includes('Missing')
            ? `${message}. Add NHOST_GRAPHQL_URL and NHOST_ADMIN_SECRET in Vercel → Settings → Environment Variables, then redeploy.`
            : message,
      },
    };
  }
}

async function proxyToNhost(
  req: NextRequest,
  path: string,
  bodyText: string
) {
  const base = functionsBase();
  if (!base) {
    return NextResponse.json(
      {
        success: false,
        message:
          'No NHOST_FUNCTIONS_URL configured for proxy. Org routes run on Vercel; other actions need Functions URL.',
      },
      { status: 500 }
    );
  }
  if (
    process.env.VERCEL &&
    (base.includes('localhost') ||
      base.includes('127.0.0.1') ||
      base.includes('local.functions'))
  ) {
    return NextResponse.json(
      {
        success: false,
        message:
          'Vercel must not use a local functions URL. Set NHOST_FUNCTIONS_URL to your Nhost cloud functions base.',
      },
      { status: 500 }
    );
  }

  const target = buildTarget(base, path);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers,
      body: bodyText,
    });
    const text = await res.text();
    // Surface Nhost lambda crashes more clearly
    if (text.includes('problem calling lambda') || res.status >= 500) {
      return NextResponse.json(
        {
          success: false,
          message: `Nhost function error (${path}): ${text.slice(0, 300)}. Prefer org APIs on Vercel; ensure functions are deployed and secrets set on Nhost.`,
        },
        { status: 200 }
      );
    }
    return new NextResponse(text, {
      status: res.status,
      headers: {
        'Content-Type':
          res.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        success: false,
        message: `Proxy failed (${target}): ${message}`,
      },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await ctx.params;
  const name = (parts || []).filter(Boolean).join('/');
  const auth = req.headers.get('authorization');
  const bodyText = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Org + trigger/approve: always on Vercel (fixes Nhost "Unhandled" lambda)
  if (LOCAL_HANDLERS.has(name)) {
    const result = await runLocal(name, auth, body);
    return NextResponse.json(result.data, { status: result.status });
  }

  // Webhooks / scheduled / notify may still proxy to Nhost Functions
  return proxyToNhost(req, name, bodyText);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
