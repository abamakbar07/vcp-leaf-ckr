'use client';
import { useMemo, useState } from 'react';
import Modal from '@/components/scanner/Modal';
import type { InboundLog } from '@/lib/inbound';

interface Props {
  logs: InboundLog[];
  onDelete: (log: InboundLog) => void;
  onClose: () => void;
}

export default function InboundLogsModal({ logs, onDelete, onClose }: Props) {
  const [lot, setLot] = useState('');
  const lots = useMemo(() => Array.from(new Set(logs.map(l => l.lot_code))).sort(), [logs]);
  const rows = useMemo(() => logs.filter(l => !lot || l.lot_code === lot).sort((a, b) => b.id - a.id).slice(0, 200), [logs, lot]);

  return (
    <Modal title="Log Scan Inbound" onClose={onClose}>
      <select value={lot} onChange={e => setLot(e.target.value)} className="w-full min-h-11 border-2 border-gray-300 rounded-lg px-3 font-semibold mb-2 bg-white">
        <option value="">Semua LOT (terbaru 200)</option>
        {lots.map(l => <option key={l} value={l}>{l}</option>)}
      </select>
      <div className="max-h-[55vh] overflow-auto border border-gray-200 rounded-md">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-white sticky top-0">
            <tr><th className="p-2 text-left">LOT</th><th className="p-2 text-left">PMRUN</th><th className="p-2 text-left">CASEID</th><th className="p-2 text-left">SN (Last 8)</th><th className="p-2 text-left">KG</th><th className="p-2">Aksi</th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-3 text-center">Belum ada scan.</td></tr>}
            {rows.map(l => (
              <tr key={l.id} className={`border-b ${l.is_exception ? 'bg-orange-50' : ''}`}>
                <td className="p-2 font-bold">{l.lot_code}{l.is_exception && <span title={l.exception_reason || ''} className="ml-1 text-orange-700">⚠</span>}</td>
                <td className="p-2 font-mono">{l.pmi_run_no}</td>
                <td className="p-2 font-mono font-bold">{l.case_number}</td>
                <td className="p-2 font-mono text-gray-500">...{l.serial_number.slice(-8)}{l.wms_received_at && <span className="ml-1 text-green-700">✓WMS</span>}</td>
                <td className="p-2">{l.net_weight_kg} kg</td>
                <td className="p-2 text-center"><button onClick={() => onDelete(l)} className="px-3 min-h-9 rounded-md bg-red-600 text-white text-xs font-bold">Hapus</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">⚠ = scan dengan pengecualian (LOT di luar ASN / over qty / SN ada di ASN lain). Arahkan kursor/tekan lama untuk melihat alasannya.</p>
    </Modal>
  );
}