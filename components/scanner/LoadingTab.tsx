/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseHMSBarcode } from '@/lib/utils';
import DispatchModal from './DispatchModal';
import { Notify, Order } from './types';

interface Props {
  allOrders: Order[];
  whList: string[];
  defaultWH: string;
  checkerName: string;
  notify: Notify;
  onDone: () => void; // dipanggil setelah dispatch selesai (kembali ke tab Picking)
}

interface LoadLog { id: number; serial_number: string; is_loaded: boolean; net_weight_kg: number }

const whOf = (o: Order) => o.wh_id || 'WH01';
const ritOf = (o: Order) => o.arrival_time || '-';

export default function LoadingTab({ allOrders, whList, defaultWH, checkerName, notify, onDone }: Props) {
  const [wh, setWh] = useState(defaultWH);
  const [date, setDate] = useState('');
  const [rit, setRit] = useState('');
  const [logs, setLogs] = useState<LoadLog[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const dates = Array.from(new Set(allOrders.filter(o => whOf(o) === wh).map(o => o.arrival_date)));
  const rits = Array.from(new Set(allOrders.filter(o => whOf(o) === wh && o.arrival_date === date).map(ritOf)));

  const fetchLogs = useCallback(async (w: string, d: string, r: string) => {
    notify('⏳ Memuat data staging RIT...', 'warning', true);
    setPanelOpen(true);
    try {
      const poList = allOrders
        .filter(o => whOf(o) === w && o.arrival_date === d && ritOf(o) === r)
        .map(o => o.po_number);
      const { data, error } = await supabase.from('vcp-op-scan_logs')
        .select('id, serial_number, is_loaded, net_weight_kg')
        .eq('arrival_time', r)
        .in('po_number', poList);
      if (error) throw error;
      setLogs(data || []);
      setTimeout(() => inputRef.current?.focus(), 0);
    } catch (err: any) { notify(`❌ Error loading data: ${err.message}`, 'error'); }
  }, [allOrders, notify]);

  const onWh = (v: string) => { setWh(v); setDate(''); setRit(''); setLogs([]); setPanelOpen(false); };
  const onDate = (v: string) => { setDate(v); setRit(''); setLogs([]); setPanelOpen(false); };
  const onRit = (v: string) => {
    setRit(v);
    if (!v) { setPanelOpen(false); setLogs([]); return; }
    fetchLogs(wh, date, v);
  };

  const total = logs.length;
  const loaded = logs.filter(b => b.is_loaded).length;
  const pct = total > 0 ? Math.round((loaded / total) * 100) : 0;
  const canDispatch = total > 0 && loaded >= total;

  const handleScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = e.currentTarget.value.trim();
    e.currentTarget.value = '';
    if (!raw || busyRef.current) return;

    const parsed = parseHMSBarcode(raw);
    if (!parsed.isValid) return notify(`❌ ${parsed.message}`, 'error');

    const box = logs.find(b => b.serial_number === parsed.serialNumber);
    if (!box) return notify(`❌ SALAH BARANG! Box ${parsed.serialNumber} BUKAN milik RIT ini / Belum di-Picking!`, 'error');
    if (box.is_loaded) return notify('⚠️ DUPLIKAT! Box ini SUDAH tervalidasi masuk truk.', 'warning');

    busyRef.current = true;
    try {
      const { error } = await supabase.from('vcp-op-scan_logs')
        .update({ is_loaded: true, loaded_at: new Date().toISOString(), loaded_by: checkerName.trim() || 'anon' })
        .eq('id', box.id);
      if (error) throw error;
      setLogs(prev => prev.map(b => (b.id === box.id ? { ...b, is_loaded: true } : b)));
      notify('✅ VALID! Box Masuk Truk.', 'success');
    } catch (err: any) {
      notify(`❌ Gagal update status: ${err.message}`, 'error');
    } finally { busyRef.current = false; }
  };

  const selectCls = 'w-full min-h-12 border-2 border-gray-300 rounded-lg px-3 font-semibold bg-white disabled:opacity-50';

  return (
    <div className="bg-white p-4 rounded-lg shadow-sm border-t-4 border-orange-500">
      <h2 className="font-bold text-orange-600 mb-4">🚚 Validasi Muat Barang (Outbound)</h2>

      <div className="mb-3">
        <label className="block text-xs font-bold text-gray-500 mb-1">0. Warehouse (WHID):</label>
        <select value={wh} onChange={e => onWh(e.target.value)} className={selectCls}>
          <option value="">-- Pilih WHID --</option>
          {whList.map(w => <option key={w} value={w}>{w}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">1. Tanggal Kedatangan:</label>
          <select value={date} onChange={e => onDate(e.target.value)} disabled={!wh} className={selectCls}>
            <option value="">- Date -</option>
            {dates.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">2. Pilih RIT / Jam:</label>
          <select value={rit} onChange={e => onRit(e.target.value)} disabled={!date} className={selectCls}>
            <option value="">- RIT -</option>
            {rits.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
      </div>

      {panelOpen && (
        <div className="mt-3">
          <div className="bg-blue-50 border border-dashed border-orange-500 rounded-lg p-3 mb-3 text-sm">
            <div className="flex justify-between mb-1"><span>Total Box di Staging:</span><strong>{total} Box</strong></div>
            <div className="flex justify-between mb-2"><span>Tervalidasi Masuk Truk:</span><strong className="text-green-600">{loaded} Box</strong></div>
            <div className="bg-gray-200 rounded-md h-3.5 overflow-hidden">
              <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct >= 100 ? '#38a169' : '#dd6b20' }} />
            </div>
          </div>

          <div className="bg-orange-50 border-2 border-orange-500 rounded-lg p-3 mb-3 sticky top-0 z-40">
            <label className="block text-xs font-bold text-orange-600 mb-1">SCAN BOX MASUK TRUK (VALIDASI):</label>
            <input
              ref={inputRef}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={handleScan}
              placeholder="Scan Serial Number..."
              className="w-full min-h-14 border-2 border-orange-500 rounded-lg text-center font-mono font-bold text-xl tracking-wider focus:outline-none focus:ring-4 focus:ring-orange-200"
            />
          </div>

          <button
            onClick={() => setShowDispatch(true)}
            disabled={!canDispatch}
            className="w-full min-h-12 rounded-lg bg-green-700 text-white font-bold text-sm disabled:opacity-50"
          >
            📸 AMBIL 4 FOTO &amp; SELESAIKAN LOADING TRUK
          </button>
        </div>
      )}

      {showDispatch && (
        <DispatchModal
          whId={wh}
          loadDate={date}
          loadRit={rit}
          checkerName={checkerName}
          notify={notify}
          onClose={() => setShowDispatch(false)}
          onDone={() => { setShowDispatch(false); onDone(); }}
        />
      )}
    </div>
  );
}