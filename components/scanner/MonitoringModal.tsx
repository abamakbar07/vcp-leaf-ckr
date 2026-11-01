/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { uploadPhoto } from '@/lib/storage';
import Modal from './Modal';
import { Notify } from './types';

interface Props {
  po: string;
  rit: string;
  whId: string;
  totalTargetCT: number;
  checkerName: string;
  notify: Notify;
  onClose: () => void;
}

export default function MonitoringModal({ po, rit, whId, totalTargetCT, checkerName, notify, onClose }: Props) {
  const [kainMori, setKainMori] = useState('');
  const [photoMori, setPhotoMori] = useState<File | null>(null);
  const [photoOut, setPhotoOut] = useState<File | null>(null);
  const [photoIn, setPhotoIn] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  // Serrico trap = 1 per 20 CT, dibulatkan ke atas (sama seperti versi statis)
  const serricoQty = Math.ceil(totalTargetCT / 20);

  const submit = async () => {
    if (!kainMori.trim() || !photoMori || !photoOut || !photoIn) {
      return notify('❌ Nomor Kain Mori dan ke-3 Foto Wajib Diisi!', 'error');
    }
    setBusy(true);
    try {
      const urlMori = await uploadPhoto(photoMori, po, 'mori');
      const urlOut = await uploadPhoto(photoOut, po, 'serrico_out');
      const urlIn = await uploadPhoto(photoIn, po, 'serrico_in');

      const { error } = await supabase.from('vcp-op-staging_monitoring_logs').insert([{
        po_number: po, arrival_time: rit, wh_id: whId || 'WH01', nomor_kain_mori: kainMori.trim(),
        total_box: totalTargetCT, serrico_trap_qty: serricoQty,
        photo_mori_url: urlMori, photo_serrico_out_url: urlOut, photo_serrico_in_url: urlIn,
        inspected_by: checkerName.trim() || 'anon',
      }]);
      if (error) throw error;
      notify('✅ Monitoring Disimpan!', 'success');
      onClose();
    } catch (err: any) {
      notify(`❌ Error Upload: ${err.message}`, 'error');
    } finally { setBusy(false); }
  };

  const fileField = (label: string, setter: (f: File | null) => void) => (
    <div className="mb-3">
      <label className="block text-xs font-bold text-gray-500 mb-1">{label}</label>
      <input type="file" accept="image/*" capture="environment" onChange={e => setter(e.target.files?.[0] || null)}
        className="w-full text-sm p-1.5 border-2 border-dashed border-gray-300 rounded-md" />
    </div>
  );

  return (
    <Modal title={`📸 Monitoring Staging (PO: ${po})`} onClose={onClose}>
      <div className="mb-3">
        <label className="block text-xs font-bold text-gray-500 mb-1">Nomor Kain Mori:</label>
        <input type="text" value={kainMori} onChange={e => setKainMori(e.target.value)} placeholder="Contoh: KM-0812"
          className="w-full min-h-12 border-2 border-gray-300 rounded-lg px-3 font-semibold" />
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Total Box:</label>
          <input readOnly value={totalTargetCT} className="w-full min-h-12 border-2 border-gray-200 bg-gray-100 rounded-lg px-3 font-semibold" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">Serrico Qty:</label>
          <input readOnly value={serricoQty} className="w-full min-h-12 border-2 border-gray-200 bg-gray-100 rounded-lg px-3 font-semibold" />
        </div>
      </div>
      <hr className="border-dashed border-gray-300 my-3" />
      {fileField('📷 Foto Material + Kain Mori:', setPhotoMori)}
      {fileField('📷 Foto Serrico (Luar):', setPhotoOut)}
      {fileField('📷 Foto Serrico (Dalam):', setPhotoIn)}
      <button onClick={submit} disabled={busy} className="w-full min-h-12 rounded-lg bg-blue-600 text-white font-bold disabled:opacity-60">
        {busy ? '⏳ Mengunggah Data...' : '💾 Simpan Evidence Monitoring'}
      </button>
    </Modal>
  );
}