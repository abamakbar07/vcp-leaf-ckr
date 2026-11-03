/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { uploadPhoto } from '@/lib/storage';
import Modal from './Modal';
import { Notify } from './types';

interface Props {
  whId: string;
  loadDate: string;
  loadRit: string;
  allLoaded: boolean; // foto AFTER hanya aktif kalau semua box sudah masuk truk
  checkerName: string;
  notify: Notify;
  onClose: () => void;
  onDone: () => void; // dipanggil hanya kalau ke-4 foto sudah lengkap
}

type PhotoKey = 'outBefore' | 'inBefore' | 'outAfter' | 'inAfter';

const COLUMN: Record<PhotoKey, string> = {
  outBefore: 'photo_trap_out_before_url',
  inBefore: 'photo_trap_in_before_url',
  outAfter: 'photo_trap_out_after_url',
  inAfter: 'photo_trap_in_after_url',
};
const LABEL: Record<PhotoKey, string> = {
  outBefore: '📷 Trap Luar (BEFORE)',
  inBefore: '📷 Trap Dalam (BEFORE)',
  outAfter: '📷 Trap Luar (AFTER)',
  inAfter: '📷 Trap Dalam (AFTER)',
};
const PREFIX: Record<PhotoKey, string> = {
  outBefore: 'trap_out_before', inBefore: 'trap_in_before', outAfter: 'trap_out_after', inAfter: 'trap_in_after',
};

export default function DispatchModal({ whId, loadDate, loadRit, allLoaded, checkerName, notify, onClose, onDone }: Props) {
  const wh = whId || 'WH01';
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [existing, setExisting] = useState<Partial<Record<PhotoKey, string>>>({});
  const [ritNum, setRitNum] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [files, setFiles] = useState<Record<PhotoKey, File | null>>({ outBefore: null, inBefore: null, outAfter: null, inAfter: null });
  const [busy, setBusy] = useState(false);

  // Cari sesi dispatch yang sudah ada untuk WH + tanggal + RIT ini (lewat orders.dispatch_id)
  useEffect(() => {
    (async () => {
      try {
        const { data: ord, error } = await supabase.from('vcp-op-orders').select('dispatch_id')
          .eq('arrival_date', loadDate).eq('arrival_time', loadRit).eq('wh_id', wh)
          .not('dispatch_id', 'is', null).limit(1);
        if (error) throw error;
        const id = ord?.[0]?.dispatch_id;
        if (id) {
          const { data: sess, error: e2 } = await supabase.from('vcp-op-outbound_dispatch_sessions').select('*').eq('id', id).single();
          if (e2) throw e2;
          setSessionId(sess.id);
          setRitNum(sess.rit_number || '');
          setVehicle(sess.vehicle_number || '');
          const ex: Partial<Record<PhotoKey, string>> = {};
          (Object.keys(COLUMN) as PhotoKey[]).forEach(k => { if (sess[COLUMN[k]]) ex[k] = sess[COLUMN[k]]; });
          setExisting(ex);
        }
      } catch (err: any) {
        notify(`❌ Gagal cek data dispatch: ${err.message}`, 'error');
      } finally { setLoadingExisting(false); }
    })();
  }, [wh, loadDate, loadRit, notify]);

  const setFile = (k: PhotoKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFiles(f => ({ ...f, [k]: e.target.files?.[0] || null }));

  const submit = async () => {
    const rn = ritNum.trim();
    const veh = vehicle.trim();
    if (!rn || !veh) return notify('❌ No. RIT dan Plat Kendaraan wajib diisi!', 'error');

    const keys = (Object.keys(COLUMN) as PhotoKey[]).filter(k => files[k]);
    if (keys.length === 0) return notify('❌ Pilih minimal 1 foto baru untuk disimpan.', 'error');

    setBusy(true);
    try {
      const folder = `dispatch_${wh}_${loadDate}_${loadRit}`;
      const urls: Partial<Record<PhotoKey, string>> = {};
      for (const k of keys) {
        const url = await uploadPhoto(files[k], folder, PREFIX[k]);
        if (url) urls[k] = url;
      }
      const patch: Record<string, string> = {};
      (Object.keys(urls) as PhotoKey[]).forEach(k => { patch[COLUMN[k]] = urls[k] as string; });

      if (sessionId) {
        // Lanjutan: update hanya kolom foto yang baru + data RIT/plat
        const { error } = await supabase.from('vcp-op-outbound_dispatch_sessions')
          .update({ rit_number: rn, vehicle_number: veh, ...patch }).eq('id', sessionId);
        if (error) throw error;
      } else {
        // Simpanan pertama: buat sesi, lalu link semua PO dengan tanggal + RIT + WHID yang sama
        const { data: sess, error } = await supabase.from('vcp-op-outbound_dispatch_sessions').insert([{
          dispatch_code: `DISP-${Date.now()}-${rn.replace(/\s+/g, '')}`,
          wh_id: wh, rit_number: rn, vehicle_number: veh, eta_time: loadRit,
          created_by: checkerName.trim() || 'anon', ...patch,
        }]).select().single();
        if (error) throw error;
        const { error: errOrder } = await supabase.from('vcp-op-orders').update({ dispatch_id: sess.id })
          .eq('arrival_date', loadDate).eq('arrival_time', loadRit).eq('wh_id', wh);
        if (errOrder) throw errOrder;
      }

      const merged = { ...existing, ...urls };
      const complete = (Object.keys(COLUMN) as PhotoKey[]).every(k => merged[k]);
      if (complete) {
        notify('🎉 Proses Muat Truk Selesai 100%!', 'success');
        onDone();
      } else {
        const sisa = (Object.keys(COLUMN) as PhotoKey[]).filter(k => !merged[k]).length;
        notify(`💾 Foto tersimpan. Sisa ${sisa} foto belum diambil, bisa dilanjutkan nanti.`, 'success');
        onClose();
      }
    } catch (err: any) {
      notify(`❌ Error Dispatch: ${err.message}`, 'error');
    } finally { setBusy(false); }
  };

  const photoField = (k: PhotoKey) => {
    const isAfter = k === 'outAfter' || k === 'inAfter';
    const locked = isAfter && !allLoaded && !existing[k];
    return (
      <div key={k} className="flex-1 min-w-[140px]">
        <label className="block text-[11px] font-bold text-gray-500 mb-1">
          {LABEL[k]} {existing[k] && <span className="text-green-700">✅ sudah ada</span>}
        </label>
        {existing[k] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={existing[k]} alt={LABEL[k]} className="w-full h-20 object-cover rounded-md mb-1 border border-gray-200" />
        )}
        <input type="file" accept="image/*" capture="environment" onChange={setFile(k)} disabled={locked}
          className="w-full text-xs p-1.5 border-2 border-dashed border-gray-300 rounded-md disabled:opacity-40" />
        {existing[k] && <p className="text-[10px] text-gray-400 mt-0.5">Pilih foto lagi untuk mengganti.</p>}
        {locked && <p className="text-[10px] text-orange-600 mt-0.5">Aktif setelah semua box masuk truk.</p>}
      </div>
    );
  };

  return (
    <Modal title="🚚 Foto Serrico & Dispatch" onClose={onClose} accent="border-orange-500">
      {loadingExisting ? (
        <p className="text-center text-gray-500 py-6">⏳ Mengecek data dispatch...</p>
      ) : (
        <>
          {sessionId && (
            <div className="mb-3 text-xs bg-blue-50 border border-blue-200 rounded-md p-2 text-blue-900">
              Melanjutkan sesi dispatch yang sudah tersimpan. Hanya foto baru yang diunggah.
            </div>
          )}
          <div className="flex gap-2 mb-3">
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-500 mb-1">No. RIT:</label>
              <input type="text" value={ritNum} onChange={e => setRitNum(e.target.value)} placeholder="Contoh: RIT 1"
                className="w-full min-h-12 border-2 border-gray-300 rounded-lg px-3 font-semibold" />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-gray-500 mb-1">Plat Kendaraan:</label>
              <input type="text" value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="Contoh: B 1234 CD"
                className="w-full min-h-12 border-2 border-gray-300 rounded-lg px-3 font-semibold" />
            </div>
          </div>
          <hr className="border-dashed border-gray-300 my-3" />
          <div className="flex flex-wrap gap-2 mb-2">{photoField('outBefore')}{photoField('inBefore')}</div>
          <div className="flex flex-wrap gap-2 mb-4">{photoField('outAfter')}{photoField('inAfter')}</div>
          <button onClick={submit} disabled={busy} className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold disabled:opacity-60">
            {busy ? '⏳ Menyimpan...' : '💾 Simpan Foto'}
          </button>
        </>
      )}
    </Modal>
  );
}