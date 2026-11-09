'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/ui/Toast';
import UploadPanel from '@/components/tools/hioki/UploadPanel';
import CollectPanel from '@/components/tools/hioki/CollectPanel';

const NAME_KEY = 'hioki_collector_name';

export default function HiokiToolPage() {
  const { notify, toast } = useToast();
  const [tab, setTab] = useState<'upload' | 'collect'>('upload');
  const [collector, setCollector] = useState('');

  useEffect(() => { setCollector(localStorage.getItem(NAME_KEY) || ''); }, []);
  const onName = (v: string) => { setCollector(v); localStorage.setItem(NAME_KEY, v.trim()); };

  return (
    <div className="max-w-5xl mx-auto p-4 bg-gray-50 min-h-screen text-sm">
      <header className="bg-white shadow-sm rounded-lg p-4 mb-4 border border-gray-200">
        <div className="flex flex-wrap justify-between items-center gap-3">
          <div>
            <h1 className="font-bold text-lg text-blue-900">Hioki Data Tool</h1>
            <p className="text-xs text-gray-500">Upload hasil ekstrak (.luw) dari RF &amp; collect ke desktop</p>
          </div>
          <div className="w-full sm:w-64">
            <label className="block text-xs font-bold text-gray-500 mb-1">👤 Nama collector</label>
            <input type="text" value={collector} onChange={e => onName(e.target.value)} placeholder="Ketik nama Anda..."
              className="w-full border-2 border-blue-400 rounded-md p-2 font-bold focus:outline-none focus:border-blue-600" />
          </div>
        </div>
      </header>
      {toast}

      <div className="flex bg-white rounded-lg shadow-sm mb-4 overflow-hidden border border-gray-200">
        <button onClick={() => setTab('upload')} className={`flex-1 py-3 text-xs font-bold transition ${tab === 'upload' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>⬆️ UPLOAD</button>
        <button onClick={() => setTab('collect')} className={`flex-1 py-3 text-xs font-bold transition ${tab === 'collect' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'}`}>📦 COLLECT</button>
      </div>

      {/* Dua panel tetap di-mount agar pilihan folder / progress upload tidak hilang saat pindah tab */}
      <div className={tab === 'upload' ? '' : 'hidden'}><UploadPanel collector={collector} notify={notify} /></div>
      <div className={tab === 'collect' ? '' : 'hidden'}>{tab === 'collect' && <CollectPanel collector={collector} notify={notify} />}</div>
    </div>
  );
}