/* eslint-disable react-hooks/set-state-in-effect */
/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { fetchPaged } from '@/lib/db';
import AppNav from '@/components/AppNav';
import { useToast } from '@/components/ui/Toast';
import SkuMasterSection from '@/components/admin/SkuMasterSection';
import OrderImportSection from '@/components/admin/OrderImportSection';
import ExportSection from '@/components/admin/ExportSection';
import MasterOrdersSection from '@/components/admin/MasterOrdersSection';

export default function AdminPage() {
  const { notify, toast } = useToast();
  const [skuMap, setSkuMap] = useState<Map<string, number>>(new Map());
  const [orders, setOrders] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSku = useCallback(async () => {
    const { data, error } = await supabase.from('vcp-op-sku_master').select('lot_code, std_net_weight_kg');
    if (error) return notify(`❌ Gagal load SKU Master: ${error.message}`, 'error');
    const m = new Map<string, number>();
    (data || []).forEach(r => m.set(r.lot_code, Number(r.std_net_weight_kg)));
    setSkuMap(m);
  }, [notify]);

  const loadMaster = useCallback(async () => {
    setLoading(true);
    try {
      const [o, i] = await Promise.all([
        fetchPaged<any>((f, t) => supabase.from('vcp-op-orders').select('*')
          .order('arrival_date', { ascending: false }).order('arrival_time').order('po_number').range(f, t)),
        fetchPaged<any>((f, t) => supabase.from('vcp-op-order_items').select('po_number, arrival_time, lot_code, qty_usage_ct')
          .order('po_number').order('arrival_time').order('lot_code').range(f, t)),
      ]);
      setOrders(o);
      setItems(i);
    } catch (err: any) { notify(`❌ Gagal load master data: ${err.message}`, 'error'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { loadSku(); loadMaster(); }, [loadSku, loadMaster]);

  const existingKeys = useMemo(() => new Set(orders.map(o => `${o.po_number}___${o.arrival_time}`)), [orders]);

  return (
    <div className="max-w-4xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      <AppNav current="admin" title="Admin Portal" subtitle="Order & SKU VCP-OP" />
      {toast}
      <SkuMasterSection skuMap={skuMap} onSaved={loadSku} notify={notify} />
      <OrderImportSection skuMap={skuMap} existingKeys={existingKeys} onSaved={loadMaster} notify={notify} />
      <ExportSection orders={orders} notify={notify} />
      <MasterOrdersSection orders={orders} items={items} loading={loading} onReload={loadMaster} notify={notify} />
    </div>
  );
}