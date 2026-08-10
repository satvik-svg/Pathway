/**
 * Server-only Hasura admin client (Vercel API routes).
 * Env: NHOST_GRAPHQL_URL + NHOST_ADMIN_SECRET (or HASURA_* aliases)
 */

function graphqlUrl() {
  const raw =
    process.env.NHOST_GRAPHQL_URL ||
    process.env.HASURA_GRAPHQL_URL ||
    process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL ||
    '';
  if (!raw) {
    throw new Error(
      'Missing NHOST_GRAPHQL_URL (set in Vercel env to your Nhost GraphQL endpoint)'
    );
  }
  // Cloud GraphQL is often .../v1 not .../v1/graphql
  return raw.replace(/\/$/, '');
}

function adminSecret() {
  const s =
    process.env.NHOST_ADMIN_SECRET ||
    process.env.HASURA_GRAPHQL_ADMIN_SECRET ||
    '';
  if (!s) {
    throw new Error(
      'Missing NHOST_ADMIN_SECRET (set in Vercel env from Nhost dashboard)'
    );
  }
  return s;
}

export async function adminGql<T = Record<string, unknown>>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const url = graphqlUrl();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(
      json.errors ? JSON.stringify(json.errors) : `Hasura HTTP ${res.status}`
    );
  }
  return json.data as T;
}

/** Hasura metadata SQL (for auth.users lookups). */
export async function runSql(sql: string): Promise<string[][]> {
  const g = graphqlUrl();
  // .../v1 or .../v1/graphql → base for /v2/query
  const base = g
    .replace(/\/v1\/graphql$/, '')
    .replace(/\/v1$/, '');
  const res = await fetch(`${base}/v2/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret(),
    },
    body: JSON.stringify({
      type: 'run_sql',
      args: { source: 'default', sql },
    }),
  });
  const json = await res.json();
  if (json.error || json.code) {
    throw new Error(JSON.stringify(json));
  }
  return (json.result || []) as string[][];
}

export function userIdFromRequest(
  authHeader: string | null,
  body: { session_variables?: Record<string, string>; input?: unknown }
): string | null {
  const session = body?.session_variables || {};
  const fromSession =
    session['x-hasura-user-id'] || session['X-Hasura-User-Id'];
  if (fromSession) return fromSession;

  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const payload = m[1].split('.')[1];
    if (!payload) return null;
    const json = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, '+').replace(/_/g, '/'),
        'base64'
      ).toString('utf8')
    );
    const hasura =
      json['https://hasura.io/jwt/claims'] ||
      json['https://nhost.io/jwt/claims'];
    if (hasura?.['x-hasura-user-id']) return hasura['x-hasura-user-id'];
    if (json.sub) return json.sub;
  } catch {
    /* ignore */
  }
  return null;
}
