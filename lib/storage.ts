import { supabase } from './supabaseClient';

const BUCKET = 'staging-evidence';

// Kompres foto: max lebar 1024px, JPEG kualitas 0.75 (sama seperti versi statis)
export function compressImage(file: File, maxWidth = 1024, quality = 0.75): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = img.width > maxWidth ? maxWidth / img.width : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas tidak tersedia'));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Gagal kompres foto'))),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Foto tidak bisa dibaca'));
    };
    img.src = url;
  });
}

// Upload ke bucket staging-evidence, return public URL
export async function uploadPhoto(
  file: File | null | undefined,
  folder: string,
  prefix: string
): Promise<string | null> {
  if (!file) return null;
  const blob = await compressImage(file);
  const safeFolder = folder.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `${safeFolder}/${prefix}_${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}