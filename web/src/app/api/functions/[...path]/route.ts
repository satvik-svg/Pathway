import { NextRequest, NextResponse } from 'next/server';

/**
 * Same-origin proxy (Vercel / localhost) → Nhost Functions or local engine.
 * Browser never talks to *.functions.*.nhost.run directly → no CORS.
 *
 * Vercel env (server):
 *   NHOST_FUNCTIONS_URL=https://<subdomain>.functions.<region>.nhost.run/v1
 * Fallback:
 *   NEXT_PUBLIC_NHOST_FUNCTIONS_URL
 */
function functionsBase() {
  const raw =
    process.env.NHOST_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_NHOST_FUNCTIONS_URL ||
    process.env.NEXT_PUBLIC_FUNCTIONS_URL ||
    '';
  if (!raw) {
    return null;
  }
  return raw.replace(/\/$/, '');
}

function buildTarget(base: string, path: string) {
  // Nhost cloud base usually ends with /v1
  // Local engine: http://127.0.0.1:4001
  if (base.endsWith('/v1') || base.includes('/v1/')) {
    return `${base.replace(/\/$/, '')}/${path}`;
  }
  return `${base}/${path}`;
}

async function proxy(req: NextRequest, pathParts: string[]) {
  const path = (pathParts || []).filter(Boolean).join('/');
  if (!path) {
    return NextResponse.json(
      { success: false, message: 'Missing function path' },
      { status: 400 }
    );
  }

  const base = functionsBase();
  if (!base) {
    return NextResponse.json(
      {
        success: false,
        message:
          'Server missing NHOST_FUNCTIONS_URL (or NEXT_PUBLIC_NHOST_FUNCTIONS_URL). Set it in Vercel to your Nhost Functions base, e.g. https://<subdomain>.functions.<region>.nhost.run/v1',
      },
      { status: 500 }
    );
  }

  // Don't proxy to local.functions / localhost on Vercel production
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
          'Vercel is pointing functions at a local URL. Set NHOST_FUNCTIONS_URL to your Nhost cloud Functions URL in the Vercel project env.',
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

  let body: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.text();
  }

  try {
    const res = await fetch(target, {
      method: req.method,
      headers,
      body,
    });
    const text = await res.text();
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
        message: `Functions proxy failed calling ${target}: ${message}`,
      },
      { status: 502 }
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path } = await ctx.params;
  return proxy(req, path || []);
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
