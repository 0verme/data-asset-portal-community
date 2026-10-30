"""Versioned, read-only catalog export and fail-closed receiving contract.

Hashes cover the authorized wire representation, including key presence. These
are full catalog exports, not change cursors, source-schema assertions or indexes.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from typing import Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StrictStr,
    model_validator,
)

CONTRACT_VERSION = "1.0"
PROJECTION_VERSION = "catalog-business-v1"
MAX_PAGE_SIZE = 200
MAX_TEXT_LENGTH = 16384
Digest = str


class SnapshotWire(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    def wire(self) -> dict:
        return self.model_dump(mode="json", exclude_unset=True)


class EntityRef(SnapshotWire):
    entityType: Literal["table", "field"]
    assetId: StrictInt = Field(gt=0)
    fieldId: StrictInt | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def identity(self):
        if (self.entityType == "field") != (self.fieldId is not None):
            raise ValueError("invalid entity identity")
        # A table must not carry even an explicit null fieldId.
        if self.entityType == "table" and "fieldId" in self.model_fields_set:
            raise ValueError("table forbids fieldId")
        return self


def digest_field():
    return Field(pattern=r"^[0-9a-f]{64}$")


class SnapshotBinding(SnapshotWire):
    contractVersion: Literal["1.0"]
    catalogId: StrictStr = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    scopeId: StrictStr = Field(pattern=r"^[0-9a-f]{64}$")
    snapshotId: StrictStr = Field(pattern=r"^[A-Za-z0-9_-]{20,64}$")
    projectionVersion: Literal["catalog-business-v1"]
    policyRevision: Digest = digest_field()
    dataRevision: Digest = digest_field()
    workloadId: StrictStr = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
    purpose: Literal["snapshot-read"]


class IndexDocument(SnapshotWire):
    ref: EntityRef
    projectionHash: Digest = digest_field()
    name: StrictStr = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    displayName: StrictStr = Field(min_length=1, max_length=MAX_TEXT_LENGTH)
    description: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    domain: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    layer: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    layerDisplayName: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    grain: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    cycle: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    dataType: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    nullable: StrictBool | None = None
    primaryKey: StrictBool | None = None
    partitionKey: StrictBool | None = None
    enumeration: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    parentName: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    parentDisplayName: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    parentDescription: StrictStr | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    parentProjectionHash: Digest | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    fieldSetState: Literal["catalog-complete"] | None = None
    sourceFieldSetState: Literal["unknown"] | None = None

    @model_validator(mode="after")
    def context(self):
        if self.ref.entityType == "table":
            if self.fieldSetState != "catalog-complete" or self.sourceFieldSetState != "unknown":
                raise ValueError("table requires explicit catalog/source completeness")
            if any(key.startswith("parent") for key in self.model_fields_set):
                raise ValueError("table forbids parent context")
        elif (
            not self.parentName or not self.parentDisplayName or not self.parentProjectionHash
            or "fieldSetState" in self.model_fields_set
            or "sourceFieldSetState" in self.model_fields_set
        ):
            raise ValueError("field requires parent context")
        return self


class SnapshotManifest(SnapshotWire):
    binding: SnapshotBinding
    capturedAt: AwareDatetime
    expiresAt: AwareDatetime
    manifestHash: Digest = digest_field()
    documentCount: StrictInt = Field(ge=0)

    @model_validator(mode="after")
    def complete(self):
        if self.expiresAt <= self.capturedAt or self.manifestHash != self.binding.dataRevision:
            raise ValueError("invalid manifest")
        return self


class SnapshotPage(SnapshotWire):
    binding: SnapshotBinding
    capturedAt: AwareDatetime
    expiresAt: AwareDatetime
    pageNumber: StrictInt = Field(ge=0)
    pageSize: StrictInt = Field(ge=1, le=MAX_PAGE_SIZE)
    items: list[IndexDocument] = Field(max_length=MAX_PAGE_SIZE)
    nextCursor: StrictStr | None = Field(max_length=128)
    final: StrictBool
    manifestHash: Digest | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    documentCount: StrictInt | None = Field(default=None, ge=0)

    @model_validator(mode="after")
    def page(self):
        if self.expiresAt <= self.capturedAt or len(self.items) > self.pageSize:
            raise ValueError("invalid page bounds")
        if self.final:
            if (self.nextCursor is not None or self.manifestHash is None or self.documentCount is None
                    or (self.pageNumber > 0 and not self.items)):
                raise ValueError("final page requires manifest and a canonical ending")
            if self.manifestHash != self.binding.dataRevision:
                raise ValueError("manifest binding mismatch")
        elif (
            not self.nextCursor or len(self.items) != self.pageSize
            or "manifestHash" in self.model_fields_set
            or "documentCount" in self.model_fields_set
        ):
            raise ValueError("non-final page must be full and have no manifest")
        return self


def canonical_bytes(value) -> bytes:
    """UTF-8 JSON, sorted keys, no whitespace, no NaN; no text normalization."""
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
    ).encode("utf-8")


def content_hash(value) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def projection_hash(document: dict) -> str:
    return content_hash({
        "projectionVersion": PROJECTION_VERSION,
        "document": {key: value for key, value in document.items() if key != "projectionHash"},
    })


def identity_order(document: dict) -> tuple[int, int, int]:
    ref = document["ref"]
    return (ref["assetId"], 0 if ref["entityType"] == "table" else 1, ref.get("fieldId", 0))


def manifest_hash(binding: dict, documents: Iterable[dict]) -> str:
    return content_hash({
        "catalogId": binding["catalogId"],
        "scopeId": binding["scopeId"],
        "projectionVersion": binding["projectionVersion"],
        "policyRevision": binding["policyRevision"],
        "documents": [
            {"ref": document["ref"], "projectionHash": document["projectionHash"]}
            for document in documents
        ],
    })


class SnapshotIntegrityError(ValueError):
    """No documents may be published or swept after this failure."""


def validate_documents(documents: Iterable[dict]) -> None:
    previous = None
    parents = {}
    field_ids = set()
    for document in documents:
        IndexDocument.model_validate(document)
        order = identity_order(document)
        if previous is not None and order <= previous:
            raise SnapshotIntegrityError("SNAPSHOT_IDENTITY_ORDER")
        previous = order
        if projection_hash(document) != document["projectionHash"]:
            raise SnapshotIntegrityError("SNAPSHOT_DOCUMENT_HASH")
        ref = document["ref"]
        if ref["entityType"] == "table":
            parents[ref["assetId"]] = document
            continue
        if ref["fieldId"] in field_ids:
            raise SnapshotIntegrityError("SNAPSHOT_DUPLICATE_FIELD")
        field_ids.add(ref["fieldId"])
        parent = parents.get(ref["assetId"])
        if parent is None or document["parentProjectionHash"] != parent["projectionHash"]:
            raise SnapshotIntegrityError("SNAPSHOT_PARENT_MISMATCH")
        for key, parent_key in (
            ("parentName", "name"), ("parentDisplayName", "displayName"),
            ("parentDescription", "description"), ("domain", "domain"),
            ("layer", "layer"), ("layerDisplayName", "layerDisplayName"),
            ("grain", "grain"), ("cycle", "cycle"),
        ):
            if (key in document) != (parent_key in parent) or document.get(key) != parent.get(parent_key):
                raise SnapshotIntegrityError("SNAPSHOT_PARENT_CONTEXT")


class SnapshotReceiver:
    """Bounded staging validation, not an index or a metadata store.

    The caller supplies the expected DAP binding through a trusted channel.
    finish() MUST call DAP's authenticated manifest operation; a cached manifest
    does not implement that callback contract. Only its return value is eligible
    for a caller's atomic publication. No partial results are exposed.
    """

    def __init__(self, binding: dict, *, max_documents=10000, max_bytes=32 * 1024 * 1024,
                 now: Callable[[], datetime] | None = None):
        self._binding = SnapshotBinding.model_validate(binding).wire()
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._max_documents = max_documents
        self._max_bytes = max_bytes
        self._bytes = 0
        self._documents = []
        self._next_cursor = None
        self._seen_cursors = set()
        self._page_number = 0
        self._first = None
        self._final = None
        self._failed = False
        self._finished = False

    def accept(self, raw: dict, *, request_cursor: str | None = None) -> None:
        try:
            if self._failed or self._finished or self._final is not None:
                raise SnapshotIntegrityError("SNAPSHOT_NOT_RECEIVING")
            page = SnapshotPage.model_validate(raw)
            if (
                page.binding.wire() != self._binding
                or page.pageNumber != self._page_number
                or request_cursor != self._next_cursor
                or page.expiresAt <= self._now()
            ):
                raise SnapshotIntegrityError("SNAPSHOT_PAGE_MISMATCH")
            boundary = (page.capturedAt, page.expiresAt, page.pageSize)
            if self._first is not None and self._first != boundary:
                raise SnapshotIntegrityError("SNAPSHOT_BOUNDARY_MISMATCH")
            self._first = boundary
            if page.nextCursor is not None:
                if page.nextCursor in self._seen_cursors:
                    raise SnapshotIntegrityError("SNAPSHOT_CURSOR_CYCLE")
                self._seen_cursors.add(page.nextCursor)
            documents = [document.wire() for document in page.items]
            self._bytes += len(canonical_bytes(documents))
            if (len(self._documents) + len(documents) > self._max_documents
                    or self._bytes > self._max_bytes):
                raise SnapshotIntegrityError("SNAPSHOT_RECEIVER_LIMIT")
            self._documents.extend(documents)
            self._page_number += 1
            self._next_cursor = page.nextCursor
            if page.final:
                self._final = page
        except Exception:
            self._failed = True
            raise

    def finish(self, confirm: Callable[[], dict]) -> tuple[dict, ...]:
        try:
            if self._failed or self._finished or self._final is None:
                raise SnapshotIntegrityError("SNAPSHOT_INCOMPLETE")
            validate_documents(self._documents)
            final = self._final
            if (
                final.expiresAt <= self._now()
                or final.documentCount != len(self._documents)
                or final.manifestHash != manifest_hash(self._binding, self._documents)
            ):
                raise SnapshotIntegrityError("SNAPSHOT_MANIFEST_MISMATCH")
            # Online, authenticated current-authorization linearization point.
            confirmation = SnapshotManifest.model_validate(confirm())
            if (
                confirmation.binding.wire() != self._binding
                or confirmation.capturedAt != final.capturedAt
                or confirmation.expiresAt != final.expiresAt
                or confirmation.expiresAt <= self._now()
                or confirmation.documentCount != final.documentCount
                or confirmation.manifestHash != final.manifestHash
            ):
                raise SnapshotIntegrityError("SNAPSHOT_CONFIRMATION_MISMATCH")
            self._finished = True
            return tuple(json.loads(canonical_bytes(document)) for document in self._documents)
        except Exception:
            self._failed = True
            raise
