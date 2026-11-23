'use client';

import { useEffect, useState, useCallback } from 'react';
import type { UserRole } from '@/lib/auth/rbac';

interface ManagedUser {
  id: string;
  user_id: string;
  full_name: string;
  role: UserRole;
  is_super_user: boolean;
  must_change_pin: boolean;
  is_active: boolean;
  failed_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
}

interface AuditEntry {
  id: string;
  actor_user_id: string | null;
  target_user_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
  ip_address: string | null;
  created_at: string;
}

export function UserManagementSection() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [newUserId, setNewUserId] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('FD');
  const [oneTimeCredential, setOneTimeCredential] = useState<{
    user_id: string;
    full_name: string;
    pin: string;
    action: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/admin/users', { cache: 'no-store' });
    const data = await res.json();
    if (res.ok) {
      setUsers(data.users || []);
      setAuditLogs(data.auditLogs || []);
    } else {
      setError(data.error || 'Failed to load user management data.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: newUserId.trim(),
        full_name: newFullName.trim(),
        role: newRole,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Failed to create user.');
      return;
    }
    setOneTimeCredential({
      user_id: data.user.user_id,
      full_name: data.user.full_name,
      pin: data.oneTimePin,
      action: 'New Account Created',
    });
    setNewUserId('');
    setNewFullName('');
    loadData();
  }

  async function handleResetPin(user: ManagedUser) {
    setError(null);
    const res = await fetch(`/api/admin/users/${user.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset_pin' }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'PIN reset failed.');
      return;
    }
    setOneTimeCredential({
      user_id: data.user_id,
      full_name: data.full_name,
      pin: data.oneTimePin,
      action: 'PIN Reset (Existing Sessions Revoked)',
    });
    loadData();
  }

  async function handleUpdateUser(userId: string, patch: Record<string, unknown>) {
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || 'Update failed.');
      return;
    }
    loadData();
  }

  const filteredUsers = users.filter((u) => {
    const matchesSearch =
      u.user_id.toLowerCase().includes(search.toLowerCase()) ||
      u.full_name.toLowerCase().includes(search.toLowerCase());
    const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          {error}
        </div>
      )}

      {/* One-Time PIN Display Modal / Banner */}
      {oneTimeCredential && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="rounded bg-amber-200 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                {oneTimeCredential.action} — DISPLAYED ONCE ONLY
              </span>
              <h3 className="mt-2 text-base font-bold text-slate-900">
                {oneTimeCredential.full_name} ({oneTimeCredential.user_id})
              </h3>
              <p className="mt-1 text-xs text-slate-700">
                Distribute this temporary 6-digit PIN securely to the user. They will be forced to
                set a personal PIN upon first login.
              </p>
              <div className="mt-3 inline-flex items-center gap-3 rounded-lg border border-amber-300 bg-white px-4 py-2">
                <span className="font-mono text-xl font-bold tracking-[0.35em] text-slate-900">
                  {oneTimeCredential.pin}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    navigator.clipboard.writeText(
                      `User ID: ${oneTimeCredential.user_id} | Temporary PIN: ${oneTimeCredential.pin}`
                    )
                  }
                  className="rounded bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white"
                >
                  Copy
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOneTimeCredential(null)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Create New User Form */}
      <form
        onSubmit={handleCreateUser}
        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:grid-cols-4 sm:items-end"
      >
        <div>
          <label className="block text-xs font-semibold text-slate-700">New User ID</label>
          <input
            type="text"
            required
            value={newUserId}
            onChange={(e) => setNewUserId(e.target.value)}
            placeholder="e.g. Budi"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700">Full Name</label>
          <input
            type="text"
            required
            value={newFullName}
            onChange={(e) => setNewFullName(e.target.value)}
            placeholder="e.g. Budi Santoso"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700">Assigned Role</label>
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-xs"
          >
            <option value="FD">FD (Operational + Dashboard)</option>
            <option value="Checker">Checker (Operational + Dashboard)</option>
            <option value="Management">Management (Dashboard Only)</option>
            <option value="Admin">Admin (Ops + Dashboard + Admin)</option>
            <option value="Administrator">Administrator (Full Access)</option>
          </select>
        </div>
        <button
          type="submit"
          className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          + Create User & Generate PIN
        </button>
      </form>

      {/* Search & Role Filter */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by User ID or Full Name..."
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs"
        />
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs"
        >
          <option value="ALL">All Roles ({users.length})</option>
          <option value="Administrator">Administrator</option>
          <option value="Admin">Admin</option>
          <option value="Management">Management</option>
          <option value="Checker">Checker</option>
          <option value="FD">FD</option>
        </select>
      </div>

      {/* Registered Users Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold uppercase text-slate-600">
            <tr>
              <th className="px-4 py-3">User ID</th>
              <th className="px-4 py-3">Full Name</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">PIN State</th>
              <th className="px-4 py-3">Last Login</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Loading users...
                </td>
              </tr>
            ) : (
              filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono font-bold text-slate-900">
                    {u.user_id}
                    {u.is_super_user && (
                      <span className="ml-1.5 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800">
                        SUPER
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-800">{u.full_name}</td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      disabled={u.is_super_user}
                      onChange={(e) => handleUpdateUser(u.id, { role: e.target.value })}
                      className="rounded border border-slate-200 bg-white px-2 py-1 text-xs font-medium disabled:opacity-60"
                    >
                      <option value="Administrator">Administrator</option>
                      <option value="Admin">Admin</option>
                      <option value="Management">Management</option>
                      <option value="Checker">Checker</option>
                      <option value="FD">FD</option>
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        u.is_active
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-red-100 text-red-700'
                      }`}
                    >
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {u.must_change_pin ? 'Reset / Initial Required' : 'Personal PIN Set'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : 'Never'}
                  </td>
                  <td className="space-x-2 px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleResetPin(u)}
                      className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Reset PIN
                    </button>
                    {!u.is_super_user && (
                      <button
                        type="button"
                        onClick={() => handleUpdateUser(u.id, { is_active: !u.is_active })}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        {u.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Recent Security & Administrative Audit Log */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-sm font-bold text-slate-900">Security & Administrative Audit Log</h3>
        <div className="mt-3 max-h-64 overflow-y-auto divide-y divide-slate-100 text-xs">
          {auditLogs.map((log) => (
            <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div>
                <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-800">
                  {log.event_type}
                </span>{' '}
                <span className="font-semibold text-slate-900">{log.actor_user_id || 'SYSTEM'}</span>
                {log.target_user_id && (
                  <span className="text-slate-600"> → {log.target_user_id}</span>
                )}
              </div>
              <span className="text-[11px] text-slate-400">
                {new Date(log.created_at).toLocaleString()} ({log.ip_address || 'n/a'})
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}