/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Modal from './Modal';
import { Notify } from './types';

interface Props {
  whId: string;
  orderDate: string;
  lots: string[];
  onClose: () => void;
  onChanged: () => void;
  notify: Notify;
}

interface Row { id: number; serial_number: string; lot_code: string; pmi_run_no: string; case_number: string; net_weight_kg: number }

const LIMIT = 200;

export default function PickingLogsModal({ whId, orderDate, lots, onClose, onChanged, notify }: Props) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [lot, setLot] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      let q = supabase.from('vcp-op-picking_logs')
        .select('id, serial_number, lot_code, pmi_run_no, case_number, net_weight_kg')
        .eq('wh_id', whId).eq('order_date', orderDate)
        .order('scanned_at', { ascending: false }).limit(LIMIT);
      if (lot) q = q.eq('lot_code', lot);
      const { data, error } = await q;
      if (error) throw error;
      setRows(data || []);
    } catch (err: any) { setError(err.message); }
  }, [whId, orderDate, lot]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Yakin hapus scan picking ini?')) return;
    try {
      const { error } = await supabase.from('vcp-op-picking_logs').delete().eq('id', id);
      if (error) throw error;
      notify('🗑️ Scan picking dihapus!', 'success');
      await load();
      onChanged();
    } catch (err: any) { notify(`❌ Error: ${err.message}`, 'error'); }
  };

  return (
    <Modal title={`Log Picking: ${whId} • ${orderDate}`} onClose={onClose}>
      <select value={lot} onChange={e => { setRows(null); setLot(e.target.value); }}
        className="w-full min-h-11 border-2 border-gray-300 rounded-lg px-3 font-semibold mb-2 bg-white">
        <option value="">Semua LOT (terbaru {LIMIT})</option>
        {lots.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <div className="max-h-[55vh] overflow-auto border border-gray-200 rounded-md">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-white sticky top-0">
            <tr>
              <th className="p-2 text-left">LOT</th><th className="p-2 text-left">PMRUN</th><th className="p-2 text-left">CASEID</th>
              <th className="p-2 text-left">SN (Last 8)</th><th className="p-2 text-left">KG</th><th className="p-2">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={6} className="p-3 text-red-600">Error: {error}</td></tr>}
            {!error && rows === null && <tr><td colSpan={6} className="p-3 text-center">Loading...</td></tr>}
            {rows && rows.length === 0 && <tr><td colSpan={6} className="p-3 text-center">Belum ada scan.</td></tr>}
            {rows?.map(r => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="p-2 font-bold">{r.lot_code}</td>
                <td className="p-2 font-mono">{r.pmi_run_no}</td>
                <td className="p-2 font-mono font-bold">{r.case_number}</td>
                <td className="p-2 font-mono text-gray-500">...{r.serial_number.slice(-8)}</td>
                <td className="p-2">{r.net_weight_kg} kg</td>
                <td className="p-2 text-center">
                  <button onClick={() => remove(r.id)} className="px-3 min-h-9 rounded-md bg-red-600 text-white text-xs font-bold">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}