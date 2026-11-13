/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { readFirstSheet, writeWorkbook } from '@/lib/excel';
import { asnDefaultsFromFilename, parseAsnRows, r2, type AsnLine, type AsnSummary } from '@/lib/inbound';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  asns: AsnSummary[];
  skuMap: Map<string, number>;
  checker: string;
  notify: (msg: string, type?: ToastType) => void;
  onChanged: () => void;
  onOpen: (asnId: number) => void;
}

const WH_KEY = 'inbound_last_wh';
const TEMPLATE = [{ 'ASN LineNO': 1, 'Line Status': 'ASN Open', SKU: 'LQ8516', 'SKU Descr(L)': 'LQ8516-Krosok', 'Expected QTY': 18, 'Received QTY': 0, 'Pack UOM': 'BOX' }];

export default function AsnTab({ asns, skuMap, checker, notify, onChanged, onOpen }: Props) {
  const [lines, setLines] = useState<AsnLine[]>([]);
  const [fileName, setFileName] = useState('');
  const [asnNo, setAsnNo] = useState('');
  const [whId, setWhId] = useState(() => (typeof window !== 'undefined' ? localStorage.getItem(WH_KEY) || '' : ''));
  const [asnDate, setAsnDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const whOptions = useMemo(() => Array.from(new Set(asns.map(a => a.wh_id))), [asns]);

  const onFile = async (file: File) => {
    try {
      const raw = await readFirstSheet(file);
      const { lines: parsed, skipped } = parseAsnRows(raw);
      if (parsed.length === 0) return notify('❌ Kolom SKU / Expected QTY tidak terdeteksi. Pakai format export ASN WMS.', 'error');
      const d = asnDefaultsFromFilename(file.name);
      setLines(parsed); setFileName(file.name); setAsnNo(d.asnNo); setAsnDate(d.date);
      if (skipped > 0) notify(`⚠️ ${skipped} baris tanpa SKU dilewati.`, 'warning');
    } catch (err: any) { notify(`❌ Gagal membaca file ASN: ${err.message}`, 'error'); }
    if (fileRef.current) fileRef.current.value = '';
  };

  const missingSku = useMemo(() => lines.filter(l => !skuMap.has(l.sku)).map(l => l.sku), [lines, skuMap]);
  const totalExpected = lines.reduce((s, l) => s + l.expected_qty, 0);
  const exists = asns.some(a => a.wh_id === whId.trim() && a.asn_no === asnNo.trim());
  const canSave = lines.length > 0 && whId.trim() && asnNo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(asnDate);

  const save = async () => {
    if (!canSave) return notify('⚠️ Lengkapi WHID, Nomor ASN, dan tanggal (YYYY-MM-DD).', 'warning');
    setSaving(true);
    try {
      const wh = whId.trim(); const no = asnNo.trim();
      const { data: head, error } = await supabase.from('inbound_asn')
        .upsert({ wh_id: wh, asn_no: no, asn_date: asnDate, source_file: fileName, created_by: checker.trim() || 'anon' }, { onConflict: 'wh_id,asn_no' })
        .select().single();
      if (error) throw error;

      // Re-import = revisi: item diganti, scan SN yang sudah tercatat tidak ikut terhapus
      const { error: eDel } = await supabase.from('inbound_asn_items').delete().eq('asn_id', head.id);
      if (eDel) throw eDel;
      const { error: eIns } = await supabase.from('inbound_asn_items').insert(lines.map(l => ({
        asn_id: head.id, line_no: l.line_no, sku: l.sku, description: l.description || null, expected_qty: l.expected_qty,
        uom: l.uom, wms_line_status: l.wms_line_status || null, wms_received_qty: l.wms_received_qty,
      })));
      if (eIns) throw eIns;

      localStorage.setItem(WH_KEY, wh);
      notify(`🎉 ASN ${no} tersimpan (${lines.length} SKU).`, 'success');
      setLines([]); setFileName(''); setAsnNo('');
      onChanged();
      onOpen(head.id);
    } catch (err: any) { notify(`❌ Gagal simpan ASN: ${err.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const toggleStatus = async (a: AsnSummary) => {
    setBusyId(a.asn_id);
    try {
      const { error } = await supabase.from('inbound_asn').update({ status: a.status === 'OPEN' ? 'CLOSED' : 'OPEN' }).eq('id', a.asn_id);
      if (error) throw error;
      onChanged();
    } catch (err: any) { notify(`❌ Gagal ubah status: ${err.message}`, 'error'); }
    finally { setBusyId(null); }
  };

  const remove = async (a: AsnSummary) => {
    if (!confirm(`Hapus ASN ${a.asn_no} (${a.wh_id}) beserta ${a.scanned_boxes} scan SN di dalamnya? Tidak bisa dibatalkan.`)) return;
    setBusyId(a.asn_id);
    try {
      const { error } = await supabase.from('inbound_asn').delete().eq('id', a.asn_id);
      if (error) throw error;
      notify('🗑️ ASN dihapus.', 'success');
      onChanged();
    } catch (err: any) { notify(`❌ Gagal hapus: ${err.message}`, 'error'); }
    finally { setBusyId(null); }
  };

  const inp = 'w-full min-h-11 border-2 border-gray-300 rounded-lg px-3 font-semibold bg-white';
  const lbl = 'block text-xs font-bold text-gray-500 mb-1';

  return (
    <div>
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <h2 className="font-bold text-gray-900">Import ASN dari WMS</h2>
          <button onClick={() => writeWorkbook([{ name: 'ASN', rows: TEMPLATE }], 'Template_ASN.xlsx')} className="px-3 min-h-9 rounded-md border border-gray-300 bg-white text-xs font-bold">📥 Template</button>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Pakai export ASN dari WMS (kolom <strong>SKU</strong> dan <strong>Expected QTY</strong> dipakai; <em>Received QTY</em> dan <em>Line Status</em> hanya disimpan sebagai info).
          Export WMS tidak memuat nomor ASN, jadi isi sendiri di bawah. Upload ulang untuk ASN yang sama = revisi (scan SN yang sudah tercatat tetap aman).
        </p>

        <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) onFile(f); }}
          className="border-2 border-dashed border-amber-500 bg-amber-50 rounded-lg p-6 text-center cursor-pointer font-bold text-gray-800">
          📁 Drag &amp; Drop / Klik untuk Upload File ASN
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
        </div>

        {lines.length > 0 && (
          <div className="mt-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
              <div><label className={lbl}>Warehouse (WHID)</label>
                <input list="inboundWhList" value={whId} onChange={e => setWhId(e.target.value)} placeholder="mis. HMS" className={inp} />
                <datalist id="inboundWhList">{whOptions.map(w => <option key={w} value={w} />)}</datalist></div>
              <div><label className={lbl}>Nomor / Referensi ASN</label><input value={asnNo} onChange={e => setAsnNo(e.target.value)} className={inp} /></div>
              <div><label className={lbl}>Tanggal ASN</label><input type="date" value={asnDate} onChange={e => setAsnDate(e.target.value)} className={inp} /></div>
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mb-2">
              <span><strong>{lines.length}</strong> SKU</span><span><strong>{r2(totalExpected)}</strong> BOX</span>
              {exists && <span className="text-orange-700 font-bold">♻️ ASN ini sudah ada: item akan diganti (revisi)</span>}
            </div>
            {missingSku.length > 0 && (
              <div className="mb-2 p-2 rounded-md bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold">
                ⚠️ {missingSku.length} SKU belum ada di SKU Master ({missingSku.join(', ')}). Tetap bisa disimpan, tapi berat standar dipakai default 200 kg untuk hitungan CT.
              </div>
            )}

            <div className="max-h-72 overflow-auto border border-gray-200 rounded-md mb-3">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-gray-900 text-white sticky top-0"><tr><th className="p-2 text-left">Line</th><th className="p-2 text-left">SKU</th><th className="p-2 text-left">Deskripsi</th><th className="p-2 text-left">Expected (BOX)</th><th className="p-2 text-left">Info WMS</th></tr></thead>
                <tbody>
                  {lines.map(l => (
                    <tr key={l.sku} className="border-b">
                      <td className="p-2">{l.line_no}</td><td className="p-2 font-bold">{l.sku}</td><td className="p-2">{l.description}</td>
                      <td className="p-2 font-bold">{l.expected_qty}</td>
                      <td className="p-2 text-gray-500">{l.wms_line_status || '-'} · rcv {l.wms_received_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={save} disabled={saving || !canSave} className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold text-sm disabled:opacity-50">
              {saving ? '⏳ Menyimpan...' : exists ? '💾 Simpan Revisi ASN' : '💾 Simpan ASN'}
            </button>
          </div>
        )}
      </section>

      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
        <h2 className="font-bold text-gray-900 mb-2">Daftar ASN</h2>
        <div className="max-h-[50vh] overflow-auto border border-gray-200 rounded-md">
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="bg-gray-900 text-white sticky top-0">
              <tr><th className="p-2 text-left">Tanggal</th><th className="p-2 text-left">ASN</th><th className="p-2 text-left">WH</th><th className="p-2 text-left">SKU</th>
                <th className="p-2 text-left">Scan / ASN (CT)</th><th className="p-2 text-left">Exception</th><th className="p-2 text-left">Receive WMS</th><th className="p-2 text-left">Status</th><th className="p-2">Aksi</th></tr>
            </thead>
            <tbody>
              {asns.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-gray-500">Belum ada ASN. Import dulu di atas.</td></tr>}
              {asns.map(a => {
                const pct = a.expected_qty > 0 ? Math.round((a.scanned_ct / a.expected_qty) * 100) : 0;
                return (
                  <tr key={a.asn_id} className="border-b">
                    <td className="p-2">{a.asn_date}</td><td className="p-2 font-bold">{a.asn_no}</td><td className="p-2">{a.wh_id}</td><td className="p-2">{a.lines}</td>
                    <td className="p-2 tabular-nums"><span className={`font-bold ${pct >= 100 ? 'text-green-700' : ''}`}>{a.scanned_ct} / {a.expected_qty}</span> <span className="text-gray-400">({pct}%)</span></td>
                    <td className="p-2">{a.exception_boxes > 0 ? <span className="text-orange-700 font-bold">⚠ {a.exception_boxes}</span> : <span className="text-gray-300">—</span>}</td>
                    <td className="p-2 tabular-nums">{a.received_boxes} / {a.scanned_boxes}</td>
                    <td className="p-2"><span className={`px-2 py-0.5 rounded font-bold ${a.status === 'OPEN' ? 'bg-green-100 text-green-900' : 'bg-gray-200 text-gray-600'}`}>{a.status}</span></td>
                    <td className="p-2 text-center space-x-1">
                      <button onClick={() => onOpen(a.asn_id)} className="px-2 min-h-8 rounded-md bg-amber-600 text-white font-bold">Buka</button>
                      <button onClick={() => toggleStatus(a)} disabled={busyId === a.asn_id} className="px-2 min-h-8 rounded-md border border-gray-300 bg-white font-bold disabled:opacity-50">{a.status === 'OPEN' ? 'Tutup' : 'Buka lagi'}</button>
                      <button onClick={() => remove(a)} disabled={busyId === a.asn_id} className="px-2 min-h-8 rounded-md bg-red-600 text-white font-bold disabled:opacity-50">Hapus</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}