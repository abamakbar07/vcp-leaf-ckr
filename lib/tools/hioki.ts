export const HIOKI_BUCKET = 'hioki-uploads';
export const HIOKI_TABLE = 'hioki_uploads';

export interface HiokiRow {
  id: number;
  batch_id: string;
  batch_at: string;
  serial_device: string;
  original_name: string;
  stored_name: string;
  storage_path: string;
  size_bytes: number;
  file_modified_at: string | null;
  source_path: string | null;
  uploaded_by: string;
  collected_at: string | null;
  collected_by: string | null;
}

export interface HiokiFile {
  id: string;          // path relatif (unik dalam satu pilihan folder)
  file: File;
  relPath: string;
  serial: string;
  name: string;
  size: number;
}

export interface HiokiSelection {
  rootName: string;
  luw: HiokiFile[];
  ignored: number;
  ignoredExt: Record<string, number>;
  total: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

// Prefix tanggal + jam upload (waktu lokal perangkat): 20261109_143012
export function batchPrefix(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

export function prefixToLabel(prefix: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(prefix);
  if (!m) return prefix;
  return `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}`;
}

// Nama aman untuk key storage (karakter aneh diganti _)
export function sanitizeName(s: string): string {
  return s.normalize('NFKD').replace(/[^\w.\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'file';
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// Baca hasil pemilihan folder: ambil semua .luw, serial = nama folder yang langsung memuat file
// (struktur: data/hioki/<serial_device>/<file>.luw, folder induk mana pun boleh dipilih)
export function parseSelection(list: FileList | File[]): HiokiSelection {
  const files = Array.from(list);
  const luw: HiokiFile[] = [];
  const ignoredExt: Record<string, number> = {};
  let ignored = 0;
  let rootName = '';

  files.forEach(f => {
    const rel: string = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    const parts = rel.split('/').filter(Boolean);
    if (!rootName && parts.length > 1) rootName = parts[0];
    const name = parts[parts.length - 1];

    if (!/\.luw$/i.test(name)) {
      ignored += 1;
      const ext = name.includes('.') ? (name.split('.').pop() as string).toLowerCase() : '(tanpa ekstensi)';
      ignoredExt[ext] = (ignoredExt[ext] || 0) + 1;
      return;
    }
    const serial = parts.length >= 2 ? parts[parts.length - 2] : 'UNKNOWN';
    luw.push({ id: rel, file: f, relPath: rel, serial, name, size: f.size });
  });

  luw.sort((a, b) => a.serial.localeCompare(b.serial) || a.name.localeCompare(b.name));
  return { rootName, luw, ignored, ignoredExt, total: files.length };
}

// Rencana nama & path di storage; kalau dua nama setelah sanitize bentrok, ditambah _2, _3, ...
export function planPaths(files: HiokiFile[], prefix: string): Record<string, { stored: string; path: string }> {
  const used = new Set<string>();
  const plan: Record<string, { stored: string; path: string }> = {};
  files.forEach(f => {
    const safe = sanitizeName(f.name);
    const dot = safe.lastIndexOf('.');
    const base = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : '';
    const folder = sanitizeName(f.serial);
    let stored = `${prefix}_${safe}`;
    let n = 2;
    while (used.has(`${folder}/${stored}`)) { stored = `${prefix}_${base}_${n}${ext}`; n += 1; }
    used.add(`${folder}/${stored}`);
    plan[f.id] = { stored, path: `${folder}/${stored}` };
  });
  return plan;
}

export const dupKey = (serial: string, name: string, size: number) => `${serial}|${name}|${size}`;