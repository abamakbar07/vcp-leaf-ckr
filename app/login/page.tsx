'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';

function LoginFormContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode = searchParams.get('mode');
  const redirectParam = searchParams.get('redirect');

  const [step, setStep] = useState<'login' | 'change-pin'>(
    mode === 'change-pin' ? 'change-pin' : 'login'
  );
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (mode === 'change-pin') setStep('change-pin');
  }, [mode]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, pin }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Authentication failed.');
        setPin('');
        return;
      }

      if (data.user?.must_change_pin) {
        setCurrentPin(pin);
        setStep('change-pin');
        return;
      }

      const destination =
        redirectParam && redirectParam.startsWith('/') ? redirectParam : data.redirectTo || '/';
      router.push(destination);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangePin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!/^\d{6}$/.test(newPin)) {
      setError('New PIN must be exactly 6 numeric digits.');
      return;
    }
    if (newPin !== confirmPin) {
      setError('New PIN and confirmation do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'change_pin',
          currentPin,
          newPin,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to update PIN.');
        return;
      }

      router.push('/');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100vh-140px)] max-w-md flex-col justify-center px-4 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-900 text-sm font-bold text-white">
            VCP
          </div>
          <h1 className="text-xl font-bold text-slate-900">
            {step === 'login' ? 'ASSA LOGISTICS (VCP) Sign In' : 'Set Your Personal 6-Digit PIN'}
          </h1>
          <p className="mt-1 text-xs text-slate-500">
            {step === 'login'
              ? 'Enter your assigned User ID and 6-digit security PIN'
              : 'Initial or reset PIN detected. You must set a new personal PIN before continuing.'}
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
            {error}
          </div>
        )}

        {step === 'login' ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">User ID</label>
              <input
                type="text"
                required
                autoComplete="username"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="e.g. Akbar, Denny, Sukarna"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">6-Digit PIN</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                required
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="••••••"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 text-center font-mono text-lg tracking-[0.5em] text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !userId || pin.length !== 6}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Verifying...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleChangePin} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Current / Temporary PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-center font-mono text-base tracking-[0.4em]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">New 6-Digit PIN</label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-center font-mono text-base tracking-[0.4em]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700">
                Confirm New 6-Digit PIN
              </label>
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                required
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="mt-1 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-center font-mono text-base tracking-[0.4em]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || newPin.length !== 6 || confirmPin.length !== 6}
              className="w-full rounded-lg bg-slate-900 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {submitting ? 'Updating PIN...' : 'Save Personal PIN & Continue'}
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-slate-100 pt-4 text-center">
          <Link
            href="/tools/hioki"
            className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
          >
            Continue to Public Hioki Tools (No Login Required) →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-sm text-slate-500">Loading...</div>}>
      <LoginFormContent />
    </Suspense>
  );
}