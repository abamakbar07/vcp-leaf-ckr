/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/inbound.ts - tipe, parsing ASN (export WMS) dan rekonsiliasi per SKU untuk tools Inbound
import { getVal } from './excel';

export interface AsnSummary {
  asn_id: number; wh_id: string; asn_no: string; asn_date: string; status: string; created_at: string;
  lines: number; expected_qty: number; scanned_ct: number; scanned_boxes: number; exception_boxes: number; received_boxes: number;
}

export interface AsnItem {
  id?: number; asn_id: number; line_no: number; sku: string; description: string | null; expected_qty: number; uom: string;
}

export interface InboundLog {
  id: number; asn_id: number; serial_number: string; lot_code: string; pmi_run_no: string | null; case_number: string | null;
  gross_weight_kg: number | null; net_weight_kg: number; is_exception: boolean; exception_reason: string | null;
  scanned_by: string; scanned_at: string; wms_received_at: string | null; wms_received_by: string | null;
}

export interface AsnLine {
  line_no: number; sku: string; description: string; expected_qty: number; uom: string; wms_line_status: string; wms_received_qty: number;
}

export const r2 = (n: number) => +Number(n).toFixed(2);

// Nama file WMS contoh: ASN_20261112.xlsx -> ASN No "ASN_20261112", tanggal 2026-11-12
export function asnDefaultsFromFilename(filename: string): { asnNo: string; date: string } {
  const stem = filename.replace(/\.[^.]+$/, '');
  let date = new Date().toLocaleDateString('sv-SE');
  const m = /(\d{4})(\d{2})(\d{2})/.exec(stem);
  if (m) {
    const [, y, mo, d] = m;
    const dt = new Date(`${y}-${mo}-${d}T00:00:00`);
    if (!isNaN(dt.getTime()) && +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31) date = `${y}-${mo}-${d}`;
  }
  return { asnNo: stem, date };
}

// Baca baris export ASN WMS. Kolom: ASN LineNO, Line Status, SKU, SKU Descr(L), Expected QTY, Received QTY, Pack UOM
// SKU yang sama di beberapa baris dijumlahkan.
export function parseAsnRows(raw: Record<string, any>[]): { lines: AsnLine[]; skipped: number } {
  const agg = new Map<string, AsnLine>();
  let skipped = 0;
  raw.forEach((row, i) => {
    const sku = String(getVal(row, ['sku', 'lot_code', 'lot'])).trim();
    if (!sku) { skipped += 1; return; }
    const exp = parseFloat(getVal(row, ['expected qty', 'expected_qty', 'qty'])) || 0;
    const rec = parseFloat(getVal(row, ['received qty', 'received_qty'])) || 0;
    const lineNo = parseInt(getVal(row, ['asn lineno', 'asn line no', 'line no', 'lineno']), 10) || i + 1;
    const ex = agg.get(sku);
    if (ex) { ex.expected_qty += exp; ex.wms_received_qty += rec; return; }
    agg.set(sku, {
      line_no: lineNo, sku,
      description: String(getVal(row, ['sku descr(l)', 'sku descr', 'description', 'desc'])).trim(),
      expected_qty: exp, wms_received_qty: rec,
      uom: String(getVal(row, ['pack uom', 'uom'])).trim() || 'BOX',
      wms_line_status: String(getVal(row, ['line status', 'status'])).trim(),
    });
  });
  return { lines: Array.from(agg.values()).sort((a, b) => a.line_no - b.line_no), skipped };
}

export type LotStatus = 'OPEN' | 'PARTIAL' | 'DONE' | 'OVER' | 'DI LUAR ASN';

export interface LotRow {
  sku: string; description: string; expected: number; scannedCt: number; boxes: number;
  exceptions: number; received: number; status: LotStatus; inAsn: boolean;
}

export function buildLotRows(items: AsnItem[], logs: InboundLog[], std: (lot: string) => number): LotRow[] {
  const exp = new Map<string, AsnItem>();
  items.forEach(i => exp.set(i.sku, i));
  const agg = new Map<string, { ct: number; boxes: number; ex: number; rec: number }>();
  logs.forEach(l => {
    const a = agg.get(l.lot_code) || { ct: 0, boxes: 0, ex: 0, rec: 0 };
    a.ct += Number(l.net_weight_kg) / std(l.lot_code); a.boxes += 1;
    if (l.is_exception) a.ex += 1;
    if (l.wms_received_at) a.rec += 1;
    agg.set(l.lot_code, a);
  });
  const skus = Array.from(new Set([...exp.keys(), ...agg.keys()]));
  const rows = skus.map(sku => {
    const it = exp.get(sku);
    const a = agg.get(sku) || { ct: 0, boxes: 0, ex: 0, rec: 0 };
    const expected = Number(it?.expected_qty || 0);
    const scannedCt = r2(a.ct);
    let status: LotStatus;
    if (!it) status = 'DI LUAR ASN';
    else if (scannedCt > expected + 0.05) status = 'OVER';
    else if (scannedCt >= expected - 0.05) status = 'DONE';
    else if (scannedCt > 0) status = 'PARTIAL';
    else status = 'OPEN';
    return { sku, description: it?.description || '', expected, scannedCt, boxes: a.boxes, exceptions: a.ex, received: a.rec, status, inAsn: !!it };
  });
  return rows.sort((x, y) => Number(y.inAsn) - Number(x.inAsn) || x.sku.localeCompare(y.sku));
}

// Urutan tampil di tab Receive: LOT, lalu nomor case (numerik), lalu waktu scan
export function sortForReceive(logs: InboundLog[]): InboundLog[] {
  return [...logs].sort((a, b) =>
    a.lot_code.localeCompare(b.lot_code) ||
    (parseInt(a.case_number || '0', 10) || 0) - (parseInt(b.case_number || '0', 10) || 0) ||
    String(a.scanned_at).localeCompare(String(b.scanned_at)));
}