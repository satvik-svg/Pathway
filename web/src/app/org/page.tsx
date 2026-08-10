'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useOrg } from '@/components/OrgContext';
import { callFunction } from '@/lib/functions';
import { formatMessage } from '@/lib/format';
import type { OrgRole } from '@/lib/types';

type MemberRow = {
  id: string;
  user_id: string;
  role: OrgRole;
  email: string;
  created_at?: string;
};

const ROLE_META: Record<
  OrgRole,
  { label: string; help: string; chip: string; ring: string }
> = {
  owner: {
    label: 'Owner',
    help: 'Members, webhooks, all step types, runs',
    chip: 'bg-violet-500/15 text-violet-300 border-violet-500/35',
    ring: 'border-violet-500/25 bg-violet-500/5',
  },
  editor: {
    label: 'Editor',
    help: 'Build & run workflows — no member admin',
    chip: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
    ring: 'border-sky-500/25 bg-sky-500/5',
  },
  viewer: {
    label: 'Viewer',
    help: 'Read-only — cannot run or edit',
    chip: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/35',
    ring: 'border-zinc-600/40 bg-zinc-800/30',
  },
};

function initials(email: string) {
  const local = email.split('@')[0] || '?';
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function Avatar({ email }: { email: string }) {
  return (
    <div
      className="w-9 h-9 rounded-full bg-gradient-to-br from-emerald-600/80 to-teal-700/80 flex items-center justify-center text-[11px] font-semibold text-white shrink-0 ring-2 ring-zinc-900"
      aria-hidden
    >
      {initials(email)}
    </div>
  );
}

export default function OrgPage() {
  const { org, role, isOwner, memberships, setOrgId, refresh } = useOrg();
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [newOrgName, setNewOrgName] = useState('');
  const [creating, setCreating] = useState(false);

  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<OrgRole>('editor');
  const [busyMember, setBusyMember] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!org) {
      setMembers([]);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const data = await callFunction<{
        success: boolean;
        message?: string;
        members: MemberRow[];
      }>('/list-org-members', { org_id: org.id });
      if (!data.success) throw new Error(data.message || 'Failed to load members');
      setMembers(data.members || []);
    } catch (e) {
      setErr(formatMessage(e));
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  async function createOrg(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    setMsg(null);
    setErr(null);
    try {
      const data = await callFunction<{
        success: boolean;
        message?: string;
        org_id?: string;
      }>('/create-organization', { name: newOrgName.trim(), quota_limit: 100 });
      if (!data.success) throw new Error(data.message);
      setMsg(data.message || 'Organization created');
      setNewOrgName('');
      await refresh();
      if (data.org_id) setOrgId(data.org_id);
    } catch (e) {
      setErr(formatMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setBusyMember('add');
    setMsg(null);
    setErr(null);
    try {
      const data = await callFunction<{ success: boolean; message?: string }>(
        '/manage-org-member',
        {
          org_id: org.id,
          action: 'add',
          email: addEmail.trim(),
          role: addRole,
        }
      );
      if (!data.success) throw new Error(data.message);
      setMsg(data.message || 'Member added');
      setAddEmail('');
      await loadMembers();
    } catch (e) {
      setErr(formatMessage(e));
    } finally {
      setBusyMember(null);
    }
  }

  async function changeRole(userId: string, nextRole: OrgRole) {
    if (!org) return;
    setBusyMember(userId);
    setMsg(null);
    setErr(null);
    try {
      const data = await callFunction<{ success: boolean; message?: string }>(
        '/manage-org-member',
        {
          org_id: org.id,
          action: 'update',
          user_id: userId,
          role: nextRole,
        }
      );
      if (!data.success) throw new Error(data.message);
      setMsg(data.message || 'Role updated');
      await loadMembers();
      await refresh();
    } catch (e) {
      setErr(formatMessage(e));
    } finally {
      setBusyMember(null);
    }
  }

  async function removeMember(userId: string) {
    if (!org) return;
    if (!confirm('Remove this member from the organization?')) return;
    setBusyMember(userId);
    setMsg(null);
    setErr(null);
    try {
      const data = await callFunction<{ success: boolean; message?: string }>(
        '/manage-org-member',
        {
          org_id: org.id,
          action: 'remove',
          user_id: userId,
        }
      );
      if (!data.success) throw new Error(data.message);
      setMsg(data.message || 'Removed');
      await loadMembers();
    } catch (e) {
      setErr(formatMessage(e));
    } finally {
      setBusyMember(null);
    }
  }

  const quotaUsed = org?.quota_used ?? 0;
  const quotaLimit = org?.quota_limit ?? 100;
  const quotaPct = Math.min(100, Math.round((quotaUsed / Math.max(quotaLimit, 1)) * 100));

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Hero */}
      <header className="relative overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/30 p-6 sm:p-8">
        <div
          className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-emerald-500/90">
              Workspace
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-zinc-50">
              {org ? org.name : 'Organization'}
            </h1>
            <p className="text-sm text-zinc-400 max-w-md leading-relaxed">
              {memberships.length === 0
                ? 'Create a workspace to own workflows, members, and usage. You become the owner.'
                : 'Manage members and roles. Each org is isolated — switch workspaces from the header.'}
            </p>
          </div>
          {org && role && (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`text-xs font-medium px-2.5 py-1 rounded-full border ${ROLE_META[role].chip}`}
              >
                Your role · {ROLE_META[role].label}
              </span>
              <Link
                href="/"
                className="text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-500 text-zinc-950 hover:bg-emerald-400 transition-colors"
              >
                Go to workflows →
              </Link>
            </div>
          )}
        </div>

        {org && (
          <div className="relative mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Members</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
                {loading ? '—' : members.length}
              </p>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Run quota</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
                {quotaUsed}
                <span className="text-sm font-normal text-zinc-500"> / {quotaLimit}</span>
              </p>
              <div className="mt-2 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaPct > 90 ? 'bg-red-500' : 'bg-emerald-500'
                  }`}
                  style={{ width: `${quotaPct}%` }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/50 px-4 py-3 col-span-2 sm:col-span-1">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500">Your orgs</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-zinc-100">
                {memberships.length}
              </p>
            </div>
          </div>
        )}
      </header>

      {/* Toasts */}
      {msg && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400 text-xs">
            ✓
          </span>
          <span className="flex-1">{msg}</span>
          <button
            type="button"
            className="text-emerald-400/70 hover:text-emerald-300 text-xs"
            onClick={() => setMsg(null)}
          >
            Dismiss
          </button>
        </div>
      )}
      {err && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-200"
        >
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 text-xs">
            !
          </span>
          <span className="flex-1">{err}</span>
          <button
            type="button"
            className="text-red-400/70 hover:text-red-300 text-xs"
            onClick={() => setErr(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Workspaces strip */}
      {memberships.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Your workspaces</h2>
            <span className="text-[11px] text-zinc-600">Click to switch</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {memberships.map((m) => {
              const active = m.org_id === org?.id;
              return (
                <button
                  key={m.org_id}
                  type="button"
                  onClick={() => setOrgId(m.org_id)}
                  className={`group flex items-center gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-all ${
                    active
                      ? 'border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.12)]'
                      : 'border-zinc-800 bg-zinc-900/50 hover:border-zinc-600 hover:bg-zinc-900'
                  }`}
                >
                  <span
                    className={`h-2 w-2 rounded-full ${
                      active ? 'bg-emerald-400' : 'bg-zinc-600 group-hover:bg-zinc-400'
                    }`}
                  />
                  <span className="text-sm font-medium text-zinc-100">
                    {m.organization.name}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                      ROLE_META[m.role as OrgRole]?.chip || ROLE_META.viewer.chip
                    }`}
                  >
                    {m.role}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Create org — sidebar on large */}
        <section
          className={`lg:col-span-2 rounded-2xl border p-5 sm:p-6 space-y-4 h-fit ${
            memberships.length === 0
              ? 'border-emerald-500/35 bg-gradient-to-b from-emerald-500/10 to-zinc-900/40'
              : 'border-zinc-800 bg-zinc-900/40'
          }`}
        >
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-100">
              {memberships.length === 0 ? 'Create your first org' : 'New organization'}
            </h2>
            <p className="text-xs text-zinc-500 leading-relaxed">
              You become{' '}
              <span className="text-emerald-400 font-medium">owner</span> with full control.
              {memberships.length > 0
                ? ' Use the header or chips above to switch.'
                : ' Then open Workflows to build.'}
            </p>
          </div>
          <form onSubmit={createOrg} className="space-y-3">
            <label className="block text-xs text-zinc-400">
              Organization name
              <input
                required
                minLength={2}
                placeholder="e.g. Acme Robotics"
                className="mt-1.5 w-full rounded-xl bg-zinc-950 border border-zinc-700 px-3.5 py-2.5 text-sm text-zinc-100 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 transition-shadow"
                value={newOrgName}
                onChange={(e) => setNewOrgName(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={creating || newOrgName.trim().length < 2}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-semibold text-sm px-4 py-2.5 rounded-xl disabled:opacity-45 transition-colors"
            >
              {creating ? 'Creating…' : 'Create organization'}
            </button>
          </form>
        </section>

        {/* Members */}
        <section className="lg:col-span-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-zinc-800/80">
            <div>
              <h2 className="text-base font-semibold text-zinc-100">Members</h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {org ? (
                  <>
                    People in <span className="text-zinc-300">{org.name}</span>
                  </>
                ) : (
                  'Create an org first'
                )}
              </p>
            </div>
            {org && (
              <button
                type="button"
                onClick={() => void loadMembers()}
                className="text-xs text-zinc-400 border border-zinc-700 rounded-lg px-2.5 py-1.5 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              >
                Refresh
              </button>
            )}
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            {!org && (
              <p className="text-sm text-zinc-500 text-center py-8">
                Create an organization on the left to manage members.
              </p>
            )}

            {org && (
              <>
                {/* Role legend */}
                <div className="grid gap-2 sm:grid-cols-3">
                  {(Object.keys(ROLE_META) as OrgRole[]).map((r) => (
                    <div
                      key={r}
                      className={`rounded-xl border px-3 py-2.5 ${ROLE_META[r].ring}`}
                    >
                      <div
                        className={`inline-flex text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${ROLE_META[r].chip}`}
                      >
                        {ROLE_META[r].label}
                      </div>
                      <p className="text-[11px] text-zinc-500 mt-1.5 leading-snug">
                        {ROLE_META[r].help}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Member list */}
                {loading ? (
                  <div className="space-y-2 animate-pulse">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 rounded-xl bg-zinc-800/40" />
                    ))}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {members.map((m) => (
                      <li
                        key={m.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800/90 bg-zinc-950/50 px-3.5 py-3 hover:border-zinc-700/80 transition-colors"
                      >
                        <Avatar email={m.email} />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-zinc-100 truncate">
                            {m.email}
                          </div>
                          <div className="text-[10px] text-zinc-600 font-mono truncate mt-0.5">
                            {m.user_id.slice(0, 8)}…
                          </div>
                        </div>
                        {isOwner ? (
                          <select
                            className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
                            value={m.role}
                            disabled={busyMember === m.user_id}
                            onChange={(e) =>
                              void changeRole(m.user_id, e.target.value as OrgRole)
                            }
                          >
                            <option value="owner">Owner</option>
                            <option value="editor">Editor</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        ) : (
                          <span
                            className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded-lg border ${
                              ROLE_META[m.role]?.chip || ROLE_META.viewer.chip
                            }`}
                          >
                            {m.role}
                          </span>
                        )}
                        {isOwner && (
                          <button
                            type="button"
                            disabled={busyMember === m.user_id}
                            onClick={() => void removeMember(m.user_id)}
                            className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-40 px-1 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                      </li>
                    ))}
                    {members.length === 0 && (
                      <li className="text-center text-sm text-zinc-500 py-6">
                        No members yet
                      </li>
                    )}
                  </ul>
                )}

                {/* Add member */}
                {isOwner && (
                  <form
                    onSubmit={addMember}
                    className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-950/40 p-4 space-y-3"
                  >
                    <div>
                      <h3 className="text-sm font-medium text-zinc-200">Invite by email</h3>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        They must already have signed up on the login page.
                      </p>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="email"
                        required
                        placeholder="colleague@example.com"
                        className="flex-1 rounded-xl bg-zinc-950 border border-zinc-700 px-3.5 py-2.5 text-sm outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
                        value={addEmail}
                        onChange={(e) => setAddEmail(e.target.value)}
                      />
                      <select
                        className="bg-zinc-950 border border-zinc-700 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-sky-500"
                        value={addRole}
                        onChange={(e) => setAddRole(e.target.value as OrgRole)}
                      >
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                        <option value="owner">Owner</option>
                      </select>
                      <button
                        type="submit"
                        disabled={busyMember === 'add'}
                        className="bg-sky-500 hover:bg-sky-400 text-zinc-950 font-semibold text-sm px-5 py-2.5 rounded-xl disabled:opacity-50 shrink-0 transition-colors"
                      >
                        {busyMember === 'add' ? 'Adding…' : 'Add member'}
                      </button>
                    </div>
                  </form>
                )}

                {!isOwner && (
                  <p className="text-xs text-zinc-500 text-center">
                    Only owners can add members or change roles.
                  </p>
                )}
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
