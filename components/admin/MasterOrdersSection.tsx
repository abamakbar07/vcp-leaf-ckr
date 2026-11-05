/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { whOf } from '@/lib/db';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  orders: any[];
  items: any[]; // { po_number, arrival_time, lot_code, qty_usage_ct }
  loading: boolean;
  onReload: () => void;
  notify: (msg: string, type?: ToastType) => void;
}

const CHILD_TABLES = ['vcp-op-scan_logs', 'vcp-op-staging_monitoring_logs', 'vcp-op-po_status', 'vcp-op-order_items'];

// Hapus per kelompok RIT: filter PO + RIT supaya PO yang sama di RIT lain tidak ikut terhapus
async function deleteGroup(poList: string[], rit: string) {
  for (let i = 0; i < poList.length; i += 100) {
    const chunk = poList.slice(i, i + 100);
    for (const table of CHILD_TABLES) {
      const { error } = await supabase.from(table).delete().in('po_number', chunk).eq('arrival_time', rit);
      // po_status baru: abaikan kalau tabelnya belum dibuat
      if (error && table !== 'vcp-op-po_status') throw error;
    }
    const { error } = await supabase.from('vcp-op-orders').delete().in('po_number', chunk).eq('arrival_time', rit);
    if (error) throw error;
  }
}

export default function MasterOrdersSection({ orders, items, loading, onReload, notify }: Props) {
  const [fWh, setFWh] = useState('ALL');
  const [fDate, setFDate] = useState('ALL');
  const [fRit, setFRit] = useState('ALL');
  const [busy, setBusy] = useState(false);

  const whs = useMemo(() => Array.from(new Set(orders.map(whOf))), [orders]);
  const dates = useMemo(() => Array.from(new Set(orders.map(o => o.arrival_date))).sort().reverse(), [orders]);
  const rits = useMemo(() => Array.from(new Set(orders.map(o => o.arrival_time))).sort(), [orders]);

  const filtered = useMemo(() => orders.filter(o =>
    (fWh === 'ALL' || whOf(o) === fWh) && (fDate === 'ALL' || o.arrival_date === fDate) && (fRit === 'ALL' || o.arrival_time === fRit)
  ), [orders, fWh, fDate, fRit]);

  const itemStats = useMemo(() => {
    const m = new Map<string, { lots: number; ct: number }>();
    items.forEach(i => {
      const k = `${i.po_number}___${i.arrival_time}`;
      const cur = m.get(k) || { lots: 0, ct: 0 };
      cur.lots += 1; cur.ct += Number(i.qty_usage_ct);
      m.set(k, cur);
    });
    return m;
  }, [items]);

  const deleteOne = async (o: any) => {
    if (!confirm(`Yakin ingin menghapus PO [${o.po_number}] (RIT: ${o.arrival_time}) beserta seluruh LOT, log scan, dan monitoring terkait?`)) return;
    setBusy(true);
    try {
      await deleteGroup([o.po_number], o.arrival_time);
      notify(`🗑️ PO [${o.po_number}] berhasil dihapus utuh!`, 'success');
      onReload();
    } catch (err: any) { notify(`❌ Delete error: ${err.message}`, 'error'); }
    finally { setBusy(false); }
  };

  const bulkDelete = async () => {
    if (filtered.length === 0) return notify('⚠️ Tidak ada data untuk dihapus dengan filter ini.', 'warning');
    const isAll = fWh === 'ALL' && fDate === 'ALL' && fRit === 'ALL';
    if (isAll) {
      const typed = prompt('PERINGATAN! Ini akan menghapus SELURUH order beserta log scan dan monitoring.\nKetik HAPUS untuk melanjutkan:');
      if (typed !== 'HAPUS') return;
    } else if (!confirm(`Yakin ingin menghapus ${filtered.length} PO secara massal beserta semua log scan dan monitoring?`)) return;

    setBusy(true);
    notify('⏳ Sedang menghapus data secara massal...', 'warning');
    try {
      const byRit = new Map<string, string[]>();
      filtered.forEach(o => { byRit.set(o.arrival_time, [...(byRit.get(o.arrival_time) || []), o.po_number]); });
      for (const [rit, poList] of byRit) await deleteGroup(poList, rit);
      notify(`🗑️ ${filtered.length} PO berhasil dihapus massal!`, 'success');
      onReload();
    } catch (err: any) { notify(`❌ Error Hapus Massal: ${err.message}`, 'error'); onReload(); }
    finally { setBusy(false); }
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-white font-semibold text-sm';

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
        <h2 className="font-bold text-base text-gray-900">4. Master Data Order Terdaftar</h2>
        <div className="flex gap-2">
          <button onClick={bulkDelete} disabled={busy} className="px-3 min-h-10 rounded-md bg-red-600 text-white text-xs font-bold disabled:opacity-60">🗑️ Hapus Massal (Sesuai Filter)</button>
          <button onClick={onReload} disabled={loading} className="px-3 min-h-10 rounded-md border border-gray-300 text-xs font-bold bg-white disabled:opacity-60">🔄 Refresh</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 mb-3 bg-gray-50 rounded-md border border-gray-200">
        <div><label className="block text-xs font-bold text-gray-500 mb-1">Warehouse (WHID):</label>
          <select value={fWh} onChange={e => setFWh(e.target.value)} className={selCls}><option value="ALL">-- SEMUA --</option>{whs.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
        <div><label className="block text-xs font-bold text-gray-500 mb-1">Tanggal Kedatangan:</label>
          <select value={fDate} onChange={e => setFDate(e.target.value)} className={selCls}><option value="ALL">-- SEMUA --</option>{dates.map(d => <option key={d} value={d}>{d}</option>)}</select></div>
        <div><label className="block text-xs font-bold text-gray-500 mb-1">RITase:</label>
          <select value={fRit} onChange={e => setFRit(e.target.value)} className={selCls}><option value="ALL">-- SEMUA --</option>{rits.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
      </div>

      <div className="text-xs text-gray-500 mb-1">{filtered.length} PO ditampilkan dari {orders.length}</div>
      <div className="max-h-[50vh] overflow-auto border border-gray-200 rounded-md">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-white sticky top-0">
            <tr><th className="p-2 text-left">WHID</th><th className="p-2 text-left">PO Number</th><th className="p-2 text-left">Blend</th><th className="p-2 text-left">Arrival Date</th><th className="p-2 text-left">RIT</th><th className="p-2 text-left">Total LOT</th><th className="p-2 text-left">Target CT</th><th className="p-2">Aksi</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-4 text-center">Loading data master...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="p-4 text-center">Tidak ada data sesuai filter.</td></tr>}
            {!loading && filtered.map(o => {
              const st = itemStats.get(`${o.po_number}___${o.arrival_time}`);
              return (
                <tr key={`${o.po_number}${o.arrival_time}`} className="border-b">
                  <td className="p-2 font-bold">{whOf(o)}</td>
                  <td className="p-2 font-bold">{o.po_number}</td>
                  <td className="p-2">{o.blend_code || '-'}</td>
                  <td className="p-2">{o.arrival_date || '-'}</td>
                  <td className="p-2">{o.arrival_time || '-'}</td>
                  <td className="p-2 font-bold">{st?.lots || 0} LOT</td>
                  <td className="p-2">{st ? +st.ct.toFixed(2) : 0}</td>
                  <td className="p-2 text-center"><button onClick={() => deleteOne(o)} disabled={busy} className="px-3 min-h-9 rounded-md bg-red-600 text-white text-xs font-bold disabled:opacity-60">Hapus 1 PO</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}