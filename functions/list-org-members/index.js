import { getUserIdFromRequest, ok, fail, corsPreflight } from '../_lib/hasura.js';
import { adminGql } from '../_lib/hasura.js';

function adminSecret() {
  return (
    process.env.NHOST_ADMIN_SECRET ||
    process.env.HASURA_GRAPHQL_ADMIN_SECRET
  );
}

function hasuraBase() {
  const g =
    process.env.NHOST_GRAPHQL_URL ||
    process.env.HASURA_GRAPHQL_URL ||
    '';
  return g.replace(/\/v1\/graphql$/, '');
}

async function runSql(sql) {
  const res = await fetch(`${hasuraBase()}/v2/query`, {
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
  return json.result; // [[col...],[row...],...]
}

/**
 * List org members with emails. Caller must be a member of the org.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsPreflight();

  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req, body);
    const orgId = body?.input?.org_id || body?.org_id;

    if (!userId) return fail('Unauthorized', 401);
    if (!orgId) return ok({ success: false, message: 'org_id required', members: [] });

    const mem = await adminGql(
      `
      query IsMember($org_id: uuid!, $user_id: uuid!) {
        org_members(
          where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }
          limit: 1
        ) { id role }
      }
    `,
      { org_id: orgId, user_id: userId }
    );
    if (!mem.org_members?.length) {
      return ok({
        success: false,
        message: 'Forbidden: not a member of this organization',
        members: [],
      });
    }

    const result = await runSql(`
      SELECT m.id::text, m.user_id::text, m.role, COALESCE(u.email, ''), m.created_at::text
      FROM public.org_members m
      LEFT JOIN auth.users u ON u.id = m.user_id
      WHERE m.org_id = '${orgId.replace(/'/g, "''")}'
      ORDER BY
        CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
        u.email;
    `);

    const members = (result || [])
      .slice(1)
      .map((row) => ({
        id: row[0],
        user_id: row[1],
        role: row[2],
        email: row[3] || '(unknown)',
        created_at: row[4],
      }));

    return ok({
      success: true,
      members,
      my_role: mem.org_members[0].role,
    });
  } catch (err) {
    console.error('list-org-members', err);
    return ok({
      success: false,
      message: String(err.message || err),
      members: [],
    });
  }
}
