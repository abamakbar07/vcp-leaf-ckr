import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth/session';
import { canAccessModule } from '@/lib/auth/rbac';

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;

  const modules = [
    {
      key: 'operational',
      title: 'Operational Tools',
      description: 'Barcode Picking & Scanner, Inbound ASN/Receiving, Inventory Control, and Loading.',
      links: [
        { label: 'Scanner & Picking', href: '/scanner' },
        { label: 'Inbound', href: '/inbound' },
        { label: 'Inventory', href: '/inventory' },
        { label: 'Loading', href: '/loading' },
      ],
      authorized: user ? canAccessModule(user.role, 'operational') : false,
      publicAccess: false,
    },
    {
      key: 'dashboard',
      title: 'Dashboard',
      description: 'Warehouse performance KPIs, PO/Lot/RIT tracking, and operational monitoring.',
      links: [{ label: 'Open Dashboard', href: '/dashboard' }],
      authorized: user ? canAccessModule(user.role, 'dashboard') : false,
      publicAccess: false,
    },
    {
      key: 'admin',
      title: 'Admin Panel',
      description: 'User & role management, PIN issuance, SKU/Order imports, and audit logs.',
      links: [{ label: 'Open Admin Panel', href: '/admin' }],
      authorized: user ? canAccessModule(user.role, 'admin') : false,
      publicAccess: false,
    },
    {
      key: 'hioki',
      title: 'Hioki Tools',
      description: 'Publicly accessible temperature and humidity logger collection and reporting utilities.',
      links: [{ label: 'Launch Hioki Tools', href: '/tools/hioki' }],
      authorized: true,
      publicAccess: true,
    },
  ];

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      {params.error === 'access_denied' && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          Access denied: Your assigned role does not have permission to open that module.
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
          <div>
            <span className="inline-block rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              ASSA LOGISTICS (VCP)
            </span>
            <h1 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Operational Tools & Warehouse Management Utilities
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Centralized warehouse execution, real-time monitoring, inventory control, and
              environmental logging platform.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {user ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-right">
                <p className="text-xs text-slate-500">Authenticated Operator</p>
                <p className="text-sm font-bold text-slate-900">
                  {user.full_name}{' '}
                  <span className="ml-1 rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white">
                    {user.role}
                  </span>
                </p>
                <Link
                  href="/profile"
                  className="mt-1 inline-block text-xs font-medium text-slate-600 underline hover:text-slate-900"
                >
                  Manage Profile & PIN
                </Link>
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
              >
                Sign In with User ID & PIN
              </Link>
            )}
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        {modules.map((mod) => (
          <div
            key={mod.key}
            className={`flex flex-col justify-between rounded-2xl border p-6 transition ${
              mod.authorized
                ? 'border-slate-200 bg-white shadow-sm'
                : 'border-slate-200/70 bg-slate-50/70 opacity-75'
            }`}
          >
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-900">{mod.title}</h2>
                {mod.publicAccess ? (
                  <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                    Public Access
                  </span>
                ) : mod.authorized ? (
                  <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800">
                    Authorized
                  </span>
                ) : (
                  <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                    {user ? 'Restricted Role' : 'Login Required'}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600">{mod.description}</p>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              {mod.authorized ? (
                mod.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    {link.label}
                  </Link>
                ))
              ) : !user ? (
                <Link
                  href="/login"
                  className="rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Sign In to Access
                </Link>
              ) : (
                <span className="text-xs font-medium text-slate-500">
                  Not available for {user.role} role
                </span>
              )}
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}