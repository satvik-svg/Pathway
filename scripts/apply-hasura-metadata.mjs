#!/usr/bin/env node
/**
 * Apply essential Hasura metadata for local docker eval:
 * track tables, relationships, permissions, (actions optional — we call functions directly).
 */
const HASURA = process.env.HASURA_GRAPHQL_URL?.replace(/\/v1\/graphql$/, '') || 'http://localhost:8080';
const ADMIN = process.env.HASURA_GRAPHQL_ADMIN_SECRET || 'devadminsecret';

async function meta(type, args = {}) {
  const res = await fetch(`${HASURA}/v1/metadata`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': ADMIN,
    },
    body: JSON.stringify({ type, args }),
  });
  const json = await res.json();
  if (!res.ok || json.error || json.code) {
    // ignore already-tracked
    if (
      String(json.code || '').includes('already') ||
      String(json.error || '').includes('already')
    ) {
      return json;
    }
    throw new Error(`${type}: ${JSON.stringify(json)}`);
  }
  return json;
}

const tables = [
  'organizations',
  'org_members',
  'workflows',
  'workflow_steps',
  'workflow_triggers',
  'workflow_runs',
  'step_runs',
  'db_write_results',
  'notification_outbox',
  'watched_rows',
];

const memberFilter = {
  organization: {
    members: { user_id: { _eq: 'X-Hasura-User-Id' } },
  },
};

const orgMemberSelf = {
  _or: [
    { user_id: { _eq: 'X-Hasura-User-Id' } },
    {
      organization: {
        members: { user_id: { _eq: 'X-Hasura-User-Id' } },
      },
    },
  ],
};

async function trackAll() {
  for (const name of tables) {
    try {
      await meta('pg_track_table', {
        source: 'default',
        table: { schema: 'public', name },
      });
      console.log('tracked', name);
    } catch (e) {
      console.log('track', name, e.message.slice(0, 100));
    }
  }
  // view
  try {
    await meta('pg_track_table', {
      source: 'default',
      table: { schema: 'public', name: 'org_usage_stats' },
    });
    console.log('tracked org_usage_stats');
  } catch (e) {
    console.log('track view', e.message.slice(0, 120));
  }
}

async function relationships() {
  const rels = [
    // organizations
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'organizations' },
        name: 'members',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'org_members' },
            column: 'org_id',
          },
        },
      },
    },
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'organizations' },
        name: 'workflows',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'workflows' },
            column: 'org_id',
          },
        },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'org_members' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflows' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflows' },
        name: 'steps',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'workflow_steps' },
            column: 'workflow_id',
          },
        },
      },
    },
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflows' },
        name: 'triggers',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'workflow_triggers' },
            column: 'workflow_id',
          },
        },
      },
    },
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflows' },
        name: 'runs',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'workflow_runs' },
            column: 'workflow_id',
          },
        },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflow_steps' },
        name: 'workflow',
        using: { foreign_key_constraint_on: 'workflow_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflow_triggers' },
        name: 'workflow',
        using: { foreign_key_constraint_on: 'workflow_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflow_runs' },
        name: 'workflow',
        using: { foreign_key_constraint_on: 'workflow_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflow_runs' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
    {
      type: 'pg_create_array_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'workflow_runs' },
        name: 'step_runs',
        using: {
          foreign_key_constraint_on: {
            table: { schema: 'public', name: 'step_runs' },
            column: 'workflow_run_id',
          },
        },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'step_runs' },
        name: 'workflow_run',
        using: { foreign_key_constraint_on: 'workflow_run_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'db_write_results' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'notification_outbox' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
    {
      type: 'pg_create_object_relationship',
      args: {
        source: 'default',
        table: { schema: 'public', name: 'watched_rows' },
        name: 'organization',
        using: { foreign_key_constraint_on: 'org_id' },
      },
    },
  ];

  for (const r of rels) {
    try {
      await meta(r.type, r.args);
      console.log('rel', r.args.name, 'on', r.args.table.name);
    } catch (e) {
      console.log('rel skip', r.args.name, e.message.slice(0, 80));
    }
  }
}

async function permissions() {
  // Drop existing user perms first (ignore errors)
  const dropTargets = [
    ['organizations', 'select'],
    ['organizations', 'update'],
    ['org_members', 'select'],
    ['org_members', 'insert'],
    ['org_members', 'update'],
    ['org_members', 'delete'],
    ['workflows', 'select'],
    ['workflows', 'insert'],
    ['workflows', 'update'],
    ['workflows', 'delete'],
    ['workflow_steps', 'select'],
    ['workflow_steps', 'insert'],
    ['workflow_steps', 'update'],
    ['workflow_steps', 'delete'],
    ['workflow_triggers', 'select'],
    ['workflow_triggers', 'insert'],
    ['workflow_triggers', 'update'],
    ['workflow_triggers', 'delete'],
    ['workflow_runs', 'select'],
    ['step_runs', 'select'],
    ['db_write_results', 'select'],
    ['notification_outbox', 'select'],
    ['watched_rows', 'select'],
    ['watched_rows', 'insert'],
  ];
  for (const [table, perm] of dropTargets) {
    try {
      await meta(`pg_drop_${perm}_permission`, {
        source: 'default',
        table: { schema: 'public', name: table },
        role: 'user',
      });
    } catch {
      /* ok */
    }
  }

  const create = async (type, args) => {
    await meta(type, args);
    console.log(type, args.table.name);
  };

  // organizations select
  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'organizations' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'name',
        'quota_limit',
        'quota_used',
        'quota_period_start',
        'created_at',
        'updated_at',
      ],
      filter: {
        members: { user_id: { _eq: 'X-Hasura-User-Id' } },
      },
      allow_aggregations: true,
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'org_members' },
    role: 'user',
    permission: {
      columns: ['id', 'org_id', 'user_id', 'role', 'created_at'],
      filter: orgMemberSelf,
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflows' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'org_id',
        'name',
        'description',
        'created_by',
        'created_at',
        'updated_at',
      ],
      filter: memberFilter,
      allow_aggregations: true,
    },
  });

  await create('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflows' },
    role: 'user',
    permission: {
      columns: ['org_id', 'name', 'description', 'created_by'],
      check: {
        organization: {
          members: {
            user_id: { _eq: 'X-Hasura-User-Id' },
            role: { _in: ['owner', 'editor'] },
          },
        },
      },
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'workflow_id',
        'position',
        'type',
        'name',
        'config',
        'created_at',
        'updated_at',
      ],
      filter: {
        workflow: memberFilter,
      },
    },
  });

  await create('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_steps' },
    role: 'user',
    permission: {
      columns: ['workflow_id', 'position', 'type', 'name', 'config'],
      check: {
        workflow: {
          organization: {
            members: {
              user_id: { _eq: 'X-Hasura-User-Id' },
              role: { _in: ['owner', 'editor'] },
            },
          },
        },
      },
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_triggers' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'workflow_id',
        'type',
        'config',
        'is_active',
        'webhook_secret',
        'created_at',
      ],
      filter: { workflow: memberFilter },
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'workflow_runs' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'workflow_id',
        'org_id',
        'status',
        'trigger_type',
        'started_by',
        'current_step_position',
        'error',
        'context',
        'started_at',
        'completed_at',
        'created_at',
      ],
      filter: memberFilter,
      allow_aggregations: true,
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'step_runs' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'workflow_run_id',
        'workflow_step_id',
        'position',
        'step_type',
        'step_name',
        'status',
        'input',
        'output',
        'error',
        'attempt_count',
        'approved_by',
        'approved_at',
        'started_at',
        'completed_at',
        'created_at',
      ],
      filter: {
        workflow_run: memberFilter,
      },
      allow_aggregations: true,
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'db_write_results' },
    role: 'user',
    permission: {
      columns: [
        'id',
        'org_id',
        'workflow_run_id',
        'step_run_id',
        'key',
        'payload',
        'created_at',
      ],
      filter: memberFilter,
    },
  });

  await create('pg_create_select_permission', {
    source: 'default',
    table: { schema: 'public', name: 'watched_rows' },
    role: 'user',
    permission: {
      columns: ['id', 'org_id', 'workflow_id', 'payload', 'created_at'],
      filter: memberFilter,
    },
  });

  await create('pg_create_insert_permission', {
    source: 'default',
    table: { schema: 'public', name: 'watched_rows' },
    role: 'user',
    permission: {
      columns: ['org_id', 'workflow_id', 'payload'],
      check: {
        organization: {
          members: {
            user_id: { _eq: 'X-Hasura-User-Id' },
            role: { _in: ['owner', 'editor'] },
          },
        },
      },
    },
  });
}

async function main() {
  console.log('Applying Hasura metadata to', HASURA);
  await trackAll();
  await relationships();
  await permissions();
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
