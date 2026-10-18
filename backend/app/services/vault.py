"""Evidence vault: stores files and appends them to the owner's tamper-evident chain."""

from __future__ import annotations

import io
import json
import threading
import zipfile
from typing import Protocol

from app.schemas import EvidenceRecord
from app.services.evidence import Signer, build_record, verify_chain
from app.services.security import ValidatedFile
from app.storage import DocStore

EVIDENCE = "evidence"
MAX_CHAIN_RETRIES = 5


class BlobStore(Protocol):
    def put(self, path: str, data: bytes, mime_type: str) -> str: ...

    def get(self, uri: str) -> bytes | None: ...


class MemoryBlobStore:
    def __init__(self) -> None:
        self._blobs: dict[str, bytes] = {}
        self._lock = threading.Lock()

    def put(self, path: str, data: bytes, mime_type: str) -> str:
        uri = f"mem://{path}"
        with self._lock:
            self._blobs[uri] = data
        return uri

    def get(self, uri: str) -> bytes | None:
        with self._lock:
            return self._blobs.get(uri)


class GcsBlobStore:
    """Cloud Storage bucket with uniform access, no public access, and a lifecycle delete rule."""

    def __init__(self, bucket: str) -> None:
        from google.cloud import storage  # lazy import

        self._bucket = storage.Client().bucket(bucket)
        self._name = bucket

    def put(self, path: str, data: bytes, mime_type: str) -> str:
        blob = self._bucket.blob(path)
        blob.upload_from_string(data, content_type=mime_type)
        return f"gs://{self._name}/{path}"

    def get(self, uri: str) -> bytes | None:
        prefix = f"gs://{self._name}/"
        if not uri.startswith(prefix):
            return None
        blob = self._bucket.blob(uri[len(prefix):])
        return blob.download_as_bytes() if blob.exists() else None


class EvidenceVault:
    def __init__(self, store: DocStore, blobs: BlobStore, signer: Signer) -> None:
        self._store = store
        self._blobs = blobs
        self._signer = signer
        self._lock = threading.Lock()  # serialises appends within one instance; ids guard across instances

    def records(self, owner_id: str) -> list[EvidenceRecord]:
        docs = self._store.where(EVIDENCE, "owner_id", owner_id, limit=5000)
        return sorted((EvidenceRecord.model_validate(d) for d in docs), key=lambda r: r.index)

    def get(self, owner_id: str, record_id: str) -> EvidenceRecord | None:
        raw = self._store.get(EVIDENCE, record_id)
        if not raw or raw.get("owner_id") != owner_id:
            return None
        return EvidenceRecord.model_validate(raw)

    def add(self, owner_id: str, file: ValidatedFile, case_id: str | None = None, note: str | None = None) -> EvidenceRecord:
        with self._lock:
            for _ in range(MAX_CHAIN_RETRIES):
                chain = self.records(owner_id)
                previous = chain[-1] if chain else None
                index = 0 if previous is None else previous.index + 1
                record_id = f"ev_{owner_id[:24]}_{index:05d}"
                uri = self._blobs.put(f"evidence/{owner_id}/{index:05d}_{file.filename}", file.data, file.mime_type)
                record = build_record(
                    record_id=record_id,
                    owner_id=owner_id,
                    data=file.data,
                    filename=file.filename,
                    mime_type=file.mime_type,
                    previous=previous,
                    signer=self._signer,
                    case_id=case_id,
                    storage_uri=uri,
                    note=note[:200] if note else None,
                )
                # Deterministic id per (owner, index): a concurrent append on another instance makes create fail.
                if self._store.create(EVIDENCE, record_id, record.model_dump(mode="json")):
                    return record
            raise RuntimeError("Could not append evidence after several attempts; please retry")

    def verify(self, owner_id: str, check_contents: bool = True) -> dict:
        records = self.records(owner_id)
        files = None
        if check_contents:
            files = {}
            for rec in records:
                data = self._blobs.get(rec.storage_uri) if rec.storage_uri else None
                if data is not None:
                    files[rec.id] = data
        ok, bad_index, reason = verify_chain(records, self._signer, files)
        return {"ok": ok, "records": len(records), "first_bad_index": bad_index, "reason": reason}

    def export_bundle(self, owner_id: str, record_ids: list[str] | None = None) -> bytes:
        """A zip with every file plus manifest.json (hashes, chain links, signatures) for third-party checking."""
        records = self.records(owner_id)
        if record_ids:
            wanted = set(record_ids)
            records = [r for r in records if r.id in wanted]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            manifest = []
            for rec in records:
                data = self._blobs.get(rec.storage_uri) if rec.storage_uri else None
                name = f"{rec.index:05d}_{rec.filename}"
                if data is not None:
                    zf.writestr(name, data)
                manifest.append({**rec.model_dump(mode="json"), "bundle_file": name if data is not None else None})
            zf.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "owner": owner_id,
                        "signer": self._signer.name,
                        "how_to_verify": (
                            "For each record: sha256(file) must equal 'sha256'; record_hash must equal "
                            "sha256 of the canonical JSON of owner_id, index, filename, mime_type, size, sha256, "
                            "prev_hash and created_at; and each prev_hash must equal the previous record_hash."
                        ),
                        "records": manifest,
                    },
                    indent=2,
                ),
            )
        return buf.getvalue()
