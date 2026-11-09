/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPaged } from '@/lib/db';
import { HIOKI_BUCKET, HIOKI_TABLE, fmtBytes, prefixToLabel, sanitizeName, type HiokiRow } from '@/lib/tools/hioki';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  collector: string;
  notify: (msg: string, type?: ToastType) => void;
}

const SHOW_LIMIT = 500;
const ZIP_WARN_BYTES = 500 * 1024 * 1024;

const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function triggerDownload(blobOrUrl: Blob | string, filename: string) {
  const url = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  if (typeof blobOrUrl !== 'string') setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function CollectPanel({ collector, notify }: Props) {
  const [rows, setRows] = useState<HiokiRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<'pending' | 'all' | 'collected'>('pending');
  const [serial, setSerial] = useState('');
  const [batch, setBatch] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [markCollected, setMarkCollected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchPaged<HiokiRow>((f, t) => {
        let query: any = supabase.from(HIOKI_TABLE).select('*');
        if (from) query = query.gte('batch_at', new Date(`${from}T00:00:00`).toISOString());
        if (to) { const d = new Date(`${to}T00:00:00`); d.setDate(d.getDate() + 1); query = query.lt('batch_at', d.toISOString()); }
        if (status === 'pending') query = query.is('collected_at', null);
        if (status === 'collected') query = query.not('collected_at', 'is', null);
        return query.order('batch_at', { ascending: false }).order('id', { ascending: false }).range(f, t);
      });
      setRows(data);
      setSelected(new Set());
    } catch (err: any) { notify(`❌ Gagal memuat data: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  }, [from, to, status, notify]);

  useEffect(() => { load(); }, [load]);

  const serials = useMemo(() => Array.from(new Set(rows.map(r => r.serial_device))).sort(), [rows]);
  const batches = useMemo(() => {
    const m = new Map<string, number>();
    rows.forEach(r => m.set(r.batch_id, (m.get(r.batch_id) || 0) + 1));
    return Array.from(m.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(r =>
      (!serial || r.serial_device === serial) &&
      (!batch || r.batch_id === batch) &&
      (!needle || r.original_name.toLowerCase().includes(needle) || r.serial_device.toLowerCase().includes(needle))
    );
  }, [rows, serial, batch, q]);

  // Pilihan hanya dihitung dari baris yang sedang terfilter
  const picked = useMemo(() => filtered.filter(r => selected.has(r.id)), [filtered, selected]);
  const pickedSize = picked.reduce((s, r) => s + Number(r.size_bytes), 0);
  const allChecked = filtered.length > 0 && filtered.every(r => selected.has(r.id));
  const toggleAll = (on: boolean) => setSelected(prev => { const n = new Set(prev); filtered.forEach(r => (on ? n.add(r.id) : n.delete(r.id))); return n; });
  const toggleOne = (id: number, on: boolean) => setSelected(prev => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });

  const totalSize = filtered.reduce((s, r) => s + Number(r.size_bytes), 0);
  const uncollected = filtered.filter(r => !r.collected_at).length;

  const chunks = <T,>(arr: T[], n: number) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const markRows = async (ids: number[], on: boolean) => {
    for (const c of chunks(ids, 100)) {
      const { error } = await supabase.from(HIOKI_TABLE)
        .update({ collected_at: on ? new Date().toISOString() : null, collected_by: on ? (collector.trim() || 'anon') : null }).in('id', c);
      if (error) throw error;
    }
  };

  const downloadOne = async (r: HiokiRow) => {
    try {
      const { data, error } = await supabase.storage.from(HIOKI_BUCKET).createSignedUrl(r.storage_path, 120, { download: r.stored_name });
      if (error) throw error;
      triggerDownload(data.signedUrl, r.stored_name);
    } catch (err: any) { notify(`❌ Gagal download: ${err.message}`, 'error'); }
  };

  const downloadZip = async () => {
    if (picked.length === 0) return notify('⚠️ Pilih minimal 1 file.', 'warning');
    if (pickedSize > ZIP_WARN_BYTES && !confirm(`Total ${fmtBytes(pickedSize)}. ZIP besar dibuat di memori browser dan bisa berat. Lanjutkan?`)) return;
    setBusy(true); setProgress({ done: 0, total: picked.length });
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      let idx = 0; let done = 0;
      const worker = async () => {
        while (true) {
          const i = idx++;
          if (i >= picked.length) return;
          const r = picked[i];
          const { data, error } = await supabase.storage.from(HIOKI_BUCKET).download(r.storage_path);
          if (error || !data) throw new Error(`${r.storage_path}: ${error?.message || 'file kosong'}`);
          zip.file(`${sanitizeName(r.serial_device)}/${r.stored_name}`, data);
          done += 1; setProgress({ done, total: picked.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, picked.length) }, worker));
      const blob = await zip.generateAsync({ type: 'blob' });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1_$2');
      triggerDownload(blob, `Hioki_Collect_${stamp}.zip`);

      if (markCollected) { await markRows(picked.map(r => r.id), true); await load(); }
      notify(`✅ ${picked.length} file di-download${markCollected ? ' dan ditandai sudah di-collect' : ''}.`, 'success');
    } catch (err: any) { notify(`❌ Gagal membuat ZIP: ${err.message}`, 'error'); }
    finally { setBusy(false); setProgress(null); }
  };

  const resetCollect = async () => {
    if (picked.length === 0) return notify('⚠️ Pilih minimal 1 file.', 'warning');
    setBusy(true);
    try { await markRows(picked.map(r => r.id), false); notify('↩️ Status collect dikembalikan ke "belum".', 'success'); await load(); }
    catch (err: any) { notify(`❌ Gagal: ${err.message}`, 'error'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    if (picked.length === 0) return notify('⚠️ Pilih minimal 1 file.', 'warning');
    if (!confirm(`Hapus ${picked.length} file (${fmtBytes(pickedSize)}) dari server? Tindakan ini tidak bisa dibatalkan.`)) return;
    setBusy(true);
    try {
      for (const c of chunks(picked, 100)) {
        const { error } = await supabase.storage.from(HIOKI_BUCKET).remove(c.map(r => r.storage_path));
        if (error) throw error;
        const { error: e2 } = await supabase.from(HIOKI_TABLE).delete().in('id', c.map(r => r.id));
        if (e2) throw e2;
      }
      notify(`🗑️ ${picked.length} file dihapus.`, 'success');
      await load();
    } catch (err: any) { notify(`❌ Gagal hapus: ${err.message}`, 'error'); await load(); }
    finally { setBusy(false); }
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-white font-semibold text-sm';
  const lbl = 'block text-xs font-bold text-gray-500 mb-1';

  return (
    <div>
      {/* FILTER */}
      <section className="bg-sky-50 border border-sky-200 rounded-lg p-3 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div><label className={lbl}>Upload dari</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={selCls} /></div>
          <div><label className={lbl}>Sampai</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={selCls} /></div>
          <div><label className={lbl}>Status collect</label>
            <select value={status} onChange={e => setStatus(e.target.value as any)} className={selCls}>
              <option value="pending">Belum di-collect</option><option value="all">Semua</option><option value="collected">Sudah di-collect</option>
            </select></div>
          <div><label className={lbl}>Serial device</label>
            <select value={serial} onChange={e => setSerial(e.target.value)} className={selCls}><option value="">Semua</option>{serials.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
          <div><label className={lbl}>Batch upload</label>
            <select value={batch} onChange={e => setBatch(e.target.value)} className={selCls}><option value="">Semua</option>{batches.map(([b, n]) => <option key={b} value={b}>{prefixToLabel(b)} ({n})</option>)}</select></div>
          <div><label className={lbl}>Cari nama file</label><input type="text" value={q} onChange={e => setQ(e.target.value)} placeholder="nama / serial" className={selCls} /></div>
        </div>
      </section>

      {/* RINGKASAN */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
        <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">File</div><div className="text-xl font-extrabold">{filtered.length}</div></div>
        <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Total ukuran</div><div className="text-xl font-extrabold">{fmtBytes(totalSize)}</div></div>
        <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Belum di-collect</div><div className="text-xl font-extrabold text-orange-700">{uncollected}</div></div>
        <div className="bg-white rounded-lg border border-gray-200 p-3"><div className="text-[11px] text-gray-500 font-bold uppercase">Serial device</div><div className="text-xl font-extrabold">{new Set(filtered.map(r => r.serial_device)).size}</div></div>
      </div>

      {/* AKSI */}
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <button onClick={downloadZip} disabled={busy || picked.length === 0} className="px-4 min-h-11 rounded-lg bg-green-700 text-white font-bold text-sm disabled:opacity-50">
            {busy && progress ? `⏳ ${progress.done}/${progress.total}...` : `📦 Download ZIP (${picked.length})`}
          </button>
          <button onClick={resetCollect} disabled={busy || picked.length === 0} className="px-3 min-h-11 rounded-lg border border-gray-300 bg-white text-xs font-bold disabled:opacity-50">↩️ Reset status collect</button>
          <button onClick={remove} disabled={busy || picked.length === 0} className="px-3 min-h-11 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-50">🗑️ Hapus</button>
          <button onClick={load} disabled={loading || busy} className="px-3 min-h-11 rounded-lg border border-gray-300 bg-white text-xs font-bold ml-auto disabled:opacity-50">{loading ? '⏳' : '🔄 Refresh'}</button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
          <label className="flex items-center gap-2 cursor-pointer font-semibold"><input type="checkbox" checked={markCollected} onChange={e => setMarkCollected(e.target.checked)} className="w-4 h-4 accent-gray-900" /> Tandai sudah di-collect setelah ZIP di-download</label>
          {picked.length > 0 && <span>Terpilih: <strong>{picked.length}</strong> file ({fmtBytes(pickedSize)})</span>}
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Isi ZIP: folder per serial device, nama file tetap memakai prefix tanggal &amp; jam upload.</p>
      </section>

      {/* TABEL */}
      <div className="max-h-[60vh] overflow-auto border border-gray-200 rounded-md bg-white">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-white sticky top-0 z-10">
            <tr>
              <th className="p-2 w-10"><input type="checkbox" checked={allChecked} onChange={e => toggleAll(e.target.checked)} className="w-4 h-4 accent-amber-500" /></th>
              <th className="p-2 text-left">Batch upload</th><th className="p-2 text-left">Serial device</th><th className="p-2 text-left">File asli</th>
              <th className="p-2 text-left">Ukuran</th><th className="p-2 text-left">Collector</th><th className="p-2 text-left">Collect</th><th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="p-4 text-center">Memuat...</td></tr>}
            {!loading && filtered.length === 0 && <tr><td colSpan={8} className="p-4 text-center text-gray-500">Tidak ada file untuk filter ini.</td></tr>}
            {!loading && filtered.slice(0, SHOW_LIMIT).map(r => (
              <tr key={r.id} className={`border-b ${selected.has(r.id) ? 'bg-amber-50' : ''}`}>
                <td className="p-2 text-center"><input type="checkbox" checked={selected.has(r.id)} onChange={e => toggleOne(r.id, e.target.checked)} className="w-4 h-4 accent-gray-900" /></td>
                <td className="p-2 tabular-nums">{prefixToLabel(r.batch_id)}</td>
                <td className="p-2 font-bold">{r.serial_device}</td>
                <td className="p-2">{r.original_name}</td>
                <td className="p-2">{fmtBytes(Number(r.size_bytes))}</td>
                <td className="p-2">{r.uploaded_by}</td>
                <td className="p-2">{r.collected_at ? <span className="text-green-700 font-bold">✓ {fmtDT(r.collected_at)}</span> : <span className="text-orange-700 font-bold">belum</span>}</td>
                <td className="p-2"><button onClick={() => downloadOne(r)} className="px-2 min-h-8 rounded-md border border-gray-300 bg-white font-bold">⬇</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > SHOW_LIMIT && <p className="text-xs text-gray-500 mt-1">Menampilkan {SHOW_LIMIT} dari {filtered.length} file. Pilih semua tetap mencakup seluruh hasil filter. Persempit filter bila perlu.</p>}
    </div>
  );
}