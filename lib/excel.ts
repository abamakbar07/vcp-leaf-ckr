/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/excel.ts - parsing Excel/CSV + template + tulis workbook (SheetJS dimuat dinamis, hanya di browser)

export function parseExcelDate(val: any): string {
  if (!val && val !== 0) return new Date().toISOString().split('T')[0];
  if (typeof val === 'string' && (val.includes('-') || val.includes('/'))) return val.replace(/\//g, '-');
  const num = parseFloat(val);
  if (!isNaN(num) && num > 10000) {
    const utcDays = num - 25569;
    return new Date(utcDays * 86400 * 1000).toISOString().split('T')[0];
  }
  return String(val);
}

export function parseExcelTime(val: any): string {
  if (!val && val !== 0) return '06:00:00';
  if (typeof val === 'string' && val.includes(':')) return val.length === 5 ? `${val}:00` : val;
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0 && num < 1) {
    const total = Math.round(num * 86400);
    const h = String(Math.floor(total / 3600)).padStart(2, '0');
    const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  }
  return String(val);
}

// Cari nilai kolom dengan beberapa kemungkinan nama header (case-insensitive)
export function getVal(row: Record<string, any>, keys: string[]): any {
  for (const k of keys) {
    const found = Object.keys(row).find(rk => rk.trim().toLowerCase() === k.toLowerCase());
    if (found && row[found] !== undefined) return row[found];
  }
  return '';
}

export async function readFirstSheet(file: File): Promise<Record<string, any>[]> {
  const XLSX = await import('xlsx');
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) as Record<string, any>[];
}

export async function writeWorkbook(sheets: { name: string; rows: any[] }[], filename: string) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  sheets.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31)));
  XLSX.writeFile(wb, filename);
}

export const SKU_TEMPLATE = [
  { lot_code: 'LB2370', std_net_weight_kg: 180 },
  { lot_code: 'LB2625', std_net_weight_kg: 200 },
];

export const ORDER_TEMPLATE = [
  { wh_id: 'WH01', po_number: '101412213', lot_code: 'LB8333', qty_usage_ct: 10, arrival_date: '2026-09-08', arrival_time: '06:00', blend_code: 'AA60R' },
];