// The evidence vault: add a file, check the chain, export everything with its proof.
// A file's bytes stay on the phone (lib/vault-files); its record (name, size, SHA-256, the link to
// the record before it) goes to the store, where Firestore stamps the server's own time on it. The
// bytes are never changed: a photo is kept exactly as taken, because the fingerprint is of the file.

import { buildRecord, verifyChain, type ChainCheck } from "@/lib/engine/evidence";
import { randomId } from "@/lib/engine/text";
import type { DataStore } from "@/lib/store";
import type { EvidenceRecord } from "@/lib/types";
import type { FileStore } from "@/lib/vault-files";

export const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;

export class VaultError extends Error {
  constructor(public code: "tooLarge" | "empty" | "save") {
    super(code);
  }
}

/** Add one file to the end of the chain. The file is kept first, so a record never points at nothing. */
export async function addToVault(opts: { store: DataStore; files: FileStore; file: Blob; name: string; note?: string | null; caseId?: string | null; now?: string }): Promise<EvidenceRecord> {
  const { store, files, file } = opts;
  if (!file.size) throw new VaultError("empty");
  if (file.size > MAX_EVIDENCE_BYTES) throw new VaultError("tooLarge");
  const records = await store.listEvidence();
  const previous = records.length ? records[records.length - 1] : null;
  const id = randomId("ev", 8);
  const name = (opts.name || "file").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
  const record = await buildRecord({ id, ownerId: store.uid, data: await file.arrayBuffer(), filename: name, mimeType: file.type || "application/octet-stream", previous, caseId: opts.caseId ?? null, note: opts.note?.trim().slice(0, 300) || null, now: opts.now });
  await files.put({ id, owner_id: store.uid, name, type: record.mime_type, blob: file });
  try {
    await store.addEvidence(record);
  } catch {
    await files.remove(id).catch(() => undefined);
    throw new VaultError("save");
  }
  return record;
}

export interface VaultCheck extends ChainCheck {
  /** Records whose file is not on this phone (added on another device), so only the chain was checked. */
  files_missing: number;
}

export async function checkVault(store: DataStore, files: FileStore): Promise<VaultCheck> {
  const records = await store.listEvidence();
  const bytes = new Map<string, ArrayBuffer>();
  for (const r of records) {
    const f = await files.get(r.id);
    if (f) bytes.set(r.id, await f.blob.arrayBuffer());
  }
  const result = await verifyChain(records, bytes);
  return { ...result, files_missing: records.length - bytes.size };
}

const safeName = (r: EvidenceRecord) => `${String(r.index + 1).padStart(3, "0")}-${r.filename}`;

/**
 * One ZIP: every file on this phone, and manifest.json with every record and the check of the
 * chain. Anyone can recompute each file's SHA-256 and compare it with the manifest.
 */
export async function exportVault(store: DataStore, files: FileStore, now = new Date().toISOString()): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const records = await store.listEvidence();
  const check = await checkVault(store, files);
  for (const r of records) {
    const f = await files.get(r.id);
    if (f) zip.file(`files/${safeName(r)}`, f.blob);
  }
  const manifest = {
    app: "Pardes Guard",
    exported_at: now,
    owner_id: store.uid,
    how_to_check:
      "Each record's sha256 is the SHA-256 of its file. Each record_hash is the SHA-256 of the JSON {created_at, filename, index, mime_type, owner_id, prev_hash, sha256, size} with sorted keys and no spaces, and each prev_hash is the record_hash before it (64 zeros for the first). Files are in files/ as NNN-filename.",
    chain: { ok: check.ok, reason: check.reason, first_bad_index: check.first_bad_index, records: check.records, files_checked: check.files_checked, files_not_on_this_device: check.files_missing },
    records: records.map((r) => ({ ...r, file: `files/${safeName(r)}` })),
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  return zip.generateAsync({ type: "blob" });
}
