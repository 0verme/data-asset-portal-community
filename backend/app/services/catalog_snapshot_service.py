"""DAP-owned issuance and short-lived, read-only workload snapshot leases.

No HTTP mint, cookie delegation, cross-service APP_SECRET_KEY, durable metadata
store, query identity, retrieval or index publication is implemented here.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from threading import Lock, RLock
from time import monotonic

from ..application import Identity
from ..authorization.core import AuthorizationService, IdentityAuthorizationRepository
from ..contracts.catalog_snapshot import (
    CONTRACT_VERSION, MAX_PAGE_SIZE, MAX_TEXT_LENGTH, PROJECTION_VERSION,
    IndexDocument, SnapshotBinding, SnapshotManifest, SnapshotPage,
    canonical_bytes, content_hash, identity_order, manifest_hash, projection_hash,
    validate_documents,
)
from ..db.catalog_capture import CatalogCaptureLimit, CatalogCaptureTimeout, CatalogCaptureUnsupported
from ..db.facade import get_db_profile
from ..security import public_field_policy as policy
from ..settings import get_public_catalog_export_enabled, get_public_catalog_profile

_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
_PROOF = re.compile(r"^[A-Za-z0-9_-]{43}$")
_SUSPECT_TEXT = re.compile(
    r"://|jdbc:|-----BEGIN[ -]|\b(?:Bearer|Basic)\s+[A-Za-z0-9+/=._-]+|"
    r"\b(?:ghp_|github_pat_|AKIA)[A-Za-z0-9_]+", re.IGNORECASE,
)
_STATUS = {
    "SNAPSHOT_DISABLED": 503,
    "SNAPSHOT_UNAVAILABLE": 503,
    "CAPTURE_UNSUPPORTED": 503,
    "CAPTURE_TIMEOUT": 504,
    "SNAPSHOT_LIMIT": 413,
    "SNAPSHOT_BUSY": 429,
    "SNAPSHOT_CONTENT_REJECTED": 422,
    "SNAPSHOT_INPUT_INVALID": 422,
    "SNAPSHOT_AUTH_REQUIRED": 401,
    "SNAPSHOT_FORBIDDEN": 403,
    "SNAPSHOT_POLICY_CHANGED": 409,
    "SNAPSHOT_CURSOR_INVALID": 409,
    "SNAPSHOT_EXPIRED": 410,
}


class SnapshotError(RuntimeError):
    def __init__(self, code):
        self.code = code
        self.status = _STATUS[code]
        super().__init__(code)


@dataclass(frozen=True)
class SnapshotLease:
    """Deliver only to the intended workload over a trusted secret channel."""
    binding: dict
    expires_at: datetime
    proof: str = field(repr=False)


@dataclass(frozen=True)
class _FrozenSnapshot:
    binding: dict
    captured_at: datetime
    expires_at: datetime
    deadline: float
    issuer: Identity
    identity: Identity | None
    authorization_fence: str
    proof_hash: bytes = field(repr=False)
    documents: tuple[bytes, ...] = field(repr=False)
    cursors: tuple[str, ...] = field(repr=False)
    page_size: int
    size_bytes: int


class CatalogSnapshotService:
    """Explicit opt-in composition seam; ordinary application startup is unchanged.

    issue() is a trusted DAP Python operation, not a user-controlled HTTP API.
    issuer must currently hold metadata:read. identity is the separately resolved
    projection subject (None = current anonymous policy/export gate), NEVER a
    profile or allowed-ID list. The workload gets no issuer session/CRUD rights.
    """

    def __init__(self, assets, authorization: AuthorizationService, *, catalog_id: str,
                 max_documents=10000, max_bytes=32 * 1024 * 1024, max_snapshots=4,
                 capture_timeout=10.0, now=None, clock=None):
        if not _NAME.fullmatch(catalog_id):
            raise ValueError("catalog namespace must not be a URL")
        if isinstance(authorization.repository, IdentityAuthorizationRepository):
            raise ValueError("snapshot issuance requires a current-state authorization repository")
        if not (1 <= max_documents <= 10000 and 1024 <= max_bytes <= 32 * 1024 * 1024
                and 1 <= max_snapshots <= 16 and 0 < capture_timeout <= 30):
            raise ValueError("invalid capture bounds")
        self.assets = assets
        self.authorization = authorization
        self.catalog_id = catalog_id
        self.max_documents = max_documents
        self.max_bytes = max_bytes  # Also the aggregate retained-document budget.
        self.max_snapshots = max_snapshots
        self.capture_timeout = capture_timeout
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._clock = clock or monotonic
        self._cursor_key = secrets.token_bytes(32)
        self._snapshots = {}
        self._store_lock = RLock()
        self._capture_lock = Lock()

    def _subject(self, identity, permission):
        decision = self.authorization.authenticate(identity)
        if not decision.authenticated:
            raise SnapshotError("SNAPSHOT_AUTH_REQUIRED")
        if decision.reason != "authenticated":
            raise SnapshotError("SNAPSHOT_FORBIDDEN")
        allowed = self.authorization.authorize(identity, permission, authentication=decision)
        if not allowed.allowed or decision.subject is None:
            raise SnapshotError("SNAPSHOT_FORBIDDEN")
        return {
            "subject": asdict(decision.subject),
            "permissions": self.authorization.get_permissions(identity, authentication=decision),
        }

    def _current_authorization(self, issuer, identity):
        try:
            issuer_facts = self._subject(issuer, "metadata:read")
            public_profile = get_public_catalog_profile()
            export_enabled = get_public_catalog_export_enabled()
            if identity is None:
                if public_profile == "disabled" or not export_enabled:
                    raise SnapshotError("SNAPSHOT_FORBIDDEN")
                target_facts = {"anonymous": True}
                profile = public_profile
            else:
                target_facts = self._subject(identity, "asset:read")
                profile = "internal"
            policy_revision = content_hash({
                "projectionVersion": PROJECTION_VERSION,
                "publicProfile": public_profile,
                "anonymousExport": export_enabled,
                "fieldPolicy": policy.PUBLIC_FIELD_POLICY,
                "hiddenKeys": sorted(policy.PUBLIC_ALWAYS_HIDDEN_KEYS),
                "connectionKeys": sorted(policy.PUBLIC_CONNECTION_METADATA_KEYS),
                "personKeys": sorted(policy.PUBLIC_PERSON_IDENTITY_KEYS),
            })
            # Private fence only; never include DB configuration or identity in
            # a document/public digest. A changed deployment cannot reuse leases.
            fence = content_hash({
                "issuer": issuer_facts, "target": target_facts,
                "database": get_db_profile(self.assets._db.profile()),
            })
            return profile, policy_revision, fence
        except SnapshotError:
            raise
        except Exception:
            raise SnapshotError("SNAPSHOT_UNAVAILABLE") from None

    @staticmethod
    def _seal(raw, profile):
        # Only allowlisted business values reach this check. Do not inspect hidden
        # raw DB columns or let them influence an anonymous document's digest.
        for value in raw.values():
            if not isinstance(value, str):
                continue
            if len(value) > MAX_TEXT_LENGTH:
                raise SnapshotError("SNAPSHOT_LIMIT")
            if _SUSPECT_TEXT.search(value) or policy.redact_public_text(value, profile="strict") != value:
                raise SnapshotError("SNAPSHOT_CONTENT_REJECTED")
        document = policy.project_public_value(raw, profile=profile)
        document["projectionHash"] = projection_hash(document)
        return IndexDocument.model_validate(document).wire()

    def _project(self, tables, fields, profile):
        if len(tables) + len(fields) > self.max_documents:
            raise SnapshotError("SNAPSHOT_LIMIT")
        if any(isinstance(value, str) and len(value) > MAX_TEXT_LENGTH
               for row in (*tables, *fields) for value in row.values()):
            raise SnapshotError("SNAPSHOT_LIMIT")
        parents = {}
        documents = []
        projected_bytes = 0

        def append(raw):
            nonlocal projected_bytes
            document = self._seal(raw, profile)
            projected_bytes += len(canonical_bytes(document))
            if projected_bytes > self.max_bytes:
                raise SnapshotError("SNAPSHOT_LIMIT")
            documents.append(document)
            return document

        for row in tables:
            raw = {
                "ref": {"entityType": "table", "assetId": row["asset_id"]},
                "name": row["table_name"],
                "displayName": row.get("table_cn_name") or row["table_name"],
                "fieldSetState": "catalog-complete", "sourceFieldSetState": "unknown",
            }
            for source, target in (
                ("table_desc", "description"), ("domain_name", "domain"),
                ("layer_code", "layer"), ("layer_name", "layerDisplayName"),
                ("grain_desc", "grain"), ("cycle_desc", "cycle"),
            ):
                if source in row:
                    raw[target] = row[source]
            parent = append(raw)
            parents[row["asset_id"]] = parent
        for row in fields:
            parent = parents.get(row["asset_id"])
            if parent is None:
                raise SnapshotError("SNAPSHOT_UNAVAILABLE")
            raw = {
                "ref": {"entityType": "field", "assetId": row["asset_id"], "fieldId": row["field_id"]},
                "name": row["field_name"],
                # Existing display-name semantics; description stays independent.
                "displayName": row.get("field_cn_name") or row.get("field_desc") or row["field_name"],
                "parentName": parent["name"], "parentDisplayName": parent["displayName"],
                "parentProjectionHash": parent["projectionHash"],
            }
            for source, target in (("field_desc", "description"), ("enum_desc", "enumeration")):
                if source in row:
                    raw[target] = row[source]
            if "data_type" in row:
                raw["dataType"] = (
                    self.assets._normalize_field_type(row["data_type"]) if row["data_type"] is not None else None
                )
            for source, target in (
                ("nullable_flag", "nullable"), ("pk_flag", "primaryKey"), ("partition_flag", "partitionKey"),
            ):
                if source in row:
                    value = row[source]
                    if value is not None and value not in ("Y", "N"):
                        raise SnapshotError("SNAPSHOT_UNAVAILABLE")
                    raw[target] = None if value is None else value == "Y"
            for key, target in (
                ("description", "parentDescription"), ("domain", "domain"),
                ("layer", "layer"), ("layerDisplayName", "layerDisplayName"),
                ("grain", "grain"), ("cycle", "cycle"),
            ):
                if key in parent:
                    raw[target] = parent[key]
            append(raw)
        documents.sort(key=identity_order)
        validate_documents(documents)
        return tuple(canonical_bytes(document) for document in documents)

    def _expired(self, snapshot):
        return self._now() >= snapshot.expires_at or self._clock() >= snapshot.deadline

    def _prune(self):
        for key, snapshot in list(self._snapshots.items()):
            if self._expired(snapshot):
                del self._snapshots[key]

    def issue(self, *, issuer: Identity, identity: Identity | None, workload_id: str,
              page_size: int = 100, ttl_seconds: int = 300) -> SnapshotLease:
        if (not isinstance(workload_id, str) or not _NAME.fullmatch(workload_id)
                or type(page_size) is not int or not 1 <= page_size <= MAX_PAGE_SIZE
                or type(ttl_seconds) is not int or not 1 <= ttl_seconds <= 300):
            raise SnapshotError("SNAPSHOT_INPUT_INVALID")
        if not self._capture_lock.acquire(blocking=False):
            raise SnapshotError("SNAPSHOT_BUSY")
        completed = False
        snapshot_id = None
        try:
            capture_deadline = self._clock() + self.capture_timeout
            profile, policy_revision, fence = self._current_authorization(issuer, identity)
            with self._store_lock:
                self._prune()
                if len(self._snapshots) >= self.max_snapshots:
                    raise SnapshotError("SNAPSHOT_BUSY")
            captured_at = self._now()
            deadline = self._clock() + ttl_seconds
            tables, fields = self.assets.capture_catalog_rows(
                max_documents=self.max_documents, max_text_length=MAX_TEXT_LENGTH,
                max_bytes=self.max_bytes, timeout_seconds=self.capture_timeout,
            )
            documents = self._project(tables, fields, profile)
            if self._clock() >= capture_deadline:
                raise SnapshotError("CAPTURE_TIMEOUT")
            size_bytes = sum(map(len, documents))
            if size_bytes > self.max_bytes:
                raise SnapshotError("SNAPSHOT_LIMIT")
            if self._current_authorization(issuer, identity) != (profile, policy_revision, fence):
                raise SnapshotError("SNAPSHOT_POLICY_CHANGED")
            snapshot_id = secrets.token_urlsafe(24)
            binding = {
                "contractVersion": CONTRACT_VERSION, "catalogId": self.catalog_id,
                "scopeId": content_hash({"catalogId": self.catalog_id, "profile": profile,
                                         "projectionVersion": PROJECTION_VERSION}),
                "snapshotId": snapshot_id, "projectionVersion": PROJECTION_VERSION,
                "policyRevision": policy_revision, "workloadId": workload_id, "purpose": "snapshot-read",
            }
            binding["dataRevision"] = manifest_hash(binding, map(json.loads, documents))
            binding = SnapshotBinding.model_validate(binding).wire()
            proof = secrets.token_urlsafe(32)
            pages = max(1, (len(documents) + page_size - 1) // page_size)
            cursors = tuple(
                hmac.new(self._cursor_key, canonical_bytes({"binding": binding, "pageSize": page_size,
                                                          "page": number, "deadline": deadline}), hashlib.sha256).hexdigest()
                for number in range(1, pages)
            )
            snapshot = _FrozenSnapshot(
                binding, captured_at, captured_at + timedelta(seconds=ttl_seconds), deadline,
                issuer, identity, fence, hashlib.sha256(proof.encode()).digest(), documents,
                cursors, page_size, size_bytes,
            )
            with self._store_lock:
                self._prune()
                if self._expired(snapshot):
                    raise SnapshotError("SNAPSHOT_EXPIRED")
                if sum(item.size_bytes for item in self._snapshots.values()) + size_bytes > self.max_bytes:
                    raise SnapshotError("SNAPSHOT_LIMIT")
                self._snapshots[snapshot_id] = snapshot
            self._check(snapshot, catalog_id=self.catalog_id, scope_id=binding["scopeId"],
                        workload_id=workload_id, proof=proof)
            completed = True
            return SnapshotLease(dict(binding), snapshot.expires_at, proof)
        except SnapshotError:
            raise
        except CatalogCaptureUnsupported:
            raise SnapshotError("CAPTURE_UNSUPPORTED") from None
        except CatalogCaptureTimeout:
            raise SnapshotError("CAPTURE_TIMEOUT") from None
        except CatalogCaptureLimit:
            raise SnapshotError("SNAPSHOT_LIMIT") from None
        except Exception:
            raise SnapshotError("SNAPSHOT_UNAVAILABLE") from None
        finally:
            if not completed and snapshot_id is not None:
                self.revoke(snapshot_id)
            self._capture_lock.release()

    def revoke(self, snapshot_id: str) -> None:
        """Trusted DAP/operations seam; not a metadata write or public endpoint."""
        with self._store_lock:
            self._snapshots.pop(snapshot_id, None)

    def _check(self, snapshot, *, catalog_id, scope_id, workload_id, proof):
        if not isinstance(proof, str) or not _PROOF.fullmatch(proof):
            raise SnapshotError("SNAPSHOT_AUTH_REQUIRED")
        if not hmac.compare_digest(snapshot.proof_hash, hashlib.sha256(proof.encode()).digest()):
            raise SnapshotError("SNAPSHOT_AUTH_REQUIRED")
        if (catalog_id != self.catalog_id or scope_id != snapshot.binding["scopeId"]
                or workload_id != snapshot.binding["workloadId"]):
            raise SnapshotError("SNAPSHOT_FORBIDDEN")
        if self._expired(snapshot):
            raise SnapshotError("SNAPSHOT_EXPIRED")
        try:
            profile, revision, fence = self._current_authorization(snapshot.issuer, snapshot.identity)
            expected_scope = content_hash({"catalogId": self.catalog_id, "profile": profile,
                                           "projectionVersion": PROJECTION_VERSION})
            if (revision != snapshot.binding["policyRevision"] or fence != snapshot.authorization_fence
                    or expected_scope != scope_id):
                raise SnapshotError("SNAPSHOT_POLICY_CHANGED")
        except SnapshotError:
            # Once observed invalid, this lease can never be revived by restoring
            # a role/configuration. Wrong external proofs above cannot revoke it.
            self.revoke(snapshot.binding["snapshotId"])
            raise
        with self._store_lock:
            if self._snapshots.get(snapshot.binding["snapshotId"]) is not snapshot:
                raise SnapshotError("SNAPSHOT_EXPIRED")

    def _lookup(self, snapshot_id, credentials):
        with self._store_lock:
            snapshot = self._snapshots.get(snapshot_id)
        if snapshot is None:
            raise SnapshotError("SNAPSHOT_EXPIRED")
        self._check(snapshot, **credentials)
        return snapshot

    @staticmethod
    def _manifest(snapshot):
        return {
            "binding": snapshot.binding, "capturedAt": snapshot.captured_at,
            "expiresAt": snapshot.expires_at, "manifestHash": snapshot.binding["dataRevision"],
            "documentCount": len(snapshot.documents),
        }

    def read_page(self, *, snapshot_id, cursor=None, page_size=None, **credentials) -> dict:
        snapshot = self._lookup(snapshot_id, credentials)
        if page_size is not None and page_size != snapshot.page_size:
            raise SnapshotError("SNAPSHOT_CURSOR_INVALID")
        if cursor is None:
            page_number = 0
        else:
            try:
                page_number = snapshot.cursors.index(cursor) + 1
            except ValueError:
                raise SnapshotError("SNAPSHOT_CURSOR_INVALID") from None
        start = page_number * snapshot.page_size
        final = start + snapshot.page_size >= len(snapshot.documents)
        result = {
            "binding": snapshot.binding, "capturedAt": snapshot.captured_at,
            "expiresAt": snapshot.expires_at, "pageNumber": page_number, "pageSize": snapshot.page_size,
            "items": [json.loads(item) for item in snapshot.documents[start:start + snapshot.page_size]],
            "nextCursor": None if final else snapshot.cursors[page_number], "final": final,
        }
        if final:
            result.update(manifestHash=snapshot.binding["dataRevision"], documentCount=len(snapshot.documents))
        payload = SnapshotPage.model_validate(result).wire()
        self._check(snapshot, **credentials)
        return payload

    def confirm_manifest(self, *, snapshot_id, **credentials) -> dict:
        snapshot = self._lookup(snapshot_id, credentials)
        payload = SnapshotManifest.model_validate(self._manifest(snapshot)).wire()
        self._check(snapshot, **credentials)
        return payload
