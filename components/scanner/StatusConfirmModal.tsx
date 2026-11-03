'use client';
import Modal from './Modal';

interface Props {
  label: string;          // "GROUPING" / "QC"
  po: string;
  rit: string;
  next: boolean;          // true = tandai selesai, false = batalkan
  checkerName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function StatusConfirmModal({ label, po, rit, next, checkerName, busy, onConfirm, onCancel }: Props) {
  const now = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <Modal
      title={next ? `Konfirmasi ${label} Selesai?` : `Batalkan ${label}?`}
      accent={next ? 'border-green-600' : 'border-orange-500'}
    >
      <div className="text-sm text-gray-700 space-y-1 mb-4">
        <div><strong>PO:</strong> {po}</div>
        <div><strong>RIT:</strong> {rit}</div>
        {next ? (
          <>
            <div><strong>Waktu tercatat:</strong> {now}</div>
            <div><strong>Oleh:</strong> {checkerName.trim() || 'anon'}</div>
          </>
        ) : (
          <div className="text-orange-700">Status dan timestamp {label} untuk PO ini akan dihapus.</div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} disabled={busy} className="flex-1 min-h-14 rounded-lg border-2 border-gray-300 bg-white font-bold disabled:opacity-60">
          BATAL
        </button>
        <button onClick={onConfirm} disabled={busy}
          className={`flex-1 min-h-14 rounded-lg font-bold text-white disabled:opacity-60 ${next ? 'bg-green-700' : 'bg-orange-500'}`}>
          {busy ? '⏳...' : next ? '✅ YA, SELESAI' : 'YA, BATALKAN'}
        </button>
      </div>
    </Modal>
  );
}