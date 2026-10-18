// Shrink large phone photos before upload. Cloud Run limits a request body to 32 MiB, and many
// workers are on slow mobile data, so a 4000px photo is redrawn at 2000px as JPEG. Text stays
// readable at that size; PDFs and text files are sent as they are.

const MAX_SIDE = 2000;
const SHRINK_ABOVE_BYTES = 1.5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 28 * 1024 * 1024; // leaves room under 32 MiB for the other form fields

export async function shrinkImage(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= SHRINK_ABOVE_BYTES) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.(png|webp|jpe?g)$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg", lastModified: file.lastModified });
  } catch {
    return file; // an unreadable image is still sent; the server decides what to do with it
  }
}

export async function prepareUploads(files: File[]): Promise<File[]> {
  return Promise.all(files.map(shrinkImage));
}

export function totalBytes(files: (File | Blob)[]): number {
  return files.reduce((n, f) => n + f.size, 0);
}
