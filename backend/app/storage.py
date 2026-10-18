"""Document storage behind a small interface: in-memory for dev and tests, Firestore in production.

Collections hold plain JSON dicts produced by `model.model_dump(mode="json")`, so the same code works on
both backends and records stay readable in the Firestore console.
"""

from __future__ import annotations

import copy
import threading
from typing import Any, Protocol


class DocStore(Protocol):
    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None: ...

    def put(self, collection: str, doc_id: str, data: dict[str, Any]) -> None: ...

    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> bool:
        """Create only if absent. Returns False if the id already exists."""
        ...

    def delete(self, collection: str, doc_id: str) -> None: ...

    def where(self, collection: str, field: str, value: Any, limit: int = 200) -> list[dict[str, Any]]: ...

    def all(self, collection: str, limit: int = 500) -> list[dict[str, Any]]: ...


class MemoryStore:
    def __init__(self) -> None:
        self._data: dict[str, dict[str, dict[str, Any]]] = {}
        self._lock = threading.RLock()

    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        with self._lock:
            doc = self._data.get(collection, {}).get(doc_id)
            return copy.deepcopy(doc) if doc is not None else None

    def put(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        with self._lock:
            self._data.setdefault(collection, {})[doc_id] = copy.deepcopy(data)

    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> bool:
        with self._lock:
            coll = self._data.setdefault(collection, {})
            if doc_id in coll:
                return False
            coll[doc_id] = copy.deepcopy(data)
            return True

    def delete(self, collection: str, doc_id: str) -> None:
        with self._lock:
            self._data.get(collection, {}).pop(doc_id, None)

    def where(self, collection: str, field: str, value: Any, limit: int = 200) -> list[dict[str, Any]]:
        with self._lock:
            docs = [d for d in self._data.get(collection, {}).values() if d.get(field) == value]
            return copy.deepcopy(docs[:limit])

    def all(self, collection: str, limit: int = 500) -> list[dict[str, Any]]:
        with self._lock:
            return copy.deepcopy(list(self._data.get(collection, {}).values())[:limit])


class FirestoreStore:
    """Firestore in Native mode. The service account needs roles/datastore.user."""

    def __init__(self, project: str, database: str = "(default)") -> None:
        from google.cloud import firestore  # lazy import

        self._client = firestore.Client(project=project, database=database)

    def get(self, collection: str, doc_id: str) -> dict[str, Any] | None:
        snap = self._client.collection(collection).document(doc_id).get()
        return snap.to_dict() if snap.exists else None

    def put(self, collection: str, doc_id: str, data: dict[str, Any]) -> None:
        self._client.collection(collection).document(doc_id).set(data)

    def create(self, collection: str, doc_id: str, data: dict[str, Any]) -> bool:
        from google.api_core.exceptions import AlreadyExists

        try:
            self._client.collection(collection).document(doc_id).create(data)
            return True
        except AlreadyExists:
            return False

    def delete(self, collection: str, doc_id: str) -> None:
        self._client.collection(collection).document(doc_id).delete()

    def where(self, collection: str, field: str, value: Any, limit: int = 200) -> list[dict[str, Any]]:
        from google.cloud.firestore_v1.base_query import FieldFilter

        query = self._client.collection(collection).where(filter=FieldFilter(field, "==", value)).limit(limit)
        return [snap.to_dict() for snap in query.stream()]

    def all(self, collection: str, limit: int = 500) -> list[dict[str, Any]]:
        return [snap.to_dict() for snap in self._client.collection(collection).limit(limit).stream()]
