'use client';
import { ReactNode } from 'react';

interface ModalProps {
  title: ReactNode;
  onClose?: () => void;
  accent?: string; // tailwind border color class
  children: ReactNode;
}

// Bottom sheet di HP, centered di layar lebar
export default function Modal({ title, onClose, accent = 'border-blue-500', children }: ModalProps) {
  return (
    <div className="fixed inset-0 z-[1000] flex items-end sm:items-center justify-center bg-black/70 sm:p-4">
      <div className={`bg-white w-full max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl border-t-4 ${accent} p-4`}>
        <div className="flex justify-between items-center gap-2 mb-3 font-extrabold text-base text-gray-900">
          <span>{title}</span>
          {onClose && (
            <button onClick={onClose} className="min-h-9 px-3 rounded-md border border-gray-300 text-sm font-bold bg-white">
              X
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}