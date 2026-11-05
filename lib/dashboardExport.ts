/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/dashboardExport.ts - export Excel multi-sheet dari dashboard
import { supabase } from './supabaseClient';
import { fetchByPo, fetchPaged } from './db';
import { writeWorkbook } from './excel';
import { STAGE_LABEL } from './stageLabels';
import type { DashboardData, PoRow } from './dashboardData';

const t = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('id-ID') : '-');

export async function exportDashboardExcel(data: DashboardData, rows: PoRow[], ritFilter: string) {
  const poList = Array.from(new Set(rows.map(r => r.po)));
  const inScope = (po: string, rit: string) => rows.some(r => r.po === po && (r.rit === rit || (r.rit === '-' && !rit)));

  const [logs, staging, picks] = await Promise.all([
    fetchByPo<any>('vcp-op-scan_logs', '*', poList, ['id']),
    fetchByPo<any>('vcp-op-staging_monitoring_logs', '*', poList, ['po_number', 'arrival_time']),
    fetchPaged<any>((f, to) => {
      let q: any = supabase.from('vcp-op-picking_logs').select('*').eq('order_date', data.date);
      if (data.wh !== 'ALL') q = q.eq('wh_id', data.wh);
      return q.order('id').range(f, to);
    }).catch(() => [] as any[]),
  ]);

  const dispatchIds = Array.from(new Set(rows.map(r => r.dispatchId).filter(Boolean)));
  let dispatches: any[] = [];
  if (dispatchIds.length > 0) {
    const { data: disp } = await supabase.from('vcp-op-outbound_dispatch_sessions').select('*').in('id', dispatchIds as number[]);
    dispatches = disp || [];
  }

  const summary = rows.map((r, i) => ({
    'No': i + 1, 'PO Number': r.po, 'Warehouse': r.wh, 'RIT (Arrival)': r.rit, 'Blend': r.blend,
    'Target (CT)': r.target, 'Monitoring Scan (CT)': r.scanned, 'Loaded (CT)': r.loaded,
    'Box Scan': r.boxes, 'Box Loaded': r.loadedBoxes, 'Box Bypass': r.bypassed,
    'Grouping': r.grouping.done ? 'DONE' : '-', 'Grouping At': t(r.grouping.at), 'Grouping By': r.grouping.by || '-',
    'QC': r.qc.done ? 'DONE' : '-', 'QC At': t(r.qc.at), 'QC By': r.qc.by || '-',
    'No. Mori': r.evidence.kainMori || '-', 'Foto Monitoring': `${r.evidence.photos}/3`,
    'Status': STAGE_LABEL[r.stage], 'Catatan': r.notes.join('; '),
  }));

  const perLot = data.lots.map(l => ({
    'LOT': l.lot, 'Target Tanggal (CT)': l.target, 'Picking (CT)': l.picked, 'Picking (Box)': l.pickedBoxes,
    'Selisih Picking (CT)': +(l.picked - l.target).toFixed(2), 'Monitoring Scan (CT)': l.scanned, 'Loaded (CT)': l.loaded, 'Status Picking': l.pickStatus,
  }));

  const perRit = data.rits.map(r => ({
    'RIT': r.rit, 'Warehouse': r.wh, 'Jumlah PO': r.poCount, 'Grouping Done': `${r.groupingDone}/${r.poCount}`, 'QC Done': `${r.qcDone}/${r.poCount}`,
    'Target (CT)': r.target, 'Scan (CT)': r.scanned, 'Loaded (CT)': r.loaded,
    'RIT Ke-': r.dispatch?.ritNumber || '-', 'Plat Nomor': r.dispatch?.vehicle || '-', 'Foto Dispatch': r.dispatch ? `${r.dispatch.photos}/4` : '-',
  }));

  const boxLogs = logs.filter(l => inScope(l.po_number, l.arrival_time)).map(l => ({
    'PO Number': l.po_number, 'RIT': l.arrival_time, 'Serial Number': l.serial_number, 'LOT Code': l.lot_code,
    'PMRUN': l.pmi_run_no, 'CASE ID': l.case_number, 'Net Wt (Kg)': l.net_weight_kg, 'Bypass': l.is_bypassed ? 'YES' : 'NO',
    'Scanned At': t(l.scanned_at), 'Scanned By': l.scanned_by || '-',
    'Status Loading': l.is_loaded ? 'LOADED' : 'PENDING', 'Loaded At': t(l.loaded_at), 'Loaded By': l.loaded_by || '-',
  }));

  const stagingRows = staging.filter(m => inScope(m.po_number, m.arrival_time)).map(m => ({
    'PO Number': m.po_number, 'RIT': m.arrival_time, 'No. Mori': m.nomor_kain_mori,
    'Total Box Target': m.total_box, 'Serrico Qty Target': m.serrico_trap_qty,
    'Jam Inspeksi': `${m.inspection_date ?? ''} ${m.inspection_time ?? ''}`.trim(), 'Inspektor': m.inspected_by,
    'Link Foto Mori': m.photo_mori_url, 'Link Serrico Luar': m.photo_serrico_out_url, 'Link Serrico Dalam': m.photo_serrico_in_url,
  }));

  const dispatchRows = dispatches.map(d => ({
    'Dispatch ID': d.dispatch_code, 'Tgl Loading': d.dispatch_date, 'RIT Ke-': d.rit_number, 'Plat Nomor': d.vehicle_number, 'Checker Armada': d.created_by,
    'Foto Luar (Before)': d.photo_trap_out_before_url, 'Foto Dalam (Before)': d.photo_trap_in_before_url,
    'Foto Luar (After)': d.photo_trap_out_after_url, 'Foto Dalam (After)': d.photo_trap_in_after_url,
  }));

  const pickRows = picks.map((p: any) => ({
    'WH': p.wh_id, 'Tanggal Order': p.order_date, 'LOT': p.lot_code, 'PMRUN': p.pmi_run_no, 'CASE ID': p.case_number,
    'Serial Number': p.serial_number, 'Net Wt (Kg)': p.net_weight_kg, 'Scanned At': t(p.scanned_at), 'Scanned By': p.scanned_by,
  }));

  await writeWorkbook([
    { name: '1. Summary PO', rows: summary },
    { name: '2. Per LOT (Tanggal)', rows: perLot },
    { name: '3. Per RIT & Armada', rows: perRit },
    { name: '4. Box Tracking Logs', rows: boxLogs },
    { name: '5. Staging Evidence', rows: stagingRows },
    { name: '6. Armada Dispatch', rows: dispatchRows },
    { name: '7. Picking Logs', rows: pickRows },
  ], `Laporan_Lengkap_VCPOP_${data.date}_${data.wh}_RIT-${ritFilter.replace(/:/g, '')}.xlsx`);
}