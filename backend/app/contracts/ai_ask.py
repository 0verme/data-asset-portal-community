"""Public request/response contracts for the optional single-turn asset Q&A API."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .models import ContractModel

AiAskStatus = Literal[
    "answered",
    "partial_answer",
    "insufficient_evidence",
    "retrieval_unavailable",
    "generation_unavailable",
    "metadata_count_answered",
    "ambiguous_scope",
    "metadata_count_unavailable",
]
AiRetrievalStatus = Literal["available", "degraded", "unavailable", "not_run"]
AiGenerationStatus = Literal["completed", "unavailable", "disabled", "not_run"]
AiAskReason = Literal[
    "ai_disabled",
    "llm_not_configured",
    "retrieval_disabled",
    "retrieval_timeout",
    "retrieval_unavailable",
    "asset_verification_unavailable",
    "retrieval_degraded_without_evidence",
    "partial_results",
    "insufficient_evidence",
    "llm_timeout",
    "llm_busy",
    "llm_unavailable",
    "llm_daily_quota_exceeded",
    "llm_quota_unavailable",
    "invalid_model_output",
    "invalid_citation",
    "ambiguous_scope",
    "metadata_count_unavailable",
]

StableAssetId = Annotated[int, Field(strict=True, gt=0)]
StableTypedAssetId = Annotated[str, Field(strict=True, min_length=1, max_length=128)]
CandidateAssetId = StableAssetId | StableTypedAssetId
StableFieldId = Annotated[int, Field(strict=True, gt=0)]
CandidateEvidenceTerm = Annotated[str, Field(max_length=256)]


class _AiAskContract(ContractModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AiAskRequest(_AiAskContract):
    """A single independent metadata question; it carries no session identity."""

    query: str = Field(min_length=1, max_length=500)
    scope: Literal["all"] = "all"
    top_k: int = Field(default=10, alias="topK", ge=1, le=10)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        query = value.strip()
        if not query:
            raise ValueError("query 不能为空")
        return query


class AiAskAvailability(_AiAskContract):
    """Browser-safe feature availability; provider details are never serialized."""

    enabled: bool


AiAskProgressStepId = Literal[
    "analyzing",
    "retrieving",
    "counting",
    "organizing",
    "generating",
    "completed",
]
AiAskProgressStatus = Literal["pending", "running", "completed", "failed"]
AiAskProgressIntent = Literal["metadata_count", "report_count", "ambiguous_count"]
AiAskProgressError = Literal[
    "timeout", "unavailable", "invalid_response", "invalid_model_output",
    "invalid_citation", "disabled", "cancelled",
]


class AiAskProgressStep(_AiAskContract):
    """One real, safe-to-display step in an AI ask execution."""

    step_id: AiAskProgressStepId = Field(alias="id")
    status: AiAskProgressStatus
    intent: AiAskProgressIntent | None = None
    elapsed_ms: float = Field(default=0, alias="elapsedMs", ge=0)
    table_count: int | None = Field(default=None, alias="tableCount", ge=0)
    report_count: int | None = Field(default=None, alias="reportCount", ge=0)
    field_count: int | None = Field(default=None, alias="fieldCount", ge=0)
    error_code: AiAskProgressError | None = Field(default=None, alias="errorCode")


class AiAskCitation(_AiAskContract):
    """A generated citation bound to a type-qualified DAP stable identity."""

    asset_id: CandidateAssetId = Field(alias="assetId")
    asset_type: Literal["table", "field", "report", "indicator", "api"] = Field(default="table", alias="assetType")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")
    source: Literal["dap_catalog"] = "dap_catalog"

    @model_validator(mode="after")
    def validate_typed_identity(self) -> AiAskCitation:
        if isinstance(self.asset_id, int):
            if self.field_id is not None and self.asset_type == "table":
                self.asset_type = "field"
            if self.asset_type not in {"table", "field"}:
                raise ValueError("数字 assetId 只能用于表或字段引用")
            if (self.asset_type == "field") != (self.field_id is not None):
                raise ValueError("字段引用必须提供 fieldId，表引用不得提供 fieldId")
        elif self.asset_type not in {"report", "indicator", "api"} or self.field_id is not None:
            raise ValueError("字符串 assetId 必须与报表/指标/API 类型绑定")
        return self


class AiMetadataCountFilter(_AiAskContract):
    """One filter resolved from the current asset-list facet catalog."""

    code: str = Field(min_length=1, max_length=64)
    display_name: str = Field(alias="displayName", min_length=1, max_length=256)
    matched_as: Literal["catalog_value", "catalog_alias"] = Field(alias="matchedAs")
    inferred: bool


class AiMetadataCountFilters(_AiAskContract):
    domain: AiMetadataCountFilter | None = None
    layer: AiMetadataCountFilter | None = None


class AiMetadataCount(_AiAskContract):
    """Exact COUNT evidence, kept separate from semantic RAG citations."""

    metric: Literal["table_count", "report_count"]
    value: Annotated[int, Field(strict=True, ge=0)]
    filters: AiMetadataCountFilters
    source: Literal["dap_catalog"]
    complete: bool
    catalog_profile: Literal["internal", "strict", "disabled"] = Field(alias="catalogProfile")
    source_link: str = Field(
        alias="sourceLink",
        min_length=14,
        max_length=2048,
        pattern=r"^/(?:data-warehouse|report-assets)(?:\?.*)?$",
    )

    @field_validator("complete")
    @classmethod
    def require_complete_count(cls, value: bool) -> bool:
        if value is not True:
            raise ValueError("精确元数据 COUNT 必须标记 complete=true")
        return value

    @model_validator(mode="after")
    def validate_metric_target(self) -> AiMetadataCount:
        if self.metric == "table_count" and not self.source_link.startswith("/data-warehouse"):
            raise ValueError("数据表统计必须链接到数据表资产列表")
        if self.metric == "report_count" and (
            self.filters.domain is not None
            or self.filters.layer is not None
            or self.source_link != "/report-assets"
        ):
            raise ValueError("报表资产统计只允许全量口径并链接到报表资产列表")
        return self


class AiAskCandidate(_AiAskContract):
    """Display metadata copied from the current, authorized DAP catalog only."""

    asset_id: CandidateAssetId = Field(alias="assetId")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")
    asset_type: Literal["table", "field", "report", "indicator", "api"] = Field(alias="assetType")
    name: str = Field(default="", max_length=256)
    display_name: str = Field(default="", alias="displayName", max_length=256)
    description: str = Field(default="", max_length=2000)
    table_name: str | None = Field(default=None, alias="tableName", min_length=1, max_length=256)
    table_display_name: str = Field(default="", alias="tableDisplayName", max_length=256)
    table_description: str = Field(default="", alias="tableDescription", max_length=2000)
    field_name: str | None = Field(default=None, alias="fieldName", max_length=256)
    field_display_name: str | None = Field(default=None, alias="fieldDisplayName", max_length=256)
    field_description: str | None = Field(default=None, alias="fieldDescription", max_length=2000)
    domain: str = Field(default="", max_length=256)
    layer: str = Field(default="", max_length=32)
    source: Literal["dap_catalog"] = "dap_catalog"
    retrieval_source: Literal["local", "external"] = Field(default="external", alias="retrievalSource")
    match_evidence: list[CandidateEvidenceTerm] = Field(default_factory=list, alias="matchEvidence", max_length=8)
    match_reason: str = Field(alias="matchReason", min_length=1, max_length=300)
    relevance: Literal["direct", "related"] | None = None

    @model_validator(mode="after")
    def validate_candidate_identity(self) -> AiAskCandidate:
        if self.asset_type in {"table", "field"}:
            if not isinstance(self.asset_id, int) or isinstance(self.asset_id, bool):
                raise ValueError("表/字段候选必须使用数字 assetId")
            if not self.table_name:
                raise ValueError("表/字段候选必须绑定所属表名")
            if not self.name:
                self.name = self.field_name if self.asset_type == "field" else self.table_name
            if not self.display_name:
                self.display_name = self.field_display_name if self.asset_type == "field" else self.table_display_name
            if not self.description:
                self.description = self.field_description if self.asset_type == "field" else self.table_description
            if self.asset_type == "field":
                if self.field_id is None or not self.field_name:
                    raise ValueError("字段候选必须绑定 fieldId 和字段名")
            elif self.field_id is not None or self.field_name is not None:
                raise ValueError("表候选不得包含字段身份")
        else:
            if not isinstance(self.asset_id, str) or not self.asset_id or self.field_id is not None:
                raise ValueError("报表/指标/API 候选必须使用类型化字符串 ID")
            if self.table_name is not None or self.field_name is not None:
                raise ValueError("非表资产候选不得包含表/字段身份")
            if not self.name or not self.display_name:
                raise ValueError("类型化资产候选必须含稳定名称和展示名称")
        return self


class AiAskResponse(_AiAskContract):
    status: AiAskStatus
    answer: str = Field(max_length=2000)
    citations: list[AiAskCitation] = Field(default_factory=list, max_length=20)
    candidates: list[AiAskCandidate] = Field(default_factory=list, max_length=20)
    metadata_count: AiMetadataCount | None = Field(default=None, alias="metadataCount")
    retrieval_status: AiRetrievalStatus = Field(alias="retrievalStatus")
    generation_status: AiGenerationStatus = Field(alias="generationStatus")
    results_truncated: bool = Field(default=False, alias="resultsTruncated")
    reason_code: AiAskReason | None = Field(default=None, alias="reasonCode")
    elapsed_ms: float = Field(default=0, alias="elapsedMs", ge=0)

    @model_validator(mode="after")
    def validate_response_state(self) -> AiAskResponse:
        if self.results_truncated and self.status != "partial_answer":
            raise ValueError("resultsTruncated 只能用于显式 partial_answer 响应")
        if self.status == "metadata_count_answered":
            if (
                self.metadata_count is None
                or not self.metadata_count.complete
                or self.citations
                or self.candidates
                or self.retrieval_status != "not_run"
                or self.generation_status != "not_run"
                or self.results_truncated
            ):
                raise ValueError("metadata_count_answered 必须仅包含完整目录统计证据")
        elif self.status in {"ambiguous_scope", "metadata_count_unavailable"}:
            if (
                self.metadata_count is not None
                or self.citations
                or self.candidates
                or self.retrieval_status != "not_run"
                or self.generation_status != "not_run"
                or self.results_truncated
            ):
                raise ValueError("未完成的目录统计不得包含数值或 RAG 引用")
        elif self.metadata_count is not None:
            raise ValueError("非统计响应不得包含 metadataCount")
        if self.status in {"answered", "partial_answer"}:
            if (
                not self.answer.strip()
                or not self.citations
                or self.generation_status != "completed"
                or self.retrieval_status not in {"available", "degraded"}
            ):
                raise ValueError("answered/partial_answer 响应必须含有效引用与完成状态")
            candidate_ids = {
                (candidate.asset_type, candidate.asset_id, candidate.field_id)
                for candidate in self.candidates
            }
            citation_ids = {
                (citation.asset_type, citation.asset_id, citation.field_id)
                for citation in self.citations
            }
            if (
                candidate_ids != citation_ids
                or len(candidate_ids) != len(self.candidates)
                or len(self.candidates) != len(self.citations)
                or any(candidate.relevance is None for candidate in self.candidates)
            ):
                raise ValueError("回答候选必须与有效引用一一对应并标记相关性")
            if self.status == "answered" and not any(
                candidate.relevance == "direct" for candidate in self.candidates
            ):
                raise ValueError("answered 响应必须包含直接相关证据")
        if self.status == "retrieval_unavailable":
            if self.retrieval_status != "unavailable" or self.generation_status != "not_run":
                raise ValueError("retrieval_unavailable 状态不一致")
        if self.status == "generation_unavailable":
            if (
                self.generation_status not in {"unavailable", "disabled"}
                or self.citations
                or self.candidates
            ):
                raise ValueError("generation_unavailable 状态不一致")
        if self.status == "insufficient_evidence" and (self.citations or self.candidates):
            raise ValueError("insufficient_evidence 不得包含答案候选或模型引用")
        identities = [
            (citation.asset_type, citation.asset_id, citation.field_id)
            for citation in self.citations
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("citations 不得包含重复身份")
        return self


class AiGeneratedClaim(_AiAskContract):
    """One model-selected candidate; relevance is validated against typed DAP IDs."""

    asset_id: CandidateAssetId = Field(alias="assetId")
    asset_type: Literal["table", "field", "report", "indicator", "api"] | None = Field(default=None, alias="assetType")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")
    relevance: Literal["direct", "related", "context_only"]

    @model_validator(mode="after")
    def validate_typed_identity(self) -> AiGeneratedClaim:
        if isinstance(self.asset_id, int):
            if self.asset_type not in {None, "table", "field"}:
                raise ValueError("数字 assetId 只能用于表或字段候选")
            if self.asset_type == "table" and self.field_id is not None:
                raise ValueError("表 claim 不得提供 fieldId")
            if self.asset_type == "field" and self.field_id is None:
                raise ValueError("字段 claim 必须提供 fieldId")
        elif self.asset_type not in {"report", "indicator", "api"} or self.field_id is not None:
            raise ValueError("字符串 assetId 必须使用报表/指标/API 类型且不得提供 fieldId")
        return self


class AiGeneratedAnswer(_AiAskContract):
    """Strict selection-only JSON; the backend composes all user-visible prose."""

    question_type: Literal[
        "asset_location",
        "field_explanation",
        "asset_list",
        "general",
    ] = Field(alias="questionType")
    claims: list[AiGeneratedClaim] = Field(max_length=20)


class AiAskErrorEnvelope(_AiAskContract):
    code: str
    message: str


__all__ = [
    "AiAskAvailability",
    "AiAskCandidate",
    "AiMetadataCount",
    "AiMetadataCountFilter",
    "AiMetadataCountFilters",
    "AiAskProgressStep",
    "AiAskProgressStepId",
    "AiAskProgressStatus",
    "AiAskCitation",
    "AiGeneratedClaim",
    "AiAskReason",
    "AiAskRequest",
    "AiAskResponse",
    "AiAskStatus",
    "AiGeneratedAnswer",
    "AiRetrievalStatus",
    "AiGenerationStatus",
]
