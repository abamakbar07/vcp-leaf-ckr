/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import AppNav from '@/components/AppNav';
import { useToast } from '@/components/ui/Toast';
import PoTable from '@/components/dashboard/PoTable';
import LotTable from '@/components/dashboard/LotTable';
import RitTable from '@/components/dashboard/RitTable';
import { getISOWeek } from '@/lib/utils';
import { whOf } from '@/lib/db';
import { buildAlerts, fetchDashboard, fetchOrderFilters, loadSkuMap, type DashboardData } from '@/lib/dashboardData';
import { exportDashboardExcel } from '@/lib/dashboardExport';

function Card({ title, sub, value, total, pct, color, note }: { title: string; sub: string; value: string; total?: string; pct: number; color: string; note?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3" style={{ borderLeft: `4px solid ${color}` }}>
      <div className="text-[11px] font-bold uppercase text-gray-500">{title}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-2xl font-extrabold tabular-nums text-gray-900">{value}</span>
        {total && <span className="text-sm text-gray-500 tabular-nums">/ {total}</span>}
      </div>
      <div className="bg-gray-200 rounded h-2 overflow-hidden my-1.5"><div className="h-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: color }} /></div>
      <div className="flex justify-between text-[11px] text-gray-500"><span>{sub}</span><strong style={{ color }}>{pct}%</strong></div>
      {note && <div className="text-[11px] text-red-600 font-semibold mt-1">{note}</div>}
    </div>
  );
}

const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export default function DashboardPage() {
  const { notify, toast } = useToast();
  const [meta, setMeta] = useState<{ wh_id: string | null; arrival_date: string }[]>([]);
  const [skuMap, setSkuMap] = useState<Map<string, number>>(new Map());
  const [skuReady, setSkuReady] = useState(false);

  const [wh, setWh] = useState('ALL');
  const [week, setWeek] = useState('');
  const [date, setDate] = useState('');
  const [rit, setRit] = useState('ALL');

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(true);
  const [exporting, setExporting] = useState(false);

  // --- filter awal ---
  useEffect(() => {
    (async () => {
      try {
        const [m, s] = await Promise.all([fetchOrderFilters(), loadSkuMap()]);
        setMeta(m); setSkuMap(s);
      } catch (err: any) { notify(`❌ Gagal load filter: ${err.message}`, 'error'); }
      finally { setSkuReady(true); }
    })();
  }, [notify]);

  const whs = useMemo(() => Array.from(new Set(meta.map(whOf))), [meta]);
  const dates = useMemo(
    () => Array.from(new Set(meta.filter(m => wh === 'ALL' || whOf(m) === wh).map(m => m.arrival_date))).sort().reverse(),
    [meta, wh]
  );
  const weeks = useMemo(() => Array.from(new Set(dates.map(getISOWeek))), [dates]);
  const weekDates = useMemo(() => dates.filter(d => getISOWeek(d) === week), [dates, week]);

  // Tanggal tidak tersedia untuk WH ini (atau belum dipilih) -> pilih tanggal terbaru
  useEffect(() => {
    if (dates.length > 0 && !dates.includes(date)) { setDate(dates[0]); setWeek(getISOWeek(dates[0])); setRit('ALL'); }
  }, [dates, date]);

  const onWeek = (v: string) => { setWeek(v); const d = dates.find(x => getISOWeek(x) === v); if (d) { setDate(d); setRit('ALL'); } };
  const onDate = (v: string) => { setDate(v); setWeek(getISOWeek(v)); setRit('ALL'); };

  // --- load data ---
  const load = useCallback(async (silent = false) => {
    if (!date || !skuReady) return;
    if (!silent) setLoading(true);
    try { setData(await fetchDashboard(date, wh, skuMap)); }
    catch (err: any) { notify(`❌ Gagal memuat dashboard: ${err.message}`, 'error'); }
    finally { if (!silent) setLoading(false); }
  }, [date, wh, skuMap, skuReady, notify]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => load(true), 30000);
    return () => clearInterval(id);
  }, [auto, load]);

  useEffect(() => { if (data && rit !== 'ALL' && !data.rits.some(r => r.rit === rit)) setRit('ALL'); }, [data, rit]);

  // --- turunan ---
  const rows = useMemo(() => (data ? data.rows.filter(r => rit === 'ALL' || r.rit === rit) : []), [data, rit]);
  const ritRows = useMemo(() => (data ? data.rits.filter(r => rit === 'ALL' || r.rit === rit) : []), [data, rit]);
  const alerts = useMemo(() => (data ? buildAlerts(data) : []), [data]);

  const sum = useMemo(() => {
    const target = rows.reduce((s, r) => s + r.target, 0);
    const scanned = rows.reduce((s, r) => s + r.scanned, 0);
    const loaded = rows.reduce((s, r) => s + r.loaded, 0);
    return {
      target, scanned, loaded,
      grouping: rows.filter(r => r.grouping.done).length,
      qc: rows.filter(r => r.qc.done).length,
      ritFull: ritRows.filter(r => r.dispatch && r.dispatch.photos === 4).length,
    };
  }, [rows, ritRows]);

  const doExport = async () => {
    if (!data || rows.length === 0) return notify('⚠️ Tidak ada data untuk diexport!', 'warning');
    setExporting(true);
    notify('⏳ Mengambil & merangkum data master...', 'warning');
    try { await exportDashboardExcel(data, rows, rit); notify('✅ Laporan lengkap berhasil diunduh!', 'success'); }
    catch (err: any) { notify(`❌ Gagal export detail: ${err.message}`, 'error'); }
    finally { setExporting(false); }
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-white font-semibold text-sm';
  const lbl = 'block text-xs font-bold text-gray-500 mb-1';
  const p = data?.picking;

  return (
    <div className="max-w-6xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      <AppNav current="dashboard" title="VCP-OP Live Dashboard" subtitle="Picking → Grouping → QC → Monitoring → Loading" />
      {toast}

      {/* FILTER */}
      <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <div><label className={lbl}>Warehouse</label>
            <select value={wh} onChange={e => setWh(e.target.value)} className={selCls}><option value="ALL">-- SEMUA --</option>{whs.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
          <div><label className={lbl}>Week</label>
            <select value={week} onChange={e => onWeek(e.target.value)} className={selCls}>{weeks.map(w => <option key={w} value={w}>{w}</option>)}</select></div>
          <div><label className={lbl}>Tanggal Kedatangan</label>
            <select value={date} onChange={e => onDate(e.target.value)} className={selCls}>{(week ? weekDates : dates).map(d => <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label className={lbl}>RIT (PO &amp; Armada)</label>
            <select value={rit} onChange={e => setRit(e.target.value)} className={selCls}><option value="ALL">-- SEMUA RIT --</option>{data?.rits.map(r => <option key={`${r.wh}${r.rit}`} value={r.rit}>{r.rit}</option>)}</select></div>
          <div className="flex items-end gap-2">
            <button onClick={() => load()} disabled={loading} className="flex-1 min-h-10 rounded-md bg-amber-600 text-white font-bold text-xs disabled:opacity-60">{loading ? '⏳' : '🔄 Refresh'}</button>
          </div>
        </div>
        <div className="flex flex-wrap justify-between items-center gap-2 mt-2 text-xs text-gray-600">
          <label className="flex items-center gap-2 cursor-pointer font-semibold">
            <input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} className="w-4 h-4 accent-gray-900" /> Auto-refresh 30 detik
          </label>
          <span>{data ? `Terakhir diperbarui ${data.fetchedAt.toLocaleTimeString('id-ID')}` : 'Memuat...'}</span>
        </div>
      </div>

      {/* SCORECARD */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
        <Card title="1. Picking (per tanggal)" sub={p?.hasData ? `${p.boxes} box di-scan` : 'belum ada scan picking'} value={`${p?.fulfilled ?? 0}`} total={`${p?.target ?? 0} CT`}
          pct={pctOf(p?.fulfilled ?? 0, p?.target ?? 0)} color="#3182ce" note={p && p.extra > 0.05 ? `+${p.extra} CT lebih/di luar order` : undefined} />
        <Card title="2. Grouping" sub="PO selesai" value={`${sum.grouping}`} total={`${rows.length} PO`} pct={pctOf(sum.grouping, rows.length)} color="#0e7490" />
        <Card title="3. QC" sub="PO selesai" value={`${sum.qc}`} total={`${rows.length} PO`} pct={pctOf(sum.qc, rows.length)} color="#6366f1" />
        <Card title="4. Monitoring Scan" sub="CT ter-scan" value={`${+sum.scanned.toFixed(1)}`} total={`${+sum.target.toFixed(1)} CT`} pct={pctOf(sum.scanned, sum.target)} color="#1b1b1d" />
        <Card title="5. Loaded" sub="CT masuk truk" value={`${+sum.loaded.toFixed(1)}`} total={`${+sum.target.toFixed(1)} CT`} pct={pctOf(sum.loaded, sum.target)} color="#dd6b20" />
        <Card title="6. Foto Dispatch" sub="RIT lengkap 4/4" value={`${sum.ritFull}`} total={`${ritRows.length} RIT`} pct={pctOf(sum.ritFull, ritRows.length)} color="#2f855a" />
      </div>

      {/* PERLU PERHATIAN */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="font-bold text-gray-900 mb-2">⚠️ Perlu Perhatian {alerts.length > 0 && <span className="ml-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800 text-xs">{alerts.length}</span>}</h2>
        {alerts.length === 0 ? <p className="text-green-700 font-semibold text-xs">✅ Tidak ada hal yang perlu perhatian pada tanggal ini.</p> : (
          <ul className="space-y-1 max-h-48 overflow-auto">
            {alerts.map((a, i) => (
              <li key={i} className={`text-xs font-semibold px-2 py-1.5 rounded-md ${a.level === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>{a.level === 'error' ? '🔴' : '🟠'} {a.text}</li>
            ))}
          </ul>
        )}
      </section>

      {/* PO TRACKER */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <h2 className="font-bold text-gray-900">Live Status PO Tracker <span className="text-xs font-normal text-gray-500">(klik baris untuk detail LOT)</span></h2>
          <button onClick={doExport} disabled={exporting} className="px-3 min-h-10 rounded-md bg-green-700 text-white text-xs font-bold disabled:opacity-60">{exporting ? '⏳ Menyiapkan...' : '📥 Export Excel Lengkap'}</button>
        </div>
        <PoTable rows={rows} />
      </section>

      {/* PER RIT / ARMADA */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="font-bold text-gray-900 mb-2">Per RIT &amp; Armada</h2>
        <RitTable rits={ritRows} activeRit={rit} />
      </section>

      {/* PER LOT */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="font-bold text-gray-900 mb-0.5">Rekonsiliasi per LOT <span className="text-xs font-normal text-gray-500">(level tanggal, semua RIT)</span></h2>
        <p className="text-xs text-gray-500 mb-2">Target order vs hasil Picking vs scan Monitoring vs Loaded. Picking dan Monitoring adalah data terpisah, jadi selisih di sini hanya sebagai pembanding.</p>
        <LotTable lots={data?.lots ?? []} pickingHasData={!!p?.hasData} />
      </section>
    </div>
  );
}