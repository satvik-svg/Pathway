#!/usr/bin/env node
/**
 * Seed orgs + memberships via Hasura admin secret.
 *
 * Usage:
 *   HASURA_GRAPHQL_URL=... HASURA_GRAPHQL_ADMIN_SECRET=... \
 *   USER_A_OWNER=<uuid> USER_A_EDITOR=<uuid> USER_A_VIEWER=<uuid> USER_B_OWNER=<uuid> \
 *   node scripts/seed.mjs
 *
 * Create users first (sign up in the app), then fetch ids:
 *   SELECT id, email FROM auth.users;
 */

const url = process.env.HASURA_GRAPHQL_URL || process.env.NHOST_GRAPHQL_URL;
const secret =
  process.env.HASURA_GRAPHQL_ADMIN_SECRET || process.env.NHOST_ADMIN_SECRET;

const users = {
  aOwner: process.env.USER_A_OWNER,
  aEditor: process.env.USER_A_EDITOR,
  aViewer: process.env.USER_A_VIEWER,
  bOwner: process.env.USER_B_OWNER,
};

if (!url || !secret) {
  console.error('Set HASURA_GRAPHQL_URL and HASURA_GRAPHQL_ADMIN_SECRET');
  process.exit(1);
}
if (!users.aOwner || !users.bOwner) {
  console.error(
    'Set at least USER_A_OWNER and USER_B_OWNER (auth user UUIDs). Optional: USER_A_EDITOR, USER_A_VIEWER'
  );
  process.exit(1);
}

async function gql(query, variables) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': secret,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2));
  return json.data;
}

const ORG_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
const ORG_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';

const mutation = `
  mutation Seed(
    $orgs: [organizations_insert_input!]!
    $members: [org_members_insert_input!]!
  ) {
    insert_organizations(
      objects: $orgs
      on_conflict: {
        constraint: organizations_pkey
        update_columns: [name, quota_limit]
      }
    ) { affected_rows }
    insert_org_members(
      objects: $members
      on_conflict: {
        constraint: org_members_org_id_user_id_key
        update_columns: [role]
      }
    ) { affected_rows }
  }
`;

const members = [
  { org_id: ORG_A, user_id: users.aOwner, role: 'owner' },
  { org_id: ORG_B, user_id: users.bOwner, role: 'owner' },
];
if (users.aEditor) {
  members.push({ org_id: ORG_A, user_id: users.aEditor, role: 'editor' });
}
if (users.aViewer) {
  members.push({ org_id: ORG_A, user_id: users.aViewer, role: 'viewer' });
}

const data = await gql(mutation, {
  orgs: [
    { id: ORG_A, name: 'Org A', quota_limit: 100, quota_used: 0 },
    { id: ORG_B, name: 'Org B', quota_limit: 50, quota_used: 0 },
  ],
  members,
});

console.log('Seeded:', JSON.stringify(data, null, 2));
console.log('Org A id:', ORG_A);
console.log('Org B id:', ORG_B);
