// Tamper-evident evidence chain. Each record's hash covers the file's SHA-256, its metadata and the
// previous record's hash, so changing, removing or reordering any file breaks verification from that
// point on. Ported from backend/app/services/evidence.py.
//
// In this free-tier build there is no server key to sign with (the Cloud Run version signs with Cloud
// KMS). The chain still detects any later change; the database's server timestamp on each record
// anchors when it was added.

import type { EvidenceRecord } from "@/lib/types";
import { sha256Hex } from "./text";

export const GENESIS = "0".repeat(64);

function hashFields(r: Pick<EvidenceRecord, "owner_id" | "index" | "filename" | "mime_type" | "size" | "sha256" | "prev_hash" | "created_at">) {
  // Same canonical form as the Python version: sorted keys, no spaces.
  const fields: Record<string, unknown> = {
    created_at: r.created_at,
    filename: r.filename,
    index: r.index,
    mime_type: r.mime_type,
    owner_id: r.owner_id,
    prev_hash: r.prev_hash,
    sha256: r.sha256,
    size: r.size,
  };
  return JSON.stringify(fields);
}

export async function buildRecord(opts: {
  id: string;
  ownerId: string;
  data: ArrayBuffer;
  filename: string;
  mimeType: string;
  previous: EvidenceRecord | null;
  caseId?: string | null;
  note?: string | null;
  now?: string;
}): Promise<EvidenceRecord> {
  const at = opts.now ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const index = opts.previous ? opts.previous.index + 1 : 0;
  const prev = opts.previous ? opts.previous.record_hash : GENESIS;
  const sha = await sha256Hex(opts.data);
  const base = {
    owner_id: opts.ownerId,
    index,
    filename: opts.filename,
    mime_type: opts.mimeType,
    size: opts.data.byteLength,
    sha256: sha,
    prev_hash: prev,
    created_at: at,
  };
  const recordHash = await sha256Hex(hashFields(base));
  return {
    id: opts.id,
    ...base,
    case_id: opts.caseId ?? null,
    record_hash: recordHash,
    signature: "",
    signer: "none",
    storage_uri: "device",
    note: opts.note ?? null,
  };
}

/** Why a chain did not verify: a record missing or out of order, a broken link, changed details, or a changed file. */
export type ChainProblem = "missing" | "link" | "details" | "content";

export interface ChainCheck {
  ok: boolean;
  first_bad_index: number | null;
  /** English, for logs and the export. Screens use `code`. */
  reason: string;
  code: ChainProblem | null;
  records: number;
  /** Records whose file could be compared with its fingerprint (the file is on this device). */
  files_checked: number;
}

export async function verifyChain(records: EvidenceRecord[], files?: Map<string, ArrayBuffer>): Promise<ChainCheck> {
  const ordered = [...records].sort((a, b) => a.index - b.index);
  let prev = GENESIS;
  let filesChecked = 0;
  for (let expected = 0; expected < ordered.length; expected++) {
    const r = ordered[expected];
    const fail = (i: number, code: ChainProblem, reason: string): ChainCheck => ({ ok: false, first_bad_index: i, reason, code, records: records.length, files_checked: filesChecked });
    if (r.index !== expected) return fail(expected, "missing", "a record is missing or out of order");
    if (r.prev_hash !== prev) return fail(r.index, "link", "the chain link to the previous record is broken");
    if ((await sha256Hex(hashFields(r))) !== r.record_hash) return fail(r.index, "details", "the record's details were changed");
    const data = files?.get(r.id);
    if (data) {
      if ((await sha256Hex(data)) !== r.sha256) return fail(r.index, "content", "the file content was changed");
      filesChecked++;
    }
    prev = r.record_hash;
  }
  return { ok: true, first_bad_index: null, reason: "all records verified", code: null, records: records.length, files_checked: filesChecked };
}
