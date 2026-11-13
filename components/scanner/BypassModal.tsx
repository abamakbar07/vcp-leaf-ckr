'use client';
import { useEffect } from 'react';
import Modal from './Modal';

interface Props {
  title?: string;
  confirmLabel?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

// Enter = BYPASS, Esc = BATAL (sama seperti versi statis)
export default function BypassModal({ title = '⚠️ DUPLICATE SN DETECTED', confirmLabel = 'BYPASS (ENTER)', message, onConfirm, onCancel }: Props) {
  useEffect(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === 'Enter') { e.preventDefault(); onConfirm(); }
      else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onConfirm, onCancel]);

  return (
    <Modal title={<span className="text-orange-700">{title}</span>} accent="border-orange-500">
      <p className="text-base text-gray-700 mb-4 leading-snug whitespace-pre-line break-all">{message}</p>
      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 min-h-14 rounded-lg border-2 border-gray-300 bg-white font-bold">
          BATAL (ESC)
        </button>
        <button onClick={onConfirm} className="flex-1 min-h-14 rounded-lg bg-orange-400 text-gray-900 font-bold">
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}