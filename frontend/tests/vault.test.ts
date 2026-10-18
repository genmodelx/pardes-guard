// The evidence vault with the on-device store and an in-memory file store. No network.

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@/lib/engine/text";
import { LocalStore, MemoryStorage } from "@/lib/store-local";
import { MAX_EVIDENCE_BYTES, VaultError, addToVault, checkVault, exportVault } from "@/lib/vault";
import { MemoryFileStore } from "@/lib/vault-files";

const setup = () => ({ store: new LocalStore("w1", new MemoryStorage()), files: new MemoryFileStore() });
const file = (text: string, type = "text/plain") => new Blob([text], { type });

describe("evidence vault", () => {
  it("chains each file to the one before it and keeps the bytes on the device", async () => {
    const { store, files } = setup();
    const a = await addToVault({ store, files, file: file("payslip september"), name: "payslip.txt", note: " September " });
    const b = await addToVault({ store, files, file: file("photo bytes", "image/jpeg"), name: "room/photo.jpg" });
    expect([a.index, b.index]).toEqual([0, 1]);
    expect(b.prev_hash).toBe(a.record_hash);
    expect(a.note).toBe("September");
    expect(b.filename).toBe("room_photo.jpg");
    expect(a.sha256).toBe(await sha256Hex(new TextEncoder().encode("payslip september").buffer));
    expect((await files.list("w1")).map((f) => f.name)).toEqual(["payslip.txt", "room_photo.jpg"]);
    expect(await checkVault(store, files)).toMatchObject({ ok: true, records: 2, files_checked: 2, files_missing: 0 });
  });

  it("notices a changed file, and says when a file is not on this phone", async () => {
    const { store, files } = setup();
    const a = await addToVault({ store, files, file: file("original"), name: "a.txt" });
    await addToVault({ store, files, file: file("second"), name: "b.txt" });
    await files.put({ id: a.id, owner_id: "w1", name: "a.txt", type: "text/plain", blob: file("edited") });
    expect(await checkVault(store, files)).toMatchObject({ ok: false, code: "content", first_bad_index: 0 });
    await files.remove(a.id);
    expect(await checkVault(store, files)).toMatchObject({ ok: true, files_checked: 1, files_missing: 1 });
  });

  it("refuses empty and oversized files, and drops the file when its record cannot be saved", async () => {
    const { store, files } = setup();
    await expect(addToVault({ store, files, file: file(""), name: "empty.txt" })).rejects.toBeInstanceOf(VaultError);
    const big = { size: MAX_EVIDENCE_BYTES + 1, type: "image/jpeg", arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Blob;
    await expect(addToVault({ store, files, file: big, name: "big.jpg" })).rejects.toMatchObject({ code: "tooLarge" });
    const broken = Object.assign(Object.create(store), { addEvidence: async () => Promise.reject(new Error("offline")) });
    await expect(addToVault({ store: broken, files, file: file("x"), name: "x.txt" })).rejects.toMatchObject({ code: "save" });
    expect(await files.list("w1")).toEqual([]);
  });

  it("exports every file with a manifest anyone can check", async () => {
    const { store, files } = setup();
    await addToVault({ store, files, file: file("payslip"), name: "payslip.txt" });
    await addToVault({ store, files, file: file("receipt"), name: "receipt.txt" });
    const zip = await JSZip.loadAsync(await (await exportVault(store, files, "2026-10-13T09:00:00Z")).arrayBuffer());
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.chain).toMatchObject({ ok: true, records: 2, files_checked: 2 });
    expect(manifest.records.map((r: { file: string }) => r.file)).toEqual(["files/001-payslip.txt", "files/002-receipt.txt"]);
    for (const r of manifest.records) {
      const bytes = await zip.file(r.file)!.async("arraybuffer");
      expect(await sha256Hex(bytes)).toBe(r.sha256);
    }
  });
});
