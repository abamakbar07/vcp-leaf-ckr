/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/inventory.ts - Inventory Balance (IB) WMS: parsing import, aturan fumigasi, cache lookup SN
import { supabase } from './supabaseClient';
import { fetchPaged } from './db';
import { getVal } from './excel';

export const DEFAULT_FUM_LIMIT = 45;
export const IB_STALE_DAYS = 1; // IB dianggap basi kalau as_of_date lebih tua dari kemarin

export interface SnapshotMeta {
  id: number; as_of_date: string; source_file: string | null; row_count: number; uploaded_by: string;
  is_current: boolean; created_at: string; finalized_at: string | null;
}

export interface IbRow {
  id: number; customer_id: string | null; sku: string; sku_desc: string | null; product_type: string | null;
  location_id: string | null; zone_group: string | null; serial_no: string | null;
  fumigation_date_eff: string | null; fum_from_registry: boolean;
  qty_fm: number; qty_availed: number; inventory_type: string | null; uom: string | null;
}

// ---------- tanggal ----------
const pad = (n: number) => String(n).padStart(2, '0');

// Kembalikan YYYY-MM-DD atau null (TIDAK pernah menebak "hari ini" untuk tanggal fumigasi)
export function toIsoDate(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v < 10000) return null;
    const d = new Date((v - 25569) * 86400 * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})[/-](\d{2})[/-](\d{4})/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return null;
}

export const fmtDate = (iso: string | null | undefined) => (iso ? iso.split('-').reverse().join('-') : '-');
export const todayIso = () => new Date().toLocaleDateString('sv-SE');

export function daysBetween(fromIso: string, toIsoStr: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIsoStr.split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function ibStaleness(asOf: string | null, today = todayIso()): { stale: boolean; days: number } {
  if (!asOf) return { stale: true, days: 999 };
  if (!today) return { stale: false, days: 0 };
  const days = daysBetween(asOf, today);
  return { stale: days > IB_STALE_DAYS, days };
}

// ---------- parsing file IB ----------
export interface IbImportRow {
  warehouse_id: string | null; customer_id: string | null; sku: string; sku_desc: string | null; product_type: string | null;
  lotnum_fm: string | null; location_id: string | null; zone_id: string | null; zone_group: string | null; serial_no: string | null;
  fumigation_release_date: string | null; production_date: string | null; warehousing_date: string | null; asn_id: string | null;
  uom: string | null; qty_fm: number; qty_allocated: number; qty_holded: number; qty_availed: number;
  gross_weight_kg: number | null; inventory_type: string | null; quality_status: string | null;
}

export interface IbImportResult {
  rows: IbImportRow[];
  skipped: number;
  invalidDates: number;
  missingHeaders: string[];
  stats: {
    skus: number; withDate: number; noDate: number; availedTotal: number; overLimitAvailed: number;
    byCustomer: { customer: string; rows: number; availed: number; noDate: number }[];
  };
}

const REQUIRED = ['sku', 'customer id', 'location id', 'serial no', 'fumigation release date', 'qty availed', 'qty fm'];

const str = (v: any): string | null => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const num = (v: any): number => { const n = parseFloat(v); return isNaN(n) ? 0 : n; };

export function parseInventoryRows(raw: Record<string, any>[], asOf: string, limit: number): IbImportResult {
  const headers = raw.length > 0 ? Object.keys(raw[0]).map(h => h.trim().toLowerCase()) : [];
  const missingHeaders = REQUIRED.filter(h => !headers.includes(h));
  const out: IbImportRow[] = [];
  let skipped = 0; let invalidDates = 0;
  const skus = new Set<string>();
  const cust = new Map<string, { rows: number; availed: number; noDate: number }>();
  let withDate = 0; let noDate = 0; let availedTotal = 0; let overLimitAvailed = 0;

  if (missingHeaders.length === 0) {
    raw.forEach(r => {
      const sku = str(getVal(r, ['sku']));
      if (!sku) { skipped += 1; return; } // baris kosong / sisa di akhir file
      const fumRaw = getVal(r, ['fumigation release date']);
      const fum = toIsoDate(fumRaw);
      if (fum === null && str(fumRaw) !== null) invalidDates += 1;
      const row: IbImportRow = {
        warehouse_id: str(getVal(r, ['warehouse id'])), customer_id: str(getVal(r, ['customer id'])), sku,
        sku_desc: str(getVal(r, ['sku descr(l)', 'sku descr(s)'])), product_type: str(getVal(r, ['product type'])),
        lotnum_fm: str(getVal(r, ['lotnum fm'])), location_id: str(getVal(r, ['location id'])),
        zone_id: str(getVal(r, ['zone id'])), zone_group: str(getVal(r, ['zone group'])), serial_no: str(getVal(r, ['serial no'])),
        fumigation_release_date: fum, production_date: toIsoDate(getVal(r, ['production date'])),
        warehousing_date: toIsoDate(getVal(r, ['warehousing date'])), asn_id: str(getVal(r, ['asn id'])),
        uom: str(getVal(r, ['uom name fm'])), qty_fm: num(getVal(r, ['qty fm'])), qty_allocated: num(getVal(r, ['qty allocated'])),
        qty_holded: num(getVal(r, ['qty holded'])), qty_availed: num(getVal(r, ['qty availed'])),
        gross_weight_kg: str(getVal(r, ['total grossweight'])) === null ? null : num(getVal(r, ['total grossweight'])),
        inventory_type: str(getVal(r, ['inventory type'])), quality_status: str(getVal(r, ['quality status'])),
      };
      out.push(row);
      skus.add(sku);
      const c = cust.get(row.customer_id || '-') || { rows: 0, availed: 0, noDate: 0 };
      c.rows += 1; c.availed += row.qty_availed;
      if (fum) withDate += 1; else { noDate += 1; c.noDate += 1; }
      cust.set(row.customer_id || '-', c);
      availedTotal += row.qty_availed;
      if (fum && row.qty_availed > 0 && daysBetween(fum, asOf) > limit) overLimitAvailed += row.qty_availed;
    });
  }

  return {
    rows: out, skipped, invalidDates, missingHeaders,
    stats: {
      skus: skus.size, withDate, noDate, availedTotal, overLimitAvailed,
      byCustomer: Array.from(cust.entries()).map(([customer, v]) => ({ customer, ...v })).sort((a, b) => b.rows - a.rows),
    },
  };
}

export function asOfFromFilename(name: string): string {
  const m = /(\d{4})(\d{2})(\d{2})/.exec(name);
  if (m) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
    if (!isNaN(d.getTime()) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return todayIso();
}

// ---------- pengaturan & meta ----------
export async function loadFumigationLimit(): Promise<number> {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'fumigation_max_age_days').maybeSingle();
    const n = parseInt(data?.value ?? '', 10);
    return n > 0 ? n : DEFAULT_FUM_LIMIT;
  } catch { return DEFAULT_FUM_LIMIT; }
}

export async function saveFumigationLimit(days: number, by: string) {
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'fumigation_max_age_days', value: String(days), updated_by: by || 'anon', updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
}

export async function loadCurrentSnapshot(): Promise<SnapshotMeta | null> {
  try {
    const { data } = await supabase.from('inventory_snapshots').select('*').eq('is_current', true).maybeSingle();
    return (data as SnapshotMeta) || null;
  } catch { return null; }
}

// ---------- aturan fumigasi ----------
export type FumStatus = 'OK' | 'EXPIRED' | 'UNKNOWN' | 'NOT_IN_IB';

export interface FumCheck {
  status: FumStatus;
  fumDate: string | null;
  ageDays: number | null;
  message: string; // untuk popup / toast
}

export function checkFumigation(info: IbRow | undefined, deliveryDate: string, limit: number): FumCheck {
  if (!info) return { status: 'NOT_IN_IB', fumDate: null, ageDays: null, message: 'SN tidak ditemukan di Inventory Balance (IB belum di-update?)' };
  if (!info.fumigation_date_eff) {
    return {
      status: 'UNKNOWN', fumDate: null, ageDays: null,
      message: `Tanggal fumigasi belum ada di IB (lokasi ${info.location_id || '-'}${info.inventory_type === 'OFFLINE' ? ', OFFLINE' : ''})`,
    };
  }
  const age = daysBetween(info.fumigation_date_eff, deliveryDate);
  if (age > limit) {
    return {
      status: 'EXPIRED', fumDate: info.fumigation_date_eff, ageDays: age,
      message: `Fumigasi ${fmtDate(info.fumigation_date_eff)} → umur ${age} hari pada tgl pengiriman ${fmtDate(deliveryDate)} (batas ${limit} hari)`,
    };
  }
  return { status: 'OK', fumDate: info.fumigation_date_eff, ageDays: age, message: `Fumigasi ${fmtDate(info.fumigation_date_eff)} (umur ${age} hari)` };
}

export interface LotStock { total: number; eligible: number; expired: number; noDate: number }

// ---------- cache IB untuk scanner ----------
// Data IB per LOT diambil sekali (saat PO / tanggal dipilih), lalu scan dicek dari memori: tidak menambah latency per scan.
export class IbCache {
  private lots = new Set<string>();
  private bySerial = new Map<string, IbRow>();
  private byLot = new Map<string, IbRow[]>();
  meta: SnapshotMeta | null = null;
  metaLoaded = false;

  reset() { this.lots.clear(); this.bySerial.clear(); this.byLot.clear(); this.metaLoaded = false; this.meta = null; }

  async loadMeta() { this.meta = await loadCurrentSnapshot(); this.metaLoaded = true; return this.meta; }

  private better(a: IbRow, b: IbRow): IbRow {
    const score = (r: IbRow) => (r.fumigation_date_eff ? 2 : 0) + (r.qty_fm > 0 ? 1 : 0);
    return score(b) > score(a) ? b : a;
  }

  async ensureLots(lots: string[]) {
    const need = Array.from(new Set(lots)).filter(l => l && !this.lots.has(l));
    for (let i = 0; i < need.length; i += 40) {
      const chunk = need.slice(i, i + 40);
      const rows = await fetchPaged<IbRow>((f, t) => supabase.from('inventory_balance_current')
        .select('id, customer_id, sku, sku_desc, product_type, location_id, zone_group, serial_no, fumigation_date_eff, fum_from_registry, qty_fm, qty_availed, inventory_type, uom')
        .in('sku', chunk).order('id').range(f, t));
      rows.forEach(r => {
        r.qty_fm = Number(r.qty_fm); r.qty_availed = Number(r.qty_availed);
        const arr = this.byLot.get(r.sku) || []; arr.push(r); this.byLot.set(r.sku, arr);
        if (r.serial_no) { const ex = this.bySerial.get(r.serial_no); this.bySerial.set(r.serial_no, ex ? this.better(ex, r) : r); }
      });
      chunk.forEach(l => this.lots.add(l));
    }
  }

  lookup(sn: string): IbRow | undefined { return this.bySerial.get(sn); }
  hasData(): boolean { return this.bySerial.size > 0 || this.byLot.size > 0; }
  rowsOfLot(lot: string): IbRow[] { return this.byLot.get(lot) || []; }

  stock(lot: string, deliveryDate: string, limit: number): LotStock {
    const s: LotStock = { total: 0, eligible: 0, expired: 0, noDate: 0 };
    this.rowsOfLot(lot).forEach(r => {
      if (r.qty_availed <= 0) return;
      s.total += r.qty_availed;
      if (!r.fumigation_date_eff) s.noDate += r.qty_availed;
      else if (daysBetween(r.fumigation_date_eff, deliveryDate) > limit) s.expired += r.qty_availed;
      else s.eligible += r.qty_availed;
    });
    return s;
  }
}