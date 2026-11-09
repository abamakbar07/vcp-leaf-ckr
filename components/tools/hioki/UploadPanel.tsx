/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPaged } from '@/lib/db';
import {
  HIOKI_BUCKET, HIOKI_TABLE, batchPrefix, dupKey, fmtBytes, planPaths, parseSelection, prefixToLabel,
  type HiokiSelection,
} from '@/lib/tools/hioki';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  collector: string;
  notify: (msg: string, type?: ToastType) => void;
}

type FileState = 'pending' | 'uploading' | 'done' | 'error';
const CONCURRENCY = 3;

export default function UploadPanel({ collector, notify }: Props) {
  const [sel, setSel] = useState<HiokiSelection | null>(null);
  const [dupKeys, setDupKeys] = useState<Set<string>>(new Set());
  const [skipDup, setSkipDup] = useState(false);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<Record<string, { s: FileState; msg?: string }>>({});
  const [pickedAt, setPickedAt] = useState<Date>(new Date());

  const inputRef = useRef<HTMLInputElement | null>(null);
  const batchRef = useRef<{ prefix: string; iso: string; plan: ReturnType<typeof planPaths> } | null>(null);

  // Atribut folder-picker diset manual (tidak ada di tipe React)
  useEffect(() => {
    inputRef.current?.setAttribute('webkitdirectory', '');
    inputRef.current?.setAttribute('directory', '');
  }, []);

  // Jangan sampai tab ditutup saat upload berjalan
  useEffect(() => {
    if (!running) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [running]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const s = parseSelection(list); // salin dulu sebelum input dikosongkan
    e.target.value = '';
    setSel(s); setStatus({}); batchRef.current = null; setPickedAt(new Date()); setSkipDup(false); setDupKeys(new Set());

    if (s.luw.length === 0) return notify('⚠️ Tidak ada file .luw di folder yang dipilih.', 'warning');

    // Cari file dengan nama + ukuran yang sama dari upload sebelumnya (hanya sebagai informasi / opsi lewati)
    setChecking(true);
    try {
      const serials = Array.from(new Set(s.luw.map(f => f.serial)));
      const rows = await fetchPaged<any>((from, to) =>
        supabase.from(HIOKI_TABLE).select('serial_device, original_name, size_bytes').in('serial_device', serials).order('id').range(from, to));
      setDupKeys(new Set(rows.map(r => dupKey(r.serial_device, r.original_name, Number(r.size_bytes)))));
    } catch (err: any) {
      notify(`⚠️ Gagal cek riwayat upload: ${err.message}`, 'warning');
    } finally { setChecking(false); }
  };

  const isDup = (f: { serial: string; name: string; size: number }) => dupKeys.has(dupKey(f.serial, f.name, f.size));

  const queue = useMemo(() => (sel ? sel.luw.filter(f => !(skipDup && isDup(f))) : []), [sel, skipDup, dupKeys]); // eslint-disable-line react-hooks/exhaustive-deps
  const dupCount = useMemo(() => (sel ? sel.luw.filter(isDup).length : 0), [sel, dupKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const bySerial = useMemo(() => {
    const m = new Map<string, { count: number; size: number; dup: number; names: string[] }>();
    sel?.luw.forEach(f => {
      const cur = m.get(f.serial) || { count: 0, size: 0, dup: 0, names: [] };
      cur.count += 1; cur.size += f.size; cur.names.push(f.name);
      if (isDup(f)) cur.dup += 1;
      m.set(f.serial, cur);
    });
    return Array.from(m.entries());
  }, [sel, dupKeys]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSt = (id: string, s: FileState, msg?: string) => setStatus(p => ({ ...p, [id]: { s, msg } }));

  const start = async () => {
    if (!sel || queue.length === 0) return;
    if (!collector.trim()) return notify('⚠️ Isi nama collector di bagian atas dulu.', 'warning');

    // Prefix diambil sekali saat upload dimulai; percobaan ulang memakai prefix yang sama
    if (!batchRef.current) {
      const d = new Date();
      const prefix = batchPrefix(d);
      batchRef.current = { prefix, iso: d.toISOString(), plan: planPaths(sel.luw, prefix) };
    }
    const { prefix, iso, plan } = batchRef.current;
    const todo = queue.filter(f => status[f.id]?.s !== 'done');
    if (todo.length === 0) return;

    setRunning(true);
    queue.forEach(f => { if (status[f.id]?.s !== 'done') setSt(f.id, 'pending'); });

    let idx = 0; let ok = 0; let fail = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= todo.length) return;
        const f = todo[i];
        const { stored, path } = plan[f.id];
        setSt(f.id, 'uploading');
        try {
          const { error } = await supabase.storage.from(HIOKI_BUCKET).upload(path, f.file, { contentType: 'application/octet-stream', upsert: true });
          if (error) throw error;
          const { error: e2 } = await supabase.from(HIOKI_TABLE).insert([{
            batch_id: prefix, batch_at: iso, serial_device: f.serial, original_name: f.name, stored_name: stored,
            storage_path: path, size_bytes: f.size, file_modified_at: new Date(f.file.lastModified).toISOString(),
            source_path: f.relPath, uploaded_by: collector.trim(),
          }]);
          // 23505 = baris sudah ada (percobaan ulang), anggap sukses
          if (e2 && (e2 as any).code !== '23505') {
            await supabase.storage.from(HIOKI_BUCKET).remove([path]);
            throw e2;
          }
          setSt(f.id, 'done'); ok += 1;
        } catch (err: any) {
          setSt(f.id, 'error', err.message || String(err)); fail += 1;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
    setRunning(false);
    if (fail === 0) notify(`🎉 ${ok} file berhasil diupload dengan prefix ${prefix}_`, 'success');
    else notify(`⚠️ ${ok} berhasil, ${fail} gagal. Tekan "Ulangi yang gagal".`, 'warning');
  };

  const reset = () => { setSel(null); setStatus({}); batchRef.current = null; setDupKeys(new Set()); setSkipDup(false); };

  const counts = useMemo(() => {
    const vals = queue.map(f => status[f.id]?.s);
    return {
      done: vals.filter(v => v === 'done').length,
      error: vals.filter(v => v === 'error').length,
      uploading: vals.filter(v => v === 'uploading').length,
    };
  }, [queue, status]);

  const pct = queue.length > 0 ? Math.round((counts.done / queue.length) * 100) : 0;
  const totalSize = queue.reduce((s, f) => s + f.size, 0);
  const failedItems = sel ? queue.filter(f => status[f.id]?.s === 'error') : [];
  const finished = queue.length > 0 && counts.done === queue.length;
  const started = Object.keys(status).length > 0;
  const examplePrefix = batchRef.current?.prefix ?? batchPrefix(pickedAt);

  return (
    <div>
      <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <h2 className="font-bold text-gray-900 mb-1">1. Pilih folder induk</h2>
        <p className="text-xs text-gray-500 mb-3">
          Pilih folder induk hasil ekstrak (struktur <code className="bg-gray-100 px-1 rounded">data/hioki/serial_device/file.luw</code>). Semua file <strong>.luw</strong> di dalamnya
          terdeteksi otomatis, nama folder serial dibaca sebagai serial device. Folder induk mana pun boleh dipilih (<em>data</em>, <em>hioki</em>, atau langsung folder serial).
        </p>
        <input ref={inputRef} type="file" multiple onChange={onPick} disabled={running} className="hidden" id="hiokiFolder" />
        <label htmlFor="hiokiFolder" className={`block text-center min-h-14 leading-[3.5rem] rounded-lg font-bold text-sm cursor-pointer border-2 border-dashed border-amber-500 bg-amber-50 text-gray-900 ${running ? 'opacity-50 pointer-events-none' : ''}`}>
          📂 Pilih Folder
        </label>
        <p className="text-[11px] text-gray-400 mt-2">Gunakan browser di PC/laptop (Chrome, Edge, Firefox, Safari). Pemilih folder umumnya tidak tersedia di browser HP Android.</p>
      </section>

      {sel && (
        <>
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
            <div className="flex flex-wrap justify-between items-center gap-2 mb-3">
              <h2 className="font-bold text-gray-900">2. Hasil deteksi {sel.rootName && <span className="text-xs font-normal text-gray-500">(folder: {sel.rootName})</span>}</h2>
              <button onClick={reset} disabled={running} className="px-3 min-h-9 rounded-md border border-gray-300 bg-white text-xs font-bold disabled:opacity-50">✖ Ganti folder</button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <div className="rounded-md bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-500 font-bold uppercase">File .luw</div><div className="text-xl font-extrabold">{sel.luw.length}</div></div>
              <div className="rounded-md bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-500 font-bold uppercase">Serial device</div><div className="text-xl font-extrabold">{bySerial.length}</div></div>
              <div className="rounded-md bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-500 font-bold uppercase">Total ukuran</div><div className="text-xl font-extrabold">{fmtBytes(sel.luw.reduce((s, f) => s + f.size, 0))}</div></div>
              <div className="rounded-md bg-gray-50 border border-gray-200 p-2"><div className="text-[11px] text-gray-500 font-bold uppercase">Diabaikan</div><div className="text-xl font-extrabold">{sel.ignored}</div></div>
            </div>

            {sel.ignored > 0 && (
              <p className="text-xs text-gray-500 mb-2">Bukan .luw, tidak diupload: {Object.entries(sel.ignoredExt).map(([e, n]) => `${e} (${n})`).join(', ')}</p>
            )}
            {sel.luw.some(f => f.serial === 'UNKNOWN') && (
              <p className="text-xs text-red-700 font-semibold mb-2">⚠️ Ada file tanpa folder serial (serial = UNKNOWN). Pilih folder yang di dalamnya ada folder serial device.</p>
            )}

            <div className="overflow-auto border border-gray-200 rounded-md max-h-72">
              <table className="w-full text-xs">
                <thead className="bg-gray-900 text-white sticky top-0"><tr><th className="p-2 text-left">Serial device</th><th className="p-2 text-left">File</th><th className="p-2 text-left">Ukuran</th><th className="p-2 text-left">Sama dgn upload lama</th></tr></thead>
                <tbody>
                  {bySerial.map(([serial, v]) => (
                    <tr key={serial} className="border-b align-top">
                      <td className="p-2 font-bold">{serial}</td>
                      <td className="p-2">
                        <details><summary className="cursor-pointer">{v.count} file</summary>
                          <ul className="mt-1 text-[11px] text-gray-600 max-h-40 overflow-auto">{v.names.map(n => <li key={n}>{n}</li>)}</ul>
                        </details>
                      </td>
                      <td className="p-2">{fmtBytes(v.size)}</td>
                      <td className="p-2">{checking ? '...' : v.dup > 0 ? <span className="text-orange-700 font-bold">{v.dup} file</span> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
            <h2 className="font-bold text-gray-900 mb-2">3. Upload</h2>
            <div className="text-xs bg-amber-50 border border-amber-200 rounded-md p-2 mb-3">
              Nama file di server diberi prefix tanggal &amp; jam upload, contoh:<br />
              <code className="font-bold">{examplePrefix}_{sel.luw[0]?.name ?? 'namafile.luw'}</code>
              <div className="text-gray-500 mt-0.5">Jam final diambil saat tombol Upload ditekan{batchRef.current ? ` (batch ini: ${prefixToLabel(batchRef.current.prefix)})` : ''}. Satu kali upload = satu prefix yang sama untuk semua file.</div>
            </div>

            {dupCount > 0 && (
              <label className="flex items-start gap-2 text-xs mb-3 cursor-pointer">
                <input type="checkbox" checked={skipDup} disabled={running || started} onChange={e => setSkipDup(e.target.checked)} className="w-5 h-5 accent-gray-900 mt-0.5" />
                <span><strong>Lewati {dupCount} file yang nama &amp; ukurannya sama</strong> dengan upload sebelumnya.<br />
                  <span className="text-gray-500">Biarkan tidak dicentang kalau mau tetap menyimpan semuanya (aman, karena tiap upload punya prefix berbeda). File yang isinya berubah tapi ukurannya sama bisa ikut terlewati, jadi centang hanya bila yakin.</span></span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
              <span><strong>{queue.length}</strong> file ({fmtBytes(totalSize)}) akan diupload</span>
              {started && <span className="text-green-700 font-bold">✓ {counts.done}</span>}
              {counts.error > 0 && <span className="text-red-600 font-bold">✗ {counts.error}</span>}
            </div>
            <div className="bg-gray-200 rounded h-3 overflow-hidden mb-3"><div className={`h-full transition-all ${finished ? 'bg-green-700' : 'bg-amber-600'}`} style={{ width: `${pct}%` }} /></div>

            <button onClick={start} disabled={running || checking || queue.length === 0 || finished}
              className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold text-sm disabled:opacity-50">
              {running ? `⏳ Mengupload... ${counts.done}/${queue.length}` : finished ? '✅ Selesai' : counts.error > 0 ? `🔁 Ulangi yang gagal (${failedItems.length})` : `⬆️ Upload ${queue.length} File`}
            </button>

            {failedItems.length > 0 && !running && (
              <ul className="mt-3 space-y-1 max-h-48 overflow-auto">
                {failedItems.map(f => <li key={f.id} className="text-xs bg-red-50 text-red-800 rounded px-2 py-1"><strong>{f.serial}/{f.name}</strong>: {status[f.id]?.msg}</li>)}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}