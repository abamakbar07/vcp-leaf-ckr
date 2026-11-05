'use client';
import type { RitRow } from '@/lib/dashboardData';

export default function RitTable({ rits, activeRit }: { rits: RitRow[]; activeRit: string }) {
  return (
    <div className="overflow-auto border border-gray-200 rounded-md">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-gray-900 text-white">
          <tr>
            <th className="p-2 text-left">RIT / ETA</th><th className="p-2 text-left">WH</th><th className="p-2 text-left">PO</th>
            <th className="p-2 text-left">Grouping</th><th className="p-2 text-left">QC</th>
            <th className="p-2 text-left">Scan / Target</th><th className="p-2 text-left">Loaded</th>
            <th className="p-2 text-left">Armada</th><th className="p-2 text-left">Foto Dispatch</th>
          </tr>
        </thead>
        <tbody>
          {rits.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-gray-500">Belum ada RIT.</td></tr>}
          {rits.map(r => {
            const pct = r.target > 0 ? Math.round((r.loaded / r.target) * 100) : 0;
            return (
              <tr key={`${r.wh}${r.rit}`} className={`border-b ${activeRit !== 'ALL' && activeRit === r.rit ? 'bg-amber-50' : ''}`}>
                <td className="p-2 font-extrabold">{r.rit}</td>
                <td className="p-2">{r.wh}</td>
                <td className="p-2">{r.poCount}</td>
                <td className="p-2">{r.groupingDone}/{r.poCount}</td>
                <td className="p-2">{r.qcDone}/{r.poCount}</td>
                <td className="p-2 tabular-nums">{+r.scanned.toFixed(1)} / {+r.target.toFixed(1)}</td>
                <td className="p-2 tabular-nums"><span className={`font-bold ${pct >= 100 ? 'text-green-700' : 'text-orange-700'}`}>{+r.loaded.toFixed(1)} ({pct}%)</span></td>
                <td className="p-2">{r.dispatch ? <>{r.dispatch.ritNumber} · <strong>{r.dispatch.vehicle}</strong></> : <span className="text-gray-400">belum ada</span>}</td>
                <td className="p-2">{r.dispatch ? <span className={r.dispatch.photos === 4 ? 'text-green-700 font-bold' : 'text-orange-700 font-bold'}>📷 {r.dispatch.photos}/4</span> : <span className="text-gray-300">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}