/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getVal, parseExcelDate, parseExcelTime, readFirstSheet, writeWorkbook, ORDER_TEMPLATE } from '@/lib/excel';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  skuMap: Map<string, number>;
  existingKeys: Set<string>; // `${po}___${rit}` yang sudah ada di database
  onSaved: () => void;
  notify: (msg: string, type?: ToastType) => void;
}

interface DraftItem {
  wh_id: string; po_number: string; blend_code: string; lot_code: string;
  qty_usage_ct: number; qty_spare_ct: number; uom: string;
  arrival_date: string; arrival_time: string;
}

const DATE_OK = /^\d{4}-\d{2}-\d{2}$/;
const SHOW_LIMIT = 500;

export default function OrderImportSection({ skuMap, existingKeys, onSaved, notify }: Props) {
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    try {
      const raw = await readFirstSheet(file);
      if (raw.length === 0) return notify('❌ File Order kosong!', 'error');

      const agg = new Map<string, DraftItem>();
      raw.forEach(row => {
        const po = String(getVal(row, ['po_number', 'po number', 'po', 'no po'])).trim();
        const lot = String(getVal(row, ['lot_code', 'lot code', 'sku', 'lot'])).trim();
        const qty = parseFloat(getVal(row, ['qty_usage_ct', 'qty usage', 'qty ct', 'qty', 'carton'])) || 1.0;
        const wh = String(getVal(row, ['wh_id', 'whid', 'warehouse', 'wh'])).trim() || 'WH01';
        const blend = String(getVal(row, ['blend_code', 'blend code', 'blend'])).trim() || '-';
        const date = parseExcelDate(getVal(row, ['arrival_date', 'arrival date', 'date', 'tanggal']));
        const time = parseExcelTime(getVal(row, ['arrival_time', 'time', 'jam', 'rit', 'ritase'])) || '06:00';
        if (!po || !lot) return;
        const key = `${po}___${time}___${lot}`;
        const ex = agg.get(key);
        if (ex) { ex.qty_usage_ct += qty; ex.qty_spare_ct += qty; }
        else agg.set(key, { wh_id: wh, po_number: po, blend_code: blend, lot_code: lot, qty_usage_ct: qty, qty_spare_ct: qty, uom: 'CT', arrival_date: date, arrival_time: time });
      });

      const rows = Array.from(agg.values());
      if (rows.length === 0) return notify('❌ Format tidak sesuai! Kolom PO & SKU/Lot wajib ada.', 'error');
      setDraft(rows);
    } catch (err: any) { notify(`❌ Gagal membaca file Order: ${err.message}`, 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const check = useMemo(() => {
    const missing = new Set<string>();
    const badDates = new Set<string>();
    const pos = new Set<string>();
    const updates = new Set<string>();
    let totalCt = 0;
    draft.forEach(d => {
      if (!skuMap.has(d.lot_code)) missing.add(d.lot_code);
      if (!DATE_OK.test(d.arrival_date)) badDates.add(d.arrival_date);
      const k = `${d.po_number}___${d.arrival_time}`;
      pos.add(k);
      if (existingKeys.has(k)) updates.add(k);
      totalCt += d.qty_usage_ct;
    });
    return { missing, badDates, poCount: pos.size, updateCount: updates.size, totalCt };
  }, [draft, skuMap, existingKeys]);

  const canSave = draft.length > 0 && check.missing.size === 0 && check.badDates.size === 0;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const headersMap = new Map<string, any>();
      draft.forEach(i => {
        const k = `${i.po_number}___${i.arrival_time}`;
        if (!headersMap.has(k)) headersMap.set(k, { po_number: i.po_number, arrival_time: i.arrival_time, wh_id: i.wh_id, blend_code: i.blend_code, arrival_date: i.arrival_date });
      });
      const headers = Array.from(headersMap.values());

      const { error: errOrders } = await supabase.from('vcp-op-orders').upsert(headers, { onConflict: 'po_number,arrival_time' });
      if (errOrders) throw errOrders;

      // PO + RIT yang di-upload ulang: item lama diganti (scan log tidak tersentuh)
      for (const h of headers) {
        const { error } = await supabase.from('vcp-op-order_items').delete().eq('po_number', h.po_number).eq('arrival_time', h.arrival_time);
        if (error) throw error;
      }

      const items = draft.map(i => ({
        po_number: i.po_number, arrival_time: i.arrival_time, blend_code: i.blend_code, lot_code: i.lot_code,
        qty_usage_ct: i.qty_usage_ct, qty_spare_ct: i.qty_spare_ct, uom: i.uom,
      }));
      for (let n = 0; n < items.length; n += 500) {
        const { error } = await supabase.from('vcp-op-order_items').insert(items.slice(n, n + 500));
        if (error) throw error;
      }

      notify('🎉 ORDER BERHASIL DISIMPAN KE DATABASE!', 'success');
      setDraft([]);
      onSaved();
    } catch (err: any) { notify(`❌ Gagal menyimpan Order: ${err.message}`, 'error'); }
    finally { setSaving(false); }
  };

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <h2 className="font-bold text-base text-gray-900">2. Import Order HMS (Excel / CSV)</h2>
        <div className="flex gap-2">
          <button onClick={() => writeWorkbook([{ name: 'Order Import', rows: ORDER_TEMPLATE }], 'Template_Order_HMS.xlsx')} className="px-3 min-h-10 rounded-md border border-gray-300 text-xs font-bold bg-white">📥 Template</button>
          {canSave && (
            <button onClick={save} disabled={saving} className="px-3 min-h-10 rounded-md bg-green-700 text-white text-xs font-bold disabled:opacity-60">
              {saving ? '⏳ Menyimpan...' : '💾 Simpan Order ke Database'}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        Wajib: <strong>PO Number, SKU / Lot Code, Qty (CT)</strong>. Opsional: WHID, Arrival Date, Arrival Time (RIT), Blend. Semua SKU harus sudah terdaftar di SKU Master.
      </p>

      <div onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className="border-2 border-dashed border-amber-500 bg-amber-50 rounded-lg p-6 text-center cursor-pointer font-bold text-gray-800">
        📁 Drag &amp; Drop / Klik untuk Upload File Order
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>

      {draft.length > 0 && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
            <span><strong>{check.poCount}</strong> PO</span>
            <span><strong>{draft.length}</strong> baris LOT</span>
            <span><strong>{+check.totalCt.toFixed(2)}</strong> CT</span>
            {check.updateCount > 0 && <span className="text-orange-700 font-bold">♻️ {check.updateCount} PO sudah ada (item akan diganti)</span>}
          </div>
          {check.missing.size > 0 && (
            <div className="mb-2 p-2 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
              ❌ ORDER DITOLAK: {check.missing.size} SKU belum terdaftar: [{Array.from(check.missing).join(', ')}]. Upload SKU Master dulu.
            </div>
          )}
          {check.badDates.size > 0 && (
            <div className="mb-2 p-2 rounded-md bg-red-50 border border-red-200 text-red-800 text-xs font-semibold">
              ❌ Format tanggal tidak valid: [{Array.from(check.badDates).join(', ')}]. Gunakan YYYY-MM-DD.
            </div>
          )}
          {canSave && (
            <div className="mb-2 p-2 rounded-md bg-green-50 border border-green-200 text-green-800 text-xs font-semibold">
              ✅ Seluruh SKU terdaftar dan format tanggal valid. Siap disimpan.
            </div>
          )}
          <div className="max-h-80 overflow-auto border border-gray-200 rounded-md">
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="bg-gray-900 text-white sticky top-0">
                <tr><th className="p-2 text-left">WHID</th><th className="p-2 text-left">PO</th><th className="p-2 text-left">LOT</th><th className="p-2 text-left">Qty (CT)</th><th className="p-2 text-left">Tgl</th><th className="p-2 text-left">RIT</th><th className="p-2 text-left">Blend</th></tr>
              </thead>
              <tbody>
                {draft.slice(0, SHOW_LIMIT).map(d => {
                  const bad = !skuMap.has(d.lot_code);
                  return (
                    <tr key={`${d.po_number}${d.arrival_time}${d.lot_code}`} className={`border-b ${bad ? 'bg-red-50' : ''}`}>
                      <td className="p-2 font-bold">{d.wh_id}</td>
                      <td className="p-2 font-bold">{d.po_number}</td>
                      <td className={`p-2 font-bold ${bad ? 'text-red-600' : ''}`}>{d.lot_code}{bad && <span className="ml-1 px-1.5 py-0.5 rounded bg-red-100 text-red-800 text-[10px]">⚠️ SKU UNREGISTERED</span>}</td>
                      <td className="p-2">{d.qty_usage_ct}</td>
                      <td className={`p-2 ${DATE_OK.test(d.arrival_date) ? '' : 'text-red-600 font-bold'}`}>{d.arrival_date}</td>
                      <td className="p-2">{d.arrival_time}</td>
                      <td className="p-2">{d.blend_code}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {draft.length > SHOW_LIMIT && <p className="text-xs text-gray-500 mt-1">Menampilkan {SHOW_LIMIT} dari {draft.length} baris (semua tetap divalidasi dan disimpan).</p>}
        </div>
      )}
    </section>
  );
}