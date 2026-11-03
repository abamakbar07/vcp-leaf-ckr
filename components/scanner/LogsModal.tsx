/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import Modal from './Modal';
import { Notify } from './types';

interface Props {
  po: string;
  rit: string;
  onClose: () => void;
  onChanged: () => void; // refresh progress PO setelah hapus
  notify: Notify;
}

interface LogRow { id: number; serial_number: string; lot_code: string; pmi_run_no: string; case_number: string; net_weight_kg: number }

export default function LogsModal({ po, rit, onClose, onChanged, notify }: Props) {
  const [logs, setLogs] = useState<LogRow[] | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('vcp-op-scan_logs')
        .select('id, serial_number, lot_code, pmi_run_no, case_number, net_weight_kg')
        .eq('po_number', po)
        .eq('arrival_time', rit)
        .order('scanned_at', { ascending: false });
      if (error) throw error;
      setLogs(data || []);
    } catch (err: any) { setError(err.message); }
  }, [po, rit]);

  useEffect(() => { load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Yakin hapus scan item ini?')) return;
    try {
      const { error } = await supabase.from('vcp-op-scan_logs').delete().eq('id', id);
      if (error) throw error;
      notify('🗑️ Scan dihapus!', 'success');
      await load();
      onChanged();
    } catch (err: any) { notify(`❌ Error: ${err.message}`, 'error'); }
  };

  return (
    <Modal title={`Log Scan PO: ${po}`} onClose={onClose}>
      <div className="max-h-[60vh] overflow-auto border border-gray-200 rounded-md">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-white sticky top-0">
            <tr><th className="p-2 text-left">LOT</th><th className="p-2 text-left">PMRUN</th><th className="p-2 text-left">CASEID</th><th className="p-2 text-left">SN (Last 8)</th><th className="p-2 text-left">KG</th><th className="p-2">Aksi</th></tr>
          </thead>
          <tbody>
            {error && <tr><td colSpan={6} className="p-3 text-red-600">Error: {error}</td></tr>}
            {!error && logs === null && <tr><td colSpan={6} className="p-3 text-center">Loading...</td></tr>}
            {logs && logs.length === 0 && <tr><td colSpan={6} className="p-3 text-center">Belum ada scan.</td></tr>}
            {logs?.map(l => (
              <tr key={l.id} className="border-b border-gray-100">
                <td className="p-2 font-bold">{l.lot_code}</td>
                <td className="p-2 font-mono">{l.pmi_run_no}</td>
                <td className="p-2 font-mono font-bold">{l.case_number}</td>
                <td className="p-2 font-mono text-gray-500">...{l.serial_number.slice(-8)}</td>
                <td className="p-2">{l.net_weight_kg} kg</td>
                <td className="p-2 text-center">
                  <button onClick={() => remove(l.id)} className="px-3 min-h-9 rounded-md bg-red-600 text-white text-xs font-bold">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}