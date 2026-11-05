/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { getVal, readFirstSheet, writeWorkbook, SKU_TEMPLATE } from '@/lib/excel';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  skuMap: Map<string, number>;
  onSaved: () => void;
  notify: (msg: string, type?: ToastType) => void;
}

interface SkuRow { lot_code: string; std_net_weight_kg: number }

export default function SkuMasterSection({ skuMap, onSaved, notify }: Props) {
  const [draft, setDraft] = useState<SkuRow[]>([]);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File) => {
    try {
      const raw = await readFirstSheet(file);
      if (raw.length === 0) return notify('❌ File SKU Master kosong!', 'error');
      const rows: SkuRow[] = [];
      raw.forEach(row => {
        const lot = String(getVal(row, ['lot_code', 'lot', 'sku', 'item'])).trim();
        const w = parseFloat(getVal(row, ['std_net_weight_kg', 'net_weight', 'net', 'weight', 'berat'])) || 200.0;
        if (lot) rows.push({ lot_code: lot, std_net_weight_kg: w });
      });
      if (rows.length === 0) return notify('❌ Kolom SKU / Net Weight tidak terdeteksi!', 'error');
      setDraft(rows);
    } catch (err: any) { notify(`❌ Gagal membaca file SKU: ${err.message}`, 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.from('vcp-op-sku_master').upsert(draft, { onConflict: 'lot_code' });
      if (error) throw error;
      notify('🎉 SKU Master berhasil diperbarui!', 'success');
      setDraft([]);
      onSaved();
    } catch (err: any) { notify(`❌ Gagal simpan SKU: ${err.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const downloadCurrent = () =>
    writeWorkbook([{ name: 'SKU Master', rows: Array.from(skuMap.entries()).map(([lot_code, std_net_weight_kg]) => ({ lot_code, std_net_weight_kg })) }], 'SKU_Master_Current.xlsx');

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
        <h2 className="font-bold text-base text-gray-900">1. SKU Master &amp; Net Weight Standar</h2>
        <div className="flex gap-2">
          <button onClick={() => writeWorkbook([{ name: 'SKU Master', rows: SKU_TEMPLATE }], 'Template_SKU_Master.xlsx')} className="px-3 min-h-10 rounded-md border border-gray-300 text-xs font-bold bg-white">📥 Template</button>
          <button onClick={downloadCurrent} disabled={skuMap.size === 0} className="px-3 min-h-10 rounded-md border border-gray-300 text-xs font-bold bg-white disabled:opacity-50">📤 SKU Saat Ini</button>
          {draft.length > 0 && (
            <button onClick={save} disabled={saving} className="px-3 min-h-10 rounded-md bg-green-700 text-white text-xs font-bold disabled:opacity-60">
              {saving ? '⏳...' : '💾 Simpan Master SKU'}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-2">
        Kolom: <strong>lot_code</strong>, <strong>std_net_weight_kg</strong>. Saat ini terdaftar <strong>{skuMap.size}</strong> SKU. Upload ulang akan memperbarui berat LOT yang sama.
      </p>

      <div onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
        className="border-2 border-dashed border-amber-500 bg-amber-50 rounded-lg p-6 text-center cursor-pointer font-bold text-gray-800">
        🏷️ Drag &amp; Drop / Klik untuk Upload File SKU Master
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>

      {draft.length > 0 && (
        <div className="mt-3">
          <div className="text-sm font-bold text-gray-600 mb-1">Preview SKU Master ({draft.length} item):</div>
          <div className="max-h-64 overflow-auto border border-gray-200 rounded-md">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-white sticky top-0"><tr><th className="p-2 text-left">SKU / Lot Code</th><th className="p-2 text-left">Std Net Weight</th><th className="p-2 text-left">Status</th></tr></thead>
              <tbody>
                {draft.map(d => {
                  const cur = skuMap.get(d.lot_code);
                  return (
                    <tr key={d.lot_code} className="border-b">
                      <td className="p-2 font-bold">{d.lot_code}</td>
                      <td className="p-2">{d.std_net_weight_kg} kg</td>
                      <td className="p-2">
                        {cur === undefined ? <span className="text-green-700 font-bold">BARU</span>
                          : cur !== d.std_net_weight_kg ? <span className="text-orange-700 font-bold">UBAH ({cur} → {d.std_net_weight_kg})</span>
                          : <span className="text-gray-400">sama</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}