"""Stable constants and validation for the global daily LLM quota setting.

This module is intentionally independent of the API contracts package so
bootstrap and migration tools can validate the setting without importing the
FastAPI/Pydantic contract registry.
"""

from __future__ import annotations

import re

DEFAULT_AI_LLM_DAILY_LIMIT = 50
MAX_AI_LLM_DAILY_LIMIT = 2_147_483_647
AI_LLM_DAILY_LIMIT_CODE = "AI_LLM_DAILY_LIMIT"
AI_LLM_QUOTA_CATEGORY_CODE = "AI_LLM_QUOTA_CONFIG"
AI_LLM_QUOTA_CATEGORY_NAME = "AI 问答配置"
AI_LLM_QUOTA_ITEM_NAME = "每日 AI 问答上限"
# Preserve already-migrated hidden rows; the UI label is supplied by the protected panel.
AI_LLM_QUOTA_LEGACY_ITEM_NAMES = frozenset({"每日 LLM 调用上限"})
AI_LLM_QUOTA_SCOPE = "GLOBAL"
AI_LLM_QUOTA_TIMEZONE = "Asia/Shanghai"
AI_LLM_QUOTA_FAILURE_MESSAGES = {
    "llm_daily_quota_exceeded": "今日 AI 问答次数已用完，请明日再试。",
    "llm_quota_unavailable": "每日 AI 问答额度服务暂不可用，请稍后重试。",
}
_DIGITS = re.compile(r"[0-9]+\Z")


def parse_daily_limit(value: object) -> int:
    """Accept only a positive signed-32-bit integer setting."""
    if isinstance(value, bool):
        raise ValueError("daily LLM limit must be a positive integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str) and _DIGITS.fullmatch(value):
        parsed = int(value)
    else:
        raise ValueError("daily LLM limit must be a positive integer")
    if parsed < 1 or parsed > MAX_AI_LLM_DAILY_LIMIT:
        raise ValueError("daily LLM limit is out of range")
    return parsed
