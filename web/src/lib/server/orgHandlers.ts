import { adminGql, runSql, userIdFromRequest } from './hasura';

type Body = {
  input?: Record<string, unknown>;
  session_variables?: Record<string, string>;
  name?: string;
  quota_limit?: number;
  org_id?: string;
  action?: string;
  email?: string;
  user_id?: string;
  role?: string;
};

function inputOf(body: Body) {
  return (body.input || body || {}) as Record<string, unknown>;
}

export async function handleCreateOrganization(
  authHeader: string | null,
  body: Body
) {
  const userId = userIdFromRequest(authHeader, body);
  const input = inputOf(body);
  const name = String(input.name || body.name || '').trim();
  const quotaLimit = Number(input.quota_limit ?? body.quota_limit ?? 100);

  if (!userId) {
    return { status: 401, data: { success: false, message: 'Unauthorized', org_id: null } };
  }
  if (!name || name.length < 2) {
    return {
      status: 200,
      data: {
        success: false,
        message: 'Organization name must be at least 2 characters',
        org_id: null,
      },
    };
  }

  const data = await adminGql<{
    insert_organizations_one: { id: string; name: string; quota_limit: number };
  }>(
    `
    mutation CreateOrg($name: String!, $quota: Int!, $user_id: uuid!) {
      insert_organizations_one(
        object: {
          name: $name
          quota_limit: $quota
          quota_used: 0
          members: { data: [{ user_id: $user_id, role: "owner" }] }
        }
      ) {
        id
        name
        quota_limit
      }
    }
  `,
    { name, quota: Math.max(1, quotaLimit), user_id: userId }
  );

  const org = data.insert_organizations_one;
  return {
    status: 200,
    data: {
      success: true,
      message: `Created organization “${org.name}” — you are the owner`,
      org_id: org.id,
      name: org.name,
    },
  };
}

export async function handleListOrgMembers(
  authHeader: string | null,
  body: Body
) {
  const userId = userIdFromRequest(authHeader, body);
  const input = inputOf(body);
  const orgId = String(input.org_id || body.org_id || '');

  if (!userId) {
    return { status: 401, data: { success: false, message: 'Unauthorized', members: [] } };
  }
  if (!orgId) {
    return {
      status: 200,
      data: { success: false, message: 'org_id required', members: [] },
    };
  }

  const mem = await adminGql<{
    org_members: { id: string; role: string }[];
  }>(
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
    return {
      status: 200,
      data: {
        success: false,
        message: 'Forbidden: not a member of this organization',
        members: [],
      },
    };
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

  const members = (result || []).slice(1).map((row) => ({
    id: row[0],
    user_id: row[1],
    role: row[2],
    email: row[3] || '(unknown)',
    created_at: row[4],
  }));

  return {
    status: 200,
    data: {
      success: true,
      members,
      my_role: mem.org_members[0].role,
    },
  };
}

const ROLES = new Set(['owner', 'editor', 'viewer']);

export async function handleManageOrgMember(
  authHeader: string | null,
  body: Body
) {
  const callerId = userIdFromRequest(authHeader, body);
  const input = inputOf(body);
  const orgId = String(input.org_id || '');
  const action = String(input.action || 'add');
  const email = String(input.email || '')
    .trim()
    .toLowerCase();
  let targetUserId = (input.user_id as string) || null;
  const role = String(input.role || 'viewer').toLowerCase();

  if (!callerId) {
    return { status: 401, data: { success: false, message: 'Unauthorized' } };
  }
  if (!orgId) {
    return { status: 200, data: { success: false, message: 'org_id is required' } };
  }
  if (!['add', 'update', 'remove'].includes(action)) {
    return {
      status: 200,
      data: { success: false, message: 'action must be add|update|remove' },
    };
  }
  if (action !== 'remove' && !ROLES.has(role)) {
    return {
      status: 200,
      data: { success: false, message: 'role must be owner, editor, or viewer' },
    };
  }

  const mem = await adminGql<{ org_members: { id: string }[] }>(
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
    return {
      status: 200,
      data: {
        success: false,
        message: 'Forbidden: only organization owners can manage members',
      },
    };
  }

  if (!targetUserId && email) {
    const rows = await runSql(
      `SELECT id::text FROM auth.users WHERE lower(email) = lower('${email.replace(/'/g, "''")}') LIMIT 1;`
    );
    if (rows.length >= 2 && rows[1][0]) targetUserId = rows[1][0];
  }

  if (!targetUserId) {
    return {
      status: 200,
      data: {
        success: false,
        message: email
          ? `No signed-up user found with email “${email}”. They must create an account first (Sign up).`
          : 'user_id or email is required',
      },
    };
  }

  if (action === 'remove') {
    if (targetUserId === callerId) {
      return {
        status: 200,
        data: {
          success: false,
          message: 'You cannot remove yourself as owner',
        },
      };
    }
    await adminGql(
      `
      mutation Del($org_id: uuid!, $user_id: uuid!) {
        delete_org_members(
          where: { org_id: { _eq: $org_id }, user_id: { _eq: $user_id } }
        ) { affected_rows }
      }
    `,
      { org_id: orgId, user_id: targetUserId }
    );
    return {
      status: 200,
      data: {
        success: true,
        message: 'Member removed from organization',
        user_id: targetUserId,
      },
    };
  }

  await adminGql(
    `
    mutation Upsert($org_id: uuid!, $user_id: uuid!, $role: String!) {
      insert_org_members_one(
        object: { org_id: $org_id, user_id: $user_id, role: $role }
        on_conflict: {
          constraint: org_members_org_id_user_id_key
          update_columns: [role]
        }
      ) { id role user_id }
    }
  `,
    { org_id: orgId, user_id: targetUserId, role }
  );

  return {
    status: 200,
    data: {
      success: true,
      message:
        action === 'add'
          ? `Added member as ${role}`
          : `Updated member role to ${role}`,
      user_id: targetUserId,
      role,
    },
  };
}
