"""Versioned, database-independent metadata ingestion contracts.

The models in this module deliberately describe the integration boundary rather
than the portal's tables.  They accept both the repository's camelCase JSON
style and snake_case field names so collectors can be implemented in any
language; responses are emitted in camelCase.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import (  # pyright: ignore[reportMissingImports]
    AliasChoices,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


MAX_ASSETS_PER_REQUEST = 1_000
MAX_FIELDS_PER_ASSET = 1_000
MAX_TOTAL_FIELDS = 10_000
MAX_LINEAGE_NODES = 10_000
MAX_LINEAGE_EDGES = 20_000
MAX_METADATA_BODY_BYTES = 8 * 1024 * 1024
SUPPORTED_CONTRACT_MAJOR = 1


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class MetadataContractModel(BaseModel):
    """Strictly shaped integration DTOs with additive-field tolerance."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="ignore",
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class MetadataSource(MetadataContractModel):
    """The system being described, not the program submitting the payload."""

    type: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=128)
    namespace: str | None = Field(default=None, max_length=128)
    instance: str | None = Field(default=None, max_length=128)


class MetadataCollector(MetadataContractModel):
    """The program that produced a contract payload."""

    name: str = Field(min_length=1, max_length=128)
    version: str = Field(min_length=1, max_length=64)


class MetadataField(MetadataContractModel):
    """Column metadata supplied by a collector; no internal field ID is accepted."""

    name: str = Field(min_length=1, max_length=256)
    data_type: str = Field(
        min_length=1,
        max_length=128,
        validation_alias=AliasChoices("dataType", "data_type", "type"),
        serialization_alias="dataType",
    )
    nullable: bool = True
    primary_key: bool = Field(
        default=False,
        validation_alias=AliasChoices("primaryKey", "primary_key", "pk"),
        serialization_alias="primaryKey",
    )
    partition_key: bool = Field(
        default=False,
        validation_alias=AliasChoices("partitionKey", "partition_key", "part"),
        serialization_alias="partitionKey",
    )
    ordinal_position: int | None = Field(default=None, ge=1, serialization_alias="ordinalPosition")
    description: str | None = Field(
        default=None,
        max_length=2_000,
        validation_alias=AliasChoices("description", "comment"),
    )


class MetadataAsset(MetadataContractModel):
    """Source asset metadata mapped to the portal's asset domain."""

    external_id: str | None = Field(default=None, max_length=256)
    qualified_name: str | None = Field(default=None, max_length=512)
    asset_type: str = Field(default="table", max_length=64)
    catalog: str | None = Field(default=None, max_length=128)
    database: str | None = Field(default=None, max_length=128)
    schema_name: str | None = Field(
        default=None,
        validation_alias=AliasChoices("schema", "schemaName", "schema_name"),
        serialization_alias="schema",
        max_length=128,
    )
    name: str | None = Field(default=None, max_length=256)
    description: str | None = Field(
        default=None,
        max_length=2_000,
        validation_alias=AliasChoices("description", "comment"),
    )
    fields: list[MetadataField] = Field(default_factory=list)

    @model_validator(mode="after")
    def require_name_or_qualified_name(self) -> MetadataAsset:
        if not (self.name or self.qualified_name):
            raise ValueError("name or qualifiedName is required")
        return self


class AssetMetadataIngestionRequest(MetadataContractModel):
    """Bulk Asset Contract submitted by an external Collector."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "contractVersion": "1.0",
                    "source": {"type": "postgresql", "name": "warehouse-prod"},
                    "collector": {"name": "postgresql-reference", "version": "0.1.0"},
                    "assets": [
                        {
                            "externalId": "public.orders",
                            "qualifiedName": "public.orders",
                            "assetType": "table",
                            "schema": "public",
                            "name": "orders",
                            "fields": [],
                        }
                    ],
                }
            ]
        }
    )
    contract_version: str = Field(
        min_length=1,
        max_length=32,
        validation_alias=AliasChoices("contractVersion", "contract_version"),
        serialization_alias="contractVersion",
    )
    source: MetadataSource
    collector: MetadataCollector
    assets: list[MetadataAsset] = Field(default_factory=list)
    authoritative: bool = False


class LineageSnapshot(MetadataContractModel):
    """Identity and publication mode for one self-contained lineage snapshot."""

    external_snapshot_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "externalSnapshotId", "external_snapshot_id", "snapshotId", "snapshot_id"
        ),
        serialization_alias="externalSnapshotId",
        max_length=256,
    )
    import_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("importId", "import_id"),
        serialization_alias="importId",
        max_length=256,
    )
    generated_at: datetime = Field(serialization_alias="generatedAt")
    mode: str = Field(default="replace", max_length=32)

    @model_validator(mode="after")
    def require_snapshot_identity(self) -> LineageSnapshot:
        if not (self.external_snapshot_id or self.import_id):
            raise ValueError("externalSnapshotId or importId is required")
        return self

    @field_validator("generated_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("generatedAt must include a timezone")
        return value


class LineageNode(MetadataContractModel):
    """Node identity and attributes inside a self-contained snapshot."""

    external_id: str | None = Field(default=None, max_length=256)
    qualified_name: str | None = Field(default=None, max_length=512)
    node_type: str = Field(
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("type", "nodeType", "node_type"),
        serialization_alias="type",
    )
    name: str = Field(min_length=1, max_length=256)
    namespace: str | None = Field(default=None, max_length=128)
    attributes: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def require_node_identity(self) -> LineageNode:
        if not (self.external_id or self.qualified_name):
            raise ValueError("externalId or qualifiedName is required")
        return self


class LineageEvidence(MetadataContractModel):
    """Bounded evidence summary; raw credentials and full payloads are not audit data."""

    evidence_type: str = Field(
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("type", "evidenceType", "evidence_type"),
        serialization_alias="type",
    )
    source_record_id: str = Field(
        default="",
        max_length=256,
        validation_alias=AliasChoices("sourceRecordId", "source_record_id"),
        serialization_alias="sourceRecordId",
    )
    description: str = Field(default="", max_length=1_000)


class LineageEdge(MetadataContractModel):
    """An edge whose endpoints must resolve to nodes in the same snapshot."""

    external_id: str | None = Field(default=None, max_length=256)
    source_id: str = Field(
        min_length=1,
        max_length=512,
        validation_alias=AliasChoices("sourceId", "source_id", "from", "fromId"),
        serialization_alias="sourceId",
    )
    target_id: str = Field(
        min_length=1,
        max_length=512,
        validation_alias=AliasChoices("targetId", "target_id", "to", "toId"),
        serialization_alias="targetId",
    )
    edge_type: str = Field(
        min_length=1,
        max_length=64,
        validation_alias=AliasChoices("type", "edgeType", "edge_type"),
        serialization_alias="type",
    )
    evidence: LineageEvidence
    confidence: str | float | int
    diagnostics: list[dict[str, Any]] = Field(default_factory=list)


class LineageMetadataIngestionRequest(MetadataContractModel):
    """Lineage snapshot Contract; V1 formally supports replace mode only."""

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "contractVersion": "1.0",
                    "source": {"type": "postgresql", "name": "warehouse-prod"},
                    "collector": {"name": "lineage-reference", "version": "0.1.0"},
                    "snapshot": {
                        "externalSnapshotId": "run-1",
                        "generatedAt": "2026-08-22T10:00:00Z",
                        "mode": "replace",
                    },
                    "nodes": [],
                    "edges": [],
                }
            ]
        }
    )
    contract_version: str = Field(
        min_length=1,
        max_length=32,
        validation_alias=AliasChoices("contractVersion", "contract_version"),
        serialization_alias="contractVersion",
    )
    source: MetadataSource
    collector: MetadataCollector
    snapshot: LineageSnapshot
    nodes: list[LineageNode] = Field(default_factory=list)
    edges: list[LineageEdge] = Field(default_factory=list)


class MetadataSummary(MetadataContractModel):
    received: int = 0
    valid: int = 0
    create: int = 0
    update: int = 0
    unchanged: int = 0
    conflict: int = 0
    invalid: int = 0
    failed: int = 0
    delete_candidate: int = Field(default=0, serialization_alias="deleteCandidate")
    nodes: int = 0
    edges: int = 0


class MetadataItemResult(MetadataContractModel):
    index: int | None = None
    external_key: str = Field(default="", serialization_alias="externalKey")
    status: str
    action: str | None = None
    code: str | None = None
    message: str | None = None
    field: str | None = None


class MetadataIngestionResult(MetadataContractModel):
    """Stable result envelope shared by Asset and Lineage ingestion endpoints."""

    ingestion_id: str = Field(serialization_alias="ingestionId")
    correlation_id: str = Field(serialization_alias="correlationId")
    status: str
    contract_version: str = Field(serialization_alias="contractVersion")
    dry_run: bool = Field(serialization_alias="dryRun")
    duration_ms: int | None = Field(default=None, serialization_alias="durationMs")
    source: MetadataSource
    collector: MetadataCollector
    summary: MetadataSummary
    items: list[MetadataItemResult] = Field(default_factory=list)
    errors: list[MetadataItemResult] = Field(default_factory=list)
    snapshot_id: str | None = Field(default=None, serialization_alias="snapshotId")


class MetadataStatusResult(MetadataIngestionResult):
    """Status lookup uses the same stable envelope as a submission result."""


__all__ = [
    "AssetMetadataIngestionRequest",
    "LineageMetadataIngestionRequest",
    "LineageEdge",
    "LineageEvidence",
    "LineageNode",
    "LineageSnapshot",
    "MAX_ASSETS_PER_REQUEST",
    "MAX_FIELDS_PER_ASSET",
    "MAX_LINEAGE_EDGES",
    "MAX_LINEAGE_NODES",
    "MAX_METADATA_BODY_BYTES",
    "MAX_TOTAL_FIELDS",
    "MetadataAsset",
    "MetadataCollector",
    "MetadataField",
    "MetadataIngestionResult",
    "MetadataItemResult",
    "MetadataSource",
    "MetadataStatusResult",
    "MetadataSummary",
    "SUPPORTED_CONTRACT_MAJOR",
]
