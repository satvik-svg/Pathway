-- Seed template for Final Task (run AFTER creating auth users via nhost Auth).
-- Replace the UUIDs below with real auth.users ids from your project.
--
-- Example users to create in the app / Auth UI first:
--   owner-a@example.com  / password123  → Org A owner
--   editor-a@example.com / password123  → Org A editor
--   viewer-a@example.com / password123  → Org A viewer
--   owner-b@example.com  / password123  → Org B owner
--
-- Then:
--   SELECT id, email FROM auth.users;
-- and paste ids into :'user_a_owner' etc., or edit the constants below.

BEGIN;

-- ========== EDIT THESE ==========
-- Paste real UUIDs from auth.users
\set user_a_owner  '00000000-0000-0000-0000-0000000000a1'
\set user_a_editor '00000000-0000-0000-0000-0000000000a2'
\set user_a_viewer '00000000-0000-0000-0000-0000000000a3'
\set user_b_owner  '00000000-0000-0000-0000-0000000000b1'
-- ================================

INSERT INTO public.organizations (id, name, quota_limit, quota_used)
VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', 'Org A', 100, 0),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', 'Org B', 50, 0)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      quota_limit = EXCLUDED.quota_limit;

INSERT INTO public.org_members (org_id, user_id, role) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', :'user_a_owner',  'owner'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', :'user_a_editor', 'editor'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', :'user_a_viewer', 'viewer'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', :'user_b_owner',  'owner')
ON CONFLICT (org_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- Sample workflow for Org A (owner creates via UI is preferred for demo).
-- Uncomment if you want SQL-seeded workflow:
/*
INSERT INTO public.workflows (id, org_id, name, description, created_by)
VALUES (
  'cccccccc-cccc-cccc-cccc-ccccccccccc1',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1',
  'Sentiment pipeline',
  'LLM → HTTP → branch → approval → notify',
  :'user_a_owner'
) ON CONFLICT DO NOTHING;
*/

COMMIT;
