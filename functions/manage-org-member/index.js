import { adminGql, getUserIdFromRequest, ok, fail, corsPreflight } from '../_lib/hasura.js';

const ROLES = new Set(['owner', 'editor', 'viewer']);

/**
 * Owner-only: add / update role / remove a member by email or user_id.
 * input: { org_id, action: "add"|"update"|"remove", email?, user_id?, role? }
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return corsPreflight();

  try {
    const body = await req.json();
    const callerId = getUserIdFromRequest(req, body);
    const input = body?.input || body || {};
    const orgId = input.org_id;
    const action = input.action || 'add';
    const email = (input.email || '').trim().toLowerCase();
    let userId = input.user_id || null;
    const role = (input.role || 'viewer').toLowerCase();

    if (!callerId) return fail('Unauthorized', 401);
    if (!orgId) {
      return ok({ success: false, message: 'org_id is required' });
    }
    if (!['add', 'update', 'remove'].includes(action)) {
      return ok({ success: false, message: 'action must be add|update|remove' });
    }
    if (action !== 'remove' && !ROLES.has(role)) {
      return ok({
        success: false,
        message: 'role must be owner, editor, or viewer',
      });
    }

    // Caller must be owner of this org
    const mem = await adminGql(
      `
      query Caller($org_id: uuid!, $user_id: uuid!) {
        org_members(
          where: {
            org_id: { _eq: $org_id }
            user_id: { _eq: $user_id }
            role: { _eq: "owner" }
          }
          limit: 1
        ) { id }
      }
    `,
      { org_id: orgId, user_id: callerId }
    );
    if (!mem.org_members?.length) {
      return ok({
        success: false,
        message: 'Forbidden: only organization owners can manage members',
      });
    }

    // Resolve user by email if needed
    if (!userId && email) {
      // auth.users is not tracked in public GraphQL — use raw SQL via hasura run_sql
      const sql = await adminGql(
        `
        mutation Lookup($sql: String!) {
          run_sql(args: { sql: $sql, cascade: false, read_only: true }) {
            result
          }
        }
      `,
        {
          sql: `SELECT id::text FROM auth.users WHERE lower(email) = lower('${email.replace(/'/g, "''")}') LIMIT 1;`,
        }
      ).catch(() => null);

      // run_sql may not be exposed; fallback postgres via fetch admin isn't available
      // Use direct SQL through env DATABASE or second approach: track nothing, use
      // hasura metadata run_sql type
    }

    if (!userId && email) {
      const res = await fetch(
        (process.env.NHOST_GRAPHQL_URL || process.env.HASURA_GRAPHQL_URL || '').replace(
          /\/v1\/graphql$/,
          '/v2/query'
        ),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-hasura-admin-secret':
              process.env.NHOST_ADMIN_SECRET ||
              process.env.HASURA_GRAPHQL_ADMIN_SECRET,
          },
          body: JSON.stringify({
            type: 'run_sql',
            args: {
              source: 'default',
              sql: `SELECT id::text FROM auth.users WHERE lower(email) = lower('${email.replace(/'/g, "''")}') LIMIT 1;`,
            },
          }),
        }
      );
      const json = await res.json();
      // result is [[headers],[row]]
      const rows = json?.result;
      if (Array.isArray(rows) && rows.length >= 2 && rows[1][0]) {
        userId = rows[1][0];
      }
    }

    if (!userId) {
      return ok({
        success: false,
        message: email
          ? `No signed-up user found with email “${email}”. They must create an account first (Sign up).`
          : 'user_id or email is required',
      });
    }

    if (action === 'remove') {
      if (userId === callerId) {
        return ok({
          success: false,
          message: 'You cannot remove yourself as owner',
        });
      }
      await adminGql(
        `
        mutation Del($org_id: uuid!, $user_id: uuid!) {
          delete_org_members(
            where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }
          ) { affected_rows }
        }
      `,
        { org_id: orgId, user_id: userId }
      );
      return ok({
        success: true,
        message: 'Member removed from organization',
        user_id: userId,
      });
    }

    // add or update
    await adminGql(
      `
      mutation Upsert($org_id: uuid!, $user_id: uuid!, $role: String!) {
        insert_org_members_one(
          object: { org_id: $org_id, user_id: $user_id, role: $role }
          on_conflict: {
            constraint: org_members_org_id_user_id_key
            update_columns: [role]
          }
        ) {
          id
          role
          user_id
        }
      }
    `,
      { org_id: orgId, user_id: userId, role }
    );

    return ok({
      success: true,
      message:
        action === 'add'
          ? `Added member as ${role}`
          : `Updated member role to ${role}`,
      user_id: userId,
      role,
    });
  } catch (err) {
    console.error('manage-org-member', err);
    return ok({ success: false, message: String(err.message || err) });
  }
}
