'use client';
import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  zoom: number; // persen lebar (100 = pas layar, >100 = geser horizontal)
}

// Code 128, latar putih + quiet zone lebar supaya mudah dibaca scanner RF dari layar HP
export default function BarcodeView({ value, zoom }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const JsBarcode = (await import('jsbarcode')).default;
        if (!alive || !ref.current) return;
        const svg = ref.current;
        JsBarcode(svg, value, { format: 'CODE128', width: 2, height: 150, displayValue: false, margin: 28, background: '#ffffff', lineColor: '#000000' });
        const w = parseFloat(svg.getAttribute('width') || '0');
        const h = parseFloat(svg.getAttribute('height') || '0');
        if (!svg.getAttribute('viewBox') && w && h) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        setError('');
      } catch (e: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
        if (alive) setError(e?.message || 'Barcode tidak bisa dibuat');
      }
    })();
    return () => { alive = false; };
  }, [value]);

  return (
    <div className="bg-white overflow-x-auto rounded-md border border-gray-300">
      {error ? <div className="p-4 text-red-600 text-sm font-semibold">{error}</div>
        : <svg ref={ref} style={{ width: `${zoom}%`, height: 'auto', display: 'block' }} role="img" aria-label={`Barcode ${value}`} />}
    </div>
  );
}