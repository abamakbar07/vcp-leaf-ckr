// components/scanner/types.ts
export interface Order {
  wh_id: string;
  po_number: string;
  blend_code: string;
  arrival_date: string;
  arrival_time: string; // RIT
}

export interface OrderItem {
  lot_code: string;
  qty_usage_ct: number;
  blend_code?: string;
  scanned_ct?: number;
}

export type FeedbackType = 'success' | 'error' | 'warning';

// silent = true -> hanya toast, tanpa suara/getar/flash (setara showFeedback di versi statis)
export type Notify = (msg: string, type: FeedbackType, silent?: boolean) => void;