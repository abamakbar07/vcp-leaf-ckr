'use client';
import { useCallback, useRef, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning';

// Toast ringan untuk halaman admin & dashboard
export function useToast() {
  const [t, setT] = useState<{ msg: string; type: ToastType } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const notify = useCallback((msg: string, type: ToastType = 'success') => {
    setT({ msg, type });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), 5000);
  }, []);

  const toast = t ? (
    <div
      onClick={() => setT(null)}
      className={`fixed left-3 right-3 bottom-4 z-[900] max-w-3xl mx-auto p-4 rounded-xl text-center font-bold text-sm shadow-2xl cursor-pointer ${
        t.type === 'success' ? 'bg-green-700 text-white' : t.type === 'error' ? 'bg-red-600 text-white' : 'bg-amber-500 text-gray-900'
      }`}
    >
      {t.msg}
    </div>
  ) : null;

  return { notify, toast };
}