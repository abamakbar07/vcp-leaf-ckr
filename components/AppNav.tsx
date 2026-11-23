'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { AuthenticatedUser } from '@/lib/auth/rbac';
import { canAccessModule } from '@/lib/auth/rbac';

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => setUser(data.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [pathname]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    router.push('/login');
    router.refresh();
  }

  const navItems = [
    { href: '/', label: 'Home', visible: true },
    {
      href: '/dashboard',
      label: 'Dashboard',
      visible: Boolean(user && canAccessModule(user.role, 'dashboard')),
    },
    {
      href: '/scanner',
      label: 'Scanner',
      visible: Boolean(user && canAccessModule(user.role, 'operational')),
    },
    {
      href: '/inbound',
      label: 'Inbound',
      visible: Boolean(user && canAccessModule(user.role, 'operational')),
    },
    {
      href: '/inventory',
      label: 'Inventory',
      visible: Boolean(user && canAccessModule(user.role, 'operational')),
    },
    // {
    //   href: '/loading',
    //   label: 'Loading',
    //   visible: Boolean(user && canAccessModule(user.role, 'operational')),
    // },
    {
      href: '/admin',
      label: 'Admin Panel',
      visible: Boolean(user && canAccessModule(user.role, 'admin')),
    },
    {
      href: '/tools/hioki',
      label: 'Hioki Tools',
      visible: true,
    },
  ].filter((item) => item.visible);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-xs font-bold text-white">
              VCP
            </span>
            <div>
              <span className="block text-sm font-bold tracking-tight text-slate-900">
                ASSA LOGISTICS
              </span>
              <span className="block text-[10px] font-medium text-slate-500">
                Warehouse Operations Suite
              </span>
            </div>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2.5">
          {!loading && user ? (
            <>
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs hover:bg-slate-100"
              >
                <span className="font-semibold text-slate-900">{user.full_name}</span>
                <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700">
                  {user.role}
                </span>
              </Link>
              <button
                onClick={handleLogout}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
              >
                Logout
              </button>
            </>
          ) : !loading ? (
            <Link
              href="/login"
              className="rounded-lg bg-slate-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-slate-800"
            >
              Sign In
            </Link>
          ) : null}
        </div>
      </div>

      {/* Mobile responsive navigation strip */}
      <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium ${
                active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}