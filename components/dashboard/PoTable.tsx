'use client';
import { Fragment, useState } from 'react';
import type { PoRow, Stage } from '@/lib/dashboardData';

export const STAGE_META: Record<Stage, { label: string; cls: string }> = {
  OPEN: { label: 'OPEN', cls: 'bg-gray-200 text-gray-700' },
  GROUPING: { label: 'GROUPING', cls: 'bg-sky-100 text-sky-900' },
  QC: { label: 'QC DONE', cls: 'bg-indigo-100 text-indigo-900' },
  MONITORING: { label: 'MONITORING', cls: 'bg-amber-100 text-amber-900' },
  READY: { label: 'READY TO LOAD', cls: 'bg-orange-200 text-orange-900' },
  LOADED: { label: 'LOADED', cls: 'bg-green-200 text-green-900' },
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Bar({ value, total, color }: { value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="min-w-[110px]">
      <div className="flex justify-between text-[11px] font-bold tabular-nums"><span>{+value.toFixed(1)} / {+total.toFixed(1)}</span><span>{pct}%</span></div>
      <div className="bg-gray-200 rounded h-2 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function Tick({ done, at, by }: { done: boolean; at: string | null; by: string | null }) {
  if (!done) return <span className="text-gray-300 font-bold">—</span>;
  return <div className="text-[11px] leading-tight"><span className="text-green-700 font-extrabold">✓</span> {fmt(at)}<div className="text-gray-500">{by}</div></div>;
}

export default function PoTable({ rows }: { rows: PoRow[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div className="max-h-[520px] overflow-auto border border-gray-200 rounded-md">
      <table className="w-full text-xs">
        <thead className="bg-gray-900 text-white sticky top-0 z-10">
          <tr>
            <th className="p-2 text-left">PO</th><th className="p-2 text-left">RIT</th><th className="p-2 text-left">Blend</th>
            <th className="p-2 text-left">Monitoring Scan (CT)</th><th className="p-2 text-left">Loaded (CT)</th>
            <th className="p-2 text-left">Grouping</th><th className="p-2 text-left">QC</th><th className="p-2 text-left">Evidence</th>
            <th className="p-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-gray-500">Tidak ada PO pada filter ini.</td></tr>}
          {rows.map(r => (
            <Fragment key={r.key}>
              <tr onClick={() => toggle(r.key)} className="border-b cursor-pointer hover:bg-amber-50 align-top">
                <td className="p-2"><div className="font-extrabold">{r.po}</div><div className="text-gray-500">{r.wh}{r.notes.length > 0 && <span className="ml-2 text-orange-700 font-bold">⚠ {r.notes.length}</span>}</div></td>
                <td className="p-2 whitespace-nowrap">{r.rit}</td>
                <td className="p-2">{r.blend}</td>
                <td className="p-2"><Bar value={r.scanned} total={r.target} color="bg-gray-900" /><div className="text-[10px] text-gray-500">{r.boxes} box</div></td>
                <td className="p-2"><Bar value={r.loaded} total={r.target} color="bg-orange-500" /><div className="text-[10px] text-gray-500">{r.loadedBoxes}/{r.boxes} box</div></td>
                <td className="p-2"><Tick {...r.grouping} /></td>
                <td className="p-2"><Tick {...r.qc} /></td>
                <td className="p-2 text-[11px]">
                  {r.evidence.has ? <><span className="font-bold">{r.evidence.kainMori || '-'}</span><div className={r.evidence.photos === 3 ? 'text-green-700' : 'text-orange-700'}>📷 {r.evidence.photos}/3</div></> : <span className="text-gray-300 font-bold">—</span>}
                </td>
                <td className="p-2 text-center"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold whitespace-nowrap ${STAGE_META[r.stage].cls}`}>{STAGE_META[r.stage].label}</span></td>
              </tr>
              {open.has(r.key) && (
                <tr className="bg-gray-50 border-b">
                  <td colSpan={9} className="p-3">
                    {r.notes.length > 0 && <ul className="mb-2 text-orange-800 font-semibold space-y-0.5">{r.notes.map(n => <li key={n}>⚠ {n}</li>)}</ul>}
                    <table className="w-full max-w-xl text-[11px]">
                      <thead><tr className="text-gray-500"><th className="text-left p-1">LOT</th><th className="text-left p-1">Target</th><th className="text-left p-1">Scanned</th><th className="text-left p-1">Loaded</th><th className="text-left p-1">Sisa scan</th></tr></thead>
                      <tbody>
                        {r.lots.map(l => (
                          <tr key={l.lot} className="border-t border-gray-200">
                            <td className="p-1 font-bold">{l.lot}</td><td className="p-1">{l.target}</td><td className="p-1 text-blue-700 font-bold">{l.scanned}</td>
                            <td className="p-1 text-orange-700 font-bold">{l.loaded}</td><td className="p-1">{+(l.target - l.scanned).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}