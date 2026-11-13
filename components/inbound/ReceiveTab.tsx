/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPaged } from '@/lib/db';
import { sortForReceive, type AsnSummary, type InboundLog } from '@/lib/inbound';
import BarcodeView from './BarcodeView';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  asn: AsnSummary | null;
  checker: string;
  notify: (msg: string, type?: ToastType) => void;
}

type Filter = 'pending' | 'done' | 'all';
const ZOOMS = [100, 150, 200, 300];

export default function ReceiveTab({ asn, checker, notify }: Props) {
  const asnId = asn?.asn_id ?? null;
  const [logs, setLogs] = useState<InboundLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter>('pending');
  const [lot, setLot] = useState('');
  const [idx, setIdx] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [mode, setMode] = useState<'card' | 'list'>('card');
  const [busy, setBusy] = useState(false);

  // Jaga layar HP tetap menyala selama tab ini terbuka (kalau layar mati, barcode tidak bisa ditembak)
  useEffect(() => {
    let lock: any = null;
    const request = async () => { try { if ('wakeLock' in navigator) lock = await (navigator as any).wakeLock.request('screen'); } catch { /* tidak didukung / ditolak */ } };
    request();
    const onVis = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); lock?.release?.(); };
  }, []);

  const load = useCallback(async () => {
    if (asnId === null) { setLogs([]); return; }
    setLoading(true);
    try {
      const rows = await fetchPaged<InboundLog>((f, t) => supabase.from('inbound_scan_logs').select('*').eq('asn_id', asnId).order('id').range(f, t));
      setLogs(sortForReceive(rows));
    } catch (err: any) { notify(`❌ Gagal memuat SN: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  }, [asnId, notify]);

  useEffect(() => { load(); setIdx(0); }, [load]);

  const lots = useMemo(() => Array.from(new Set(logs.map(l => l.lot_code))).sort(), [logs]);
  const list = useMemo(() => logs.filter(l =>
    (!lot || l.lot_code === lot) &&
    (filter === 'all' || (filter === 'pending' ? !l.wms_received_at : !!l.wms_received_at))
  ), [logs, lot, filter]);

  const total = logs.length;
  const done = logs.filter(l => l.wms_received_at).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const safeIdx = Math.min(idx, Math.max(0, list.length - 1));
  const cur = list[safeIdx];

  const setReceived = async (l: InboundLog, on: boolean) => {
    setBusy(true);
    const at = on ? new Date().toISOString() : null;
    const by = on ? (checker.trim() || 'anon') : null;
    const prev = logs;
    setLogs(p => p.map(x => (x.id === l.id ? { ...x, wms_received_at: at, wms_received_by: by } : x))); // optimistis
    try {
      const { error } = await supabase.from('inbound_scan_logs').update({ wms_received_at: at, wms_received_by: by }).eq('id', l.id);
      if (error) throw error;
      // Tampilan "semua": lanjut ke SN berikutnya. Tampilan "belum": item hilang dari daftar, index otomatis menunjuk SN berikutnya.
      if (on && filter === 'all') setIdx(i => Math.min(i + 1, list.length - 1));
    } catch (err: any) {
      setLogs(prev);
      notify(`❌ Gagal menyimpan: ${err.message}`, 'error');
    } finally { setBusy(false); }
  };

  const copySn = async (sn: string) => {
    try { await navigator.clipboard.writeText(sn); notify('📋 SN disalin', 'success'); } catch { notify('Gagal menyalin', 'warning'); }
  };

  if (!asn) return <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">Pilih ASN di bagian atas.</div>;

  const chip = (active: boolean) => `px-3 min-h-9 rounded-full text-xs font-bold border ${active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300'}`;

  return (
    <div>
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 mb-3">
        <div className="flex justify-between items-center mb-1 text-sm">
          <span className="font-bold">Receive WMS: {done} / {total} SN</span>
          <button onClick={load} disabled={loading} className="px-3 min-h-9 rounded-md border border-gray-300 bg-white text-xs font-bold disabled:opacity-50">{loading ? '⏳' : '🔄 Refresh'}</button>
        </div>
        <div className="bg-gray-200 rounded h-2.5 overflow-hidden mb-2"><div className={`h-full ${pct >= 100 ? 'bg-green-700' : 'bg-amber-600'}`} style={{ width: `${pct}%` }} /></div>
        <div className="flex flex-wrap gap-2 items-center">
          <button className={chip(filter === 'pending')} onClick={() => { setFilter('pending'); setIdx(0); }}>Belum ({total - done})</button>
          <button className={chip(filter === 'done')} onClick={() => { setFilter('done'); setIdx(0); }}>Sudah ({done})</button>
          <button className={chip(filter === 'all')} onClick={() => { setFilter('all'); setIdx(0); }}>Semua</button>
          <select value={lot} onChange={e => { setLot(e.target.value); setIdx(0); }} className="min-h-9 border border-gray-300 rounded-md px-2 text-xs font-semibold bg-white">
            <option value="">Semua LOT</option>{lots.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <div className="ml-auto flex gap-1">
            <button className={chip(mode === 'card')} onClick={() => setMode('card')}>Kartu</button>
            <button className={chip(mode === 'list')} onClick={() => setMode('list')}>Daftar</button>
          </div>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          {total === 0 ? <span className="text-gray-500">Belum ada SN yang direcord untuk ASN ini.</span>
            : filter === 'pending' ? <span className="text-green-700 font-bold text-lg">🎉 Semua SN sudah receive di WMS!</span>
            : <span className="text-gray-500">Tidak ada SN untuk filter ini.</span>}
        </div>
      ) : mode === 'card' && cur ? (
        <div className="bg-white rounded-lg border-2 border-gray-300 shadow-sm p-3">
          <div className="flex justify-between items-center text-xs text-gray-500 mb-2">
            <span className="font-bold">{safeIdx + 1} / {list.length}</span>
            <span className="flex items-center gap-1">Zoom barcode:
              {ZOOMS.map(z => <button key={z} onClick={() => setZoom(z)} className={`px-2 min-h-8 rounded border text-[11px] font-bold ${zoom === z ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-300'}`}>{z}%</button>)}
            </span>
          </div>

          <BarcodeView value={cur.serial_number} zoom={zoom} />
          <p className="text-[11px] text-gray-400 mt-1">Barcode terlalu rapat? Putar HP ke landscape atau naikkan zoom lalu geser.</p>

          <div className="text-center my-3">
            <div className="font-mono font-extrabold text-xl tracking-wider break-all leading-tight select-all">{cur.serial_number}</div>
            <button onClick={() => copySn(cur.serial_number)} className="mt-1 text-xs text-blue-700 underline">Salin SN</button>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center text-xs mb-3">
            <div className="bg-gray-50 border rounded-md p-2"><div className="text-gray-500 font-bold">LOT</div><div className="font-extrabold">{cur.lot_code}</div></div>
            <div className="bg-gray-50 border rounded-md p-2"><div className="text-gray-500 font-bold">PMRUN</div><div className="font-extrabold">{cur.pmi_run_no}</div></div>
            <div className="bg-gray-50 border rounded-md p-2"><div className="text-gray-500 font-bold">CASEID</div><div className="font-extrabold">{cur.case_number}</div></div>
            <div className="bg-gray-50 border rounded-md p-2"><div className="text-gray-500 font-bold">NET</div><div className="font-extrabold">{cur.net_weight_kg} kg</div></div>
          </div>
          {cur.is_exception && <div className="mb-3 text-xs bg-orange-50 border border-orange-200 text-orange-900 rounded-md p-2 font-semibold">⚠ Exception: {cur.exception_reason}</div>}

          {cur.wms_received_at ? (
            <button onClick={() => setReceived(cur, false)} disabled={busy} className="w-full min-h-14 rounded-lg border-2 border-gray-300 bg-white font-bold disabled:opacity-60">
              ✓ Sudah receive ({new Date(cur.wms_received_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}) · Batalkan
            </button>
          ) : (
            <button onClick={() => setReceived(cur, true)} disabled={busy} className="w-full min-h-14 rounded-lg bg-green-700 text-white font-extrabold text-base disabled:opacity-60">✅ SUDAH RECEIVE DI WMS</button>
          )}

          <div className="flex gap-2 mt-2">
            <button onClick={() => setIdx(Math.max(0, safeIdx - 1))} disabled={safeIdx === 0} className="flex-1 min-h-12 rounded-lg border border-gray-300 bg-white font-bold disabled:opacity-40">◀ Sebelumnya</button>
            <button onClick={() => setIdx(Math.min(list.length - 1, safeIdx + 1))} disabled={safeIdx >= list.length - 1} className="flex-1 min-h-12 rounded-lg border border-gray-300 bg-white font-bold disabled:opacity-40">Lewati / Berikutnya ▶</button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="max-h-[65vh] overflow-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-white sticky top-0"><tr><th className="p-2 text-left">LOT</th><th className="p-2 text-left">PMRUN</th><th className="p-2 text-left">CASEID</th><th className="p-2 text-left">SN</th><th className="p-2">WMS</th></tr></thead>
              <tbody>
                {list.map((l, i) => (
                  <tr key={l.id} onClick={() => { setIdx(i); setMode('card'); }} className={`border-b cursor-pointer ${l.wms_received_at ? 'bg-green-50' : ''}`}>
                    <td className="p-2 font-bold">{l.lot_code}</td><td className="p-2 font-mono">{l.pmi_run_no}</td><td className="p-2 font-mono font-bold">{l.case_number}</td>
                    <td className="p-2 font-mono text-gray-500">...{l.serial_number.slice(-8)}</td>
                    <td className="p-2 text-center">{l.wms_received_at ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}