"use client";

// Papers a person adds to a check: which files are accepted, shrinking big photos, and turning a
// file into the base64 text Gemini takes. Files stay in this browser tab's memory and are never
// written to storage.

import { shrinkImage } from "@/lib/images";

/** Photos and PDFs Gemini can read. HEIC is what many phones take; it is sent as it is. */
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"] as const;
export const ACCEPT_ATTRIBUTE = "image/*,application/pdf";
export const MAX_PAPERS = 4;
/** Each paper is its own request; Firebase AI Logic takes at most 20 MB per request, base64 adds a third. */
export const MAX_PAPER_BYTES = 12 * 1024 * 1024;

export type FileProblem = "unsupported" | "tooLarge" | "tooMany";

export interface PaperFile {
  id: string;
  name: string;
  mimeType: string;
  data: Blob;
  /** For showing a thumbnail. Revoke with releasePaper. */
  preview: string | null;
}

function typeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  // Some Android galleries leave the type empty.
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif", pdf: "application/pdf" }[ext] ?? "";
}

let counter = 0;

/** Accept, shrink and wrap the files a person picked. Returns what was added and any problem found. */
export async function addPapers(picked: File[], current: PaperFile[]): Promise<{ added: PaperFile[]; problem: FileProblem | null }> {
  const added: PaperFile[] = [];
  let problem: FileProblem | null = null;
  for (const file of picked) {
    if (current.length + added.length >= MAX_PAPERS) {
      problem = "tooMany";
      break;
    }
    const type = typeOf(file);
    if (!(ACCEPTED_TYPES as readonly string[]).includes(type)) {
      problem = "unsupported";
      continue;
    }
    const shrunk = type.startsWith("image/") ? await shrinkImage(new File([file], file.name, { type })) : file;
    if (shrunk.size > MAX_PAPER_BYTES) {
      problem = "tooLarge";
      continue;
    }
    added.push({
      id: `paper_${Date.now()}_${counter++}`,
      name: file.name || "paper",
      mimeType: shrunk.type || type,
      data: shrunk,
      preview: type.startsWith("image/") && type !== "image/heic" && type !== "image/heif" ? URL.createObjectURL(shrunk) : null,
    });
  }
  return { added, problem };
}

export function releasePaper(paper: PaperFile): void {
  if (paper.preview) URL.revokeObjectURL(paper.preview);
}

/** The file as base64 text, without the "data:...;base64," prefix. */
export function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read"));
    reader.readAsDataURL(blob);
  });
}

/** Fetch one of the app's own sample papers as a file. */
export async function samplePaper(url: string, mimeType: string): Promise<PaperFile> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Sample ${url} could not be loaded`);
  const data = await response.blob();
  return { id: `sample_${counter++}`, name: url.split("/").pop() ?? "sample", mimeType, data, preview: url };
}
