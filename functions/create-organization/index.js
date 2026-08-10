import { adminGql, getUserIdFromRequest, ok, fail } from '../_lib/hasura.js';

/**
 * Create an organization and make the caller owner.
 */
export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    const body = await req.json();
    const userId = getUserIdFromRequest(req, body);
    const name = (body?.input?.name || body?.name || '').trim();
    const quotaLimit = Number(body?.input?.quota_limit ?? body?.quota_limit ?? 100);

    if (!userId) return fail('Unauthorized', 401);
    if (!name || name.length < 2) {
      return ok({
        success: false,
        message: 'Organization name must be at least 2 characters',
        org_id: null,
      });
    }

    const data = await adminGql(
      `
      mutation CreateOrg($name: String!, $quota: Int!, $user_id: uuid!) {
        insert_organizations_one(
          object: {
            name: $name
            quota_limit: $quota
            quota_used: 0
            members: {
              data: [{ user_id: $user_id, role: "owner" }]
            }
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
    return ok({
      success: true,
      message: `Created organization “${org.name}” — you are the owner`,
      org_id: org.id,
      name: org.name,
    });
  } catch (err) {
    console.error('create-organization', err);
    return ok({
      success: false,
      message: String(err.message || err),
      org_id: null,
    });
  }
}
