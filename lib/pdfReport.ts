/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/pdfReport.ts - PDF Evidence Monitoring Outbound (per sesi dispatch / truk)
import { supabase } from './supabaseClient';

const esc = (v: any) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export async function generateOutboundPdf(dispatchId: number | string) {
  const { data: session, error: errSession } = await supabase
    .from('vcp-op-outbound_dispatch_sessions').select('*').eq('id', dispatchId).single();
  if (errSession || !session) throw new Error('Data sesi Loading Truk tidak ditemukan.');

  const { data: orders, error: errOrders } = await supabase
    .from('vcp-op-orders')
    .select('*, "vcp-op-staging_monitoring_logs"(*)')
    .eq('dispatch_id', dispatchId);
  if (errOrders || !orders || orders.length === 0) throw new Error('Tidak ada PO di dalam RIT ini.');

  const rowsHtml = orders.map((po: any) => {
    const logsArray = po['vcp-op-staging_monitoring_logs'];
    const log = logsArray && logsArray.length > 0 ? logsArray[logsArray.length - 1] : {};
    const img = (url?: string) => (url ? `<img src="${esc(url)}" class="pdf-img"/>` : '-');
    return `
      <tr>
        <td><strong>${esc(po.po_number)}</strong><br><small>${esc(po.blend_code || '')}</small></td>
        <td>${img(log.photo_mori_url)}</td>
        <td>${img(log.photo_serrico_out_url)}</td>
        <td>${img(log.photo_serrico_in_url)}</td>
        <td>${esc(log.nomor_kain_mori || '-')}</td>
        <td>${esc(log.total_box || 0)}</td>
        <td>${esc(log.serrico_trap_qty || 0)}</td>
        <td style="background-color:#fef08a;font-weight:bold;">PASSED</td>
        <td style="background-color:#fef08a;">-</td>
        <td>${esc(po.wh_id || 'WH01')}</td>
        <td>${esc(log.inspection_date || '')}<br>${esc(log.inspection_time || '')}</td>
      </tr>`;
  }).join('');

  const trapPhoto = (url: string | null, label: string) => `
    <div style="text-align:center;">
      <img src="${esc(url || '')}" style="width:160px;height:120px;object-fit:cover;border-radius:6px;border:1px solid #999;" onerror="this.style.display='none'"/><br>
      <small><b>${label}</b></small>
    </div>`;

  const el = document.createElement('div');
  el.id = 'pdfReportTemplate';
  el.innerHTML = `
    <style>
      #pdfReportTemplate { font-family: Arial, sans-serif; padding: 15px; color: #1e293b; font-size: 10px; }
      .report-header { border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; margin-bottom: 10px; }
      .report-title { font-size: 14px; font-weight: bold; color: #1e3a8a; text-transform: uppercase; }
      .report-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      .report-table th, .report-table td { border: 1px solid #cbd5e1; padding: 4px; text-align: center; vertical-align: middle; }
      .report-table th { background-color: #f1f5f9; font-weight: bold; }
      .pdf-img { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid #ccc; }
    </style>
    <div class="report-header">
      <div class="report-title">Evidence Monitoring Outbound | ${esc(session.dispatch_date)} | ${esc(session.rit_number)}</div>
      <div style="background-color:#fef08a;padding:6px;margin-top:6px;font-weight:bold;display:inline-block;border-radius:4px;">
        Berikut Evidence Monitoring untuk pengiriman RRP pada ${esc(session.dispatch_date)} ${esc(session.rit_number)} ETA ${esc(session.eta_time || '06:00')}
      </div>
    </div>
    <table class="report-table">
      <thead>
        <tr><th colspan="11" style="background-color:#3b82f6;color:white;">MONITORING MATERIAL (STAGING)</th></tr>
        <tr><th>PO Number</th><th>Kain Mori</th><th>Serrico Luar</th><th>Serrico Dalam</th><th>No. Mori</th><th>Total Box</th><th>Serrico Qty</th><th>Status</th><th>Keterangan</th><th>WHID</th><th>Jam Mon.</th></tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div style="margin-top:15px;border-top:1px dashed #ccc;padding-top:10px;">
      <strong style="font-size:11px;">FOTO EVIDENCE MOBILE TRAP DALAM UNIT (${esc(session.rit_number)} - ${esc(session.vehicle_number || 'Truk')}):</strong>
      <div style="display:flex;justify-content:center;gap:20px;margin-top:8px;">
        ${trapPhoto(session.photo_trap_out_before_url, 'Luar (Before Loading)')}
        ${trapPhoto(session.photo_trap_in_before_url, 'Dalam (Before Loading)')}
        ${trapPhoto(session.photo_trap_out_after_url, 'Luar (After Loading)')}
        ${trapPhoto(session.photo_trap_in_after_url, 'Dalam (After Loading)')}
      </div>
    </div>`;

  document.body.appendChild(el);
  try {
    const html2pdf = (await import('html2pdf.js')).default;
    await html2pdf().set({
      margin: 0.3,
      filename: `Evidence_Report_${String(session.rit_number).replace(/\s+/g, '_')}_${session.dispatch_date}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'in', format: 'a4', orientation: 'landscape' },
    }).from(el).save();
  } finally {
    document.body.removeChild(el);
  }
}

export const countDispatchPhotos = (s: any) =>
  ['photo_trap_out_before_url', 'photo_trap_in_before_url', 'photo_trap_out_after_url', 'photo_trap_in_after_url'].filter(k => !!s?.[k]).length;