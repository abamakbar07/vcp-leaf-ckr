/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseHMSBarcode, getISOWeek } from '@/lib/utils';
import PickingLogsModal from './PickingLogsModal';
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
  const [skuMap, setSkuMap] = useState<Map<string, number>>(() => new Map());

  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const targetsRef = useRef(targets);
  const pickedRef = useRef(pickedKg);

  const applyTargets = (m: Map<string, number>) => { targetsRef.current = m; setTargets(m); };
  const applyPicked = (kg: Map<string, number>, bx: Map<string, number>) => { pickedRef.current = kg; setPickedKg(kg); setBoxes(bx); };

  useEffect(() => { if (active) setTimeout(() => inputRef.current?.focus(), 0); }, [active]);
  useEffect(() => { setSkuMap(new Map(skuRef.current)); }, [allOrders, skuRef]);

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

      const logs = await fetchPaged<any>((from, to) =>
        supabase.from('vcp-op-picking_logs').select('lot_code, net_weight_kg')
          .eq('wh_id', w).eq('order_date', d).order('id').range(from, to));

      const kg = new Map<string, number>();
      const bx = new Map<string, number>();
      logs.forEach(l => {
        kg.set(l.lot_code, (kg.get(l.lot_code) || 0) + Number(l.net_weight_kg));
        bx.set(l.lot_code, (bx.get(l.lot_code) || 0) + 1);
      });

      applyTargets(t);
      applyPicked(kg, bx);
      setLoaded(true);
    } catch (err: any) {
      notify(`❌ Gagal load data picking: ${err.message}`, 'error');
    }
  }, [allOrders, notify]);

  const resetData = () => { applyTargets(new Map()); applyPicked(new Map(), new Map()); setLoaded(false); };
  const onWh = (v: string) => { setWh(v); setWeek(''); setDate(''); resetData(); };
  const onWeek = (v: string) => { setWeek(v); setDate(''); resetData(); };
  const onDate = (v: string) => { setDate(v); resetData(); if (v) loadData(wh, v); setTimeout(() => inputRef.current?.focus(), 0); };

  // --- tabel per LOT ---
  const rows = useMemo(() => {
    const lots = Array.from(new Set([...targets.keys(), ...pickedKg.keys()]));
    const list = lots.map(lot => {
      const target = targets.get(lot);
      const std = skuMap.get(lot) || 200;
      const picked = +((pickedKg.get(lot) || 0) / std).toFixed(2);
      let status: RowStatus;
      if (target === undefined) status = 'DI LUAR ORDER';
      else if (picked > target + 0.05) status = 'OVER';
      else if (picked >= target - 0.05) status = 'DONE';
      else if (picked > 0) status = 'PARTIAL';
      else status = 'OPEN';
      return { lot, target: target ?? 0, picked, boxes: boxes.get(lot) || 0, status, inOrder: target !== undefined };
    });
    return list.sort((a, b) => Number(b.inOrder) - Number(a.inOrder) || a.lot.localeCompare(b.lot));
  }, [targets, pickedKg, boxes, skuMap]);

  const totalTarget = rows.reduce((s, r) => s + r.target, 0);
  const fulfilled = rows.filter(r => r.inOrder).reduce((s, r) => s + Math.min(r.picked, r.target), 0);
  const extraCT = rows.filter(r => !r.inOrder || r.picked > r.target).reduce((s, r) => s + (r.inOrder ? r.picked - r.target : r.picked), 0);
  const totalBoxes = rows.reduce((s, r) => s + r.boxes, 0);
  const pct = totalTarget > 0 ? Math.round((fulfilled / totalTarget) * 100) : 0;

  // --- scan: tidak ada yang memblokir kecuali SN dobel di tanggal + WH yang sama ---
  const processScan = useCallback(async (raw: string, w: string, d: string) => {
    const parsed = parseHMSBarcode(raw);
    if (!parsed.isValid) return notify(`❌ ${parsed.message}`, 'error');

    const { error } = await supabase.from('vcp-op-picking_logs').insert([{
      wh_id: w, order_date: d, serial_number: parsed.serialNumber, lot_code: parsed.lotCode,
      pmi_run_no: parsed.pmiRunNo, case_number: parsed.caseNo,
      gross_weight_kg: parsed.grossWeight, net_weight_kg: parsed.netWeight,
      moisture: parsed.moisture, grade_code: parsed.gradeCode,
      scanned_by: checkerName.trim() || 'anon',
    }]);
    if (error) {
      if ((error as any).code === '23505') return notify('⚠️ SN sudah pernah di-scan picking pada tanggal ini (tidak dihitung dobel).', 'warning');
      return notify(`❌ DB Error: ${error.message}`, 'error');
    }

    const std = skuRef.current.get(parsed.lotCode) || 200;
    const curKg = pickedRef.current.get(parsed.lotCode) || 0;
    const target = targetsRef.current.get(parsed.lotCode);
    const projected = (curKg + parsed.netWeight) / std;

    const kg = new Map(pickedRef.current);
    kg.set(parsed.lotCode, curKg + parsed.netWeight);
    setBoxes(prev => { const n = new Map(prev); n.set(parsed.lotCode, (n.get(parsed.lotCode) || 0) + 1); return n; });
    pickedRef.current = kg;
    setPickedKg(kg);

    if (target === undefined) notify(`⚠️ LOT [${parsed.lotCode}] DI LUAR ORDER tanggal ini (tersimpan).`, 'warning');
    else if (projected > target + 0.05) notify(`⚠️ OVER! LOT [${parsed.lotCode}] melebihi target (tersimpan).`, 'warning');
    else notify(`✅ [${parsed.lotCode}] OK`, 'success');
  }, [checkerName, notify, skuRef]);

  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = e.currentTarget.value.trim();
    e.currentTarget.value = '';
    if (!raw) return;
    if (!wh || !date) return notify('⚠️ Pilih WHID dan Tanggal Order dulu!', 'warning');
    const w = wh, d = date;
    queueRef.current = queueRef.current.then(() => processScan(raw, w, d)).catch(() => {});
  };

  const handleRootClick = (e: React.MouseEvent) => {
    if (!active || showLogs) return;
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
      <div className="sticky top-0 z-50 bg-neutral-900 border-2 border-neutral-700 focus-within:border-amber-500 rounded-lg p-3 mb-3 shadow-lg">
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
              <tr><th className="p-2">LOT</th><th className="p-2">TARGET</th><th className="p-2">PICKED</th><th className="p-2">SISA</th><th className="p-2">STATUS</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className="p-3 text-center text-gray-400">
                  {loaded ? 'Tidak ada order / scan pada tanggal ini' : 'Pilih WHID dan Tanggal Order'}
                </td></tr>
              )}
              {rows.map(r => {
                const sisa = +(r.target - r.picked).toFixed(2);
                return (
                  <tr key={r.lot} className="border-b">
                    <td className="p-2 font-bold">{r.lot}</td>
                    <td className="p-2">{r.inOrder ? `${r.target} CT` : '-'}</td>
                    <td className="p-2 text-blue-600 font-bold">{r.picked} CT <span className="text-gray-400 font-normal">({r.boxes} bx)</span></td>
                    <td className={`p-2 font-semibold ${r.inOrder && sisa < -0.05 ? 'text-red-600' : ''}`}>{r.inOrder ? `${sisa} CT` : '-'}</td>
                    <td className="p-2"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold ${badge(r.status)}`}>{r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

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