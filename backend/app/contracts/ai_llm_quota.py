"""Public contract aliases and Pydantic models for AI Ask LLM settings & daily quota."""

from __future__ import annotations

from pydantic import ConfigDict, Field, field_validator, model_validator

from ..ai_llm_quota_contract import (
    AI_LLM_DAILY_LIMIT_CODE,
    AI_LLM_QUOTA_CATEGORY_CODE,
    AI_LLM_QUOTA_CATEGORY_NAME,
    AI_LLM_QUOTA_FAILURE_MESSAGES,
    AI_LLM_QUOTA_ITEM_NAME,
    AI_LLM_QUOTA_LEGACY_ITEM_NAMES,
    AI_LLM_QUOTA_SCOPE,
    AI_LLM_QUOTA_TIMEZONE,
    DEFAULT_AI_LLM_DAILY_LIMIT,
    MAX_AI_LLM_DAILY_LIMIT,
    parse_daily_limit,
)
from ..settings import _validated_ai_llm_base_url
from .models import ContractModel

DEFAULT_AI_LLM_TIMEOUT_MS = 30000
MIN_AI_LLM_TIMEOUT_MS = 250
MAX_AI_LLM_TIMEOUT_MS = 60000

DEFAULT_AI_LLM_MAX_TOKENS = 3072
MIN_AI_LLM_MAX_TOKENS = 64
MAX_AI_LLM_MAX_TOKENS = 4096


def _validate_base_url_value(value: str) -> str:
    trimmed = value.strip()
    if not trimmed:
        return ""
    validated = _validated_ai_llm_base_url(trimmed)
    if not validated:
        raise ValueError(
            "baseUrl 必须是无凭据、无查询参数的 HTTP(S) 地址；HTTP 仅允许 localhost 或 loopback IP"
        )
    return validated


def _validate_model_value(value: str) -> str:
    trimmed = value.strip()
    if len(trimmed) > 128 or any(ord(character) < 32 for character in trimmed):
        raise ValueError("model 长度不能超过 128 且不能包含控制字符")
    return trimmed


def _reject_bool_int(value: object, *, field_name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{field_name} 必须是整数")
    if value < minimum or value > maximum:
        raise ValueError(f"{field_name} 必须在 {minimum} 到 {maximum} 之间")
    return value


class _AiLlmContractModel(ContractModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class AiAskLlmStoredConfig(_AiLlmContractModel):
    """Non-secret AI Ask LLM configuration persisted in p_code_item.ext_json.

    AI_LLM_API_KEY is strictly excluded and stays in deployment Secret storage.
    """

    enabled: bool = False
    base_url: str = Field(default="", alias="baseUrl", max_length=2048)
    model: str = Field(default="", max_length=128)
    timeout_ms: int = Field(
        default=DEFAULT_AI_LLM_TIMEOUT_MS,
        alias="timeoutMs",
        ge=MIN_AI_LLM_TIMEOUT_MS,
        le=MAX_AI_LLM_TIMEOUT_MS,
    )
    max_tokens: int = Field(
        default=DEFAULT_AI_LLM_MAX_TOKENS,
        alias="maxTokens",
        ge=MIN_AI_LLM_MAX_TOKENS,
        le=MAX_AI_LLM_MAX_TOKENS,
    )
    disable_thinking: bool = Field(default=False, alias="disableThinking")

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        return _validate_base_url_value(value)

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str) -> str:
        return _validate_model_value(value)

    @field_validator("timeout_ms", mode="before")
    @classmethod
    def validate_timeout_ms(cls, value: object) -> int:
        return _reject_bool_int(
            value,
            field_name="timeoutMs",
            minimum=MIN_AI_LLM_TIMEOUT_MS,
            maximum=MAX_AI_LLM_TIMEOUT_MS,
        )

    @field_validator("max_tokens", mode="before")
    @classmethod
    def validate_max_tokens(cls, value: object) -> int:
        return _reject_bool_int(
            value,
            field_name="maxTokens",
            minimum=MIN_AI_LLM_MAX_TOKENS,
            maximum=MAX_AI_LLM_MAX_TOKENS,
        )

    @model_validator(mode="after")
    def validate_enabled_requirements(self) -> AiAskLlmStoredConfig:
        if self.enabled:
            if not self.base_url:
                raise ValueError("启用 AI 问答前必须配置有效的模型接口地址 (baseUrl)")
            if not self.model:
                raise ValueError("启用 AI 问答前必须配置模型名称 (model)")
        return self


class AiAskLlmConfigUpdate(_AiLlmContractModel):
    """Partial update contract for PUT /api/system/ai-llm-daily-quota.

    Extra keys (including apiKey / api_key / token / authorization) are forbidden.
    """

    daily_limit: int | None = Field(default=None, alias="dailyLimit")
    enabled: bool | None = None
    base_url: str | None = Field(default=None, alias="baseUrl", max_length=2048)
    model: str | None = Field(default=None, max_length=128)
    timeout_ms: int | None = Field(default=None, alias="timeoutMs")
    max_tokens: int | None = Field(default=None, alias="maxTokens")
    disable_thinking: bool | None = Field(default=None, alias="disableThinking")

    @field_validator("daily_limit", mode="before")
    @classmethod
    def validate_daily_limit(cls, value: object) -> int | None:
        if value is None:
            return None
        return parse_daily_limit(value)

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_base_url_value(value)

    @field_validator("model")
    @classmethod
    def validate_model(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _validate_model_value(value)

    @field_validator("timeout_ms", mode="before")
    @classmethod
    def validate_timeout_ms(cls, value: object) -> int | None:
        if value is None:
            return None
        return _reject_bool_int(
            value,
            field_name="timeoutMs",
            minimum=MIN_AI_LLM_TIMEOUT_MS,
            maximum=MAX_AI_LLM_TIMEOUT_MS,
        )

    @field_validator("max_tokens", mode="before")
    @classmethod
    def validate_max_tokens(cls, value: object) -> int | None:
        if value is None:
            return None
        return _reject_bool_int(
            value,
            field_name="maxTokens",
            minimum=MIN_AI_LLM_MAX_TOKENS,
            maximum=MAX_AI_LLM_MAX_TOKENS,
        )

    @field_validator("enabled", "disable_thinking", mode="before")
    @classmethod
    def validate_strict_bool(cls, value: object) -> bool | None:
        if value is None:
            return None
        if not isinstance(value, bool):
            raise ValueError("布尔字段必须为 true 或 false")
        return value


DEFAULT_AI_LLM_STORED_CONFIG = AiAskLlmStoredConfig()

__all__ = [
    "AI_LLM_DAILY_LIMIT_CODE",
    "AI_LLM_QUOTA_CATEGORY_CODE",
    "AI_LLM_QUOTA_CATEGORY_NAME",
    "AI_LLM_QUOTA_FAILURE_MESSAGES",
    "AI_LLM_QUOTA_ITEM_NAME",
    "AI_LLM_QUOTA_LEGACY_ITEM_NAMES",
    "AI_LLM_QUOTA_SCOPE",
    "AI_LLM_QUOTA_TIMEZONE",
    "AiAskLlmConfigUpdate",
    "AiAskLlmStoredConfig",
    "DEFAULT_AI_LLM_DAILY_LIMIT",
    "DEFAULT_AI_LLM_MAX_TOKENS",
    "DEFAULT_AI_LLM_STORED_CONFIG",
    "DEFAULT_AI_LLM_TIMEOUT_MS",
    "MAX_AI_LLM_DAILY_LIMIT",
    "MAX_AI_LLM_MAX_TOKENS",
    "MAX_AI_LLM_TIMEOUT_MS",
    "MIN_AI_LLM_MAX_TOKENS",
    "MIN_AI_LLM_TIMEOUT_MS",
    "parse_daily_limit",
]
