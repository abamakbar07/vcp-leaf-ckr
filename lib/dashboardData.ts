/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/dashboardData.ts - ambil & hitung semua data dashboard untuk satu tanggal (+ filter WH)
import { supabase } from './supabaseClient';
import { fetchByPo, fetchPaged, whOf } from './db';

export type Stage = 'OPEN' | 'GROUPING' | 'QC' | 'MONITORING' | 'READY' | 'LOADED';
export type PickStatus = 'OPEN' | 'PARTIAL' | 'DONE' | 'OVER' | 'DI LUAR ORDER';

export interface LotLine { lot: string; target: number; scanned: number; loaded: number }

export interface PoRow {
  key: string; po: string; wh: string; date: string; rit: string; blend: string; eta: string;
  target: number; scanned: number; loaded: number;
  boxes: number; loadedBoxes: number; bypassed: number;
  grouping: { done: boolean; at: string | null; by: string | null };
  qc: { done: boolean; at: string | null; by: string | null };
  evidence: { has: boolean; photos: number; kainMori: string | null; by: string | null };
  dispatchId: number | null;
  lots: LotLine[];
  stage: Stage;
  notes: string[];
}

export interface RitRow {
  rit: string; wh: string; poCount: number; target: number; scanned: number; loaded: number;
  groupingDone: number; qcDone: number;
  dispatch: { id: number; ritNumber: string; vehicle: string; photos: number; by: string | null } | null;
}

export interface LotRow { lot: string; target: number; picked: number; pickedBoxes: number; scanned: number; loaded: number; pickStatus: PickStatus }

export interface PickingSummary { hasData: boolean; target: number; fulfilled: number; extra: number; boxes: number }

export interface DashboardData {
  fetchedAt: Date; date: string; wh: string;
  rows: PoRow[]; rits: RitRow[]; lots: LotRow[]; picking: PickingSummary;
  tableErrors: string[];
}

const r2 = (n: number) => +n.toFixed(2);

export async function fetchOrderFilters(): Promise<{ wh_id: string | null; arrival_date: string }[]> {
  return fetchPaged<any>((f, t) => supabase.from('vcp-op-orders').select('wh_id, arrival_date').order('arrival_date', { ascending: false }).order('po_number').range(f, t));
}

export async function loadSkuMap(): Promise<Map<string, number>> {
  const { data } = await supabase.from('vcp-op-sku_master').select('lot_code, std_net_weight_kg');
  const m = new Map<string, number>();
  (data || []).forEach(r => m.set(r.lot_code, Number(r.std_net_weight_kg)));
  return m;
}

export async function fetchDashboard(date: string, wh: string, sku: Map<string, number>): Promise<DashboardData> {
  const tableErrors: string[] = [];
  const std = (lot: string) => sku.get(lot) || 200;

  const allOrders = await fetchPaged<any>((f, t) => supabase.from('vcp-op-orders').select('*')
    .eq('arrival_date', date).order('po_number').order('arrival_time').range(f, t));
  const orders = allOrders.filter(o => wh === 'ALL' || whOf(o) === wh);
  const poList = Array.from(new Set(orders.map(o => o.po_number)));
  const pk = (o: any) => `${o.po_number}|${o.arrival_time}`;
  const pairSet = new Set(orders.map(pk));

  // Tabel yang mungkin belum dibuat tidak boleh merusak dashboard
  const safe = async <T,>(label: string, fn: () => Promise<T[]>): Promise<T[]> => {
    try { return await fn(); } catch (e: any) { tableErrors.push(`${label}: ${e.message}`); return []; }
  };

  const dispatchIds = Array.from(new Set(orders.map(o => o.dispatch_id).filter(Boolean)));

  const [items, logs, statuses, monitors, picks, sessions] = await Promise.all([
    safe('order_items', () => fetchByPo<any>('vcp-op-order_items', 'po_number, arrival_time, lot_code, qty_usage_ct', poList, ['po_number', 'lot_code'])),
    safe('scan_logs', () => fetchByPo<any>('vcp-op-scan_logs', 'po_number, arrival_time, lot_code, net_weight_kg, is_loaded, is_bypassed', poList, ['id'])),
    safe('po_status', () => fetchByPo<any>('vcp-op-po_status', '*', poList, ['po_number'])),
    safe('staging_monitoring_logs', () => fetchByPo<any>('vcp-op-staging_monitoring_logs', '*', poList, ['po_number', 'arrival_time'])),
    safe('picking_logs', () => fetchPaged<any>((f, t) => {
      let q: any = supabase.from('vcp-op-picking_logs').select('wh_id, lot_code, net_weight_kg').eq('order_date', date);
      if (wh !== 'ALL') q = q.eq('wh_id', wh);
      return q.order('id').range(f, t);
    })),
    safe<any>('dispatch_sessions', async () => {
      if (dispatchIds.length === 0) return [];
      const { data, error } = await supabase.from('vcp-op-outbound_dispatch_sessions').select('*').in('id', dispatchIds);
      if (error) throw error;
      return data || [];
    }),
  ]);

  // ---- index per PO + RIT ----
  const targetByPo = new Map<string, Map<string, number>>();
  items.filter(i => pairSet.has(`${i.po_number}|${i.arrival_time}`)).forEach(i => {
    const k = `${i.po_number}|${i.arrival_time}`;
    const m = targetByPo.get(k) || new Map<string, number>();
    m.set(i.lot_code, (m.get(i.lot_code) || 0) + Number(i.qty_usage_ct));
    targetByPo.set(k, m);
  });

  type Agg = { ct: number; loadedCt: number; boxes: number; loadedBoxes: number };
  const scanByPo = new Map<string, Map<string, Agg>>();
  const bypassByPo = new Map<string, number>();
  logs.filter(l => pairSet.has(`${l.po_number}|${l.arrival_time}`)).forEach(l => {
    const k = `${l.po_number}|${l.arrival_time}`;
    const m = scanByPo.get(k) || new Map<string, Agg>();
    const a = m.get(l.lot_code) || { ct: 0, loadedCt: 0, boxes: 0, loadedBoxes: 0 };
    const ct = Number(l.net_weight_kg) / std(l.lot_code);
    a.ct += ct; a.boxes += 1;
    if (l.is_loaded) { a.loadedCt += ct; a.loadedBoxes += 1; }
    m.set(l.lot_code, a);
    scanByPo.set(k, m);
    if (l.is_bypassed) bypassByPo.set(k, (bypassByPo.get(k) || 0) + 1);
  });

  const statusByPo = new Map<string, any>();
  statuses.forEach(s => statusByPo.set(`${s.po_number}|${s.arrival_time}`, s));
  const monitorByPo = new Map<string, any>();
  monitors.forEach(m => monitorByPo.set(`${m.po_number}|${m.arrival_time}`, m)); // terakhir menang
  const sessionById = new Map<number, any>();
  sessions.forEach(s => sessionById.set(s.id, s));

  // ---- baris per PO ----
  const rows: PoRow[] = orders.map(o => {
    const key = pk(o);
    const tMap = targetByPo.get(key) || new Map<string, number>();
    const sMap = scanByPo.get(key) || new Map<string, Agg>();
    const lotNames = Array.from(new Set([...tMap.keys(), ...sMap.keys()])).sort();
    const lots: LotLine[] = lotNames.map(lot => ({
      lot, target: r2(tMap.get(lot) || 0), scanned: r2(sMap.get(lot)?.ct || 0), loaded: r2(sMap.get(lot)?.loadedCt || 0),
    }));
    const target = r2(lots.reduce((s, l) => s + l.target, 0));
    const scanned = r2(lots.reduce((s, l) => s + l.scanned, 0));
    const loaded = r2(lots.reduce((s, l) => s + l.loaded, 0));
    const boxes = Array.from(sMap.values()).reduce((s, a) => s + a.boxes, 0);
    const loadedBoxes = Array.from(sMap.values()).reduce((s, a) => s + a.loadedBoxes, 0);

    const st = statusByPo.get(key);
    const mon = monitorByPo.get(key);
    const photos = mon ? ['photo_mori_url', 'photo_serrico_out_url', 'photo_serrico_in_url'].filter(k => !!mon[k]).length : 0;

    const grouping = { done: !!st?.grouping_done, at: st?.grouping_at || null, by: st?.grouping_by || null };
    const qc = { done: !!st?.qc_done, at: st?.qc_at || null, by: st?.qc_by || null };

    let stage: Stage = 'OPEN';
    if (target > 0 && loaded >= target - 0.05) stage = 'LOADED';
    else if (target > 0 && scanned >= target - 0.05) stage = 'READY';
    else if (scanned > 0) stage = 'MONITORING';
    else if (qc.done) stage = 'QC';
    else if (grouping.done) stage = 'GROUPING';

    const notes: string[] = [];
    if (scanned > 0 && !grouping.done) notes.push('Grouping belum dicentang');
    if (scanned > 0 && !qc.done) notes.push('QC belum dicentang');
    if (stage === 'READY' && !mon) notes.push('Evidence monitoring belum diisi');
    if (mon && photos < 3) notes.push(`Foto monitoring ${photos}/3`);
    const byp = bypassByPo.get(key) || 0;
    if (byp > 0) notes.push(`${byp} scan bypass (SN duplikat PO lain)`);
    if (boxes > 0 && loadedBoxes > 0 && loadedBoxes < boxes && stage === 'LOADED') notes.push('Loaded ≥ target tapi ada box belum divalidasi');

    return {
      key, po: o.po_number, wh: whOf(o), date: o.arrival_date, rit: o.arrival_time || '-', blend: o.blend_code || '-', eta: o.arrival_time || '',
      target, scanned, loaded, boxes, loadedBoxes, bypassed: byp, grouping, qc,
      evidence: { has: !!mon, photos, kainMori: mon?.nomor_kain_mori || null, by: mon?.inspected_by || null },
      dispatchId: o.dispatch_id || null, lots, stage, notes,
    };
  });

  // ---- per RIT / armada ----
  const ritMap = new Map<string, RitRow>();
  rows.forEach(r => {
    const k = `${r.wh}|${r.rit}`;
    const cur = ritMap.get(k) || { rit: r.rit, wh: r.wh, poCount: 0, target: 0, scanned: 0, loaded: 0, groupingDone: 0, qcDone: 0, dispatch: null };
    cur.poCount += 1; cur.target += r.target; cur.scanned += r.scanned; cur.loaded += r.loaded;
    if (r.grouping.done) cur.groupingDone += 1;
    if (r.qc.done) cur.qcDone += 1;
    if (!cur.dispatch && r.dispatchId && sessionById.has(r.dispatchId)) {
      const s = sessionById.get(r.dispatchId);
      cur.dispatch = {
        id: s.id, ritNumber: s.rit_number || '-', vehicle: s.vehicle_number || '-', by: s.created_by || null,
        photos: ['photo_trap_out_before_url', 'photo_trap_in_before_url', 'photo_trap_out_after_url', 'photo_trap_in_after_url'].filter(k2 => !!s[k2]).length,
      };
    }
    ritMap.set(k, cur);
  });
  const rits = Array.from(ritMap.values()).map(r => ({ ...r, target: r2(r.target), scanned: r2(r.scanned), loaded: r2(r.loaded) }))
    .sort((a, b) => a.rit.localeCompare(b.rit));

  // ---- picking (level tanggal) vs target tanggal vs monitoring ----
  const dateTarget = new Map<string, number>();
  items.filter(i => pairSet.has(`${i.po_number}|${i.arrival_time}`)).forEach(i => dateTarget.set(i.lot_code, (dateTarget.get(i.lot_code) || 0) + Number(i.qty_usage_ct)));
  const pickKg = new Map<string, number>();
  const pickBx = new Map<string, number>();
  picks.forEach(p => { pickKg.set(p.lot_code, (pickKg.get(p.lot_code) || 0) + Number(p.net_weight_kg)); pickBx.set(p.lot_code, (pickBx.get(p.lot_code) || 0) + 1); });
  const monScanned = new Map<string, number>();
  const monLoaded = new Map<string, number>();
  rows.forEach(r => r.lots.forEach(l => { monScanned.set(l.lot, (monScanned.get(l.lot) || 0) + l.scanned); monLoaded.set(l.lot, (monLoaded.get(l.lot) || 0) + l.loaded); }));

  const lotNames = Array.from(new Set([...dateTarget.keys(), ...pickKg.keys(), ...monScanned.keys()])).sort();
  const lots: LotRow[] = lotNames.map(lot => {
    const target = r2(dateTarget.get(lot) || 0);
    const picked = r2((pickKg.get(lot) || 0) / std(lot));
    let pickStatus: PickStatus;
    if (!dateTarget.has(lot)) pickStatus = 'DI LUAR ORDER';
    else if (picked > target + 0.05) pickStatus = 'OVER';
    else if (picked >= target - 0.05) pickStatus = 'DONE';
    else if (picked > 0) pickStatus = 'PARTIAL';
    else pickStatus = 'OPEN';
    return { lot, target, picked, pickedBoxes: pickBx.get(lot) || 0, scanned: r2(monScanned.get(lot) || 0), loaded: r2(monLoaded.get(lot) || 0), pickStatus };
  });

  const totalTarget = lots.reduce((s, l) => s + l.target, 0);
  const fulfilled = lots.filter(l => dateTarget.has(l.lot)).reduce((s, l) => s + Math.min(l.picked, l.target), 0);
  const extra = lots.reduce((s, l) => s + (dateTarget.has(l.lot) ? Math.max(0, l.picked - l.target) : l.picked), 0);
  const picking: PickingSummary = {
    hasData: picks.length > 0, target: r2(totalTarget), fulfilled: r2(fulfilled), extra: r2(extra), boxes: picks.length,
  };

  return { fetchedAt: new Date(), date, wh, rows, rits, lots, picking, tableErrors };
}

// ---- peringatan "perlu perhatian" ----
export interface Alert { level: 'error' | 'warning'; text: string }

export function buildAlerts(d: DashboardData, now = new Date()): Alert[] {
  const out: Alert[] = [];
  const today = now.toLocaleDateString('sv-SE'); // YYYY-MM-DD (waktu lokal perangkat)

  d.lots.filter(l => l.pickStatus === 'DI LUAR ORDER').forEach(l => out.push({ level: 'error', text: `Picking: LOT ${l.lot} (${l.picked} CT) di luar order tanggal ini` }));
  d.lots.filter(l => l.pickStatus === 'OVER').forEach(l => out.push({ level: 'warning', text: `Picking: LOT ${l.lot} over ${r2(l.picked - l.target)} CT dari target` }));

  d.rows.forEach(r => {
    if (r.date === today && r.eta && r.stage !== 'LOADED') {
      const [h, m] = r.eta.split(':').map(Number);
      const eta = new Date(now); eta.setHours(h || 0, m || 0, 0, 0);
      const diffMin = Math.round((eta.getTime() - now.getTime()) / 60000);
      const pct = r.target > 0 ? Math.round((r.scanned / r.target) * 100) : 0;
      if (diffMin < 0 && pct < 100) out.push({ level: 'error', text: `PO ${r.po} (RIT ${r.rit}) ETA sudah lewat ${Math.abs(diffMin)} menit, scan baru ${pct}%` });
      else if (diffMin <= 120 && pct < 100) out.push({ level: 'warning', text: `PO ${r.po} (RIT ${r.rit}) ETA ${diffMin} menit lagi, scan baru ${pct}%` });
    }
    if (r.stage === 'LOADED' && r.dispatchId === null) out.push({ level: 'warning', text: `PO ${r.po}: sudah loaded 100% tapi data dispatch/foto truk belum disimpan` });
  });

  d.rits.forEach(r => {
    if (r.dispatch && r.dispatch.photos < 4 && r.loaded >= r.target - 0.05 && r.target > 0) out.push({ level: 'warning', text: `RIT ${r.rit}: loaded 100%, foto dispatch baru ${r.dispatch.photos}/4` });
  });

  const byp = d.rows.reduce((s, r) => s + r.bypassed, 0);
  if (byp > 0) out.push({ level: 'warning', text: `${byp} scan bypass (SN duplikat dari PO lain) pada tanggal ini` });
  d.tableErrors.forEach(e => out.push({ level: 'error', text: `Sebagian data gagal dimuat → ${e}` }));

  return out;
}