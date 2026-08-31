"""Field Mapping batch import request and response contracts."""

# pyright: reportMissingImports=false

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


MAX_FIELD_MAPPING_IMPORT_ITEMS = 500
MAX_FIELDS_PER_MAPPING_IMPORT_ITEM = 1_000


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


class FieldMappingImportContractModel(BaseModel):
    """Camel-case integration DTOs with bounded, forward-compatible fields."""

    model_config = ConfigDict(
        alias_generator=_to_camel,
        extra="ignore",
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class FieldMappingImportFieldRequest(FieldMappingImportContractModel):
    """One source-to-target field mapping; internal primary keys are not accepted."""

    source_field: str = Field(min_length=1, max_length=128)
    source_type: str | None = Field(default=None, max_length=128)
    source_comment: str | None = Field(default=None, max_length=1_000)
    target_field: str | None = Field(default=None, max_length=128)
    mapping_rule: str = Field(default="待补充", min_length=1, max_length=64)
    field_order: int = Field(ge=1)


class FieldMappingImportItemRequest(FieldMappingImportContractModel):
    """One table mapping identified by a data source and source table name."""

    data_source_id: int = Field(gt=0)
    source_table: str = Field(min_length=1, max_length=128)
    source_table_cn: str | None = Field(default=None, max_length=256)
    target_layer: str = Field(default="DWF", min_length=1, max_length=32)
    target_table: str | None = Field(default=None, max_length=128)
    load_mode: str | None = Field(default=None, max_length=32)
    table_desc: str | None = Field(default=None, max_length=2_000)
    fields: list[FieldMappingImportFieldRequest] = Field(
        min_length=1,
        max_length=MAX_FIELDS_PER_MAPPING_IMPORT_ITEM,
    )

    @model_validator(mode="after")
    def require_unique_field_identities(self) -> FieldMappingImportItemRequest:
        seen: set[tuple[str, str]] = set()
        for index, field in enumerate(self.fields):
            identity = (
                field.source_field.casefold(),
                (field.target_field or "").casefold(),
            )
            if identity in seen:
                raise ValueError(
                    f"fields[{index}] duplicates a sourceField/targetField pair"
                )
            seen.add(identity)
        return self


class FieldMappingImportRequest(FieldMappingImportContractModel):
    """Batch import request; v1 intentionally exposes upsert only."""

    mode: Literal["upsert"] = "upsert"
    dry_run: bool = False
    items: list[FieldMappingImportItemRequest] = Field(
        min_length=1,
        max_length=MAX_FIELD_MAPPING_IMPORT_ITEMS,
    )


class FieldMappingImportIdentity(FieldMappingImportContractModel):
    data_source_id: int
    source_table: str
    target_table: str | None = None


class FieldMappingImportError(FieldMappingImportContractModel):
    code: str
    message: str


FieldMappingImportAction = Literal["created", "updated", "unchanged", "failed"]


class FieldMappingImportItemResult(FieldMappingImportContractModel):
    index: int = Field(ge=0)
    identity: FieldMappingImportIdentity
    action: FieldMappingImportAction
    field_count: int = Field(ge=0)
    created_field_count: int = Field(default=0, ge=0)
    updated_field_count: int = Field(default=0, ge=0)
    unchanged_field_count: int = Field(default=0, ge=0)
    error: FieldMappingImportError | None = None


class FieldMappingImportSummary(FieldMappingImportContractModel):
    received: int = Field(ge=0)
    created: int = Field(ge=0)
    updated: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    failed: int = Field(ge=0)
    field_count: int = Field(ge=0)
    created_field_count: int = Field(default=0, ge=0)
    updated_field_count: int = Field(default=0, ge=0)
    unchanged_field_count: int = Field(default=0, ge=0)


class FieldMappingImportResponse(FieldMappingImportContractModel):
    """Stable response for both real imports and dry-run previews."""

    mode: Literal["upsert"]
    dry_run: bool
    summary: FieldMappingImportSummary
    items: list[FieldMappingImportItemResult]


__all__ = [
    "FieldMappingImportAction",
    "FieldMappingImportContractModel",
    "FieldMappingImportError",
    "FieldMappingImportFieldRequest",
    "FieldMappingImportIdentity",
    "FieldMappingImportItemRequest",
    "FieldMappingImportItemResult",
    "FieldMappingImportRequest",
    "FieldMappingImportResponse",
    "FieldMappingImportSummary",
    "MAX_FIELD_MAPPING_IMPORT_ITEMS",
    "MAX_FIELDS_PER_MAPPING_IMPORT_ITEM",
]
