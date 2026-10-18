"""Personal-data protection: masking identifiers in text and hashing them for the integrity network.

Masking runs locally on every piece of extracted text. When USE_SENSITIVE_DATA_PROTECTION is on,
Google Cloud Sensitive Data Protection runs as a second pass for anything the patterns miss.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import re
import unicodedata

log = logging.getLogger(__name__)

# Ordered most specific first so a CNIC is not half-masked as a phone number.
_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("IBAN", re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{7}[A-Z0-9]{0,16}\b")),
    ("CNIC", re.compile(r"\b\d{5}-?\d{7}-?\d\b")),
    ("CARD", re.compile(r"\b(?:\d[ -]?){13,19}\b")),
    ("PASSPORT", re.compile(r"\b[A-Z]{1,2}\d{7,8}\b")),
    ("PHONE", re.compile(r"(?<!\w)\+?\d[\d\s\-()]{8,16}\d(?!\w)")),
    ("EMAIL", re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.-]+\b")),
]


def mask_identifiers(text: str | None) -> str | None:
    """Replace ID, account, card, phone and email numbers with typed placeholders."""
    if not text:
        return text
    masked = text
    for label, pattern in _PATTERNS:
        masked = pattern.sub(f"[{label}]", masked)
    return masked


def normalize_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("00"):
        digits = digits[2:]
    # Pakistani local format 03xx... -> 923xx...
    if len(digits) == 11 and digits.startswith("03"):
        digits = "92" + digits[1:]
    return digits


def normalize_account(raw: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", (raw or "").upper())


def normalize_name(raw: str | None) -> str:
    if not raw:
        return ""
    text = unicodedata.normalize("NFKC", raw).lower()
    text = re.sub(r"\b(pvt|private|ltd|limited|llc|co|company|overseas employment promoters?|oep|the)\b", " ", text)
    text = re.sub(r"[^\w\s]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


# Words recruiting firms share. Two different firms that both use them look alike to a fuzzy match;
# without them only the part that tells the firms apart is compared. Same list as lib/engine/text.ts.
_GENERIC_FIRM_WORDS = re.compile(
    r"\b(manpower|employment|overseas|promoters?|recruit(?:ers?|ment|ing)?|placements?|services?|consultants?"
    r"|consultancy|agency|international|intl|enterprises?|trading|group|travels?|tours?|fictional|sample)\b"
)


def distinctive_name(raw: str | None) -> str:
    """The part of a firm's name that tells it apart from other firms. Falls back to the whole name."""
    base = normalize_name(raw)
    rest = re.sub(r"\s+", " ", _GENERIC_FIRM_WORDS.sub(" ", base)).strip()
    return rest or base


class Hasher:
    """Keyed hashing so the network can match identifiers without storing them.

    HMAC-SHA256 with a secret salt: equal inputs give equal tokens, but tokens can't be reversed or
    brute-forced by someone without the salt.
    """

    def __init__(self, salt: str) -> None:
        if not salt:
            raise ValueError("hash salt must not be empty")
        self._key = salt.encode("utf-8")

    def token(self, kind: str, value: str) -> str:
        digest = hmac.new(self._key, f"{kind}:{value}".encode("utf-8"), hashlib.sha256).hexdigest()
        return f"{kind}_{digest[:24]}"

    def phone(self, raw: str) -> str | None:
        value = normalize_phone(raw)
        return self.token("ph", value) if len(value) >= 8 else None

    def account(self, raw: str) -> str | None:
        value = normalize_account(raw)
        return self.token("ac", value) if len(value) >= 6 else None

    def name(self, raw: str | None) -> str | None:
        value = normalize_name(raw)
        return self.token("nm", value) if value else None


class SensitiveDataProtection:
    """Optional second pass through Google Cloud Sensitive Data Protection (DLP API)."""

    INFO_TYPES = ["PHONE_NUMBER", "EMAIL_ADDRESS", "PASSPORT", "IBAN_CODE", "CREDIT_CARD_NUMBER"]

    def __init__(self, project: str) -> None:
        from google.cloud import dlp_v2  # imported lazily: only needed when enabled

        self._client = dlp_v2.DlpServiceClient()
        self._parent = f"projects/{project}/locations/global"

    def deidentify(self, text: str) -> str:
        response = self._client.deidentify_content(
            request={
                "parent": self._parent,
                "inspect_config": {"info_types": [{"name": n} for n in self.INFO_TYPES]},
                "deidentify_config": {
                    "info_type_transformations": {
                        "transformations": [{"primitive_transformation": {"replace_with_info_type_config": {}}}]
                    }
                },
                "item": {"value": text},
            }
        )
        return response.item.value


class Masker:
    """Local masking plus the optional Sensitive Data Protection pass; never raises on the SDP path."""

    def __init__(self, sdp: SensitiveDataProtection | None = None) -> None:
        self._sdp = sdp

    def __call__(self, text: str | None) -> str | None:
        masked = mask_identifiers(text)
        if masked and self._sdp is not None:
            try:
                masked = self._sdp.deidentify(masked)
            except Exception:  # keep the local result; log without the text
                log.warning("Sensitive Data Protection pass failed; local masking kept", exc_info=True)
        return masked
