/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

export default function LoadingValidation() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  const [activePO, setActivePO] = useState('');
  const [loadedItems, setLoadedItems] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState({ message: '', type: '' });

  // 1. Fetch Loaded Items (Realtime or Poll)
  const fetchLoadedItems = async (po: string) => {
    setIsLoading(true);
    const { data, error } = await supabase
      .from('vcp-op-scan_logs')
      .select('id, serial_number, lot_code, is_loaded')
      .eq('po_number', po)
      .eq('is_loaded', true)
      .order('scanned_at', { ascending: false });

    if (!error && data) setLoadedItems(data);
    setIsLoading(false);
  };

  // 2. Undo Loading Scan Feature
  const handleUndoLoad = async (logId: number, serialNumber: string) => {
    if (!confirm(`Batalkan loading untuk SN [${serialNumber}]?`)) return;
    
    // Revert the 'is_loaded' flag instead of deleting the row, 
    // keeping the item in the Picking phase.
    const { error } = await supabase
      .from('vcp-op-scan_logs')
      .update({ is_loaded: false })
      .eq('id', logId);

    if (error) {
      setFeedback({ message: `❌ Error: ${error.message}`, type: 'error' });
    } else {
      setFeedback({ message: `✅ Loading dibatalkan untuk SN ${serialNumber.slice(-8)}`, type: 'success' });
      setLoadedItems((prev) => prev.filter((item) => item.id !== logId));
    }
  };

  // 3. Generate Shareable Link Feature
  const handleGenerateLink = async () => {
    if (!activePO) {
      setFeedback({ message: '⚠️ Pilih PO terlebih dahulu!', type: 'warning' });
      return;
    }

    try {
      // Automatically uses the current deployment domain (localhost or Cloudflare Pages URL)
      const baseUrl = window.location.origin;
      const shareUrl = `${baseUrl}/dispatch/share/${activePO}`;
      
      await navigator.clipboard.writeText(shareUrl);
      setFeedback({ message: '🚀 Link Dispatch berhasil di-copy ke clipboard!', type: 'success' });
      
      // Optional: Update dispatch status in database
      await supabase.from('vcp-op-orders').update({ status: 'DISPATCHED' }).eq('po_number', activePO);
    } catch (err) {
      setFeedback({ message: '❌ Gagal copy link!', type: 'error' });
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      <h2 className="text-2xl font-bold mb-4 text-slate-800">Validasi Loading Outbound</h2>
      
      {/* Feedback Banner */}
      {feedback.message && (
        <div className={`p-3 mb-4 rounded ${feedback.type === 'error' ? 'bg-red-100 text-red-700' : feedback.type === 'warning' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
          {feedback.message}
        </div>
      )}

      {/* PO Selector */}
      <div className="flex gap-2 mb-6">
        <input
          type="text"
          placeholder="Masukkan Nomor PO"
          className="border p-2 rounded flex-1"
          value={activePO}
          onChange={(e) => setActivePO(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchLoadedItems(activePO)}
        />
        <button onClick={() => fetchLoadedItems(activePO)} className="bg-blue-600 text-white px-4 py-2 rounded">
          Load Data
        </button>
      </div>

      {/* Log Table with Undo Action */}
      <div className="bg-white shadow rounded overflow-hidden mb-6">
        <table className="w-full text-left">
          <thead className="bg-slate-100 border-b">
            <tr>
              <th className="p-3">LOT Code</th>
              <th className="p-3">Serial Number</th>
              <th className="p-3 text-center">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={3} className="p-4 text-center">Loading data...</td></tr>
            ) : loadedItems.length === 0 ? (
              <tr><td colSpan={3} className="p-4 text-center text-slate-500">Belum ada item yang di-load.</td></tr>
            ) : (
              loadedItems.map((item) => (
                <tr key={item.id} className="border-b">
                  <td className="p-3 font-semibold">{item.lot_code}</td>
                  <td className="p-3 font-mono">...{item.serial_number.slice(-8)}</td>
                  <td className="p-3 text-center">
                    <button 
                      onClick={() => handleUndoLoad(item.id, item.serial_number)}
                      className="bg-red-500 hover:bg-red-600 text-white px-3 py-1 rounded text-sm transition-colors"
                    >
                      Hapus Scan
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Generate Link Action */}
      <button 
        onClick={handleGenerateLink}
        className="w-full bg-slate-800 hover:bg-slate-900 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        <span>🚀 Selesaikan Loading & Generate Link</span>
      </button>
    </div>
  );
}