"""Pydantic models describing the current public API shapes.

These models intentionally accept extra fields. Existing clients rely on
legacy aliases and additive fields, so P2 documents the wire contract without
silently narrowing or redesigning it.
"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class ContractModel(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ErrorModel(ContractModel):
    code: str
    message: str
    details: Any = None


class ErrorEnvelope(ContractModel):
    error: ErrorModel


T = TypeVar("T")


class ItemsResponse(ContractModel, Generic[T]):
    items: list[T]
    page: int | None = None
    pageSize: int | None = None
    total: int | None = None


class DataEnvelope(ContractModel, Generic[T]):
    data: T


class MessageDataResponse(ContractModel, Generic[T]):
    message: str
    data: T


class ReportRelatedTable(ContractModel):
    tableName: str
    tableCn: str | None = None
    layer: str | None = None
    domain: str | None = None


class ReportRelatedIndicator(ContractModel):
    indicatorId: str
    indicatorName: str | None = None
    dimension: str | None = None
    path: str | None = None


class ReportItem(ContractModel):
    code: str
    name: str
    alias: str = ""
    type: str = ""
    domain: str = ""
    freq: str = ""
    statPeriod: str = ""
    statCaliber: str = ""
    dataDelay: str = ""
    legacyFreq: str = ""
    legacyTimeCaliber: str = ""
    status: str = ""
    effectiveDate: str = ""
    expireDate: str = ""
    purpose: str = ""
    statObject: str = ""
    businessScopeTags: str = ""
    filterCondition: str = ""
    specialRule: str = ""
    ownerDept: str = ""
    ownerName: str = ""
    maintainerName: str = ""
    relatedTables: list[ReportRelatedTable] = Field(default_factory=list)
    relatedIndicators: list[ReportRelatedIndicator] = Field(default_factory=list)
    relatedTableCount: int = 0
    relatedIndicatorCount: int = 0
    remark: str | None = ""
    updatedBy: str = ""
    updatedAt: str = ""
    dateCaliber: str = ""
    dateCaliberOther: str = ""
    dataTimeliness: str = ""
    dataTimelinessCustom: str = ""
    statScope: str = ""
    timeCaliber: str = ""


class ReportRequest(ContractModel):
    code: str | None = None
    name: str | None = None
    alias: str | None = None
    type: str | None = None
    domain: str | None = None
    statPeriod: str | None = None
    statCaliber: str | None = None
    dataDelay: str | None = None
    status: str | None = None
    effectiveDate: str | None = None
    expireDate: str | None = None
    purpose: str | None = None
    statObject: str | None = None
    businessScopeTags: str | None = None
    filterCondition: str | None = None
    specialRule: str | None = None
    ownerDept: str | None = None
    ownerName: str | None = None
    maintainerName: str | None = None
    relatedTables: list[dict[str, Any]] | None = None
    relatedIndicators: list[dict[str, Any]] | None = None
    remark: str | None = None
    dateCaliber: str | None = None
    dateCaliberOther: str | None = None
    dataTimeliness: str | None = None
    dataTimelinessCustom: str | None = None
    statScope: str | None = None
    timeCaliber: str | None = None


class ReportListResponse(ItemsResponse[ReportItem]):
    pass


class IndicatorItem(ContractModel):
    id: str
    name: str
    meaning: str = ""
    resultTableName: str = ""
    resultFieldName: str = ""
    dimension: str = ""
    caliber: str = ""
    path: str = ""
    status: str = ""
    registrar: str = ""
    registeredAt: str = ""


class IndicatorRequest(ContractModel):
    id: str | None = None
    name: str | None = None
    meaning: str | None = None
    resultTableName: str | None = Field(
        default=None,
        validation_alias=AliasChoices("resultTableName", "result_table_name"),
    )
    resultFieldName: str | None = Field(
        default=None,
        validation_alias=AliasChoices("resultFieldName", "result_field_name"),
    )
    dimension: str | None = None
    caliber: str | None = None
    path: str | None = None
    status: str | None = None
    registrar: str | None = None
    registeredAt: str | None = None


class IndicatorListResponse(ItemsResponse[IndicatorItem]):
    pass


class AssetField(ContractModel):
    name: str
    cn: str
    type: str
    nullable: bool
    pk: bool
    part: bool
    enum: str | None = None


class AssetItem(ContractModel):
    name: str
    cn: str | None = None
    domain: str = ""
    layer: str = ""
    owner: str = ""
    grain: str = ""
    cycle: str = ""
    desc: str = ""
    schema_name: str = Field(default="", alias="schema")
    fieldCount: int = 0
    fields: list[AssetField] = Field(default_factory=list)
    assetRisks: list[Any] = Field(default_factory=list)


class AssetTableRequest(ContractModel):
    name: str | None = None
    cn: str | None = None
    domain: str | None = None
    layer: str | None = None
    schema_name: str | None = Field(default=None, alias="schema")
    owner: str | None = None
    grain: str | None = None
    cycle: str | None = None
    desc: str | None = None
    fields: list[dict[str, Any]] | None = None


class AssetPageResponse(ItemsResponse[AssetItem]):
    pass


class SourceSystem(ContractModel):
    name: str
    count: int = 0
    dataSourceId: int | str | None = None
    upstreamSystemId: int | str | None = None
    systemCode: str | None = None
    systemAbbr: str | None = None


class FieldMappingItem(ContractModel):
    dataSourceId: int | str | None = None
    upstreamSystemId: int | str | None = None
    systemCode: str | None = None
    srcSystem: str | None = None
    systemAbbr: str | None = None
    srcTable: str
    srcTableCn: str | None = None
    srcField: str
    srcType: str | None = None
    srcComment: str | None = None
    targetLayer: str | None = None
    targetTable: str | None = None
    loadMode: str | None = None
    targetField: str | None = None
    mappingRule: str | None = None
    updatedAt: str | None = None


class FieldMappingTableItem(ContractModel):
    dataSourceId: int | str | None = None
    upstreamSystemId: int | str | None = None
    systemCode: str | None = None
    srcSystem: str | None = None
    systemAbbr: str | None = None
    srcTable: str
    srcTableCn: str | None = None
    targetLayer: str | None = None
    targetTable: str | None = None
    loadMode: str | None = None
    fieldCount: int = 0
    mappedCount: int = 0
    emptyCommentCount: int = 0
    emptyCommentRate: int = 0
    updatedAt: str | None = None


class MappingStats(ContractModel):
    sourceSystemCount: int = 0
    sourceTableCount: int = 0
    fieldCount: int = 0
    mappedFieldCount: int = 0
    unmappedFieldCount: int = 0
    emptyCommentCount: int = 0
    emptyCommentRate: int = 0
    coverage: int = 0


class FieldMappingListResponse(ItemsResponse[FieldMappingItem]):
    pass


class FieldMappingTableListResponse(ItemsResponse[FieldMappingTableItem]):
    pass


class SourceSystemListResponse(ItemsResponse[SourceSystem]):
    pass


class RootItem(ContractModel):
    abbr: str
    en: str = ""
    cn: str
    cat: str
    desc: str = ""


class RootRequest(ContractModel):
    abbr: str | None = None
    en: str | None = None
    cn: str | None = None
    cat: str | None = None
    desc: str | None = None
    items: list[dict[str, Any]] | None = None


class RootListResponse(ItemsResponse[RootItem]):
    pass


class RootCategory(ContractModel):
    name: str
    count: int = 0


class RootCategoryListResponse(ItemsResponse[RootCategory]):
    pass


class ManualCodeTableItem(ContractModel):
    id: str
    tableCode: str
    tableName: str
    style: str
    owner: str = ""
    status: str
    remark: str = ""
    createdBy: str = ""
    createdAt: str = ""
    updatedBy: str = ""
    updatedAt: str = ""


class ManualCodeTableRequest(ContractModel):
    tableCode: str | None = None
    tableName: str | None = None
    style: str | None = None
    owner: str | None = None
    status: str | None = None
    remark: str | None = None


class ManualCodeTableListResponse(ItemsResponse[ManualCodeTableItem]):
    pass


class ApiAssetItem(ContractModel):
    code: str
    name: str
    method: str = ""
    path: str = ""
    status: str = ""
    params: list[Any] = Field(default_factory=list)
    responseFields: list[Any] = Field(default_factory=list)
    relations: list[Any] = Field(default_factory=list)


class ApiAssetRequest(ContractModel):
    code: str | None = None
    name: str | None = None
    method: str | None = None
    path: str | None = None
    version: str | None = None
    systemId: int | str | None = None
    status: str | None = None
    ownerDept: str | None = None
    ownerName: str | None = None
    maintainerName: str | None = None
    description: str | None = None
    remark: str | None = None
    items: list[dict[str, Any]] | None = None
    params: list[dict[str, Any]] | None = None
    responseFields: list[dict[str, Any]] | None = None
    relations: list[dict[str, Any]] | None = None


class ApiAssetListResponse(ItemsResponse[ApiAssetItem]):
    pass
