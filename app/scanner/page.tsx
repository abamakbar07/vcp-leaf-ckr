/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { parseHMSBarcode, playAudio, triggerHaptic, getISOWeek } from '@/lib/utils';
import type { ParsedBarcode } from '@/lib/utils';
import { Package, Truck } from 'lucide-react';
import BypassModal from '@/components/scanner/BypassModal';
import LogsModal from '@/components/scanner/LogsModal';
import MonitoringModal from '@/components/scanner/MonitoringModal';
import LoadingTab from '@/components/scanner/LoadingTab';
import type { FeedbackType, Notify, Order, OrderItem } from '@/components/scanner/types';

type ValidBarcode = Extract<ParsedBarcode, { isValid: true }>;

const whOf = (o: Order) => o.wh_id || 'WH01';
const ritOf = (o: Order) => o.arrival_time || '-';

export default function ScannerApp() {
  // --- STATES UTAMA ---
  const [activeTab, setActiveTab] = useState<'picking' | 'loading'>('picking');
  const [checkerName, setCheckerName] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('hms_checker_name') || '' : ''
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const [feedback, setFeedback] = useState<{ msg: string; type: FeedbackType } | null>(null);
  const [flash, setFlash] = useState<FeedbackType | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- STATES DROPDOWN & DATA ---
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [whList, setWhList] = useState<string[]>([]);
  const [activeWH, setActiveWH] = useState('');
  const [activeWeek, setActiveWeek] = useState('');
  const [activeDate, setActiveDate] = useState('');
  const [activeRit, setActiveRit] = useState('');
  const [activePO, setActivePO] = useState('');

  const [poItems, setPoItems] = useState<OrderItem[]>([]);
  const poItemsRef = useRef<OrderItem[]>([]); // dibaca saat scan (hindari state basi)
  const skuRef = useRef<Map<string, number>>(new Map());

  // --- STATES UI ---
  const [isManual, setIsManual] = useState(false);
  const [manualPo, setManualPo] = useState('');
  const [keyboardOn, setKeyboardOn] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showMon, setShowMon] = useState(false);
  const [pendingScan, setPendingScan] = useState<{ parsed: ValidBarcode; po: string; rit: string; message: string } | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  // --- FEEDBACK: suara + getar + flash + toast ---
  const notify: Notify = useCallback((msg, type, silent = false) => {
    if (!silent) {
      playAudio(type);
      triggerHaptic(type);
      setFlash(type);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), type === 'error' ? 800 : 400);
    }
    setFeedback({ msg, type });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setFeedback(null), 4500);
  }, []);

  const applyItems = useCallback((items: OrderItem[]) => {
    poItemsRef.current = items;
    setPoItems(items);
  }, []);

  // --- EFFECT AWAL: nama checker, SKU master, orders ---
  useEffect(() => {
    async function initData() {
      const { data: skuData, error: skuError } = await supabase.from('vcp-op-sku_master').select('lot_code, std_net_weight_kg');
      if (skuError) console.error('Error loading SKU Master:', skuError);
      if (skuData) {
        const map = new Map<string, number>();
        skuData.forEach(item => map.set(item.lot_code, Number(item.std_net_weight_kg)));
        skuRef.current = map;
      }

      const { data: orderData, error: orderError } = await supabase.from('vcp-op-orders').select('*').order('arrival_date', { ascending: true });
      if (orderError) { console.error('Error loading Orders:', orderError); notify(`Gagal load PO: ${orderError.message}`, 'error'); }
      if (orderData) {
        setAllOrders(orderData);
        setWhList(Array.from(new Set(orderData.map(d => d.wh_id || 'WH01'))));
      }
    }
    initData();
    inputRef.current?.focus();
  }, [notify]);

  const onCheckerChange = (v: string) => {
    setCheckerName(v);
    localStorage.setItem('hms_checker_name', v.trim());
  };

  // --- LOAD DETAIL PO (parameter eksplisit supaya tidak bergantung state yang belum ter-update) ---
  const loadPODetails = useCallback(async (po: string, rit: string) => {
    if (!po || !rit) { applyItems([]); return; }
    try {
      const { data: items, error: itemsError } = await supabase
        .from('vcp-op-order_items').select('*').eq('po_number', po).eq('arrival_time', rit);
      if (itemsError) throw itemsError;

      const { data: logs, error: logsError } = await supabase
        .from('vcp-op-scan_logs').select('lot_code, net_weight_kg').eq('po_number', po).eq('arrival_time', rit);
      if (logsError) throw logsError;

      const processed = (items || []).map((item: any) => {
        const totalWeight = (logs || [])
          .filter(l => l.lot_code === item.lot_code)
          .reduce((sum, l) => sum + Number(l.net_weight_kg), 0);
        const std = skuRef.current.get(item.lot_code) || 200.0;
        return { ...item, scanned_ct: parseFloat((totalWeight / std).toFixed(2)) } as OrderItem;
      });
      applyItems(processed);
    } catch (err: any) {
      notify(`Gagal Load PO Detail: ${err.message}`, 'error');
    }
  }, [applyItems, notify]);

  // --- HANDLER DROPDOWN (reset berjenjang, tabel LOT ikut dikosongkan) ---
  const resetPO = () => { setActivePO(''); applyItems([]); };
  const onWH = (v: string) => { setActiveWH(v); setActiveWeek(''); setActiveDate(''); setActiveRit(''); resetPO(); };
  const onWeek = (v: string) => { setActiveWeek(v); setActiveDate(''); setActiveRit(''); resetPO(); };
  const onDate = (v: string) => { setActiveDate(v); setActiveRit(''); resetPO(); };
  const onRit = (v: string) => { setActiveRit(v); resetPO(); };
  const onPO = async (v: string) => {
    setActivePO(v);
    await loadPODetails(v, activeRit);
    inputRef.current?.focus();
  };

  // --- INPUT MANUAL PO: auto-detect WHID, tanggal, RIT dari master ---
  const onManualEnter = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const val = manualPo.trim();
    if (!val) return;
    const matched = allOrders.find(o => o.po_number === val);
    if (!matched) {
      return notify(`❌ PO [${val}] tidak ditemukan di Master Data! Pastikan Admin sudah import Order.`, 'error');
    }
    setActiveWH(whOf(matched));
    setActiveWeek(getISOWeek(matched.arrival_date));
    setActiveDate(matched.arrival_date);
    setActiveRit(ritOf(matched));
    setActivePO(matched.po_number);
    notify(`🔍 PO Ditemukan! (RIT: ${ritOf(matched)} | Tgl: ${matched.arrival_date})`, 'success');
    await loadPODetails(matched.po_number, ritOf(matched));
    inputRef.current?.focus();
  };

  // --- SIMPAN SCAN ---
  const executeSaveScan = useCallback(async (parsed: ValidBarcode, po: string, rit: string, isBypassed: boolean) => {
    try {
      const { error } = await supabase.from('vcp-op-scan_logs').insert([{
        po_number: po, arrival_time: rit, serial_number: parsed.serialNumber,
        lot_code: parsed.lotCode, pmi_run_no: parsed.pmiRunNo, case_number: parsed.caseNo,
        gross_weight_kg: parsed.grossWeight, net_weight_kg: parsed.netWeight,
        moisture: parsed.moisture, grade_code: parsed.gradeCode,
        is_bypassed: isBypassed, scanned_by: checkerName.trim() || 'anon',
      }]);
      if (error) throw error;
      notify(`✅ [${parsed.lotCode}] SN OK!`, 'success');
      await loadPODetails(po, rit);
    } catch (err: any) {
      notify(`❌ DB Save Error: ${err.message}`, 'error');
    }
  }, [checkerName, loadPODetails, notify]);

  // --- PROSES SCAN (urutan validasi sama dengan versi statis) ---
  const processScan = useCallback(async (raw: string, po: string, rit: string) => {
    const parsed = parseHMSBarcode(raw);
    if (!parsed.isValid) return notify(`❌ ${parsed.message}`, 'error');

    const sku = skuRef.current;
    if (sku.size > 0 && !sku.has(parsed.lotCode)) {
      return notify(`⚠️ LOT [${parsed.lotCode}] BELUM TERDAFTAR di SKU Master! Contact Admin.`, 'error');
    }

    const matchedLot = poItemsRef.current.find(i => i.lot_code === parsed.lotCode);
    if (!matchedLot) return notify(`❌ LOT ${parsed.lotCode} TIDAK ADA dalam PO ${po}!`, 'error');

    const std = sku.get(parsed.lotCode) || 200.0;
    const projectedCt = (matchedLot.scanned_ct || 0) + parsed.netWeight / std;
    if (projectedCt > Number(matchedLot.qty_usage_ct) + 0.05) {
      return notify(`❌ OVER PICKING! LOT [${parsed.lotCode}] sudah FULFILLED!`, 'error');
    }

    try {
      const { data: existing, error } = await supabase
        .from('vcp-op-scan_logs').select('po_number, arrival_time').eq('serial_number', parsed.serialNumber);
      if (error) throw error;

      if (existing && existing.length > 0) {
        if (existing.find(s => s.po_number === po && s.arrival_time === rit)) {
          return notify('❌ DUPLICATE SN! Barcode SUDAH DI-SCAN pada PO/RIT ini!', 'error');
        }
        // SN ada di PO lain -> hanya peringatan, operator boleh bypass
        notify('⚠️ SN sudah pernah di-scan di PO lain', 'warning');
        setPendingScan({
          parsed, po, rit,
          message: `SN [${parsed.serialNumber}] SUDAH DI-SCAN di PO [${existing[0].po_number}] Jam [${existing[0].arrival_time}]. Tetap masukkan ke sini?`,
        });
        return;
      }
    } catch (err: any) {
      return notify(`❌ DB Error: ${err.message}`, 'error');
    }

    await executeSaveScan(parsed, po, rit, false);
  }, [executeSaveScan, notify]);

  // Baca nilai langsung dari input (bukan state) + antrekan scan supaya tidak balapan
  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = e.currentTarget.value.trim();
    e.currentTarget.value = '';
    if (!raw || pendingScan) return;
    if (!activePO) return notify('⚠️ Tolong PILIH PO TARGET terlebih dahulu!', 'warning');

    const po = activePO, rit = activeRit;
    queueRef.current = queueRef.current.then(() => processScan(raw, po, rit)).catch(() => {});
  };

  const confirmBypass = useCallback(async () => {
    if (!pendingScan) return;
    const { parsed, po, rit } = pendingScan;
    setPendingScan(null);
    await executeSaveScan(parsed, po, rit, true);
    inputRef.current?.focus();
  }, [pendingScan, executeSaveScan]);

  const cancelBypass = useCallback(() => {
    setPendingScan(null);
    inputRef.current?.focus();
  }, []);

  // --- COPY WA ---
  const copyWA = () => {
    if (!activePO || poItems.length === 0) return;
    const totalTarget = poItems.reduce((s, i) => s + Number(i.qty_usage_ct), 0);
    const totalScanned = poItems.reduce((s, i) => s + Number(i.scanned_ct || 0), 0);
    const pct = totalTarget > 0 ? Math.round((totalScanned / totalTarget) * 100) : 0;
    const lotBreakdown = poItems
      .map(i => `  ${(i.scanned_ct || 0) >= i.qty_usage_ct ? '✅' : (i.scanned_ct || 0) > 0 ? '⚠️' : '⬜'} *${i.lot_code}*: ${i.scanned_ct || 0}/${i.qty_usage_ct} CT`)
      .join('\n');
    const msg = `${totalScanned >= totalTarget ? '✅ *PO FULFILLED*' : '⏳ *PO IN-PROGRESS*'}
🏢 *WHID:* ${activeWH || 'WH01'}
📅 *TGL:* ${activeDate || '-'} | 🕒 *RIT/JAM:* ${activeRit || '-'}
📌 *PO NUMBER:* ${activePO}
📦 *BLEND:* ${poHeader?.blend_code || poItems[0].blend_code || '-'}
👤 *PIC:* ${checkerName.trim() || 'Operator Gudang'}

📊 *PROGRESS OVERALL:* ${totalScanned.toFixed(1)} / ${totalTarget} CT (${pct}%)
*BREAKDOWN LOT:*
${lotBreakdown}
_Reported via VCP-OP RF Scanner App_`;
    navigator.clipboard.writeText(msg).then(() => notify('📋 Laporan WA di-copy!', 'success'));
  };

  // --- DROPDOWN TURUNAN (fallback WH01 dan '-' sama seperti versi statis) ---
  const byWH = allOrders.filter(o => whOf(o) === activeWH);
  const filteredWeeks = Array.from(new Set(byWH.map(o => getISOWeek(o.arrival_date))));
  const filteredDates = Array.from(new Set(byWH.filter(o => getISOWeek(o.arrival_date) === activeWeek).map(o => o.arrival_date)));
  const filteredRits = Array.from(new Set(byWH.filter(o => o.arrival_date === activeDate).map(ritOf)));
  const filteredPOs = byWH.filter(o => o.arrival_date === activeDate && ritOf(o) === activeRit);

  const poHeader = allOrders.find(o => o.po_number === activePO && ritOf(o) === activeRit);
  const totalTargetCT = poItems.reduce((s, i) => s + Number(i.qty_usage_ct), 0);
  const totalScannedCT = poItems.reduce((s, i) => s + Number(i.scanned_ct || 0), 0);
  const pct = totalTargetCT > 0 ? Math.min(100, Math.round((totalScannedCT / totalTargetCT) * 100)) : 0;

  // Klik di area kosong -> fokus kembali ke input scan (kecuali sedang di modal / tab lain)
  const handleRootClick = (e: React.MouseEvent) => {
    if (activeTab !== 'picking' || pendingScan || showLogs || showMon) return;
    if ((e.target as HTMLElement).closest('button,select,input,textarea,a,label')) return;
    inputRef.current?.focus();
  };

  const toggleKeyboard = () => {
    setKeyboardOn(v => !v);
    setTimeout(() => { inputRef.current?.blur(); inputRef.current?.focus(); }, 0);
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold disabled:opacity-50';
  const lblCls = 'block text-xs font-bold mb-1 text-gray-500';

  return (
    <div onClick={handleRootClick} className="max-w-3xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">

      {/* FLASH LAYAR */}
      {flash && (
        <div className={`fixed inset-0 z-[9999] pointer-events-none opacity-80 ${
          flash === 'success' ? 'bg-green-700' : flash === 'warning' ? 'bg-amber-500' : 'bg-red-600'}`} />
      )}

      {/* HEADER GLOBALS */}
      <header className="bg-white shadow-sm rounded-lg p-4 mb-4 flex justify-between items-center border border-gray-200">
        <div>
          <h1 className="font-bold text-lg text-blue-900">VCP-OP RF Scanner</h1>
          <p className="text-xs text-gray-500">Warehouse Fulfillment System</p>
        </div>
        <a href="/admin" className="text-xs font-bold text-blue-600 hover:underline">⚙️ Admin Portal</a>
      </header>

      {/* TOAST FEEDBACK (fixed di bawah, tinggi & kontras) */}
      {feedback && (
        <div className={`fixed left-2.5 right-2.5 bottom-3 z-[900] max-w-3xl mx-auto p-4 rounded-xl text-center font-extrabold text-base shadow-2xl ${
          feedback.type === 'success' ? 'bg-green-700 text-white' :
          feedback.type === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-gray-900'}`}>
          {feedback.msg}
        </div>
      )}

      {/* TABS NAVIGATION */}
      <div className="flex bg-white rounded-lg shadow-sm mb-4 overflow-hidden border border-gray-200">
        <button
          onClick={() => { setActiveTab('picking'); setTimeout(() => inputRef.current?.focus(), 0); }}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 transition ${activeTab === 'picking' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          <Package size={16} /> 1. PICKING &amp; STAGING
        </button>
        <button
          onClick={() => setActiveTab('loading')}
          className={`flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 transition ${activeTab === 'loading' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}
        >
          <Truck size={16} /> 2. VALIDASI LOADING
        </button>
        <a href="/dashboard" className="flex-1 py-3 text-xs font-bold flex items-center justify-center gap-2 bg-gray-100 text-gray-600 no-underline">
          📊 3. DASHBOARD
        </a>
      </div>

      {/* --- TAB: PICKING --- */}
      {activeTab === 'picking' && (
        <>
          <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 mb-3">
            <div className="flex justify-between items-center flex-wrap gap-2 mb-3">
              <span className="font-bold text-base text-gray-900">Pilih PO</span>
              {activePO && (
                <div className="flex gap-2">
                  <button onClick={() => setShowLogs(true)} className="px-3 min-h-10 rounded-md bg-amber-600 text-white text-xs font-bold">📋 Log</button>
                  <button onClick={copyWA} className="px-3 min-h-10 rounded-md bg-green-600 text-white text-xs font-bold">📱 Copy WA</button>
                </div>
              )}
            </div>

            <div className="mb-4 pb-4 border-b border-gray-100">
              <label className={lblCls}>👤 NAMA CHECKER (PIC):</label>
              <input
                type="text" value={checkerName} onChange={e => onCheckerChange(e.target.value)}
                placeholder="Ketik nama Anda..."
                className="w-full border-2 border-blue-400 rounded-md p-2 font-bold focus:outline-none focus:border-blue-600"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className={lblCls}>1. WAREHOUSE (WHID):</label>
                <select value={activeWH} onChange={e => onWH(e.target.value)} className={selCls}>
                  <option value="">-- Pilih WHID --</option>
                  {whList.map(wh => <option key={wh} value={wh}>{wh}</option>)}
                </select>
              </div>
              <div>
                <label className={lblCls}>2. WEEK KEDATANGAN:</label>
                <select value={activeWeek} onChange={e => onWeek(e.target.value)} disabled={!activeWH} className={selCls}>
                  <option value="">- Pilih Week -</option>
                  {filteredWeeks.map(w => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
              <div>
                <label className={lblCls}>3. TANGGAL KEDATANGAN:</label>
                <select value={activeDate} onChange={e => onDate(e.target.value)} disabled={!activeWeek} className={selCls}>
                  <option value="">- Pilih Tanggal -</option>
                  {filteredDates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={lblCls}>4. RIT / JAM (TIME):</label>
                <select value={activeRit} onChange={e => onRit(e.target.value)} disabled={!activeDate} className={selCls}>
                  <option value="">- Pilih RIT -</option>
                  {filteredRits.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>

            <div className="mb-2">
              <div className="flex justify-between items-center">
                <label className={lblCls}>5. PO TARGET AKTIF:</label>
                <span onClick={() => setIsManual(v => !v)} className="text-xs font-semibold text-yellow-800 underline cursor-pointer pb-1">
                  {isManual ? 'Gunakan Dropdown' : 'Input Manual PO?'}
                </span>
              </div>
              {!isManual ? (
                <select value={activePO} onChange={e => onPO(e.target.value)} disabled={!activeRit}
                  className="w-full border-2 border-blue-400 rounded-md p-2 bg-white font-bold text-blue-900 disabled:opacity-50 focus:outline-none">
                  <option value="">-- Pilih PO Target --</option>
                  {filteredPOs.map(po => <option key={po.po_number} value={po.po_number}>PO: {po.po_number} ({po.blend_code || '-'})</option>)}
                </select>
              ) : (
                <input
                  type="text" autoFocus value={manualPo} onChange={e => setManualPo(e.target.value)} onKeyDown={onManualEnter}
                  placeholder="Ketik Nomor PO Manual lalu Enter..."
                  className="w-full border-2 border-blue-400 rounded-md p-2 font-bold focus:outline-none"
                />
              )}
            </div>

            {/* PO SUMMARY */}
            {activePO && poItems.length > 0 && (
              <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div><strong>RIT:</strong> {activeRit || '-'} | <strong>Blend:</strong> {poHeader?.blend_code || poItems[0].blend_code || '-'} | <strong>Tgl:</strong> {activeDate || '-'}</div>
                <div className="mt-1">
                  <strong>Progress PO:</strong>{' '}
                  <span className="font-extrabold tabular-nums">{totalScannedCT.toFixed(1)} / {totalTargetCT} CT ({pct}%)</span>
                  <div className="bg-gray-200 rounded-md h-3.5 overflow-hidden mt-1.5">
                    <div className={`h-full transition-all ${pct >= 100 ? 'bg-green-700' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <button onClick={() => setShowMon(true)} className="mt-2 w-full min-h-10 rounded-md bg-amber-600 text-white text-xs font-bold">
                  📸 Monitoring Staging
                </button>
              </div>
            )}
          </div>

          {/* INPUT SCAN (sticky, keyboard HP mati default) */}
          <div className="sticky top-0 z-50 bg-neutral-900 border-2 border-neutral-700 focus-within:border-amber-500 rounded-lg p-3 mb-3 shadow-lg">
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-xs font-bold text-amber-200">Scan barcode (31 karakter)</label>
              <button type="button" onClick={toggleKeyboard}
                className={`min-h-8 px-2.5 text-xs font-semibold rounded-md border ${keyboardOn ? 'bg-amber-500 border-amber-500 text-gray-900' : 'border-neutral-500 text-neutral-200'}`}>
                ⌨ Keyboard
              </button>
            </div>
            <input
              ref={inputRef}
              type="text"
              onKeyDown={handleScan}
              inputMode={keyboardOn ? 'text' : 'none'}
              autoFocus
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="Siap scan..."
              className="w-full min-h-14 border-2 border-amber-500 rounded-lg text-center font-mono font-bold text-xl tracking-wider text-gray-900 focus:outline-none focus:ring-4 focus:ring-amber-300"
            />
          </div>

          {/* TABEL LOT */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 p-2 font-bold text-xs text-gray-700">Target Lot Progress</div>
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-900 text-white sticky top-0">
                  <tr><th className="p-2">LOT</th><th className="p-2">TARGET</th><th className="p-2">SCANNED</th><th className="p-2">STATUS</th></tr>
                </thead>
                <tbody>
                  {poItems.length === 0 && (
                    <tr><td colSpan={4} className="p-3 text-center text-gray-400">
                      {activePO ? 'Tidak ada LOT' : 'Pilih PO untuk menampilkan LOT'}
                    </td></tr>
                  )}
                  {poItems.map(item => {
                    const sc = item.scanned_ct || 0;
                    const done = sc >= item.qty_usage_ct;
                    return (
                      <tr key={item.lot_code} className="border-b">
                        <td className="p-2 font-bold">{item.lot_code}</td>
                        <td className="p-2">{item.qty_usage_ct} CT</td>
                        <td className="p-2 text-blue-600 font-bold">{sc} CT</td>
                        <td className="p-2">
                          <span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold ${
                            done ? 'bg-green-100 text-green-900' : sc > 0 ? 'bg-orange-100 text-orange-900' : 'bg-gray-200 text-gray-600'}`}>
                            {done ? 'DONE' : sc > 0 ? 'PARTIAL' : 'OPEN'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* --- TAB: LOADING --- */}
      {activeTab === 'loading' && (
        <LoadingTab
          allOrders={allOrders}
          whList={whList}
          defaultWH={activeWH}
          checkerName={checkerName}
          notify={notify}
          onDone={() => { setActiveTab('picking'); setTimeout(() => inputRef.current?.focus(), 0); }}
        />
      )}

      {/* --- MODALS --- */}
      {pendingScan && <BypassModal message={pendingScan.message} onConfirm={confirmBypass} onCancel={cancelBypass} />}
      {showLogs && activePO && (
        <LogsModal
          po={activePO} rit={activeRit} notify={notify}
          onClose={() => { setShowLogs(false); inputRef.current?.focus(); }}
          onChanged={() => loadPODetails(activePO, activeRit)}
        />
      )}
      {showMon && activePO && (
        <MonitoringModal
          po={activePO} rit={activeRit} whId={activeWH} totalTargetCT={totalTargetCT}
          checkerName={checkerName} notify={notify}
          onClose={() => { setShowMon(false); inputRef.current?.focus(); }}
        />
      )}
    </div>
  );
}