/**
 * Admin GraphQL client for Hasura (service role — bypasses row permissions).
 * Used only inside serverless Actions / Event Triggers.
 */

const HASURA_URL =
  process.env.NHOST_GRAPHQL_URL ||
  process.env.HASURA_GRAPHQL_URL ||
  process.env.NEXT_PUBLIC_NHOST_GRAPHQL_URL;

const ADMIN_SECRET =
  process.env.NHOST_ADMIN_SECRET ||
  process.env.HASURA_GRAPHQL_ADMIN_SECRET;

/** CORS so browser → Nhost Functions URL works (preflight + response). */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Authorization, Content-Type, X-Requested-With, x-hasura-admin-secret, x-nhost-webhook-secret',
  'Access-Control-Max-Age': '86400',
};

export function corsPreflight() {
  return new Response(null, { status: 204, headers: { ...CORS_HEADERS } });
}

export function getHasuraConfig() {
  if (!HASURA_URL || !ADMIN_SECRET) {
    throw new Error(
      'Missing Hasura config: set NHOST_GRAPHQL_URL and NHOST_ADMIN_SECRET'
    );
  }
  return { url: HASURA_URL, secret: ADMIN_SECRET };
}

export async function adminGql(query, variables = {}) {
  const { url, secret } = getHasuraConfig();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': secret,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    const msg = json.errors
      ? JSON.stringify(json.errors)
      : `HTTP ${res.status}`;
    throw new Error(`Hasura error: ${msg}`);
  }
  return json.data;
}

/** Best-effort decode JWT payload (no verify — only for reading user id claim). */
function userIdFromJwt(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  try {
    const parts = m[1].split('.');
    if (parts.length < 2) return null;
    const json = Buffer.from(
      parts[1].replace(/-/g, '+').replace(/_/g, '/'),
      'base64'
    ).toString('utf8');
    const claims = JSON.parse(json);
    const hasura =
      claims['https://hasura.io/jwt/claims'] || claims['https://nhost.io/jwt/claims'];
    if (hasura?.['x-hasura-user-id']) return hasura['x-hasura-user-id'];
    if (claims.sub) return claims.sub;
  } catch {
    /* ignore */
  }
  return null;
}

/** Extract user id from Action payload, headers, or Bearer JWT. */
export function getUserIdFromRequest(req, body) {
  const session =
    body?.session_variables || body?.sessionVariables || {};
  const fromSession =
    session['x-hasura-user-id'] || session['X-Hasura-User-Id'];
  if (fromSession) return fromSession;

  const headers = req?.headers;
  const get = (k) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') return headers.get(k);
    return headers[k] || headers[k.toLowerCase()];
  };

  const claimHeader = get('x-hasura-user-id');
  if (claimHeader) return claimHeader;

  const auth = get('authorization') || get('Authorization');
  const fromJwt = userIdFromJwt(auth);
  if (fromJwt) return fromJwt;

  return null;
}

export function actionResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

/** Standard Hasura Action success/error helpers */
export function ok(payload, status = 200) {
  return actionResponse(payload, status);
}

export function fail(message, status = 400) {
  return actionResponse({ message }, status);
}
