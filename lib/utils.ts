// lib/utils.ts

// Fungsi Parser Barcode HMS
export function parseHMSBarcode(snString: string) {
  if (!snString || snString.length !== 31) {
    return { isValid: false, message: "Panjang Barcode Bukan 31 Karakter!" };
  }
  return {
    isValid: true,
    serialNumber: snString,
    lotCode: snString.substring(0, 6),
    pmiRunNo: snString.substring(6, 9),
    caseNo: snString.substring(9, 14),
    grossWeight: parseFloat(snString.substring(14, 18)) / 10,
    netWeight: parseFloat(snString.substring(18, 22)) / 10,
    moisture: parseFloat(snString.substring(22, 26)) / 100,
    gradeCode: snString.substring(26, 31)
  };
}

// Fungsi Bantuan Mendapatkan Minggu (ISO Week)
export function getISOWeek(dateString: string) {
  const d = new Date(dateString);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `Week ${weekNo} (${d.getFullYear()})`;
}

// Fungsi Audio Web (Buzzer & Beep)
export function playAudio(type: 'success' | 'warning' | 'error') {
  if (typeof window !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const ctx = new AudioContextClass();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.connect(gain);
    gain.connect(ctx.destination);
    
    const now = ctx.currentTime;
    
    if (type === 'success') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1000, now);
      osc.frequency.exponentialRampToValueAtTime(1400, now + 0.1);
      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    } else if (type === 'warning') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.setValueAtTime(800, now + 0.15);
      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'error') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(140, now);
      osc.frequency.setValueAtTime(110, now + 0.2);
      gain.gain.setValueAtTime(1.0, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
      osc.start(now);
      osc.stop(now + 0.6);
    }
  }
}