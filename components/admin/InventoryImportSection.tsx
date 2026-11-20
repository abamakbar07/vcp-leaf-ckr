/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { readFirstSheet } from '@/lib/excel';
import {
  asOfFromFilename, daysBetween, fmtDate, ibStaleness, loadFumigationLimit, parseInventoryRows, saveFumigationLimit,
  type IbImportResult, type SnapshotMeta,
} from '@/lib/inventory';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  checker: string;
  notify: (msg: string, type?: ToastType) => void;
}

const CHUNK = 1000;
const nf = (n: number) => n.toLocaleString('id-ID');

export default function InventoryImportSection({ checker, notify }: Props) {
  const [limit, setLimit] = useState(45);
  const [limitInput, setLimitInput] = useState('45');
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([]);
  const [fileName, setFileName] = useState('');
  const [raw, setRaw] = useState<Record<string, any>[] | null>(null);
  const [asOf, setAsOf] = useState('');
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadSnaps = useCallback(async () => {
    const { data, error } = await supabase.from('inventory_snapshots').select('*').not('finalized_at', 'is', null).order('id', { ascending: false }).limit(5);
    if (error) return notify(`⚠️ Gagal memuat riwayat IB (SQL sudah dijalankan?): ${error.message}`, 'warning');
    setSnaps((data || []) as SnapshotMeta[]);
  }, [notify]);

  useEffect(() => {
    loadSnaps();
    loadFumigationLimit().then(n => { setLimit(n); setLimitInput(String(n)); });
  }, [loadSnaps]);

  const current = snaps.find(s => s.is_current) || null;
  const stale = ibStaleness(current?.as_of_date ?? null);

  const saveLimit = async () => {
    const n = parseInt(limitInput, 10);
    if (!(n > 0 && n <= 365)) return notify('⚠️ Batas hari harus 1 sampai 365.', 'warning');
    try { await saveFumigationLimit(n, checker); setLimit(n); notify(`✅ Batas fumigasi diubah menjadi ${n} hari.`, 'success'); }
    catch (err: any) { notify(`❌ Gagal simpan: ${err.message}`, 'error'); }
  };

  const onFile = async (file: File) => {
    setParsing(true); setRaw(null);
    await new Promise(r => setTimeout(r, 30)); // beri kesempatan UI menampilkan "membaca file"
    try {
      const rows = await readFirstSheet(file);
      const test = parseInventoryRows(rows.slice(0, 1), todayFallback(), limit);
      if (test.missingHeaders.length > 0) {
        notify(`❌ Kolom wajib tidak ditemukan: ${test.missingHeaders.join(', ')}. Pakai export Inventory Balance dari WMS.`, 'error');
      } else {
        setRaw(rows); setFileName(file.name); setAsOf(asOfFromFilename(file.name));
      }
    } catch (err: any) { notify(`❌ Gagal membaca file: ${err.message}`, 'error'); }
    finally { setParsing(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  const result: IbImportResult | null = useMemo(() => (raw && asOf ? parseInventoryRows(raw, asOf, limit) : null), [raw, asOf, limit]);

  const olderThanCurrent = !!(current && asOf && asOf < current.as_of_date);
  const canUpload = !!result && result.rows.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(asOf) && !uploading;

  const upload = async () => {
    if (!result || !canUpload) return;
    if (olderThanCurrent && !confirm(`File ini per ${fmtDate(asOf)}, LEBIH LAMA dari IB aktif (${fmtDate(current!.as_of_date)}). Tetap jadikan IB aktif?`)) return;
    setUploading(true);
    let snapId: number | null = null;
    try {
      setProgress({ done: 0, total: result.rows.length, phase: 'Membuat snapshot' });
      const { data: snap, error } = await supabase.from('inventory_snapshots')
        .insert([{ as_of_date: asOf, source_file: fileName, row_count: result.rows.length, uploaded_by: checker.trim() || 'anon' }]).select().single();
      if (error) throw error;
      snapId = snap.id;

      for (let i = 0; i < result.rows.length; i += CHUNK) {
        const chunk = result.rows.slice(i, i + CHUNK).map(r => ({ ...r, snapshot_id: snapId }));
        const { error: e2 } = await supabase.from('inventory_balance').insert(chunk);
        if (e2) throw e2;
        setProgress({ done: Math.min(i + CHUNK, result.rows.length), total: result.rows.length, phase: 'Mengunggah baris IB' });
      }

      setProgress({ done: result.rows.length, total: result.rows.length, phase: 'Mengaktifkan snapshot' });
      const { error: eFin } = await supabase.rpc('finalize_inventory_snapshot', { p_snapshot_id: snapId, p_keep: 3 });
      if (eFin) throw eFin;

      notify(`🎉 IB per ${fmtDate(asOf)} aktif (${nf(result.rows.length)} baris).`, 'success');
      setRaw(null); setFileName('');
      await loadSnaps();
    } catch (err: any) {
      if (snapId) await supabase.from('inventory_snapshots').delete().eq('id', snapId); // buang upload setengah jadi; IB aktif tidak berubah
      const hint = /timeout/i.test(err?.message || '') ? ' (lihat bagian 9 di file SQL: batas waktu role anon)' : '';
      notify(`❌ Upload IB gagal, IB aktif tidak berubah: ${err.message}${hint}`, 'error');
    } finally { setUploading(false); setProgress(null); }
  };

  const inp = 'min-h-11 border-2 border-gray-300 rounded-lg px-3 font-semibold bg-white';

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
      <h2 className="font-bold text-base text-gray-900 mb-2">Inventory Balance (WMS) &amp; Aturan Fumigasi</h2>

      {/* STATUS IB AKTIF */}
      <div className={`rounded-lg border p-3 mb-3 text-sm ${current ? (stale.stale ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200') : 'bg-amber-50 border-amber-200'}`}>
        {current ? (
          <>
            <div className="font-bold">IB aktif: per {fmtDate(current.as_of_date)} <span className="font-normal text-gray-600">· {nf(current.row_count)} baris</span></div>
            <div className="text-xs text-gray-600">Diunggah {current.finalized_at ? new Date(current.finalized_at).toLocaleString('id-ID') : '-'} oleh {current.uploaded_by} · {current.source_file}</div>
            {stale.stale && <div className="text-xs text-red-700 font-bold mt-1">⚠️ IB sudah {stale.days} hari tidak di-update. Pengecekan fumigasi memakai data lama.</div>}
          </>
        ) : <div className="font-bold text-amber-900">Belum ada IB aktif. Upload file IB di bawah.</div>}
      </div>

      {/* BATAS FUMIGASI */}
      <div className="flex flex-wrap items-end gap-2 mb-4 pb-4 border-b border-dashed border-gray-300">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Batas umur fumigasi sampai tanggal pengiriman (hari)</label>
          <input type="number" min={1} max={365} value={limitInput} onChange={e => setLimitInput(e.target.value)} className={`${inp} w-32`} />
        </div>
        <button onClick={saveLimit} disabled={String(limit) === limitInput} className="px-4 min-h-11 rounded-lg bg-gray-900 text-white font-bold text-xs disabled:opacity-40">Simpan</button>
        <p className="text-[11px] text-gray-500 w-full">Aturan: boleh dipakai bila (tanggal pengiriman − tanggal fumigasi) ≤ batas. Sekarang: <strong>{limit} hari</strong>.</p>
      </div>

      {/* IMPORT */}
      <p className="text-xs text-gray-500 mb-2">
        Upload export <strong>Inventory Balance IB</strong> dari WMS (harian / akhir shift). Upload baru menggantikan IB aktif secara atomik; 3 snapshot terakhir disimpan. Baris kosong di akhir file dilewati otomatis.
      </p>
      <div onClick={() => !parsing && !uploading && fileRef.current?.click()} onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !parsing && !uploading) onFile(f); }}
        className="border-2 border-dashed border-amber-500 bg-amber-50 rounded-lg p-6 text-center cursor-pointer font-bold text-gray-800">
        {parsing ? '⏳ Membaca file (±5-15 detik untuk 20 ribu baris)...' : '📦 Drag & Drop / Klik untuk Upload File Inventory Balance'}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>

      {result && (
        <div className="mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
            <div className="sm:col-span-2 text-xs text-gray-600 flex items-end">File: <strong className="ml-1 break-all">{fileName}</strong></div>
            <div>
              <label className="block text-xs font-bold text-gray-500 mb-1">Data IB per tanggal</label>
              <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={`${inp} w-full`} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
            {[
              ['Baris', nf(result.rows.length)], ['SKU / LOT', nf(result.stats.skus)],
              ['Stok tersedia (BOX)', nf(result.stats.availedTotal)], ['Tanpa tgl fumigasi', nf(result.stats.noDate)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-md bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-500 font-bold uppercase">{k}</div><div className="text-lg font-extrabold">{v}</div></div>
            ))}
          </div>

          <div className="mb-3 p-2 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-900 font-semibold">
            Pada tanggal {fmtDate(asOf)}, <strong>{nf(result.stats.overLimitAvailed)} BOX</strong> stok tersedia sudah berumur &gt; {limit} hari sejak fumigasi.
            {result.skipped > 0 && <span className="block text-gray-600 font-normal">{result.skipped} baris tanpa SKU dilewati.</span>}
            {result.invalidDates > 0 && <span className="block text-red-700">⚠️ {result.invalidDates} tanggal fumigasi tidak terbaca (dianggap kosong).</span>}
            {olderThanCurrent && <span className="block text-red-700">⚠️ File ini lebih lama dari IB aktif ({fmtDate(current!.as_of_date)}).</span>}
          </div>

          <div className="overflow-auto border border-gray-200 rounded-md mb-3">
            <table className="w-full text-xs">
              <thead className="bg-gray-900 text-white"><tr><th className="p-2 text-left">Customer ID</th><th className="p-2 text-left">Baris</th><th className="p-2 text-left">Stok tersedia</th><th className="p-2 text-left">Tanpa tgl fumigasi</th></tr></thead>
              <tbody>
                {result.stats.byCustomer.map(c => (
                  <tr key={c.customer} className="border-b"><td className="p-2 font-bold">{c.customer}</td><td className="p-2">{nf(c.rows)}</td><td className="p-2">{nf(c.availed)}</td><td className="p-2">{nf(c.noDate)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>

          {progress && (
            <div className="mb-3">
              <div className="text-xs font-bold text-gray-600 mb-1">{progress.phase}: {nf(progress.done)} / {nf(progress.total)}</div>
              <div className="bg-gray-200 rounded h-3 overflow-hidden"><div className="h-full bg-amber-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} /></div>
            </div>
          )}

          <button onClick={upload} disabled={!canUpload} className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold text-sm disabled:opacity-50">
            {uploading ? '⏳ Mengunggah...' : `💾 Jadikan IB Aktif (${nf(result.rows.length)} baris)`}
          </button>
        </div>
      )}

      {/* RIWAYAT */}
      {snaps.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-gray-500 mb-1">Riwayat snapshot terakhir</div>
          <div className="overflow-auto border border-gray-200 rounded-md">
            <table className="w-full text-xs whitespace-nowrap">
              <tbody>
                {snaps.map(s => (
                  <tr key={s.id} className="border-b">
                    <td className="p-2 font-bold">per {fmtDate(s.as_of_date)}</td><td className="p-2">{nf(s.row_count)} baris</td>
                    <td className="p-2 text-gray-500">{s.finalized_at ? new Date(s.finalized_at).toLocaleString('id-ID') : '-'} · {s.uploaded_by}</td>
                    <td className="p-2">{s.is_current ? <span className="px-2 py-0.5 rounded bg-green-100 text-green-900 font-bold">AKTIF</span> : <span className="text-gray-400">arsip ({daysBetween(s.as_of_date, current?.as_of_date ?? s.as_of_date)} hr lebih lama)</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}

const todayFallback = () => new Date().toLocaleDateString('sv-SE');