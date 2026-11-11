"""Bounded OpenAI-compatible JSON provider for single-turn metadata answers.

The provider has no model/index dependency and never logs prompts, credentials,
URLs, response bodies, or upstream exception strings.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import httpx

from ..settings import AIAskLLMConfig, get_ai_llm_config
from .ai_llm_daily_quota import (
    DailyLLMQuotaAttempt,
    DailyLLMQuotaExceeded,
    DailyLLMQuotaUnavailable,
    DailyLLMQuotaQuestion,
    daily_llm_quota_question_scope,
    daily_llm_quota_service,
)

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
        quota_service=daily_llm_quota_service,
    ) -> None:
        self._client = client or httpx.Client(
            follow_redirects=False,
            trust_env=False,
        )
        self._config_getter = config_getter
        self._quota_service = quota_service
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

    def complete_json(
        self,
        *,
        system_prompt: str,
        user_payload: dict[str, Any],
        cancel_event: threading.Event | None = None,
    ) -> str:
        with daily_llm_quota_question_scope() as question:
            return self._complete_json_in_question(
                system_prompt=system_prompt,
                user_payload=user_payload,
                cancel_event=cancel_event,
                question=question,
            )

    def _complete_json_in_question(
        self,
        *,
        system_prompt: str,
        user_payload: dict[str, Any],
        cancel_event: threading.Event | None,
        question: DailyLLMQuotaQuestion,
    ) -> str:
        try:
            settings = self._config_getter()
        except Exception:
            raise LLMProviderError("llm_unavailable") from None
        if cancel_event is not None and cancel_event.is_set():
            raise LLMProviderError("cancelled")
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

        deadline_expired = threading.Event()
        response_lock = threading.Lock()
        active_response: list[httpx.Response] = []
        deadline_timer: threading.Timer | None = None
        quota_attempt: DailyLLMQuotaAttempt | None = None
        cancel_watch_stop = threading.Event()
        cancel_watcher: threading.Thread | None = None

        def close_response_on_cancel() -> None:
            if cancel_event is None:
                return
            while not cancel_watch_stop.wait(0.025):
                if cancel_event.is_set():
                    with response_lock:
                        response = active_response[0] if active_response else None
                    if response is not None:
                        try:
                            response.close()
                        except Exception:
                            pass
                    return

        def expire_deadline() -> None:
            deadline_expired.set()
            with response_lock:
                response = active_response[0] if active_response else None
            if response is not None:
                try:
                    response.close()
                except Exception:
                    pass

        try:
            if cancel_event is not None:
                cancel_watcher = threading.Thread(
                    target=close_response_on_cancel,
                    name="dap-llm-request-cancel",
                    daemon=True,
                )
                cancel_watcher.start()
                if cancel_event.is_set():
                    raise LLMProviderError("cancelled")
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
            if settings.disable_thinking:
                # DeepSeek 默认开启 Thinking；结构化选择任务必须显式关闭，
                # 否则 reasoning tokens 会挤占 max_tokens 预算并截断 JSON 输出。
                body["thinking"] = {"type": "disabled"}
            timeout_seconds = max(0.001, settings.timeout_ms / 1000)
            deadline = time.monotonic() + timeout_seconds
            deadline_timer = threading.Timer(timeout_seconds, expire_deadline)
            deadline_timer.daemon = True
            deadline_timer.start()
            if cancel_event is not None and cancel_event.is_set():
                raise LLMProviderError("cancelled")
            if deadline_expired.is_set() or time.monotonic() >= deadline:
                raise LLMProviderError("llm_timeout")
            try:
                quota_attempt = question.begin_provider_attempt(self._quota_service)
            except DailyLLMQuotaExceeded:
                raise LLMProviderError("llm_daily_quota_exceeded") from None
            except DailyLLMQuotaUnavailable:
                raise LLMProviderError("llm_quota_unavailable") from None
            if cancel_event is not None and cancel_event.is_set():
                raise LLMProviderError("cancelled")
            if deadline_expired.is_set() or time.monotonic() >= deadline:
                raise LLMProviderError("llm_timeout")
            quota_attempt.mark_dispatched()
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
                    timeout=timeout_seconds,
                    follow_redirects=False,
                ) as response:
                    with response_lock:
                        active_response.append(response)
                    if cancel_event is not None and cancel_event.is_set():
                        raise LLMProviderError("cancelled")
                    # HTTPX's read timeout applies to each socket read. Check an
                    # absolute request deadline between streamed chunks so a
                    # slow-drip response cannot overrun the configured budget.
                    if deadline_expired.is_set() or time.monotonic() >= deadline:
                        raise LLMProviderError("llm_timeout")
                    chunks = bytearray()
                    for chunk in response.iter_bytes():
                        if cancel_event is not None and cancel_event.is_set():
                            raise LLMProviderError("cancelled")
                        if deadline_expired.is_set() or time.monotonic() >= deadline:
                            raise LLMProviderError("llm_timeout")
                        if len(chunks) + len(chunk) > MAX_LLM_RESPONSE_BYTES:
                            raise LLMProviderError("invalid_model_output")
                        chunks.extend(chunk)
                    if cancel_event is not None and cancel_event.is_set():
                        raise LLMProviderError("cancelled")
                    if deadline_expired.is_set() or time.monotonic() >= deadline:
                        raise LLMProviderError("llm_timeout")
                    status_code = response.status_code
            except LLMProviderError:
                raise
            except httpx.TimeoutException:
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMProviderError("cancelled") from None
                raise LLMProviderError("llm_timeout") from None
            except httpx.HTTPError:
                if cancel_event is not None and cancel_event.is_set():
                    raise LLMProviderError("cancelled") from None
                if deadline_expired.is_set() or time.monotonic() >= deadline:
                    raise LLMProviderError("llm_timeout") from None
                raise LLMProviderError("llm_unavailable") from None
            except Exception:
                if deadline_expired.is_set() or time.monotonic() >= deadline:
                    raise LLMProviderError("llm_timeout") from None
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
            cancel_watch_stop.set()
            if cancel_watcher is not None:
                cancel_watcher.join()
            if deadline_timer is not None:
                deadline_timer.cancel()
                deadline_timer.join()
            with response_lock:
                active_response.clear()
            if quota_attempt is not None:
                quota_attempt.finish()
            capacity.release()

    def close(self) -> None:
        self._client.close()
