'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AuthenticatedUser } from '@/lib/auth/rbac';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [fullName, setFullName] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.user) {
          router.push('/login');
          return;
        }
        setUser(data.user);
        setFullName(data.user.full_name);
      });
  }, [router]);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/auth/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_profile', fullName }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage({ type: 'err', text: data.error || 'Failed to update profile.' });
      return;
    }
    setMessage({ type: 'ok', text: 'Profile name updated successfully.' });
    router.refresh();
  }

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (newPin !== confirmPin) {
      setMessage({ type: 'err', text: 'New PIN and confirmation do not match.' });
      return;
    }
    setSaving(true);
    const res = await fetch('/api/auth/session', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'change_pin', currentPin, newPin }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) {
      setMessage({ type: 'err', text: data.error || 'PIN change failed.' });
      return;
    }
    setCurrentPin('');
    setNewPin('');
    setConfirmPin('');
    setMessage({ type: 'ok', text: 'Your 6-digit PIN has been changed.' });
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  if (!user) return <div className="p-8 text-center text-sm text-slate-500">Loading profile...</div>;

  return (
    <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Profile & Security Settings</h1>
          <p className="text-xs text-slate-500">
            Manage your display information and personal 6-digit security PIN
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
        >
          Logout
        </button>
      </div>

      {message && (
        <div
          className={`rounded-xl border px-4 py-3 text-xs font-medium ${
            message.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Account Information</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="block text-[11px] font-medium text-slate-500">User ID</span>
            <span className="mt-0.5 block font-mono text-sm font-bold text-slate-900">
              {user.user_id}
            </span>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="block text-[11px] font-medium text-slate-500">Assigned Role</span>
            <span className="mt-0.5 block text-sm font-bold text-slate-900">{user.role}</span>
          </div>
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="block text-[11px] font-medium text-slate-500">Account Status</span>
            <span className="mt-0.5 inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
              {user.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-slate-700">Full Name</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            Update Name
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-bold text-slate-900">Change 6-Digit PIN</h2>
        <form onSubmit={handleChangePin} className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-semibold text-slate-700">Current PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              value={currentPin}
              onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono tracking-widest"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono tracking-widest"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700">Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-center font-mono tracking-widest"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="submit"
              disabled={saving || currentPin.length !== 6 || newPin.length !== 6 || confirmPin.length !== 6}
              className="rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Change PIN
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}