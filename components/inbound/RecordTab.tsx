/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPaged } from '@/lib/db';
import { writeWorkbook } from '@/lib/excel';
import { parseHMSBarcode, playAudio, triggerHaptic } from '@/lib/utils';
import type { ParsedBarcode } from '@/lib/utils';
import { buildLotRows, r2, type AsnItem, type AsnSummary, type InboundLog, type LotStatus } from '@/lib/inbound';
import BypassModal from '@/components/scanner/BypassModal';
import InboundLogsModal from './InboundLogsModal';
import type { ToastType } from '@/components/ui/Toast';

type ValidBarcode = Extract<ParsedBarcode, { isValid: true }>;

interface Props {
  asn: AsnSummary | null;
  skuMap: Map<string, number>;
  checker: string;
  notify: (msg: string, type?: ToastType) => void;
}

const BADGE: Record<LotStatus, string> = {
  DONE: 'bg-green-100 text-green-900', PARTIAL: 'bg-orange-100 text-orange-900', OPEN: 'bg-gray-200 text-gray-600',
  OVER: 'bg-red-100 text-red-800', 'DI LUAR ASN': 'bg-red-100 text-red-800',
};

export default function RecordTab({ asn, skuMap, checker, notify }: Props) {
  const asnId = asn?.asn_id ?? null;
  const [items, setItems] = useState<AsnItem[]>([]);
  const [logs, setLogs] = useState<InboundLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<{ parsed: ValidBarcode; reasons: string[] } | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [keyboardOn, setKeyboardOn] = useState(false);
  const [flash, setFlash] = useState<ToastType | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<AsnItem[]>([]);
  const logsRef = useRef<InboundLog[]>([]);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyItems = (v: AsnItem[]) => { itemsRef.current = v; setItems(v); };
  const applyLogs = (v: InboundLog[]) => { logsRef.current = v; setLogs(v); };
  const std = useCallback((lot: string) => skuMap.get(lot) || 200, [skuMap]);

  // Suara + getar + flash + toast, sama seperti scanner order
  const fb = useCallback((msg: string, type: ToastType) => {
    playAudio(type); triggerHaptic(type);
    setFlash(type);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), type === 'error' ? 800 : 400);
    notify(msg, type);
  }, [notify]);

  const load = useCallback(async () => {
    if (asnId === null) { applyItems([]); applyLogs([]); return; }
    setLoading(true);
    try {
      const [it, lg] = await Promise.all([
        fetchPaged<AsnItem>((f, t) => supabase.from('inbound_asn_items').select('*').eq('asn_id', asnId).order('line_no').range(f, t)),
        fetchPaged<InboundLog>((f, t) => supabase.from('inbound_scan_logs').select('*').eq('asn_id', asnId).order('id').range(f, t)),
      ]);
      applyItems(it); applyLogs(lg);
    } catch (err: any) { notify(`❌ Gagal memuat ASN: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  }, [asnId, notify]);

  useEffect(() => { load(); setTimeout(() => inputRef.current?.focus(), 0); }, [load]);

  const lotRows = useMemo(() => buildLotRows(items, logs, std), [items, logs, std]);
  const totalExpected = items.reduce((s, i) => s + Number(i.expected_qty), 0);
  const totalScanned = r2(lotRows.reduce((s, r) => s + r.scannedCt, 0));
  const fulfilled = r2(lotRows.filter(r => r.inAsn).reduce((s, r) => s + Math.min(r.scannedCt, r.expected), 0));
  const pct = totalExpected > 0 ? Math.min(100, Math.round((fulfilled / totalExpected) * 100)) : 0;
  const exceptions = logs.filter(l => l.is_exception).length;
  const received = logs.filter(l => l.wms_received_at).length;
  const noStd = Array.from(new Set(logs.map(l => l.lot_code))).filter(l => !skuMap.has(l));

  // --- simpan scan ---
  const save = useCallback(async (parsed: ValidBarcode, reasons: string[]) => {
    if (asnId === null) return;
    const { data, error } = await supabase.from('inbound_scan_logs').insert([{
      asn_id: asnId, serial_number: parsed.serialNumber, lot_code: parsed.lotCode, pmi_run_no: parsed.pmiRunNo,
      case_number: parsed.caseNo, gross_weight_kg: parsed.grossWeight, net_weight_kg: parsed.netWeight,
      moisture: parsed.moisture, grade_code: parsed.gradeCode,
      is_exception: reasons.length > 0, exception_reason: reasons.length ? reasons.join('; ') : null,
      scanned_by: checker.trim() || 'anon',
    }]).select().single();
    if (error) {
      if ((error as any).code === '23505') return fb('❌ DUPLICATE SN! Sudah tercatat di ASN ini.', 'error');
      return fb(`❌ DB Save Error: ${error.message}`, 'error');
    }
    applyLogs([...logsRef.current, data as InboundLog]);
    const exp = itemsRef.current.find(i => i.sku === parsed.lotCode);
    const nowCt = r2(logsRef.current.filter(l => l.lot_code === parsed.lotCode).reduce((s, l) => s + Number(l.net_weight_kg) / std(l.lot_code), 0));
    fb(`${reasons.length ? '⚠️' : '✅'} [${parsed.lotCode}] SN OK${exp ? ` (${nowCt}/${exp.expected_qty})` : ' (di luar ASN)'}`, reasons.length ? 'warning' : 'success');
  }, [asnId, checker, fb, std]);

  // --- validasi scan ---
  const processScan = useCallback(async (raw: string) => {
    if (asnId === null) return;
    const parsed = parseHMSBarcode(raw);
    if (!parsed.isValid) return fb(`❌ ${parsed.message}`, 'error');

    if (logsRef.current.some(l => l.serial_number === parsed.serialNumber)) {
      return fb('❌ DUPLICATE SN! Barcode SUDAH tercatat di ASN ini.', 'error');
    }

    const reasons: string[] = [];
    try {
      const { data: other, error } = await supabase.from('inbound_scan_logs')
        .select('asn_id, inbound_asn(asn_no)').eq('serial_number', parsed.serialNumber).neq('asn_id', asnId).limit(1);
      if (error) throw error;
      if (other && other.length > 0) reasons.push(`SN sudah tercatat di ASN ${(other[0] as any).inbound_asn?.asn_no ?? other[0].asn_id}`);
    } catch (err: any) { return fb(`❌ DB Error: ${err.message}`, 'error'); }

    const item = itemsRef.current.find(i => i.sku === parsed.lotCode);
    if (!item) reasons.push(`LOT ${parsed.lotCode} tidak ada di ASN`);
    else {
      const cur = logsRef.current.filter(l => l.lot_code === parsed.lotCode).reduce((s, l) => s + Number(l.net_weight_kg) / std(l.lot_code), 0);
      const projected = cur + parsed.netWeight / std(parsed.lotCode);
      if (projected > Number(item.expected_qty) + 0.05) reasons.push(`OVER ASN: LOT ${parsed.lotCode} ${r2(projected)} dari ${item.expected_qty} BOX`);
    }

    if (reasons.length > 0) { // ada selisih: tanya operator, scan baru disimpan kalau di-bypass
      setPending({ parsed, reasons });
      return fb('⚠️ Ada ketidaksesuaian dengan ASN', 'warning');
    }
    await save(parsed, []);
  }, [asnId, fb, save, std]);

  const handleScan = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = e.currentTarget.value.trim();
    e.currentTarget.value = '';
    if (!raw || pending) return;
    if (asnId === null) return fb('⚠️ Pilih ASN dulu di bagian atas!', 'warning');
    queueRef.current = queueRef.current.then(() => processScan(raw)).catch(() => {});
  };

  const confirmPending = useCallback(async () => {
    if (!pending) return;
    const { parsed, reasons } = pending;
    setPending(null);
    await save(parsed, reasons);
    inputRef.current?.focus();
  }, [pending, save]);
  const cancelPending = useCallback(() => { setPending(null); inputRef.current?.focus(); }, []);

  const deleteLog = async (l: InboundLog) => {
    const msg = l.wms_received_at ? 'SN ini SUDAH ditandai receive di WMS. Tetap hapus?' : 'Yakin hapus scan SN ini?';
    if (!confirm(msg)) return;
    const { error } = await supabase.from('inbound_scan_logs').delete().eq('id', l.id);
    if (error) return notify(`❌ Gagal hapus: ${error.message}`, 'error');
    applyLogs(logsRef.current.filter(x => x.id !== l.id));
    notify('🗑️ Scan dihapus.', 'success');
  };

  const exportExcel = async () => {
    if (!asn) return;
    const t = (iso: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');
    await writeWorkbook([
      { name: 'Rekonsiliasi SKU', rows: lotRows.map(r => ({ SKU: r.sku, Deskripsi: r.description, 'ASN (BOX)': r.expected, 'Scan (CT)': r.scannedCt, 'Selisih (CT)': r2(r.scannedCt - r.expected), 'Jumlah SN': r.boxes, Exception: r.exceptions, 'Sudah Receive WMS (SN)': r.received, Status: r.status })) },
      { name: 'Detail SN', rows: [...logs].sort((a, b) => a.lot_code.localeCompare(b.lot_code)).map(l => ({ LOT: l.lot_code, PMRUN: l.pmi_run_no, 'CASE ID': l.case_number, 'Serial Number': l.serial_number, 'Net (kg)': l.net_weight_kg, Exception: l.is_exception ? 'YA' : '', Alasan: l.exception_reason || '', 'Scan Oleh': l.scanned_by, 'Waktu Scan': t(l.scanned_at), 'Receive WMS': l.wms_received_at ? 'SUDAH' : 'BELUM', 'Waktu Receive': t(l.wms_received_at), 'Receive Oleh': l.wms_received_by || '' })) },
    ], `Inbound_${asn.asn_no}_${asn.wh_id}.xlsx`);
  };

  const handleRootClick = (e: React.MouseEvent) => {
    if (pending || showLogs) return;
    if ((e.target as HTMLElement).closest('button,select,input,textarea,a,label')) return;
    inputRef.current?.focus();
  };

  if (!asn) return <div className="bg-white rounded-lg border border-gray-200 p-6 text-center text-gray-500">Pilih ASN di bagian atas, atau import ASN di tab 1.</div>;

  return (
    <div onClick={handleRootClick}>
      {flash && <div className={`fixed inset-0 z-[9999] pointer-events-none opacity-80 ${flash === 'success' ? 'bg-green-700' : flash === 'warning' ? 'bg-amber-500' : 'bg-red-600'}`} />}

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-3">
        <div className="flex flex-wrap justify-between items-center gap-2 mb-2">
          <div><span className="font-bold text-base text-gray-900">ASN {asn.asn_no}</span> <span className="text-xs text-gray-500">{asn.wh_id} · {asn.asn_date}</span></div>
          <div className="flex gap-2">
            <button onClick={load} disabled={loading} className="px-3 min-h-10 rounded-md border border-gray-300 bg-white text-xs font-bold disabled:opacity-50">{loading ? '⏳' : '🔄'}</button>
            <button onClick={() => setShowLogs(true)} className="px-3 min-h-10 rounded-md bg-amber-600 text-white text-xs font-bold">📋 Log</button>
            <button onClick={exportExcel} className="px-3 min-h-10 rounded-md bg-green-700 text-white text-xs font-bold">📥 Excel</button>
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span><strong>ASN:</strong> {r2(totalExpected)} BOX</span>
            <span><strong>Ter-scan:</strong> {totalScanned} CT ({pct}%)</span>
            <span><strong>SN:</strong> {logs.length}</span>
            {exceptions > 0 && <span className="text-orange-700 font-bold">⚠ {exceptions} exception</span>}
            <span className="text-gray-600">Receive WMS: {received}/{logs.length}</span>
          </div>
          <div className="bg-gray-200 rounded-md h-3.5 overflow-hidden mt-2"><div className={`h-full transition-all ${pct >= 100 ? 'bg-green-700' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} /></div>
          {noStd.length > 0 && <div className="mt-1 text-[11px] text-gray-500">LOT belum di SKU Master (dihitung 200 kg/box): {noStd.join(', ')}</div>}
        </div>
      </div>

      <div className="sticky top-0 z-50 bg-neutral-900 border-2 border-neutral-700 focus-within:border-amber-500 rounded-lg p-3 mb-3 shadow-lg">
        <div className="flex justify-between items-center mb-1.5">
          <label className="text-xs font-bold text-amber-200">Scan SN aktual (31 karakter)</label>
          <button type="button" onClick={() => { setKeyboardOn(v => !v); setTimeout(() => { inputRef.current?.blur(); inputRef.current?.focus(); }, 0); }}
            className={`min-h-8 px-2.5 text-xs font-semibold rounded-md border ${keyboardOn ? 'bg-amber-500 border-amber-500 text-gray-900' : 'border-neutral-500 text-neutral-200'}`}>⌨ Keyboard</button>
        </div>
        <input ref={inputRef} type="text" onKeyDown={handleScan} inputMode={keyboardOn ? 'text' : 'none'} autoFocus autoComplete="off" autoCapitalize="off" spellCheck={false}
          placeholder="Siap scan..." className="w-full min-h-14 border-2 border-amber-500 rounded-lg text-center font-mono font-bold text-xl tracking-wider text-gray-900 focus:outline-none focus:ring-4 focus:ring-amber-300" />
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-100 p-2 font-bold text-xs text-gray-700">Rekonsiliasi per SKU / LOT (ASN vs aktual)</div>
        <div className="max-h-[50vh] overflow-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-gray-900 text-white sticky top-0"><tr><th className="p-2">LOT</th><th className="p-2">ASN</th><th className="p-2">SCAN</th><th className="p-2">SISA</th><th className="p-2">STATUS</th></tr></thead>
            <tbody>
              {lotRows.length === 0 && <tr><td colSpan={5} className="p-3 text-center text-gray-400">{loading ? 'Memuat...' : 'Belum ada SKU / scan'}</td></tr>}
              {lotRows.map(r => {
                const sisa = r2(r.expected - r.scannedCt);
                return (
                  <tr key={r.sku} className="border-b">
                    <td className="p-2"><div className="font-bold">{r.sku}</div><div className="text-[10px] text-gray-400">{r.description.replace(`${r.sku}-`, '')}</div></td>
                    <td className="p-2">{r.inAsn ? `${r.expected} BOX` : '-'}</td>
                    <td className="p-2 text-blue-600 font-bold">{r.scannedCt} CT <span className="text-gray-400 font-normal">({r.boxes} SN)</span>{r.exceptions > 0 && <span className="ml-1 text-orange-700">⚠{r.exceptions}</span>}</td>
                    <td className={`p-2 font-semibold ${r.inAsn && sisa < -0.05 ? 'text-red-600' : ''}`}>{r.inAsn ? sisa : '-'}</td>
                    <td className="p-2"><span className={`inline-block px-2 py-1 rounded-md text-[11px] font-extrabold ${BADGE[r.status]}`}>{r.status}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pending && (
        <BypassModal title="⚠️ TIDAK SESUAI ASN" confirmLabel="SIMPAN (ENTER)" onConfirm={confirmPending} onCancel={cancelPending}
          message={`SN ${pending.parsed.serialNumber}\n${pending.reasons.map(r => `• ${r}`).join('\n')}\n\nTetap catat sebagai exception?`} />
      )}
      {showLogs && <InboundLogsModal logs={logs} onDelete={deleteLog} onClose={() => { setShowLogs(false); inputRef.current?.focus(); }} />}
    </div>
  );
}