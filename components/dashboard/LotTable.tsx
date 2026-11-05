'use client';
import type { LotRow, PickStatus } from '@/lib/dashboardData';

const BADGE: Record<PickStatus, string> = {
  DONE: 'bg-green-100 text-green-900', PARTIAL: 'bg-orange-100 text-orange-900', OPEN: 'bg-gray-200 text-gray-600',
  OVER: 'bg-red-100 text-red-800', 'DI LUAR ORDER': 'bg-red-100 text-red-800',
};

export default function LotTable({ lots, pickingHasData }: { lots: LotRow[]; pickingHasData: boolean }) {
  return (
    <div className="max-h-[420px] overflow-auto border border-gray-200 rounded-md">
      <table className="w-full text-xs">
        <thead className="bg-gray-900 text-white sticky top-0">
          <tr>
            <th className="p-2 text-left">LOT</th><th className="p-2 text-left">Target</th><th className="p-2 text-left">Picking</th>
            <th className="p-2 text-left">Selisih Picking</th><th className="p-2 text-left">Monitoring</th><th className="p-2 text-left">Loaded</th><th className="p-2 text-center">Status Picking</th>
          </tr>
        </thead>
        <tbody>
          {lots.length === 0 && <tr><td colSpan={7} className="p-4 text-center text-gray-500">Belum ada data LOT.</td></tr>}
          {lots.map(l => {
            const diff = +(l.picked - l.target).toFixed(2);
            return (
              <tr key={l.lot} className="border-b">
                <td className="p-2 font-bold">{l.lot}</td>
                <td className="p-2">{l.target}</td>
                <td className="p-2 text-blue-700 font-bold">{l.picked} <span className="text-gray-400 font-normal">({l.pickedBoxes} bx)</span></td>
                <td className={`p-2 font-bold ${diff > 0.05 ? 'text-red-600' : diff < -0.05 ? 'text-orange-700' : 'text-green-700'}`}>{pickingHasData ? (diff > 0 ? `+${diff}` : diff) : '-'}</td>
                <td className="p-2">{l.scanned}</td>
                <td className="p-2 text-orange-700 font-bold">{l.loaded}</td>
                <td className="p-2 text-center"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold ${BADGE[l.pickStatus]}`}>{l.pickStatus}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}