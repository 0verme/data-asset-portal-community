from __future__ import annotations

import json
import threading
import time
import unittest
from unittest.mock import patch

import httpx

from backend.app.services.ai_llm_provider import (
    MAX_LLM_RESPONSE_BYTES,
    LLMProviderError,
    OpenAICompatibleLLMProvider,
)
from backend.app.settings import AIAskLLMConfig, get_ai_llm_config


def llm_config(*, enabled=True, max_concurrency=2, timeout_ms=1000):
    return AIAskLLMConfig(
        enabled=enabled,
        base_url="https://llm.example.invalid/v1",
        model="deepseek-flash-test",
        api_key="test-provider-key",
        timeout_ms=timeout_ms,
        max_tokens=256,
        max_concurrency=max_concurrency,
    )


def success_response(content='{"answer":"ok","citations":[{"assetId":1}]}'):
    return httpx.Response(200, json={
        "choices": [{"message": {"content": content}, "finish_reason": "stop"}],
    })


class SlowDripBody(httpx.SyncByteStream):
    def __init__(self, *, interval=0.09):
        self.interval = interval
        self.closed = threading.Event()

    def __iter__(self):
        for chunk in (b'{"choices":', b'{"message":'):
            if self.closed.wait(self.interval):
                return
            yield chunk

    def close(self):
        self.closed.set()


class OpenAICompatibleLLMProviderTests(unittest.TestCase):
    def _provider(self, handler, *, config=None):
        transport = httpx.MockTransport(handler)
        client = httpx.Client(transport=transport, follow_redirects=False, trust_env=False)
        return OpenAICompatibleLLMProvider(
            client=client,
            config_getter=lambda: config or llm_config(),
        )

    def test_openai_compatible_contract_uses_server_key_and_json_mode(self):
        requests = []

        def handler(request):
            requests.append(request)
            self.assertEqual("https://llm.example.invalid/v1/chat/completions", str(request.url))
            self.assertEqual("Bearer test-provider-key", request.headers["Authorization"])
            payload = json.loads(request.content)
            self.assertEqual("deepseek-flash-test", payload["model"])
            self.assertEqual(0, payload["temperature"])
            self.assertEqual({"type": "json_object"}, payload["response_format"])
            self.assertEqual("贷款余额在哪个表？", json.loads(payload["messages"][1]["content"])["query"])
            return success_response()

        provider = self._provider(handler)
        output = provider.complete_json(
            system_prompt="strict test prompt",
            user_payload={"query": "贷款余额在哪个表？", "candidates": []},
        )

        self.assertEqual('{"answer":"ok","citations":[{"assetId":1}]}', output)
        self.assertEqual(1, len(requests))
        self.assertNotIn("test-provider-key", output)

    def test_provider_can_load_runtime_configuration_after_app_import(self):
        current_config = [None]
        transport = httpx.MockTransport(lambda _request: success_response())
        provider = OpenAICompatibleLLMProvider(
            client=httpx.Client(transport=transport, follow_redirects=False, trust_env=False),
            config_getter=lambda: current_config[0],
        )

        self.assertFalse(provider.is_enabled())
        self.assertIsNone(provider._capacity)
        current_config[0] = llm_config(max_concurrency=1)
        self.assertTrue(provider.is_enabled())
        self.assertEqual(
            '{"answer":"ok","citations":[{"assetId":1}]}',
            provider.complete_json(system_prompt="x", user_payload={}),
        )
        self.assertIsNotNone(provider._capacity)

    def test_disabled_or_unconfigured_provider_fails_closed_and_status_has_no_secret(self):
        disabled = self._provider(lambda _request: self.fail("must not send"), config=llm_config(enabled=False))
        self.assertFalse(disabled.is_enabled())
        with self.assertRaises(LLMProviderError) as raised:
            disabled.complete_json(system_prompt="x", user_payload={})
        self.assertEqual("ai_disabled", raised.exception.reason_code)

        unconfigured = OpenAICompatibleLLMProvider(config_getter=lambda: None)
        self.assertFalse(unconfigured.is_enabled())
        with self.assertRaises(LLMProviderError) as raised:
            unconfigured.complete_json(system_prompt="x", user_payload={})
        self.assertEqual("llm_not_configured", raised.exception.reason_code)

    def test_timeout_status_redirect_and_invalid_json_are_sanitized(self):
        cases = [
            (lambda _request: (_ for _ in ()).throw(httpx.ReadTimeout("private endpoint/key")), "llm_timeout"),
            (lambda _request: httpx.Response(504, text="private response"), "llm_timeout"),
            (lambda _request: httpx.Response(429), "llm_busy"),
            (lambda _request: httpx.Response(503, text="private response"), "llm_unavailable"),
            (lambda _request: httpx.Response(302, headers={"Location": "https://elsewhere.invalid"}), "llm_unavailable"),
            (lambda _request: httpx.Response(200, content=b"not json"), "invalid_model_output"),
            (lambda _request: httpx.Response(200, json={"choices": []}), "invalid_model_output"),
        ]
        for handler, reason in cases:
            with self.subTest(reason=reason):
                provider = self._provider(handler)
                with self.assertRaises(LLMProviderError) as raised:
                    provider.complete_json(system_prompt="x", user_payload={})
                self.assertEqual(reason, raised.exception.reason_code)
                self.assertNotIn("private endpoint/key", str(raised.exception))
                self.assertNotIn("test-provider-key", str(raised.exception))

    def test_response_body_is_bounded(self):
        provider = self._provider(lambda _request: httpx.Response(200, content=b"x" * (MAX_LLM_RESPONSE_BYTES + 1)))
        with self.assertRaises(LLMProviderError) as raised:
            provider.complete_json(system_prompt="x", user_payload={})
        self.assertEqual("invalid_model_output", raised.exception.reason_code)

    def test_overall_deadline_stops_slow_drip_and_releases_concurrency_slot(self):
        calls = []

        def handler(_request):
            calls.append(None)
            if len(calls) == 1:
                return httpx.Response(200, stream=SlowDripBody())
            return success_response()

        provider = self._provider(
            handler,
            config=llm_config(max_concurrency=1, timeout_ms=150),
        )
        started = time.monotonic()
        with self.assertRaises(LLMProviderError) as raised:
            provider.complete_json(system_prompt="x", user_payload={})
        elapsed = time.monotonic() - started

        self.assertEqual("llm_timeout", raised.exception.reason_code)
        self.assertGreaterEqual(elapsed, 0.15)
        self.assertLess(elapsed, 0.35)
        self.assertEqual(
            '{"answer":"ok","citations":[{"assetId":1}]}',
            provider.complete_json(system_prompt="x", user_payload={}),
            "timed-out requests must release their provider concurrency slot",
        )

    def test_deadline_closes_a_stalled_response_at_the_overall_limit(self):
        body = SlowDripBody(interval=0.5)
        provider = self._provider(
            lambda _request: httpx.Response(200, stream=body),
            config=llm_config(timeout_ms=150),
        )
        started = time.monotonic()

        with self.assertRaises(LLMProviderError) as raised:
            provider.complete_json(system_prompt="x", user_payload={})

        self.assertEqual("llm_timeout", raised.exception.reason_code)
        self.assertTrue(body.closed.is_set())
        self.assertLess(time.monotonic() - started, 0.35)

    def test_concurrency_limit_rejects_excess_requests_without_waiting(self):
        entered = threading.Event()
        release = threading.Event()
        first_errors = []

        def handler(_request):
            entered.set()
            release.wait(2)
            return success_response()

        provider = self._provider(handler, config=llm_config(max_concurrency=1))

        def first_call():
            try:
                provider.complete_json(system_prompt="x", user_payload={})
            except Exception as error:  # pragma: no cover - assertion reports thread exception
                first_errors.append(error)

        thread = threading.Thread(target=first_call)
        thread.start()
        self.assertTrue(entered.wait(1), "first request should hold the provider slot")
        with self.assertRaises(LLMProviderError) as raised:
            provider.complete_json(system_prompt="x", user_payload={})
        self.assertEqual("llm_busy", raised.exception.reason_code)
        release.set()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual([], first_errors)

    def test_environment_configuration_is_server_only_bounded_and_https_except_loopback(self):
        base_env = {
            "AI_ASK_ENABLED": "true",
            "AI_LLM_BASE_URL": "https://llm.example.invalid/v1/",
            "AI_LLM_MODEL": "deepseek-flash",
            "AI_LLM_API_KEY": "deployment-secret-value",
        }
        with patch.dict("os.environ", base_env, clear=True):
            config = get_ai_llm_config()
        self.assertIsNotNone(config)
        self.assertTrue(config.enabled)
        self.assertTrue(config.configured)
        self.assertEqual("https://llm.example.invalid/v1", config.base_url)
        self.assertEqual(10000, config.timeout_ms)
        self.assertEqual(2, config.max_concurrency)

        for invalid in (
            "http://remote.example.invalid",
            "https://user:pass" + "@" + "llm.example.invalid",
            "https://llm.example.invalid/v1?token=secret",
            "https://llm.example.invalid/../other",
        ):
            with self.subTest(invalid=invalid), patch.dict("os.environ", {**base_env, "AI_LLM_BASE_URL": invalid}, clear=True):
                self.assertIsNone(get_ai_llm_config())

        with patch.dict("os.environ", {**base_env, "AI_LLM_BASE_URL": "http://127.0.0.1:8080/v1"}, clear=True):
            self.assertEqual("http://127.0.0.1:8080/v1", get_ai_llm_config().base_url)
        with patch.dict("os.environ", {**base_env, "AI_LLM_TIMEOUT_MS": "60001"}, clear=True):
            self.assertIsNone(get_ai_llm_config())
        with patch.dict("os.environ", {**base_env, "AI_ASK_ENABLED": "false"}, clear=True):
            self.assertFalse(get_ai_llm_config().enabled)


if __name__ == "__main__":
    unittest.main()
