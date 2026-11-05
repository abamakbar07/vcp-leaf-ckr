/* eslint-disable @typescript-eslint/no-explicit-any */
// lib/db.ts - helper query: paging (batas 1000 baris/request di Supabase) + chunk untuk .in()
import { supabase } from './supabaseClient';

const PAGE = 1000;
const CHUNK = 100;

export async function fetchPaged<T = any>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

// Ambil semua baris dari tabel untuk daftar PO (di-chunk supaya URL tidak kepanjangan, di-page per 1000)
export async function fetchByPo<T = any>(
  table: string,
  select: string,
  poList: string[],
  orderBy: string[] = ['id'],
  extra?: (q: any) => any
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < poList.length; i += CHUNK) {
    const chunk = poList.slice(i, i + CHUNK);
    const rows = await fetchPaged<T>((from, to) => {
      let q: any = supabase.from(table).select(select).in('po_number', chunk);
      if (extra) q = extra(q);
      orderBy.forEach(col => { q = q.order(col); });
      return q.range(from, to);
    });
    out.push(...rows);
  }
  return out;
}

export const whOf = (o: { wh_id?: string | null }) => o.wh_id || 'WH01';