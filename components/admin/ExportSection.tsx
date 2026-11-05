/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchByPo, fetchPaged } from '@/lib/db';
import { writeWorkbook } from '@/lib/excel';
import { countDispatchPhotos, generateOutboundPdf } from '@/lib/pdfReport';
import type { ToastType } from '@/components/ui/Toast';

interface Props {
  orders: any[];
  notify: (msg: string, type?: ToastType) => void;
}

const keyOf = (o: any) => `${o.po_number}___${o.arrival_time}`;

export default function ExportSection({ orders, notify }: Props) {
  const [date, setDate] = useState('');
  const [rit, setRit] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState(false);
  const [manualPo, setManualPo] = useState('');
  const [busyXls, setBusyXls] = useState(false);

  const [sessions, setSessions] = useState<any[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [busyPdf, setBusyPdf] = useState(false);

  const dates = useMemo(() => Array.from(new Set(orders.map(o => o.arrival_date))).sort().reverse(), [orders]);
  const rits = useMemo(() => Array.from(new Set(orders.filter(o => !date || o.arrival_date === date).map(o => o.arrival_time))).sort(), [orders, date]);
  const visible = useMemo(() => orders.filter(o => (!date || o.arrival_date === date) && (!rit || o.arrival_time === rit)), [orders, date, rit]);

  // Filter berubah -> otomatis centang semua PO yang tampil (sama seperti versi lama)
  useEffect(() => { setSelected(new Set(visible.map(keyOf))); }, [visible]);

  const loadSessions = async () => {
    const { data } = await supabase.from('vcp-op-outbound_dispatch_sessions').select('*').order('created_at', { ascending: false }).limit(30);
    setSessions(data || []);
  };
  useEffect(() => { loadSessions(); }, []);

  const allVisibleChecked = visible.length > 0 && visible.every(o => selected.has(keyOf(o)));
  const toggleAll = (on: boolean) => setSelected(prev => {
    const n = new Set(prev);
    visible.forEach(o => (on ? n.add(keyOf(o)) : n.delete(keyOf(o))));
    return n;
  });
  const toggleOne = (k: string, on: boolean) => setSelected(prev => { const n = new Set(prev); if (on) n.add(k); else n.delete(k); return n; });

  const exportExcel = async () => {
    let selectedLabel = 'ALL';
    let poList: string[] | null = null;
    let pairs: Set<string> | null = null;

    if (manual) {
      selectedLabel = manualPo.trim();
      if (!selectedLabel) return notify('⚠️ Ketik atau Scan Nomor PO terlebih dahulu!', 'warning');
      poList = [selectedLabel];
    } else {
      if (selected.size === 0) return notify('⚠️ Pilih minimal 1 PO untuk di-export.', 'warning');
      const keys = Array.from(selected);
      poList = Array.from(new Set(keys.map(k => k.split('___')[0])));
      pairs = selected;
      selectedLabel = keys.length === orders.length ? 'ALL' : poList.length === 1 ? poList[0] : `Multi_${keys.length}PO`;
    }

    setBusyXls(true);
    notify('⏳ Mengambil data scan log...', 'warning');
    try {
      let logs: any[];
      if (!manual && selectedLabel === 'ALL') {
        logs = await fetchPaged<any>((f, t) => supabase.from('vcp-op-scan_logs').select('*').order('id').range(f, t));
      } else {
        logs = await fetchByPo<any>('vcp-op-scan_logs', '*', poList!);
        if (pairs) logs = logs.filter(l => pairs!.has(`${l.po_number}___${l.arrival_time}`));
      }
      logs.sort((a, b) => String(b.scanned_at).localeCompare(String(a.scanned_at)));
      if (logs.length === 0) return notify('⚠️ Tidak ada data scan untuk di-export.', 'warning');

      const dateOf = (po: string, r: string) => orders.find(o => o.po_number === po && o.arrival_time === r)?.arrival_date || '-';
      const rows = logs.map((l, i) => ({
        'No': i + 1,
        'PO Number': l.po_number,
        'Arrival Date': dateOf(l.po_number, l.arrival_time),
        'Arrival Time (RIT)': l.arrival_time,
        'Serial Number': l.serial_number,
        'LOT Code': l.lot_code,
        'PMRUN': l.pmi_run_no,
        'CASE ID': l.case_number,
        'Gross Weight (kg)': l.gross_weight_kg,
        'Net Weight (kg)': l.net_weight_kg,
        'Is Bypassed': l.is_bypassed ? 'YES' : 'NO',
        'Status Loading': l.is_loaded ? 'LOADED' : 'PENDING',
        'Scanned By': l.scanned_by || 'Operator',
        'Scanned Timestamp': new Date(l.scanned_at).toLocaleString('id-ID'),
      }));
      await writeWorkbook([{ name: 'Scan Details', rows }], `Scan_Report_${selectedLabel}_${new Date().toISOString().split('T')[0]}.xlsx`);
      notify(`✅ Report Excel (${rows.length} scan) berhasil di-download!`, 'success');
    } catch (err: any) { notify(`❌ Error Export: ${err.message}`, 'error'); }
    finally { setBusyXls(false); }
  };

  const exportPdf = async () => {
    if (!sessionId) return notify('❌ Pilih Sesi RIT Outbound terlebih dahulu!', 'warning');
    setBusyPdf(true);
    notify('⏳ Generating PDF Report...', 'warning');
    try {
      await generateOutboundPdf(sessionId);
      notify('🎉 PDF Evidence Report berhasil di-download!', 'success');
    } catch (err: any) { notify(`❌ Gagal generate PDF: ${err.message}`, 'error'); }
    finally { setBusyPdf(false); }
  };

  const selCls = 'w-full border border-gray-300 rounded-md p-2 bg-gray-50 font-semibold';

  return (
    <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
      <h2 className="font-bold text-base text-gray-900 mb-3">3. Export Report &amp; PDF Evidence</h2>

      {/* EXCEL SCAN LOG */}
      <div className="pb-4 mb-4 border-b border-dashed border-gray-300">
        <div className="flex justify-between items-center mb-2">
          <label className="text-xs font-bold text-gray-500">Export Excel (data scan monitoring)</label>
          <span onClick={() => setManual(v => !v)} className="text-xs font-semibold text-yellow-800 underline cursor-pointer">
            {manual ? 'Gunakan Dropdown' : 'Input Manual PO?'}
          </span>
        </div>

        {!manual ? (
          <>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">Tanggal</label>
                <select value={date} onChange={e => { setDate(e.target.value); setRit(''); }} className={selCls}>
                  <option value="">Semua tanggal</option>
                  {dates.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 mb-1">RIT / jam</label>
                <select value={rit} onChange={e => setRit(e.target.value)} className={selCls}>
                  <option value="">Semua RIT</option>
                  {rits.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="flex justify-between items-center text-xs text-gray-600 mb-1">
              <label className="flex items-center gap-2 font-bold cursor-pointer">
                <input type="checkbox" checked={allVisibleChecked} onChange={e => toggleAll(e.target.checked)} className="w-5 h-5 accent-gray-900" />
                Pilih semua yang tampil
              </label>
              <strong>{selected.size} dari {orders.length} dipilih</strong>
            </div>
            <div className="max-h-56 overflow-y-auto border border-gray-200 rounded-md">
              {visible.length === 0 && <div className="p-4 text-center text-gray-500 text-sm">Tidak ada PO untuk filter ini.</div>}
              {visible.map(o => (
                <label key={keyOf(o)} className={`flex flex-wrap items-center gap-3 min-h-11 px-3 py-1 border-b border-gray-100 cursor-pointer ${selected.has(keyOf(o)) ? 'bg-amber-50' : ''}`}>
                  <input type="checkbox" checked={selected.has(keyOf(o))} onChange={e => toggleOne(keyOf(o), e.target.checked)} className="w-5 h-5 accent-gray-900" />
                  <span className="font-extrabold tabular-nums">{o.po_number}</span>
                  <span className="ml-auto text-xs text-gray-500">{o.arrival_date} · {o.arrival_time} · {o.blend_code || '-'}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <input type="text" value={manualPo} onChange={e => setManualPo(e.target.value)} placeholder="Ketik Nomor PO Manual / Scan Barcode..."
            className="w-full min-h-11 border-2 border-gray-300 rounded-lg px-3 font-semibold" />
        )}

        <button onClick={exportExcel} disabled={busyXls} className="mt-3 w-full min-h-11 rounded-lg bg-amber-600 text-white font-bold text-sm disabled:opacity-60">
          {busyXls ? '⏳ Menyiapkan...' : '📥 Download Excel'}
        </button>
      </div>

      {/* PDF OUTBOUND */}
      <div>
        <label className="block text-xs font-bold text-red-700 mb-1">CETAK PDF OUTBOUND (BERDASARKAN RIT TRUK):</label>
        <div className="flex gap-2">
          <select value={sessionId} onChange={e => setSessionId(e.target.value)} className={`${selCls} flex-1`}>
            <option value="">-- PILIH SESI LOADING TRUK / RIT --</option>
            {sessions.map(s => {
              const n = countDispatchPhotos(s);
              return (
                <option key={s.id} value={s.id}>
                  {n < 4 ? `⚠️ ${n}/4 foto | ` : ''}{s.dispatch_date} | {s.rit_number} ({s.vehicle_number})
                </option>
              );
            })}
          </select>
          <button onClick={exportPdf} disabled={busyPdf} className="px-4 min-h-11 rounded-lg bg-red-600 text-white font-bold text-sm disabled:opacity-60">
            {busyPdf ? '⏳' : '📄 PDF'}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">Sesi bertanda ⚠️ belum punya ke-4 foto dispatch (foto parsial). PDF tetap bisa dibuat dengan foto yang ada.</p>
      </div>
    </section>
  );
}