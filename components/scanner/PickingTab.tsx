/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseHMSBarcode, getISOWeek } from '@/lib/utils';
import PickingLogsModal from './PickingLogsModal';
import BypassModal from './BypassModal';
import { DEFAULT_FUM_LIMIT, IbCache, checkFumigation, fmtDate, ibStaleness, loadFumigationLimit, type FumCheck, type SnapshotMeta } from '@/lib/inventory';
import { Notify, Order } from './types';

interface Props {
  active: boolean;
  allOrders: Order[];
  whList: string[];
  skuRef: MutableRefObject<Map<string, number>>;
  checkerName: string;
  notify: Notify;
}

const whOf = (o: Order) => o.wh_id || 'WH01';
const PAGE = 1000; // batas baris per request di Supabase

// Ambil semua baris (paging), supaya total picking satu hari tidak terpotong di 1000 baris
async function fetchPaged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

type RowStatus = 'OPEN' | 'PARTIAL' | 'DONE' | 'OVER' | 'DI LUAR ORDER';

export default function PickingTab({ active, allOrders, whList, skuRef, checkerName, notify }: Props) {
  const [wh, setWh] = useState('');
  const [week, setWeek] = useState('');
  const [date, setDate] = useState('');
  const [targets, setTargets] = useState<Map<string, number>>(new Map());   // lot -> target CT
  const [pickedKg, setPickedKg] = useState<Map<string, number>>(new Map()); // lot -> total kg
  const [boxes, setBoxes] = useState<Map<string, number>>(new Map());       // lot -> jumlah box
  const [loaded, setLoaded] = useState(false);
  const [keyboardOn, setKeyboardOn] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [mode, setMode] = useState<'scan' | 'manual'>('scan');
  const [manual, setManual] = useState<Map<string, number>>(new Map());   // lot -> CT yang diisi manual
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [okKg, setOkKg] = useState<Map<string, number>>(new Map());        // lot -> kg hasil scan dengan fumigasi OK
  const [ibMeta, setIbMeta] = useState<SnapshotMeta | null>(null);
  const [ibTick, setIbTick] = useState(0);
  const [fumLimit, setFumLimit] = useState(DEFAULT_FUM_LIMIT);
  const [pending, setPending] = useState<{ title: string; message: string; onConfirm: () => Promise<void> } | null>(null);

  const ibRef = useRef(new IbCache());
  const fumLimitRef = useRef(DEFAULT_FUM_LIMIT);
  const okKgRef = useRef(okKg);
  const manualRef = useRef(manual);
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const targetsRef = useRef(targets);
  const pickedRef = useRef(pickedKg);

  const applyTargets = (m: Map<string, number>) => { targetsRef.current = m; setTargets(m); };
  const applyPicked = (kg: Map<string, number>, bx: Map<string, number>) => { pickedRef.current = kg; setPickedKg(kg); setBoxes(bx); };
  const applyOk = (m: Map<string, number>) => { okKgRef.current = m; setOkKg(m); };
  const applyManual = (m: Map<string, number>) => { manualRef.current = m; setManual(m); };
  const stdOf = (lot: string) => skuRef.current.get(lot) || 200;

  useEffect(() => {
    loadFumigationLimit().then(n => { fumLimitRef.current = n; setFumLimit(n); });
    ibRef.current.loadMeta().then(m => setIbMeta(m));
  }, []);

  useEffect(() => { if (active) setTimeout(() => inputRef.current?.focus(), 0); }, [active]);

  // --- dropdown turunan ---
  const byWH = allOrders.filter(o => whOf(o) === wh);
  const weeks = Array.from(new Set(byWH.map(o => getISOWeek(o.arrival_date))));
  const dates = Array.from(new Set(byWH.filter(o => getISOWeek(o.arrival_date) === week).map(o => o.arrival_date)));

  // --- load target (semua PO di tanggal + WH ini) & hasil picking ---
  const loadData = useCallback(async (w: string, d: string) => {
    if (!w || !d) return;
    try {
      const orders = allOrders.filter(o => whOf(o) === w && o.arrival_date === d);
      const poList = Array.from(new Set(orders.map(o => o.po_number)));
      const pairs = new Set(orders.map(o => `${o.po_number}|${o.arrival_time || '-'}`));

      const items = await fetchPaged<any>((from, to) =>
        supabase.from('vcp-op-order_items').select('po_number, arrival_time, lot_code, qty_usage_ct')
          .in('po_number', poList).order('po_number').order('lot_code').range(from, to));

      const t = new Map<string, number>();
      items.filter(i => pairs.has(`${i.po_number}|${i.arrival_time || '-'}`)).forEach(i => {
        t.set(i.lot_code, +((t.get(i.lot_code) || 0) + Number(i.qty_usage_ct)).toFixed(2));
      });

      const selectPicks = (cols: string) => fetchPaged<any>((from, to) =>
        supabase.from('vcp-op-picking_logs').select(cols).eq('wh_id', w).eq('order_date', d).order('id').range(from, to));
      let logs: any[];
      try { logs = await selectPicks('lot_code, net_weight_kg, fum_status'); }
      catch (e: any) { if (/fum_status/.test(e?.message || '')) logs = await selectPicks('lot_code, net_weight_kg'); else throw e; }

      const kg = new Map<string, number>();
      const bx = new Map<string, number>();
      const ok = new Map<string, number>();
      logs.forEach(l => {
        kg.set(l.lot_code, (kg.get(l.lot_code) || 0) + Number(l.net_weight_kg));
        bx.set(l.lot_code, (bx.get(l.lot_code) || 0) + 1);
        if (l.fum_status === 'OK') ok.set(l.lot_code, (ok.get(l.lot_code) || 0) + Number(l.net_weight_kg));
      });

      // Picking manual (tabel baru; kalau belum ada cukup diabaikan)
      const man = new Map<string, number>();
      const { data: manRows, error: manErr } = await supabase.from('vcp-op-picking_manual').select('lot_code, qty_ct').eq('wh_id', w).eq('order_date', d);
      if (manErr) console.error('Load picking_manual:', manErr); else (manRows || []).forEach(r => man.set(r.lot_code, Number(r.qty_ct)));

      // Inventory Balance untuk LOT di order ini + LOT yang sudah ter-scan
      try {
        await ibRef.current.ensureLots(Array.from(new Set([...t.keys(), ...kg.keys()])));
        setIbTick(x => x + 1);
      } catch (e) { console.error('Load IB:', e); }

      applyOk(ok);
      applyManual(man);
      setDrafts({});
      applyTargets(t);
      applyPicked(kg, bx);
      setLoaded(true);
    } catch (err: any) {
      notify(`❌ Gagal load data picking: ${err.message}`, 'error');
    }
  }, [allOrders, notify]);

  const resetData = () => { applyTargets(new Map()); applyPicked(new Map(), new Map()); applyOk(new Map()); applyManual(new Map()); setDrafts({}); setLoaded(false); };
  const onWh = (v: string) => { setWh(v); setWeek(''); setDate(''); resetData(); };
  const onWeek = (v: string) => { setWeek(v); setDate(''); resetData(); };
  const onDate = (v: string) => { setDate(v); resetData(); if (v) loadData(wh, v); setTimeout(() => inputRef.current?.focus(), 0); };

  // --- tabel per LOT (picked = hasil scan + isian manual) ---
  const rows = useMemo(() => {
    const lots = Array.from(new Set([...targets.keys(), ...pickedKg.keys(), ...manual.keys()]));
    const list = lots.map(lot => {
      const target = targets.get(lot);
      const std = skuRef.current.get(lot) || 200;
      const scanCt = +((pickedKg.get(lot) || 0) / std).toFixed(2);
      const manualCt = +(manual.get(lot) || 0).toFixed(2);
      const picked = +(scanCt + manualCt).toFixed(2);
      let status: RowStatus;
      if (target === undefined) status = 'DI LUAR ORDER';
      else if (picked > target + 0.05) status = 'OVER';
      else if (picked >= target - 0.05) status = 'DONE';
      else if (picked > 0) status = 'PARTIAL';
      else status = 'OPEN';
      return { lot, target: target ?? 0, picked, scanCt, manualCt, boxes: boxes.get(lot) || 0, status, inOrder: target !== undefined };
    });
    return list.sort((a, b) => Number(b.inOrder) - Number(a.inOrder) || a.lot.localeCompare(b.lot));
  }, [targets, pickedKg, boxes, manual, skuRef]);

  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const fulfilled = rows.filter(r => r.inOrder).reduce((s, r) => s + Math.min(r.picked, r.target), 0);
  const extraCT = rows.filter(r => !r.inOrder || r.picked > r.target).reduce((s, r) => s + (r.inOrder ? r.picked - r.target : r.picked), 0);
  const totalBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  const totalManual = rows.reduce((s, r) => s + r.manualCt, 0);
  const pct = totalTarget > 0 ? Math.round((fulfilled / totalTarget) * 100) : 0;

  // --- simpan 1 scan picking ---
  const saveScan = useCallback(async (parsed: any, w: string, d: string, fum: FumCheck | null) => {
    const base = {
      wh_id: w, order_date: d, serial_number: parsed.serialNumber, lot_code: parsed.lotCode,
      pmi_run_no: parsed.pmiRunNo, case_number: parsed.caseNo,
      gross_weight_kg: parsed.grossWeight, net_weight_kg: parsed.netWeight,
      moisture: parsed.moisture, grade_code: parsed.gradeCode,
      scanned_by: checkerName.trim() || 'anon',
    };
    let { error } = await supabase.from('vcp-op-picking_logs')
      .insert([{ ...base, fumigation_date: fum?.fumDate ?? null, aging_days: fum?.ageDays ?? null, fum_status: fum?.status ?? null }]);
    let sqlMissing = false;
    if (error && /fum_status|fumigation_date|aging_days/.test(error.message)) { // SQL fumigasi belum dijalankan: operasional tetap jalan
      sqlMissing = true;
      ({ error } = await supabase.from('vcp-op-picking_logs').insert([base]));
    }
    if (error) {
      if ((error as any).code === '23505') return notify('⚠️ SN sudah pernah di-scan picking pada tanggal ini (tidak dihitung dobel).', 'warning');
      return notify(`❌ DB Error: ${error.message}`, 'error');
    }

    const std = skuRef.current.get(parsed.lotCode) || 200;
    const curKg = pickedRef.current.get(parsed.lotCode) || 0;
    const target = targetsRef.current.get(parsed.lotCode);
    const projected = (curKg + parsed.netWeight) / std + (manualRef.current.get(parsed.lotCode) || 0);

    const kg = new Map(pickedRef.current);
    kg.set(parsed.lotCode, curKg + parsed.netWeight);
    setBoxes(prev => { const n = new Map<string, number>(prev); n.set(parsed.lotCode, (n.get(parsed.lotCode) || 0) + 1); return n; });
    pickedRef.current = kg;
    setPickedKg(kg);
    if (fum?.status === 'OK') { const ok = new Map(okKgRef.current); ok.set(parsed.lotCode, (ok.get(parsed.lotCode) || 0) + parsed.netWeight); applyOk(ok); }

    if (sqlMissing) notify(`⚠️ [${parsed.lotCode}] tersimpan, tapi kolom fumigasi belum ada di database (jalankan SQL inventory).`, 'warning');
    else if (fum?.status === 'EXPIRED') notify(`⚠️ [${parsed.lotCode}] tersimpan: fumigasi > ${fumLimitRef.current} hari (${fum.ageDays} hr)`, 'warning');
    else if (fum?.status === 'UNKNOWN' || fum?.status === 'NOT_IN_IB') notify(`⚠️ [${parsed.lotCode}] tersimpan, ${fum.message}`, 'warning');
    else if (target === undefined) notify(`⚠️ LOT [${parsed.lotCode}] DI LUAR ORDER tanggal ini (tersimpan).`, 'warning');
    else if (projected > target + 0.05) notify(`⚠️ OVER! LOT [${parsed.lotCode}] melebihi target (tersimpan).`, 'warning');
    else notify(`✅ [${parsed.lotCode}] OK`, 'success');
  }, [checkerName, notify, skuRef]);

  // --- scan: tidak ada yang memblokir kecuali SN dobel; umur fumigasi > batas memunculkan popup konfirmasi ---
  const processScan = useCallback(async (raw: string, w: string, d: string) => {
    const parsed = parseHMSBarcode(raw);
    if (!parsed.isValid) return notify(`❌ ${parsed.message}`, 'error');

    // Umur fumigasi sampai tanggal order/pengiriman (d)
    let fum: FumCheck | null = null;
    if (ibRef.current.meta) {
      try { await ibRef.current.ensureLots([parsed.lotCode]); } catch (e) { console.error('ensure IB:', e); }
      fum = checkFumigation(ibRef.current.lookup(parsed.serialNumber), d, fumLimitRef.current);
    }
    if (fum?.status === 'EXPIRED') {
      const f = fum;
      notify('⚠️ Fumigasi melebihi batas!', 'warning');
      setPending({
        title: `⚠️ FUMIGASI > ${fumLimitRef.current} HARI`,
        message: `SN [${parsed.serialNumber}]\n${f.message}\n\nTetap catat sebagai picked?`,
        onConfirm: () => saveScan(parsed, w, d, f),
      });
      return;
    }
    await saveScan(parsed, w, d, fum);
  }, [notify, saveScan]);

  // --- picking MANUAL (tanpa scan): isi qty CT per LOT ---
  const commitManual = async (lot: string, qtyRaw: number) => {
    if (!wh || !date) return;
    const q = Math.max(0, +qtyRaw.toFixed(2));
    if (isNaN(q)) return;
    const prevQ = manualRef.current.get(lot) || 0;
    if (Math.abs(q - prevQ) < 0.001) { setDrafts(p => { const n = { ...p }; delete n[lot]; return n; }); return; }

    // Umur fumigasi tidak bisa dicek per box tanpa scan; bandingkan dengan stok IB yang masih valid
    const hasIb = !!ibRef.current.meta;
    const st = hasIb ? ibRef.current.stock(lot, date, fumLimitRef.current) : null;
    const scanOkCt = (okKgRef.current.get(lot) || 0) / stdOf(lot);
    let flag: 'OK' | 'EXCEEDS_ELIGIBLE' | 'NO_IB' = st && st.total > 0 ? 'OK' : 'NO_IB';
    if (st && st.total > 0 && q > 0 && q + scanOkCt > st.eligible + 0.05) flag = 'EXCEEDS_ELIGIBLE';

    const doSave = async () => {
      const { error } = await supabase.from('vcp-op-picking_manual').upsert({
        wh_id: wh, order_date: date, lot_code: lot, qty_ct: q, eligible_ct: st ? st.eligible : null, fum_flag: flag,
        updated_by: checkerName.trim() || 'anon', updated_at: new Date().toISOString(),
      }, { onConflict: 'wh_id,order_date,lot_code' });
      if (error) return notify(`❌ Gagal simpan manual (SQL sudah dijalankan?): ${error.message}`, 'error');
      const m = new Map(manualRef.current); if (q > 0) m.set(lot, q); else m.delete(lot);
      applyManual(m);
      setDrafts(p => { const n = { ...p }; delete n[lot]; return n; });
      if (flag === 'EXCEEDS_ELIGIBLE') notify(`⚠️ [${lot}] manual ${q} CT tersimpan, melebihi stok valid IB`, 'warning');
      else if (flag === 'NO_IB') notify(`⚠️ [${lot}] manual ${q} CT tersimpan (LOT tidak ada di IB / IB belum di-upload)`, 'warning');
      else notify(`✅ [${lot}] manual ${q} CT tersimpan`, 'success');
    };

    if (flag === 'EXCEEDS_ELIGIBLE' && st) {
      setPending({
        title: '⚠️ STOK VALID IB KURANG',
        message: `LOT ${lot}: manual ${q} CT + scan valid ${+scanOkCt.toFixed(2)} CT = ${+(q + scanOkCt).toFixed(2)} CT, tetapi stok IB yang valid (fumigasi ≤ ${fumLimitRef.current} hari s/d ${fmtDate(date)}) hanya ${st.eligible} CT.\n\nSebagian material kemungkinan berumur > ${fumLimitRef.current} hari atau tanpa tanggal fumigasi.\n\nTetap simpan?`,
        onConfirm: doSave,
      });
      return;
    }
    await doSave();
  };

  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = e.currentTarget.value.trim();
    e.currentTarget.value = '';
    if (!raw || pending) return;
    if (!wh || !date) return notify('⚠️ Pilih WHID dan Tanggal Order dulu!', 'warning');
    const w = wh, d = date;
    queueRef.current = queueRef.current.then(() => processScan(raw, w, d)).catch(() => {});
  };

  const handleRootClick = (e: React.MouseEvent) => {
    if (!active || showLogs || pending || mode !== 'scan') return;
    if ((e.target as HTMLElement).closest('button,select,input,textarea,a,label')) return;
    inputRef.current?.focus();
  };

  const toggleKeyboard = () => {
    setKeyboardOn(v => !v);
    setTimeout(() => { inputRef.current?.blur(); inputRef.current?.focus(); }, 0);
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold disabled:opacity-50';
  const lblCls = 'block text-xs font-bold mb-1 text-gray-500';
  const badge = (s: RowStatus) =>
    s === 'DONE' ? 'bg-green-100 text-green-900' :
    s === 'PARTIAL' ? 'bg-orange-100 text-orange-900' :
    s === 'OPEN' ? 'bg-gray-200 text-gray-600' : 'bg-red-100 text-red-800';

  return (
    <div onClick={handleRootClick}>
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-3">
        <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
          <span className="font-bold text-base text-gray-900">Picking Summary</span>
          {loaded && (
            <div className="flex gap-2">
              <div className="flex rounded-md overflow-hidden border border-gray-300">
                <button onClick={() => { setMode('scan'); setTimeout(() => inputRef.current?.focus(), 0); }} className={`px-3 min-h-10 text-xs font-bold ${mode === 'scan' ? 'bg-gray-900 text-white' : 'bg-white'}`}>📷 Scan</button>
                <button onClick={() => setMode('manual')} className={`px-3 min-h-10 text-xs font-bold ${mode === 'manual' ? 'bg-gray-900 text-white' : 'bg-white'}`}>✍️ Manual</button>
              </div>
              <button onClick={() => loadData(wh, date)} className="px-3 min-h-10 rounded-md bg-white border border-gray-300 text-xs font-bold">🔄 Refresh</button>
              <button onClick={() => setShowLogs(true)} className="px-3 min-h-10 rounded-md bg-amber-600 text-white text-xs font-bold">📋 Log</button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={lblCls}>1. WAREHOUSE (WHID):</label>
            <select value={wh} onChange={e => onWh(e.target.value)} className={selCls}>
              <option value="">-- Pilih WHID --</option>
              {whList.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>2. WEEK:</label>
            <select value={week} onChange={e => onWeek(e.target.value)} disabled={!wh} className={selCls}>
              <option value="">- Pilih Week -</option>
              {weeks.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <label className={lblCls}>3. TANGGAL ORDER:</label>
            <select value={date} onChange={e => onDate(e.target.value)} disabled={!week} className={selCls}>
              <option value="">- Pilih Tanggal -</option>
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
        </div>

        {loaded && (
          <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span><strong>Target:</strong> {totalTarget.toFixed(1)} CT</span>
              <span><strong>Terpenuhi:</strong> {fulfilled.toFixed(1)} CT ({pct}%)</span>
              <span><strong>Total scan:</strong> {totalBoxes} box</span>
              {totalManual > 0 && <span><strong>Manual:</strong> {+totalManual.toFixed(2)} CT</span>}
            </div>
            <div className="mt-1 text-[11px]" data-tick={ibTick}>
              {ibMeta
                ? <span className={ibStaleness(ibMeta.as_of_date).stale ? 'text-red-700 font-bold' : 'text-gray-500'}>📦 IB per {fmtDate(ibMeta.as_of_date)} · batas fumigasi {fumLimit} hari s/d {fmtDate(date)}{ibStaleness(ibMeta.as_of_date).stale ? ' · ⚠️ IB basi, update di Admin' : ''}</span>
                : <span className="text-gray-500">IB belum di-upload: pengecekan fumigasi nonaktif.</span>}
            </div>
            {extraCT > 0.05 && (
              <div className="mt-1 text-red-700 font-semibold">⚠️ Kelebihan / di luar order: {extraCT.toFixed(2)} CT</div>
            )}
            <div className="bg-gray-200 rounded-md h-3.5 overflow-hidden mt-2">
              <div className={`h-full transition-all ${pct >= 100 ? 'bg-green-700' : 'bg-gray-900'}`} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        )}
      </div>

      {/* INPUT SCAN */}
      <div className={`sticky top-0 z-50 bg-neutral-900 border-2 border-neutral-700 focus-within:border-amber-500 rounded-lg p-3 mb-3 shadow-lg ${mode === 'scan' ? '' : 'hidden'}`}>
        <div className="flex justify-between items-center mb-1.5">
          <label className="text-xs font-bold text-amber-200">Scan picking (31 karakter)</label>
          <button type="button" onClick={toggleKeyboard}
            className={`min-h-8 px-2.5 text-xs font-semibold rounded-md border ${keyboardOn ? 'bg-amber-500 border-amber-500 text-gray-900' : 'border-neutral-500 text-neutral-200'}`}>
            ⌨ Keyboard
          </button>
        </div>
        <input
          ref={inputRef}
          type="text"
          onKeyDown={handleScan}
          inputMode={keyboardOn ? 'text' : 'none'}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="Siap scan..."
          className="w-full min-h-14 border-2 border-amber-500 rounded-lg text-center font-mono font-bold text-xl tracking-wider text-gray-900 focus:outline-none focus:ring-4 focus:ring-amber-300"
        />
      </div>

      {/* TABEL PER LOT */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-100 p-2 font-bold text-xs text-gray-700">Progress Picking per LOT (target = total order tanggal ini)</div>
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-900 text-white sticky top-0">
              <tr><th className="p-2">LOT</th><th className="p-2">TARGET</th><th className="p-2">PICKED</th><th className="p-2">SISA</th><th className="p-2">IB VALID</th><th className="p-2">STATUS</th>{mode === 'manual' && <th className="p-2">MANUAL (CT)</th>}</tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="p-3 text-center text-gray-400">
                  {loaded ? 'Tidak ada order / scan pada tanggal ini' : 'Pilih WHID dan Tanggal Order'}
                </td></tr>
              )}
              {rows.map(r => {
                const sisa = +(r.target - r.picked).toFixed(2);
                const st = ibMeta && date ? ibRef.current.stock(r.lot, date, fumLimit) : null;
                const need = r.inOrder ? Math.max(0, r.target - r.scanCt) : 0;
                const draft = drafts[r.lot];
                const commit = () => { if (draft !== undefined) { const n = parseFloat(draft); if (!isNaN(n)) commitManual(r.lot, n); else setDrafts(p => { const x = { ...p }; delete x[r.lot]; return x; }); } };
                return (
                  <tr key={r.lot} className="border-b align-top">
                    <td className="p-2 font-bold">{r.lot}</td>
                    <td className="p-2">{r.inOrder ? `${r.target} CT` : '-'}</td>
                    <td className="p-2 text-blue-600 font-bold">{r.picked} CT <span className="text-gray-400 font-normal">({r.boxes} bx{r.manualCt > 0 ? ` + ${r.manualCt} man` : ''})</span></td>
                    <td className={`p-2 font-semibold ${r.inOrder && sisa < -0.05 ? 'text-red-600' : ''}`}>{r.inOrder ? `${sisa} CT` : '-'}</td>
                    <td className={`p-2 font-semibold ${st && r.inOrder && st.eligible + 0.05 < need ? 'text-red-600' : 'text-green-700'}`} title={st ? `Total ${st.total} · >${fumLimit}hr ${st.expired} · tanpa tgl ${st.noDate}` : ''}>
                      {st ? st.eligible : '-'}{st && st.total > st.eligible && <span className="block text-[10px] text-gray-400 font-normal">dari {st.total}</span>}
                    </td>
                    <td className="p-2"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold ${badge(r.status)}`}>{r.status}</span></td>
                    {mode === 'manual' && (
                      <td className="p-2 whitespace-nowrap">
                        <input type="number" inputMode="decimal" step="0.25" min="0" value={draft ?? String(r.manualCt)}
                          onChange={e => setDrafts(p => ({ ...p, [r.lot]: e.target.value }))} onBlur={commit}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                          className="w-20 min-h-10 border-2 border-gray-300 rounded-md px-2 font-bold text-sm" />
                        {r.inOrder && <button onClick={() => commitManual(r.lot, need)} disabled={need <= 0.05 && r.manualCt === need} title="Isi sisa target dengan manual" className="ml-1 px-2 min-h-10 rounded-md bg-green-700 text-white text-xs font-bold disabled:opacity-40">✓ Penuh</button>}
                        {r.manualCt > 0 && <button onClick={() => commitManual(r.lot, 0)} className="ml-1 px-2 min-h-10 rounded-md border border-gray-300 bg-white text-xs font-bold">↺</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pending && (
        <BypassModal title={pending.title} message={pending.message} confirmLabel="TETAP SIMPAN (ENTER)"
          onConfirm={async () => { const p = pending; setPending(null); await p.onConfirm(); setTimeout(() => inputRef.current?.focus(), 0); }}
          onCancel={() => { setPending(null); setTimeout(() => inputRef.current?.focus(), 0); }} />
      )}

      {showLogs && (
        <PickingLogsModal
          whId={wh}
          orderDate={date}
          lots={rows.map(r => r.lot)}
          notify={notify}
          onClose={() => { setShowLogs(false); inputRef.current?.focus(); }}
          onChanged={() => loadData(wh, date)}
        />
      )}
    </div>
  );
}