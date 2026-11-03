"""Public request/response contracts for the optional single-turn asset Q&A API."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from .models import ContractModel

AiAskStatus = Literal[
    "answered",
    "insufficient_evidence",
    "retrieval_unavailable",
    "generation_unavailable",
]
AiRetrievalStatus = Literal["available", "degraded", "unavailable", "not_run"]
AiGenerationStatus = Literal["completed", "unavailable", "disabled", "not_run"]
AiAskReason = Literal[
    "ai_disabled",
    "llm_not_configured",
    "retrieval_disabled",
    "retrieval_unavailable",
    "retrieval_degraded_without_evidence",
    "insufficient_evidence",
    "llm_timeout",
    "llm_busy",
    "llm_unavailable",
    "invalid_model_output",
    "invalid_citation",
]

StableAssetId = Annotated[int, Field(strict=True, gt=0)]
StableFieldId = Annotated[int, Field(strict=True, gt=0)]


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


class AiAskCitation(_AiAskContract):
    """A generated citation bound to a DAP stable identity."""

    asset_id: StableAssetId = Field(alias="assetId")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")
    source: Literal["dap_catalog"] = "dap_catalog"


class AiAskCandidate(_AiAskContract):
    """Display metadata copied from the current, authorized DAP catalog only."""

    asset_id: StableAssetId = Field(alias="assetId")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")
    asset_type: Literal["table", "field"] = Field(alias="assetType")
    table_name: str = Field(alias="tableName", min_length=1, max_length=256)
    table_display_name: str = Field(alias="tableDisplayName", max_length=256)
    table_description: str = Field(default="", alias="tableDescription", max_length=2000)
    field_name: str | None = Field(default=None, alias="fieldName", max_length=256)
    field_display_name: str | None = Field(default=None, alias="fieldDisplayName", max_length=256)
    field_description: str | None = Field(default=None, alias="fieldDescription", max_length=2000)
    domain: str = Field(default="", max_length=256)
    layer: str = Field(default="", max_length=32)
    source: Literal["dap_catalog"] = "dap_catalog"
    match_reason: str = Field(alias="matchReason", min_length=1, max_length=300)

    @model_validator(mode="after")
    def validate_candidate_identity(self) -> AiAskCandidate:
        if self.asset_type == "field":
            if self.field_id is None or not self.field_name:
                raise ValueError("字段候选必须绑定 fieldId 和字段名")
        elif self.field_id is not None or self.field_name is not None:
            raise ValueError("表候选不得包含字段身份")
        return self


class AiAskResponse(_AiAskContract):
    status: AiAskStatus
    answer: str = Field(max_length=2000)
    citations: list[AiAskCitation] = Field(default_factory=list, max_length=10)
    candidates: list[AiAskCandidate] = Field(default_factory=list, max_length=10)
    retrieval_status: AiRetrievalStatus = Field(alias="retrievalStatus")
    generation_status: AiGenerationStatus = Field(alias="generationStatus")
    reason_code: AiAskReason | None = Field(default=None, alias="reasonCode")
    elapsed_ms: float = Field(default=0, alias="elapsedMs", ge=0)

    @model_validator(mode="after")
    def validate_response_state(self) -> AiAskResponse:
        if self.status == "answered":
            if (
                not self.answer.strip()
                or not self.citations
                or self.generation_status != "completed"
                or self.retrieval_status not in {"available", "degraded"}
            ):
                raise ValueError("answered 响应必须含有效引用与完成状态")
        if self.status == "retrieval_unavailable":
            if self.retrieval_status != "unavailable" or self.generation_status != "not_run":
                raise ValueError("retrieval_unavailable 状态不一致")
        if self.status == "generation_unavailable":
            if self.generation_status not in {"unavailable", "disabled"} or self.citations:
                raise ValueError("generation_unavailable 状态不一致")
        if self.status == "insufficient_evidence" and self.citations:
            raise ValueError("insufficient_evidence 不得包含模型引用")
        identities = [
            (citation.asset_id, citation.field_id) for citation in self.citations
        ]
        if len(identities) != len(set(identities)):
            raise ValueError("citations 不得包含重复身份")
        return self


class AiGeneratedCitation(_AiAskContract):
    """Strict model-output citation; validated again against retrieved DAP IDs."""

    asset_id: StableAssetId = Field(alias="assetId")
    field_id: StableFieldId | None = Field(default=None, alias="fieldId")


class AiGeneratedAnswer(_AiAskContract):
    """Strict JSON-only response required from the OpenAI-compatible provider."""

    answer: str = Field(min_length=1, max_length=2000)
    citations: list[AiGeneratedCitation] = Field(max_length=10)

    @field_validator("answer")
    @classmethod
    def validate_answer_text(cls, value: str) -> str:
        answer = value.strip()
        if not answer:
            raise ValueError("answer 不能为空")
        return answer


class AiAskErrorEnvelope(_AiAskContract):
    code: str
    message: str


__all__ = [
    "AiAskAvailability",
    "AiAskCandidate",
    "AiAskCitation",
    "AiAskReason",
    "AiAskRequest",
    "AiAskResponse",
    "AiAskStatus",
    "AiGeneratedAnswer",
    "AiRetrievalStatus",
    "AiGenerationStatus",
]
