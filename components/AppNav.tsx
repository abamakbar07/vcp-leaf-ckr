import Link from 'next/link';

const LINKS = [
  { key: 'scanner', href: '/scanner', label: '📱 RF Scanner' },
  { key: 'inbound', href: '/inbound', label: '📥 Inbound' },
  { key: 'dashboard', href: '/dashboard', label: '📊 Dashboard' },
  { key: 'admin', href: '/admin', label: '⚙️ Admin' },
];

export default function AppNav({ current, title, subtitle }: { current: 'scanner' | 'dashboard' | 'admin' | 'inbound'; title: string; subtitle?: string }) {
  return (
    <header className="bg-white shadow-sm rounded-lg p-4 mb-4 flex flex-wrap justify-between items-center gap-3 border border-gray-200">
      <div>
        <h1 className="font-bold text-lg text-blue-900">{title}</h1>
        {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      </div>
      <nav className="flex gap-2">
        {LINKS.map(l => (
          <Link
            key={l.key}
            href={l.href}
            className={`px-3 min-h-10 inline-flex items-center rounded-lg text-xs font-bold border ${
              l.key === current ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-800'
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}