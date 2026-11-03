"""Bounded OpenAI-compatible JSON provider for single-turn metadata answers.

The provider has no model/index dependency and never logs prompts, credentials,
URLs, response bodies, or upstream exception strings.
"""

from __future__ import annotations

import json
import threading
from typing import Any

import httpx

from ..settings import AIAskLLMConfig, get_ai_llm_config

MAX_LLM_RESPONSE_BYTES = 256_000


class LLMProviderError(RuntimeError):
    """Safe, stable failure code with no upstream details."""

    def __init__(self, reason_code: str) -> None:
        self.reason_code = reason_code
        super().__init__(reason_code)


class OpenAICompatibleLLMProvider:
    """Small sync HTTP adapter for ``POST /chat/completions``."""

    def __init__(
        self,
        *,
        client: httpx.Client | None = None,
        config_getter=get_ai_llm_config,
    ) -> None:
        self._client = client or httpx.Client(
            follow_redirects=False,
            trust_env=False,
        )
        self._config_getter = config_getter
        # App composition imports this module before ``load_runtime_env`` in
        # the ASGI entrypoint. Create the semaphore lazily on the first
        # configured request so the deployment limit comes from the loaded env.
        self._capacity: threading.BoundedSemaphore | None = None
        self._capacity_lock = threading.Lock()

    def is_enabled(self) -> bool:
        try:
            settings = self._config_getter()
        except Exception:
            return False
        return bool(
            isinstance(settings, AIAskLLMConfig)
            and settings.enabled
            and settings.configured
        )

    @staticmethod
    def _endpoint(settings: AIAskLLMConfig) -> str:
        return f"{settings.base_url.rstrip('/')}/chat/completions"

    def complete_json(self, *, system_prompt: str, user_payload: dict[str, Any]) -> str:
        try:
            settings = self._config_getter()
        except Exception:
            raise LLMProviderError("llm_unavailable") from None
        if not isinstance(settings, AIAskLLMConfig) or not settings.configured:
            raise LLMProviderError("llm_not_configured")
        if not settings.enabled:
            raise LLMProviderError("ai_disabled")
        with self._capacity_lock:
            if self._capacity is None:
                self._capacity = threading.BoundedSemaphore(settings.max_concurrency)
            capacity = self._capacity
        if not capacity.acquire(blocking=False):
            raise LLMProviderError("llm_busy")

        try:
            body = {
                "model": settings.model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {
                        "role": "user",
                        "content": json.dumps(
                            user_payload,
                            ensure_ascii=False,
                            separators=(",", ":"),
                        ),
                    },
                ],
                "temperature": 0,
                "max_tokens": settings.max_tokens,
                "response_format": {"type": "json_object"},
            }
            try:
                with self._client.stream(
                    "POST",
                    self._endpoint(settings),
                    headers={
                        "Accept": "application/json",
                        "Authorization": f"Bearer {settings.api_key}",
                        "Content-Type": "application/json",
                    },
                    json=body,
                    timeout=max(0.001, settings.timeout_ms / 1000),
                    follow_redirects=False,
                ) as response:
                    chunks = bytearray()
                    for chunk in response.iter_bytes():
                        if len(chunks) + len(chunk) > MAX_LLM_RESPONSE_BYTES:
                            raise LLMProviderError("invalid_model_output")
                        chunks.extend(chunk)
                    status_code = response.status_code
            except httpx.TimeoutException:
                raise LLMProviderError("llm_timeout") from None
            except httpx.HTTPError:
                raise LLMProviderError("llm_unavailable") from None

            if status_code in (408, 504):
                raise LLMProviderError("llm_timeout")
            if status_code == 429:
                raise LLMProviderError("llm_busy")
            if not 200 <= status_code < 300:
                raise LLMProviderError("llm_unavailable")
            try:
                payload = json.loads(bytes(chunks))
                choices = payload.get("choices") if isinstance(payload, dict) else None
                message = choices[0].get("message") if isinstance(choices, list) and choices else None
                content = message.get("content") if isinstance(message, dict) else None
            except (UnicodeDecodeError, json.JSONDecodeError, TypeError, IndexError, AttributeError):
                raise LLMProviderError("invalid_model_output") from None
            if not isinstance(content, str) or not content.strip() or len(content) > MAX_LLM_RESPONSE_BYTES:
                raise LLMProviderError("invalid_model_output")
            return content.strip()
        finally:
            capacity.release()

    def close(self) -> None:
        self._client.close()
