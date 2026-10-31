/* eslint-disable @typescript-eslint/no-explicit-any */
'use client'; // Wajib untuk interaksi klien dan hooks di App Router

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseHMSBarcode, playAudio, getISOWeek } from '@/lib/utils';
import { Package, Truck, User } from 'lucide-react';

// --- Tipe Data TypeScript (Disesuaikan dengan Skema vcp-op-*) ---
interface Order {
  wh_id: string;
  po_number: string;
  blend_code: string;
  arrival_date: string;
  arrival_time: string; // RIT
}

interface OrderItem {
  lot_code: string;
  qty_usage_ct: number;
  scanned_ct?: number; 
}

export default function ScannerApp() {
  // --- STATES UTAMA ---
  const [activeTab, setActiveTab] = useState<'picking' | 'loading'>('picking');
  const [checkerName, setCheckerName] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [feedback, setFeedback] = useState<{ msg: string; type: 'success'|'error'|'warning' } | null>(null);

  // --- STATES DROPDOWN & DATA ---
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [whList, setWhList] = useState<string[]>([]);
  
  const [activeWH, setActiveWH] = useState('');
  const [activeWeek, setActiveWeek] = useState('');
  const [activeDate, setActiveDate] = useState('');
  const [activeRit, setActiveRit] = useState('');
  const [activePO, setActivePO] = useState('');

  const [poItems, setPoItems] = useState<OrderItem[]>([]);
  const [skuMasterMap, setSkuMasterMap] = useState(new Map());

  // --- EFFECT AWAL: Load Master Data (Tabel Ber-Prefix vcp-op-) ---
  useEffect(() => {
    async function initData() {
      // Load SKU Master
      const { data: skuData, error: skuError } = await supabase.from('vcp-op-sku_master').select('lot_code, std_net_weight_kg');
      if (skuError) console.error("Error loading SKU Master:", skuError);
      
      if (skuData) {
        const map = new Map();
        skuData.forEach(item => map.set(item.lot_code, Number(item.std_net_weight_kg)));
        setSkuMasterMap(map);
      }

      // Load Semua Order
      const { data: orderData, error: orderError } = await supabase.from('vcp-op-orders').select('*').order('arrival_date', { ascending: true });
      if (orderError) console.error("Error loading Orders:", orderError);

      if (orderData) {
        setAllOrders(orderData);
        const uniqueWH = Array.from(new Set(orderData.map(d => d.wh_id || 'WH01')));
        setWhList(uniqueWH);
      }
    }
    initData();
    if (inputRef.current) inputRef.current.focus();
  }, []);

  // --- HELPER FEEDBACK ---
  const triggerFeedback = (msg: string, type: 'success'|'error'|'warning') => {
    setFeedback({ msg, type });
    playAudio(type);
    setTimeout(() => setFeedback(null), 4000);
  };

  // --- FUNGSI LOAD PO DETAILS (Tabel Ber-Prefix vcp-op-) ---
  const handlePOChange = async (poNumber: string) => {
    setActivePO(poNumber);
    if (!poNumber || !activeRit) {
        setPoItems([]);
        return;
    }

    try {
        const { data: items, error: itemsError } = await supabase
          .from('vcp-op-order_items')
          .select('*')
          .eq('po_number', poNumber)
          .eq('arrival_time', activeRit);
          
        if (itemsError) throw itemsError;

        const { data: logs, error: logsError } = await supabase
          .from('vcp-op-scan_logs')
          .select('lot_code, net_weight_kg')
          .eq('po_number', poNumber)
          .eq('arrival_time', activeRit);
          
        if (logsError) throw logsError;
        
        if(items) {
           const processedItems = items.map(item => {
              const lotLogs = (logs || []).filter(l => l.lot_code === item.lot_code);
              const totalWeightScanned = lotLogs.reduce((sum, l) => sum + Number(l.net_weight_kg), 0);
              const stdWeight = skuMasterMap.get(item.lot_code) || 200.0;
              const scannedCt = parseFloat((totalWeightScanned / stdWeight).toFixed(2));
              return { ...item, scanned_ct: scannedCt };
           });
           setPoItems(processedItems);
        }
    } catch(err: any) {
        triggerFeedback(`Gagal Load PO Detail: ${err.message}`, 'error');
    }
  };

  // --- HANDLER BARCODE (On Enter) ---
  const handleScan = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const scannedData = barcodeInput.trim();
      setBarcodeInput(''); 

      if (!activePO && activeTab === 'picking') {
          triggerFeedback('⚠️ Tolong PILIH PO TARGET terlebih dahulu!', 'warning');
          return;
      }

      if (activeTab === 'picking') {
        const parsed = parseHMSBarcode(scannedData);
        if (!parsed.isValid) {
          triggerFeedback(`❌ ${parsed.message}`, 'error');
          return;
        }

        if (skuMasterMap.size > 0 && !skuMasterMap.has(parsed.lotCode)) {
            triggerFeedback(`⚠️ LOT [${parsed.lotCode}] BELUM TERDAFTAR di SKU Master!`, 'error');
            return;
        }

        const matchedLot = poItems.find(i => i.lot_code === parsed.lotCode);
        if(!matchedLot) {
             triggerFeedback(`❌ LOT ${parsed.lotCode} TIDAK ADA dalam PO ${activePO}!`, 'error');
             return;
        }

        const stdNetWeight = skuMasterMap.get(parsed.lotCode) || 200.0;
        const scannedWeightCt = parsed.netWeight! / stdNetWeight;
        const projectedCt = (matchedLot.scanned_ct || 0) + scannedWeightCt;
        const maxAllowedCt = Number(matchedLot.qty_usage_ct);

        if (projectedCt > maxAllowedCt + 0.05) {
            triggerFeedback(`❌ OVER PICKING! LOT [${parsed.lotCode}] sudah FULFILLED!`, 'error');
            return;
        }
        
        // CHECK DUPLICATE SN (Tabel Ber-Prefix vcp-op-)
        try {
            const { data: existingSNs, error: snError } = await supabase
              .from('vcp-op-scan_logs')
              .select('po_number, arrival_time')
              .eq('serial_number', parsed.serialNumber);

            if (snError) throw snError;

            if (existingSNs && existingSNs.length > 0) {
              const samePOScan = existingSNs.find(s => s.po_number === activePO && s.arrival_time === activeRit);
              if (samePOScan) {
                triggerFeedback(`❌ DUPLICATE SN! Barcode SUDAH DI-SCAN pada PO/RIT ini!`, 'error');
                return;
              } else {
                // TODO: Implement Modal Bypass for React
                triggerFeedback(`⚠️ SN SUDAH DI-SCAN di PO [${existingSNs[0].po_number}]. (Bypass TBD)`, 'warning');
                return;
              }
            }
            
            // Insert Scan Log (Tabel Ber-Prefix vcp-op-)
            const { error: insertError } = await supabase
                .from('vcp-op-scan_logs')
                .insert([{
                  po_number: activePO,
                  arrival_time: activeRit,
                  serial_number: parsed.serialNumber,
                  lot_code: parsed.lotCode,
                  pmi_run_no: parsed.pmiRunNo,
                  case_number: parsed.caseNo,
                  gross_weight_kg: parsed.grossWeight,
                  net_weight_kg: parsed.netWeight,
                  moisture: parsed.moisture,
                  grade_code: parsed.gradeCode,
                  is_bypassed: false,
                  scanned_by: checkerName || 'anon'
                }]);
            
            if (insertError) throw insertError;
            
            triggerFeedback(`✅ [${parsed.lotCode}] SN Diterima!`, 'success');
            await handlePOChange(activePO); // Refresh Progress

        } catch (err: any) {
             triggerFeedback(`❌ DB Error: ${err.message}`, 'error');
        }

      } else if (activeTab === 'loading') {
          // Logika validasi loading
          triggerFeedback('✅ Proses Validasi Loading (Simulasi)', 'success');
      }
    }
  };

  // --- RENDER PERHITUNGAN DROPDOWN DINAMIS ---
  const filteredWeeks = Array.from(new Set(allOrders.filter(i => (i.wh_id || 'WH01') === activeWH).map(i => getISOWeek(i.arrival_date))));
  const filteredDates = Array.from(new Set(allOrders.filter(i => (i.wh_id || 'WH01') === activeWH && getISOWeek(i.arrival_date) === activeWeek).map(i => i.arrival_date)));
  const filteredRits = Array.from(new Set(allOrders.filter(i => (i.wh_id || 'WH01') === activeWH && i.arrival_date === activeDate).map(i => i.arrival_time)));
  const filteredPOs = allOrders.filter(i => (i.wh_id || 'WH01') === activeWH && i.arrival_date === activeDate && i.arrival_time === activeRit);

  return (
    <div className="max-w-3xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      
      {/* HEADER GLOBALS */}
      <header className="bg-white shadow-sm rounded-lg p-4 mb-4 flex justify-between items-center border border-gray-200">
        <div>
          <h1 className="font-bold text-lg text-blue-900">VCP-OP RF Scanner</h1>
          <p className="text-xs text-gray-500">Warehouse Fulfillment System</p>
        </div>
        <a href="/admin" className="text-xs font-bold text-blue-600 hover:underline">⚙️ Admin Portal</a>
      </header>

      {/* FEEDBACK BANNER */}
      {feedback && (
         <div className={`p-3 rounded-lg font-bold text-center mb-4 border ${
             feedback.type === 'success' ? 'bg-green-100 text-green-800 border-green-300' :
             feedback.type === 'error' ? 'bg-red-100 text-red-800 border-red-300' :
             'bg-yellow-100 text-yellow-800 border-yellow-300'
         }`}>
             {feedback.msg}
         </div>
      )}

      {/* TABS NAVIGATION */}
      <div className="flex bg-white rounded-lg shadow-sm mb-4 overflow-hidden border border-gray-200">
        <button 
          onClick={() => { setActiveTab('picking'); inputRef.current?.focus(); }}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 transition ${activeTab === 'picking' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          <Package size={16} /> 1. PICKING & STAGING
        </button>
        <button 
          onClick={() => { setActiveTab('loading'); inputRef.current?.focus(); }}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 transition ${activeTab === 'loading' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          <Truck size={16} /> 2. VALIDASI LOADING
        </button>
      </div>

      {/* --- CONTENT TAB: PICKING --- */}
      {activeTab === 'picking' && (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 animate-in fade-in">
          
          <div className="mb-4 pb-4 border-b border-gray-100">
            <label className="block text-xs font-bold mb-1 text-gray-500">👤 NAMA CHECKER (PIC):</label>
            <input 
              type="text" 
              value={checkerName}
              onChange={(e) => setCheckerName(e.target.value)}
              placeholder="Ketik nama Anda..." 
              className="w-full border-2 border-blue-400 rounded-md p-2 font-bold focus:outline-none focus:border-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
             <div>
                <label className="block text-xs font-bold mb-1 text-gray-500">1. WAREHOUSE (WHID):</label>
                <select value={activeWH} onChange={(e) => { setActiveWH(e.target.value); setActiveWeek(''); setActivePO(''); }} className="w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold">
                    <option value="">-- Pilih WHID --</option>
                    {whList.map(wh => <option key={wh} value={wh}>{wh}</option>)}
                </select>
             </div>
             <div>
                <label className="block text-xs font-bold mb-1 text-gray-500">2. WEEK KEDATANGAN:</label>
                <select value={activeWeek} onChange={(e) => { setActiveWeek(e.target.value); setActiveDate(''); setActivePO(''); }} disabled={!activeWH} className="w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold disabled:opacity-50">
                    <option value="">- Pilih Week -</option>
                    {filteredWeeks.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
             </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-bold mb-1 text-gray-500">3. TANGGAL KEDATANGAN:</label>
                <select value={activeDate} onChange={(e) => { setActiveDate(e.target.value); setActiveRit(''); setActivePO(''); }} disabled={!activeWeek} className="w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold disabled:opacity-50">
                    <option value="">- Pilih Tanggal -</option>
                    {filteredDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
             </div>
             <div>
                <label className="block text-xs font-bold mb-1 text-gray-500">4. RIT / JAM (TIME):</label>
                <select value={activeRit} onChange={(e) => { setActiveRit(e.target.value); setActivePO(''); }} disabled={!activeDate} className="w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold disabled:opacity-50">
                    <option value="">- Pilih RIT -</option>
                    {filteredRits.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
             </div>
          </div>

          <div className="mb-4">
             <label className="block text-xs font-bold mb-1 text-gray-500">5. PO TARGET AKTIF:</label>
             <select value={activePO} onChange={(e) => handlePOChange(e.target.value)} disabled={!activeRit} className="w-full border-2 border-blue-400 rounded-md p-2 bg-white font-bold text-blue-900 disabled:opacity-50 focus:outline-none">
                 <option value="">-- Pilih PO Target --</option>
                 {filteredPOs.map(po => <option key={po.po_number} value={po.po_number}>PO: {po.po_number} ({po.blend_code})</option>)}
             </select>
          </div>
          
          {/* TABEL PROGRESS */}
          {poItems.length > 0 && (
             <div className="mt-4 border border-gray-200 rounded-md overflow-hidden">
                <div className="bg-gray-100 p-2 font-bold text-xs text-gray-700">Target Lot Progress</div>
                <div className="max-h-48 overflow-y-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="p-2">LOT</th>
                                <th className="p-2">TARGET</th>
                                <th className="p-2">SCANNED</th>
                            </tr>
                        </thead>
                        <tbody>
                            {poItems.map(item => (
                                <tr key={item.lot_code} className="border-b">
                                    <td className="p-2 font-bold">{item.lot_code}</td>
                                    <td className="p-2">{item.qty_usage_ct} CT</td>
                                    <td className="p-2 text-blue-600 font-bold">{item.scanned_ct || 0} CT</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
             </div>
          )}
        </div>
      )}

      {/* --- CONTENT TAB: LOADING --- */}
      {activeTab === 'loading' && (
        <div className="bg-white p-4 rounded-lg shadow-sm border-t-4 border-orange-500 animate-in fade-in">
          <h2 className="font-bold text-orange-600 mb-4 flex items-center gap-2"><Truck size={18}/> Validasi Muat Barang (Outbound)</h2>
          <p className="text-gray-500 text-xs italic">Form loading akan diletakkan di sini...</p>
        </div>
      )}

      {/* GLOBAL BARCODE SCANNER INPUT */}
      <div className={`mt-4 p-4 rounded-lg border-2 ${activeTab === 'picking' ? 'bg-blue-50 border-blue-300' : 'bg-orange-50 border-orange-300'}`}>
        <label className={`block font-bold mb-2 text-xs ${activeTab === 'picking' ? 'text-blue-800' : 'text-orange-800'}`}>
           TEMBAK BARCODE (Validasi {activeTab === 'picking' ? 'Picking' : 'Loading'}):
        </label>
        <input 
          ref={inputRef}
          type="text" 
          value={barcodeInput}
          onChange={(e) => setBarcodeInput(e.target.value)}
          onKeyDown={handleScan}
          autoFocus
          className={`w-full border-2 p-3 rounded-lg text-center font-mono tracking-widest focus:outline-none focus:ring-4 ${activeTab === 'picking' ? 'border-blue-500 text-blue-800 focus:ring-blue-200' : 'border-orange-500 text-orange-800 focus:ring-orange-200'}`}
          placeholder="Scan Serial Number..."
        />
      </div>

    </div>
  );
}