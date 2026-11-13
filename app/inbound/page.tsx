/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { loadSkuMap } from '@/lib/dashboardData';
import type { AsnSummary } from '@/lib/inbound';
import AppNav from '@/components/AppNav';
import { useToast } from '@/components/ui/Toast';
import AsnTab from '@/components/inbound/AsnTab';
import RecordTab from '@/components/inbound/RecordTab';
import ReceiveTab from '@/components/inbound/ReceiveTab';

type Tab = 'asn' | 'record' | 'receive';
const NAME_KEY = 'hms_checker_name'; // sama dengan scanner order, jadi nama checker tidak perlu diketik ulang

export default function InboundPage() {
  const { notify, toast } = useToast();
  const [tab, setTab] = useState<Tab>('asn');
  const [checker, setChecker] = useState('');
  const [asns, setAsns] = useState<AsnSummary[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [skuMap, setSkuMap] = useState<Map<string, number>>(new Map());

  const loadAsns = useCallback(async () => {
    const { data, error } = await supabase.from('inbound_asn_summary').select('*')
      .order('asn_date', { ascending: false }).order('asn_id', { ascending: false }).limit(60);
    if (error) return notify(`❌ Gagal memuat daftar ASN: ${error.message}`, 'error');
    setAsns((data || []) as AsnSummary[]);
  }, [notify]);

  useEffect(() => {
    setChecker(localStorage.getItem(NAME_KEY) || '');
    loadSkuMap().then(setSkuMap).catch(() => {});
    loadAsns();
  }, [loadAsns]);

  // Default: ASN terbaru
  useEffect(() => { if (activeId === null && asns.length > 0) setActiveId(asns[0].asn_id); }, [asns, activeId]);

  const changeTab = (t: Tab) => { setTab(t); if (t === 'asn') loadAsns(); };
  const onName = (v: string) => { setChecker(v); localStorage.setItem(NAME_KEY, v.trim()); };

  const active = useMemo(() => asns.find(a => a.asn_id === activeId) ?? null, [asns, activeId]);

  const tabCls = (t: Tab) => `flex-1 py-3 text-xs font-bold transition ${tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`;

  return (
    <div className="max-w-3xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      <AppNav current="inbound" title="Inbound Receiving Helper" subtitle="Record SN aktual → tampilkan untuk receive WMS" />
      {toast}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">👤 Nama checker</label>
          <input type="text" value={checker} onChange={e => onName(e.target.value)} placeholder="Ketik nama Anda..." className="w-full border-2 border-blue-400 rounded-md p-2 font-bold focus:outline-none focus:border-blue-600" />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-500 mb-1">📦 ASN aktif (Record &amp; Receive)</label>
          <select value={activeId ?? ''} onChange={e => setActiveId(e.target.value ? Number(e.target.value) : null)} className="w-full border-2 border-gray-300 rounded-md p-2 bg-white font-semibold">
            <option value="">-- Pilih ASN --</option>
            {asns.map(a => <option key={a.asn_id} value={a.asn_id}>{a.status === 'CLOSED' ? '✔ ' : ''}{a.asn_date} · {a.asn_no} · {a.wh_id}</option>)}
          </select>
        </div>
      </div>

      <div className="flex bg-white rounded-lg shadow-sm mb-4 overflow-hidden border border-gray-200">
        <button onClick={() => changeTab('asn')} className={tabCls('asn')}>1. ASN</button>
        <button onClick={() => changeTab('record')} className={tabCls('record')}>2. RECORD SN</button>
        <button onClick={() => changeTab('receive')} className={tabCls('receive')}>3. RECEIVE</button>
      </div>

      {tab === 'asn' && (
        <AsnTab asns={asns} skuMap={skuMap} checker={checker} notify={notify} onChanged={loadAsns}
          onOpen={id => { setActiveId(id); setTab('record'); }} />
      )}
      {tab === 'record' && <RecordTab asn={active} skuMap={skuMap} checker={checker} notify={notify} />}
      {tab === 'receive' && <ReceiveTab asn={active} checker={checker} notify={notify} />}
    </div>
  );
}