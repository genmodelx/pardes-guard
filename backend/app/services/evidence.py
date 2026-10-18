"""Tamper-evident evidence chain.

Each owner's evidence forms a hash chain: a record's hash covers the file's SHA-256, its metadata and
the previous record's hash, and the record hash is signed. Changing, removing or reordering any file
breaks verification from that point on, which is what makes the exported bundle credible.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from typing import Protocol

from app.schemas import EvidenceRecord

GENESIS = "0" * 64


class Signer(Protocol):
    name: str

    def sign(self, digest_hex: str) -> str: ...

    def verify(self, digest_hex: str, signature: str) -> bool: ...


class HmacSigner:
    """Local signer (HMAC-SHA256). The key comes from Secret Manager in production."""

    name = "hmac"

    def __init__(self, key: str) -> None:
        if not key:
            raise ValueError("signing key must not be empty")
        self._key = key.encode("utf-8")

    def sign(self, digest_hex: str) -> str:
        return hmac.new(self._key, bytes.fromhex(digest_hex), hashlib.sha256).hexdigest()

    def verify(self, digest_hex: str, signature: str) -> bool:
        return hmac.compare_digest(self.sign(digest_hex), signature)


class KmsSigner:
    """Asymmetric signing with a Cloud KMS key (EC_SIGN_P256_SHA256 or RSA_SIGN_*_SHA256).

    Verification needs only the public key, so a court or NGO can verify a bundle without our secrets.
    """

    name = "kms"

    def __init__(self, key_version: str) -> None:
        from google.cloud import kms  # lazy import

        self._client = kms.KeyManagementServiceClient()
        self._key_version = key_version
        self._public_pem: bytes | None = None

    def sign(self, digest_hex: str) -> str:
        resp = self._client.asymmetric_sign(
            request={"name": self._key_version, "digest": {"sha256": bytes.fromhex(digest_hex)}}
        )
        return base64.b64encode(resp.signature).decode("ascii")

    def public_key_pem(self) -> bytes:
        if self._public_pem is None:
            self._public_pem = self._client.get_public_key(request={"name": self._key_version}).pem.encode("utf-8")
        return self._public_pem

    def verify(self, digest_hex: str, signature: str) -> bool:
        from cryptography.exceptions import InvalidSignature
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa, utils

        key = serialization.load_pem_public_key(self.public_key_pem())
        sig = base64.b64decode(signature)
        digest = bytes.fromhex(digest_hex)
        try:
            if isinstance(key, ec.EllipticCurvePublicKey):
                key.verify(sig, digest, ec.ECDSA(utils.Prehashed(hashes.SHA256())))
            elif isinstance(key, rsa.RSAPublicKey):
                key.verify(sig, digest, padding.PKCS1v15(), utils.Prehashed(hashes.SHA256()))
            else:
                return False
            return True
        except InvalidSignature:
            return False


def _record_hash(fields: dict) -> str:
    canonical = json.dumps(fields, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _hash_fields(owner_id: str, index: int, filename: str, mime: str, size: int, sha: str, prev: str, at: str) -> dict:
    return {
        "owner_id": owner_id,
        "index": index,
        "filename": filename,
        "mime_type": mime,
        "size": size,
        "sha256": sha,
        "prev_hash": prev,
        "created_at": at,
    }


def build_record(
    *,
    record_id: str,
    owner_id: str,
    data: bytes,
    filename: str,
    mime_type: str,
    previous: EvidenceRecord | None,
    signer: Signer,
    case_id: str | None = None,
    storage_uri: str | None = None,
    note: str | None = None,
    now: datetime | None = None,
) -> EvidenceRecord:
    at = (now or datetime.now(timezone.utc)).replace(microsecond=0)
    index = 0 if previous is None else previous.index + 1
    prev_hash = GENESIS if previous is None else previous.record_hash
    sha = hashlib.sha256(data).hexdigest()
    fields = _hash_fields(owner_id, index, filename, mime_type, len(data), sha, prev_hash, at.isoformat())
    rh = _record_hash(fields)
    return EvidenceRecord(
        id=record_id,
        owner_id=owner_id,
        case_id=case_id,
        index=index,
        filename=filename,
        mime_type=mime_type,
        size=len(data),
        sha256=sha,
        prev_hash=prev_hash,
        record_hash=rh,
        signature=signer.sign(rh),
        signer=signer.name,  # type: ignore[arg-type]
        created_at=at,
        storage_uri=storage_uri,
        note=note,
    )


def verify_chain(records: list[EvidenceRecord], signer: Signer, files: dict[str, bytes] | None = None) -> tuple[bool, int | None, str]:
    """Verify a chain. Returns (ok, first_bad_index, reason). Pass `files` (id -> bytes) to also check contents."""
    ordered = sorted(records, key=lambda r: r.index)
    prev = GENESIS
    for expected_index, rec in enumerate(ordered):
        if rec.index != expected_index:
            return False, expected_index, "a record is missing or out of order"
        if rec.prev_hash != prev:
            return False, rec.index, "the chain link to the previous record is broken"
        fields = _hash_fields(
            rec.owner_id, rec.index, rec.filename, rec.mime_type, rec.size, rec.sha256, rec.prev_hash, rec.created_at.isoformat()
        )
        if _record_hash(fields) != rec.record_hash:
            return False, rec.index, "the record's details were changed"
        if not signer.verify(rec.record_hash, rec.signature):
            return False, rec.index, "the signature does not match"
        if files is not None and rec.id in files:
            if hashlib.sha256(files[rec.id]).hexdigest() != rec.sha256:
                return False, rec.index, "the file content was changed"
        prev = rec.record_hash
    return True, None, "all records verified"
