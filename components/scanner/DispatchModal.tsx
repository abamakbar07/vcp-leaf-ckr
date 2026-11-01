/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { uploadPhoto } from '@/lib/storage';
import Modal from './Modal';
import { Notify } from './types';

interface Props {
  whId: string;
  loadDate: string;
  loadRit: string;
  checkerName: string;
  notify: Notify;
  onClose: () => void;
  onDone: () => void;
}

type PhotoKey = 'outBefore' | 'inBefore' | 'outAfter' | 'inAfter';

export default function DispatchModal({ whId, loadDate, loadRit, checkerName, notify, onClose, onDone }: Props) {
  const [ritNum, setRitNum] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [photos, setPhotos] = useState<Record<PhotoKey, File | null>>({ outBefore: null, inBefore: null, outAfter: null, inAfter: null });
  const [busy, setBusy] = useState(false);

  const setPhoto = (k: PhotoKey) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setPhotos(p => ({ ...p, [k]: e.target.files?.[0] || null }));

  const submit = async () => {
    const rn = ritNum.trim();
    const veh = vehicle.trim();
    if (!rn || !veh || !photos.outBefore || !photos.inBefore || !photos.outAfter || !photos.inAfter) {
      return notify('❌ Semua field dan 4 Foto wajib diisi!', 'error');
    }
    setBusy(true);
    try {
      // Folder pakai tanggal+RIT (versi statis memakai activePO yang bisa null di tab Loading)
      const folder = `dispatch_${whId}_${loadDate}_${loadRit}`;
      const urlOutBefore = await uploadPhoto(photos.outBefore, folder, 'trap_out_before');
      const urlInBefore = await uploadPhoto(photos.inBefore, folder, 'trap_in_before');
      const urlOutAfter = await uploadPhoto(photos.outAfter, folder, 'trap_out_after');
      const urlInAfter = await uploadPhoto(photos.inAfter, folder, 'trap_in_after');

      const { data: sessionData, error: errSession } = await supabase.from('vcp-op-outbound_dispatch_sessions').insert([{
        dispatch_code: `DISP-${Date.now()}-${rn.replace(/\s+/g, '')}`,
        wh_id: whId || 'WH01', rit_number: rn, vehicle_number: veh, eta_time: loadRit,
        photo_trap_out_before_url: urlOutBefore, photo_trap_in_before_url: urlInBefore,
        photo_trap_out_after_url: urlOutAfter, photo_trap_in_after_url: urlInAfter,
        created_by: checkerName.trim() || 'anon',
      }]).select().single();
      if (errSession) throw errSession;

      // Update massal: semua PO dengan tanggal + RIT + WHID yang sama ter-link ke dispatch ini
      const { error: errOrder } = await supabase.from('vcp-op-orders')
        .update({ dispatch_id: sessionData.id })
        .eq('arrival_date', loadDate)
        .eq('arrival_time', loadRit)
        .eq('wh_id', whId || 'WH01');
      if (errOrder) throw errOrder;

      notify('🎉 Proses Muat Truk Selesai 100%!', 'success');
      onDone();
    } catch (err: any) {
      notify(`❌ Error Dispatch: ${err.message}`, 'error');
    } finally { setBusy(false); }
  };

  const fileField = (label: string, k: PhotoKey) => (
    <div className="flex-1 min-w-[140px]">
      <label className="block text-[11px] font-bold text-gray-500 mb-1">{label}</label>
      <input type="file" accept="image/*" capture="environment" onChange={setPhoto(k)}
        className="w-full text-xs p-1.5 border-2 border-dashed border-gray-300 rounded-md" />
    </div>
  );

  return (
    <Modal title="🚚 Proses Loading (Outbound)" onClose={onClose} accent="border-orange-500">
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
      <div className="flex flex-wrap gap-2 mb-2">
        {fileField('📷 Trap Luar (BEFORE):', 'outBefore')}
        {fileField('📷 Trap Dalam (BEFORE):', 'inBefore')}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {fileField('📷 Trap Luar (AFTER):', 'outAfter')}
        {fileField('📷 Trap Dalam (AFTER):', 'inAfter')}
      </div>
      <button onClick={submit} disabled={busy} className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold disabled:opacity-60">
        {busy ? '⏳ Memproses Loading...' : '🚀 Selesaikan Loading'}
      </button>
    </Modal>
  );
}