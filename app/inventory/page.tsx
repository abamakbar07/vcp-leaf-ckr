/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { writeWorkbook } from '@/lib/excel';
import AppNav from '@/components/AppNav';
import { useToast } from '@/components/ui/Toast';
import {
  DEFAULT_FUM_LIMIT, daysBetween, fmtDate, ibStaleness, loadCurrentSnapshot, loadFumigationLimit, todayIso, type SnapshotMeta,
} from '@/lib/inventory';

interface SumRow { customer_id: string | null; sku: string; sku_desc: string | null; total_avail: number; eligible: number; expired: number; no_date: number; locations: number }
interface DetailRow { id: number; customer_id: string | null; sku: string; location_id: string | null; zone_group: string | null; serial_no: string | null; fumigation_date_eff: string | null; fum_from_registry: boolean; qty_fm: number; qty_availed: number; inventory_type: string | null }

const nf = (n: number) => (+Number(n).toFixed(2)).toLocaleString('id-ID');

export default function InventoryPage() {
  const { notify, toast } = useToast();
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [limit, setLimit] = useState(DEFAULT_FUM_LIMIT);
  const [delivery, setDelivery] = useState(todayIso());
  const [rows, setRows] = useState<SumRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [customer, setCustomer] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'all' | 'valid' | 'expired' | 'nodate'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, DetailRow[] | 'loading'>>({});
  const [sn, setSn] = useState('');
  const [snRows, setSnRows] = useState<DetailRow[] | null>(null);

  useEffect(() => {
    loadCurrentSnapshot().then(setMeta);
    loadFumigationLimit().then(setLimit);
  }, []);

  const load = useCallback(async () => {
    setLoading(true); setOpen(null); setDetail({});
    try {
      const { data, error } = await supabase.rpc('inventory_summary', { p_delivery: delivery, p_limit: limit });
      if (error) throw error;
      setRows((data || []).map((r: any) => ({ ...r, total_avail: Number(r.total_avail), eligible: Number(r.eligible), expired: Number(r.expired), no_date: Number(r.no_date), locations: Number(r.locations) })));
    } catch (err: any) { notify(`❌ Gagal memuat stok (SQL sudah dijalankan?): ${err.message}`, 'error'); }
    finally { setLoading(false); }
  }, [delivery, limit, notify]);

  useEffect(() => { load(); }, [load]);

  const customers = useMemo(() => Array.from(new Set(rows.map(r => r.customer_id || '-'))).sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase().split(/[\s,]+/).filter(Boolean);
    return rows.filter(r =>
      (!customer || (r.customer_id || '-') === customer) &&
      (needle.length === 0 || needle.some(n => r.sku.toLowerCase().includes(n) || (r.sku_desc || '').toLowerCase().includes(n))) &&
      (view === 'all' || (view === 'valid' && r.eligible > 0) || (view === 'expired' && r.expired > 0) || (view === 'nodate' && r.no_date > 0))
    );
  }, [rows, customer, q, view]);

  const tot = useMemo(() => filtered.reduce((a, r) => ({ total: a.total + r.total_avail, eligible: a.eligible + r.eligible, expired: a.expired + r.expired, noDate: a.noDate + r.no_date }), { total: 0, eligible: 0, expired: 0, noDate: 0 }), [filtered]);

  const toggle = async (r: SumRow) => {
    const key = `${r.customer_id}|${r.sku}`;
    if (open === key) { setOpen(null); return; }
    setOpen(key);
    if (detail[key]) return;
    setDetail(d => ({ ...d, [key]: 'loading' }));
    try {
      let query: any = supabase.from('inventory_balance_current')
        .select('id, customer_id, sku, location_id, zone_group, serial_no, fumigation_date_eff, fum_from_registry, qty_fm, qty_availed, inventory_type')
        .eq('sku', r.sku).gt('qty_availed', 0);
      query = r.customer_id ? query.eq('customer_id', r.customer_id) : query.is('customer_id', null);
      const { data, error } = await query.order('id').limit(5000);
      if (error) throw error;
      setDetail(d => ({ ...d, [key]: (data || []) as DetailRow[] }));
    } catch (err: any) { notify(`❌ Gagal memuat lokasi: ${err.message}`, 'error'); setDetail(d => { const n = { ...d }; delete n[key]; return n; }); }
  };

  const lookupSn = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const v = sn.trim();
    if (!v) return;
    const { data, error } = await supabase.from('inventory_balance_current')
      .select('id, customer_id, sku, location_id, zone_group, serial_no, fumigation_date_eff, fum_from_registry, qty_fm, qty_availed, inventory_type').eq('serial_no', v);
    if (error) return notify(`❌ ${error.message}`, 'error');
    setSnRows((data || []) as DetailRow[]);
    if (!data || data.length === 0) notify('⚠️ SN tidak ditemukan di IB aktif.', 'warning');
  };

  const statusOf = (d: string | null) => {
    if (!d) return { label: 'TANPA TGL', cls: 'bg-gray-200 text-gray-700', age: null as number | null };
    const age = daysBetween(d, delivery);
    return age > limit ? { label: `> ${limit} HARI`, cls: 'bg-red-100 text-red-800', age } : { label: 'VALID', cls: 'bg-green-100 text-green-900', age };
  };

  // Grup per lokasi + tanggal fumigasi: yang valid dulu, yang paling lama (mendekati batas) lebih dulu dipakai
  const grouped = (list: DetailRow[]) => {
    const m = new Map<string, { loc: string; zone: string; date: string | null; fromReg: boolean; type: string; qty: number; boxes: number }>();
    list.forEach(r => {
      const k = `${r.location_id}|${r.fumigation_date_eff}|${r.inventory_type}`;
      const g = m.get(k) || { loc: r.location_id || '-', zone: r.zone_group || '-', date: r.fumigation_date_eff, fromReg: r.fum_from_registry, type: r.inventory_type || '-', qty: 0, boxes: 0 };
      g.qty += Number(r.qty_availed); g.boxes += 1; m.set(k, g);
    });
    const rank = (d: string | null) => (!d ? 2 : daysBetween(d, delivery) > limit ? 1 : 0);
    return Array.from(m.values()).sort((a, b) => rank(a.date) - rank(b.date) || String(a.date).localeCompare(String(b.date)) || a.loc.localeCompare(b.loc));
  };

  const exportSummary = () => writeWorkbook([{
    name: 'Stok IB',
    rows: filtered.map(r => ({ Customer: r.customer_id, SKU: r.sku, Deskripsi: r.sku_desc, 'Stok tersedia': r.total_avail, [`Valid (<=${limit} hr)`]: r.eligible, [`> ${limit} hr`]: r.expired, 'Tanpa tgl fumigasi': r.no_date, 'Jumlah lokasi': r.locations })),
  }], `Stok_IB_${meta?.as_of_date ?? 'x'}_kirim_${delivery}.xlsx`);

  const stale = ibStaleness(meta?.as_of_date ?? null);
  const inp = 'w-full min-h-10 border border-gray-300 rounded-md p-2 bg-white font-semibold text-sm';
  const lbl = 'block text-xs font-bold text-gray-500 mb-1';

  return (
    <div className="max-w-6xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      <AppNav current="inventory" title="Stok Inventory Balance (IB)" subtitle="Referensi stok & umur fumigasi dari WMS" />
      {toast}

      <div className={`rounded-lg border p-3 mb-4 text-sm ${meta ? (stale.stale ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200') : 'bg-amber-50 border-amber-200'}`}>
        {meta ? (
          <>
            <span className="font-bold">IB per {fmtDate(meta.as_of_date)}</span> · {meta.row_count.toLocaleString('id-ID')} baris · diunggah {meta.finalized_at ? new Date(meta.finalized_at).toLocaleString('id-ID') : '-'} oleh {meta.uploaded_by}
            {stale.stale && <span className="block text-red-700 font-bold text-xs mt-0.5">⚠️ IB sudah {stale.days} hari tidak di-update. Angka di bawah bisa tidak sesuai kondisi gudang.</span>}
          </>
        ) : <span className="font-bold text-amber-900">Belum ada IB aktif. Upload di menu Admin → Inventory Balance.</span>}
      </div>

      {/* FILTER */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 mb-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <div><label className={lbl}>Tanggal pengiriman</label><input type="date" value={delivery} onChange={e => e.target.value && setDelivery(e.target.value)} className={inp} /></div>
        <div><label className={lbl}>Customer ID (IB)</label>
          <select value={customer} onChange={e => setCustomer(e.target.value)} className={inp}><option value="">Semua</option>{customers.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
        <div><label className={lbl}>Cari SKU / deskripsi</label><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="LQ8516 LQ8694 ..." className={inp} /></div>
        <div><label className={lbl}>Tampilkan</label>
          <select value={view} onChange={e => setView(e.target.value as any)} className={inp}>
            <option value="all">Semua SKU</option><option value="valid">Ada stok valid</option><option value="expired">Ada stok &gt; {limit} hari</option><option value="nodate">Ada stok tanpa tgl fumigasi</option>
          </select></div>
        <div className="flex items-end gap-2">
          <button onClick={load} disabled={loading} className="flex-1 min-h-10 rounded-md bg-amber-600 text-white font-bold text-xs disabled:opacity-60">{loading ? '⏳' : '🔄 Refresh'}</button>
          <button onClick={exportSummary} disabled={filtered.length === 0} className="flex-1 min-h-10 rounded-md bg-green-700 text-white font-bold text-xs disabled:opacity-50">📥 Excel</button>
        </div>
        <p className="col-span-2 md:col-span-5 text-[11px] text-gray-500">Valid = stok tersedia dengan umur fumigasi ≤ <strong>{limit} hari</strong> pada tanggal pengiriman di atas (umur = tgl pengiriman − tgl fumigasi). Stok yang sudah berstatus STAGE di WMS (tidak tersedia) tidak dihitung.</p>
      </div>

      {/* CEK SN */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3 mb-4">
        <label className={lbl}>Cek satu Serial Number (scan / ketik lalu Enter)</label>
        <input type="text" value={sn} onChange={e => setSn(e.target.value)} onKeyDown={lookupSn} placeholder="31 karakter..." className={`${inp} font-mono`} />
        {snRows && snRows.length > 0 && (
          <div className="mt-2 overflow-auto border border-gray-200 rounded-md">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-900 text-white"><tr><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Customer</th><th className="p-2 text-left">Lokasi</th><th className="p-2 text-left">Qty</th><th className="p-2 text-left">Tgl fumigasi</th><th className="p-2 text-left">Umur</th><th className="p-2 text-left">Status</th></tr></thead>
              <tbody>
                {snRows.map(r => { const st = statusOf(r.fumigation_date_eff); return (
                  <tr key={r.id} className="border-b">
                    <td className="p-2 font-bold">{r.sku}</td><td className="p-2">{r.customer_id}</td><td className="p-2">{r.location_id}{r.inventory_type === 'OFFLINE' && <span className="ml-1 text-orange-700">OFFLINE</span>}</td>
                    <td className="p-2">{r.qty_fm} (tersedia {r.qty_availed})</td>
                    <td className="p-2">{fmtDate(r.fumigation_date_eff)}{r.fum_from_registry && <span className="ml-1 text-gray-400" title="Tanggal dari arsip snapshot sebelumnya">arsip</span>}</td>
                    <td className="p-2">{st.age === null ? '-' : `${st.age} hr`}</td><td className="p-2"><span className={`px-2 py-0.5 rounded font-bold ${st.cls}`}>{st.label}</span></td>
                  </tr>); })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* RINGKASAN */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {[['Stok tersedia', tot.total, ''], ['Valid', tot.eligible, 'text-green-700'], [`> ${limit} hari`, tot.expired, 'text-red-600'], ['Tanpa tgl fumigasi', tot.noDate, 'text-gray-600']].map(([k, v, c]) => (
          <div key={k as string} className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">{k}</div><div className={`text-xl font-extrabold ${c}`}>{nf(v as number)}</div></div>
        ))}
      </div>

      <div className="max-h-[65vh] overflow-auto border border-gray-200 rounded-md bg-white">
        <table className="w-full text-xs">
          <thead className="bg-gray-900 text-white sticky top-0 z-10">
            <tr><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Deskripsi</th><th className="p-2 text-left">Customer</th><th className="p-2 text-right">Stok</th><th className="p-2 text-right">Valid</th><th className="p-2 text-right">&gt; {limit} hr</th><th className="p-2 text-right">Tanpa tgl</th><th className="p-2 text-right">Lokasi</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-4 text-center">Memuat...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">Tidak ada data untuk filter ini.</td></tr>}
            {!loading && filtered.map(r => {
              const key = `${r.customer_id}|${r.sku}`;
              const d = detail[key];
              return (
                <Fragment key={key}>
                  <tr onClick={() => toggle(r)} className="border-b cursor-pointer hover:bg-amber-50">
                    <td className="p-2 font-bold">{r.sku}</td><td className="p-2 text-gray-600">{(r.sku_desc || '').replace(`${r.sku}-`, '')}</td><td className="p-2">{r.customer_id}</td>
                    <td className="p-2 text-right tabular-nums">{nf(r.total_avail)}</td>
                    <td className="p-2 text-right tabular-nums font-bold text-green-700">{nf(r.eligible)}</td>
                    <td className={`p-2 text-right tabular-nums ${r.expired > 0 ? 'font-bold text-red-600' : 'text-gray-300'}`}>{nf(r.expired)}</td>
                    <td className={`p-2 text-right tabular-nums ${r.no_date > 0 ? 'text-gray-700' : 'text-gray-300'}`}>{nf(r.no_date)}</td>
                    <td className="p-2 text-right">{r.locations}</td>
                  </tr>
                  {open === key && (
                    <tr className="bg-gray-50 border-b"><td colSpan={8} className="p-3">
                      {d === 'loading' || !d ? <span className="text-gray-500">Memuat lokasi...</span> : (
                        <table className="w-full max-w-3xl text-[11px]">
                          <thead><tr className="text-gray-500"><th className="text-left p-1">Lokasi</th><th className="text-left p-1">Zona</th><th className="text-left p-1">Tgl fumigasi</th><th className="text-left p-1">Umur</th><th className="text-left p-1">Status</th><th className="text-right p-1">Qty</th><th className="text-right p-1">Box</th></tr></thead>
                          <tbody>
                            {grouped(d).map((g, i) => { const st = statusOf(g.date); return (
                              <tr key={i} className="border-t border-gray-200">
                                <td className="p-1 font-bold">{g.loc}{g.type === 'OFFLINE' && <span className="ml-1 text-orange-700">OFFLINE</span>}</td><td className="p-1">{g.zone}</td>
                                <td className="p-1">{fmtDate(g.date)}{g.fromReg && <span className="ml-1 text-gray-400">arsip</span>}</td><td className="p-1">{st.age === null ? '-' : `${st.age} hr`}</td>
                                <td className="p-1"><span className={`px-1.5 py-0.5 rounded font-bold ${st.cls}`}>{st.label}</span></td>
                                <td className="p-1 text-right tabular-nums">{nf(g.qty)}</td><td className="p-1 text-right">{g.boxes}</td>
                              </tr>); })}
                          </tbody>
                        </table>
                      )}
                      <p className="text-[10px] text-gray-500 mt-1">Urutan: stok valid dulu (fumigasi paling lama lebih dulu dipakai), lalu &gt; {limit} hari, lalu tanpa tanggal.</p>
                    </td></tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}