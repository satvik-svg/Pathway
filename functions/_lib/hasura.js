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

/** Extract Hasura session user id from Action request payload/headers. */
export function getUserIdFromRequest(req, body) {
  // Hasura Actions send session_variables
  const session =
    body?.session_variables ||
    body?.sessionVariables ||
    {};
  const fromSession =
    session['x-hasura-user-id'] ||
    session['X-Hasura-User-Id'];
  if (fromSession) return fromSession;

  // Forwarded JWT claims (if present)
  const claimHeader = req.headers?.['x-hasura-user-id'];
  if (claimHeader) return claimHeader;

  return null;
}

export function actionResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Standard Hasura Action success/error helpers */
export function ok(payload, status = 200) {
  return actionResponse(payload, status);
}

export function fail(message, status = 400) {
  return actionResponse({ message }, status);
}
