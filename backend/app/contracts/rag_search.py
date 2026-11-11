"""DAP-side HTTP contracts for optional RAG related-asset recommendations.

The outbound request and response models mirror dap-rag-lab HTTP Search Service
v1. DAP remains isolated from ``dap-rag-lab`` implementation packages and only
trusts DAP's current catalog when building browser-visible recommendations.
"""

from __future__ import annotations

import ipaddress
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import ConfigDict, Field, field_validator, model_validator

from .models import ContractModel

RagRecommendationStatus = Literal["disabled", "available", "degraded", "unavailable"]
RagRecommendationReason = Literal[
    "disabled",
    "empty_query",
    "timeout",
    "visibility_unavailable",
    "service_unavailable",
    "service_unauthorized",
    "service_auth_not_configured",
    "index_not_ready",
    "model_mismatch",
    "invalid_response",
    "busy",
]
RagSearchStrategy = Literal["keyword", "vector", "hybrid", "auto"]
RemoteStableId = Annotated[int, Field(strict=True, gt=0)] | Annotated[str, Field(min_length=1, max_length=32)]
RemoteLabel = Annotated[str, Field(max_length=128)]
RemoteEvidenceTerm = Annotated[str, Field(max_length=256)]
RagHttpSearchMode = Literal["keyword", "vector", "hybrid", "auto"]


class _RagContractModel(ContractModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class RagSearchConfig(_RagContractModel):
    """Non-secret administrator configuration persisted by DAP."""

    enabled: bool = False
    service_url: str = Field(default="", alias="serviceUrl", max_length=2048)
    strategy: RagSearchStrategy = "auto"
    top_k: int = Field(default=5, alias="topK", ge=1, le=20)
    timeout_ms: int = Field(default=2000, alias="timeoutMs", ge=250, le=10000)

    @field_validator("service_url")
    @classmethod
    def validate_service_url(cls, value: str) -> str:
        value = value.strip()
        if not value:
            return ""
        try:
            parsed = urlsplit(value)
            hostname = parsed.hostname
            # Accessing .port validates malformed/out-of-range port values.
            _ = parsed.port
        except ValueError as error:
            raise ValueError("serviceUrl 格式无效") from error
        if (
            parsed.scheme not in {"http", "https"}
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
        ):
            raise ValueError("serviceUrl 必须是无凭据、无路径的 HTTP(S) 服务根地址")
        if parsed.scheme == "http":
            normalized_host = hostname.strip("[]").lower()
            try:
                is_loopback = ipaddress.ip_address(normalized_host).is_loopback
            except ValueError:
                is_loopback = normalized_host == "localhost"
            if not is_loopback:
                raise ValueError("跨服务器 RAG Service 必须使用 HTTPS")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_enabled_service(self) -> RagSearchConfig:
        if self.enabled and not self.service_url:
            raise ValueError("启用推荐前必须配置 RAG Service URL")
        return self


class RagSearchConfigView(_RagContractModel):
    """Browser-safe configuration; the service token is never serialized."""

    enabled: bool = False
    service_url: str = Field(default="", alias="serviceUrl")
    strategy: RagSearchStrategy = "auto"
    top_k: int = Field(default=5, alias="topK", ge=1, le=20)
    timeout_ms: int = Field(default=2000, alias="timeoutMs", ge=250, le=10000)
    token_configured: bool = Field(default=False, alias="tokenConfigured")


class RagHttpSearchRequest(_RagContractModel):
    """HTTP Search Service v1 request; the service selects retrieval mode."""

    query: str = Field(min_length=1, max_length=500)
    top_k: int = Field(alias="topK", ge=1, le=20)


class RagHttpSearchEvidence(_RagContractModel):
    """Structured v1 evidence; accepted for internal processing only."""

    channel: RemoteLabel
    rank: int = Field(gt=0)
    raw_score: float = Field(alias="rawScore", allow_inf_nan=False)
    matched_terms: list[RemoteEvidenceTerm] = Field(alias="matchedTerms", max_length=32)


class RagHttpSearchRetrieval(_RagContractModel):
    """Bounded retrieval diagnostics returned by the v1 service."""

    requested_mode: RagHttpSearchMode = Field(alias="requestedMode")
    effective_mode: RagHttpSearchMode = Field(alias="effectiveMode")
    channels_used: list[RemoteLabel] = Field(alias="channelsUsed", max_length=8)
    degradation_reason: str | None = Field(default=None, alias="degradationReason", max_length=128)
    route_reason: str | None = Field(default=None, alias="routeReason", max_length=128)


class RagHttpSearchHit(_RagContractModel):
    """Bounded v1 hit; authority/display metadata is never trusted."""

    entity_type: Literal["table", "field"] = Field(alias="entityType")
    asset_id: RemoteStableId = Field(alias="assetId")
    field_id: RemoteStableId | None = Field(default=None, alias="fieldId")
    name: str = Field(max_length=256)
    retrieval_channels: list[RemoteLabel] = Field(alias="retrievalChannels", max_length=8)
    score: float = Field(allow_inf_nan=False)
    evidence: list[RagHttpSearchEvidence] = Field(max_length=8)

    @model_validator(mode="after")
    def validate_stable_identity(self) -> RagHttpSearchHit:
        if self.entity_type == "field" and self.field_id is None:
            raise ValueError("field result requires fieldId")
        if self.entity_type == "table" and self.field_id is not None:
            raise ValueError("table result must not include fieldId")
        return self


class RagHttpSearchResponse(_RagContractModel):
    """HTTP Search Service v1 response with bounded retrieval metadata."""

    status: Literal["ok"]
    index_generation: str = Field(alias="indexGeneration", min_length=1, max_length=256)
    retrieval: RagHttpSearchRetrieval
    results: list[RagHttpSearchHit] = Field(max_length=20)


class RagRelatedTable(_RagContractModel):
    asset_id: int = Field(alias="assetId", gt=0)
    name: str = Field(max_length=256)
    display_name: str = Field(default="", alias="displayName", max_length=256)
    description: str = Field(default="", max_length=2000)
    domain: str = Field(default="", max_length=256)
    layer: str = Field(default="", max_length=32)


class RagRecommendation(_RagContractModel):
    """One table/field identity rebuilt from DAP's authoritative public catalog."""

    asset_id: int = Field(alias="assetId", gt=0)
    field_id: int | None = Field(default=None, alias="fieldId", gt=0)
    asset_type: Literal["table", "field"] = Field(alias="assetType")
    name: str = Field(max_length=256)
    display_name: str = Field(default="", alias="displayName", max_length=256)
    description: str = Field(default="", max_length=2000)
    domain: str = Field(default="", max_length=256)
    layer: str = Field(default="", max_length=32)
    related_table: RagRelatedTable | None = Field(default=None, alias="relatedTable")
    evidence: list[str] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def validate_identity(self) -> RagRecommendation:
        if self.asset_type == "field":
            if self.field_id is None or self.related_table is None:
                raise ValueError("字段推荐必须提供 fieldId 和 relatedTable")
            if self.related_table.asset_id != self.asset_id:
                raise ValueError("relatedTable.assetId 必须与字段父表 assetId 一致")
        elif self.field_id is not None:
            raise ValueError("表推荐不得包含 fieldId")
        return self


class RagRecommendationsResponse(_RagContractModel):
    """DAP's public optional response; no retrieval score or remote metadata."""

    query: str = Field(max_length=500)
    status: RagRecommendationStatus
    recommendations: list[RagRecommendation] = Field(default_factory=list, max_length=20)
    count: int = Field(ge=0, le=20)
    elapsed_ms: float = Field(default=0, alias="elapsedMs", ge=0)
    reason_code: RagRecommendationReason | None = Field(default=None, alias="reasonCode")

    @model_validator(mode="after")
    def validate_response_state(self) -> RagRecommendationsResponse:
        if self.count != len(self.recommendations):
            raise ValueError("count 必须等于 recommendations 返回数量")
        if self.status in ("disabled", "unavailable") and self.recommendations:
            raise ValueError("disabled/unavailable 状态不得包含推荐结果")
        if self.status == "disabled" and self.reason_code != "disabled":
            raise ValueError("disabled 状态必须使用 disabled reasonCode")
        if self.status == "degraded" and self.reason_code is None:
            raise ValueError("degraded 状态必须说明安全原因码")
        return self


DEFAULT_RAG_SEARCH_CONFIG = RagSearchConfig()


class RagSearchConfigUpdate(_RagContractModel):
    """Explicit admin update payload. Secrets are supplied by deployment only."""

    enabled: bool = False
    service_url: str = Field(default="", alias="serviceUrl", max_length=2048)
    strategy: RagSearchStrategy = "auto"
    top_k: int = Field(default=5, alias="topK", ge=1, le=20)
    timeout_ms: int = Field(default=2000, alias="timeoutMs", ge=250, le=10000)

    @model_validator(mode="before")
    @classmethod
    def reject_secrets_in_browser_payload(cls, value):
        if isinstance(value, dict) and any(
            key in value for key in ("token", "serviceToken", "authToken", "authorization")
        ):
            raise ValueError("RAG Service Token 必须由后端 Secret 配置，不能通过浏览器传入")
        return value

    @model_validator(mode="after")
    def validate_config(self) -> RagSearchConfigUpdate:
        # Reuse URL validation and enabled-state requirements from the stored model.
        RagSearchConfig.model_validate(self.model_dump(by_alias=True))
        return self
