"""Public documentation must not drift from the code it describes.

These tests pin the facts that repeatedly drifted in the public docs:

* the AI / RAG endpoints named in the docs must exist in the runtime route table;
* the AI capability must stay documented as opt-in and disabled by default;
* the retired "vector search / Embedding / LLM is explicitly out of scope"
  assertion must not come back, because it contradicted the shipped adapters;
* the public static Demo must not be described as calling a real model.

They are intentionally narrow: they guard statements the repository has already
gotten wrong once, not general prose style.
"""

from __future__ import annotations

import os
import re
import unittest
from unittest.mock import MagicMock, patch

from backend.app.authorization.core import AuthorizationService
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from fastapi.testclient import TestClient

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _read(relative: str) -> str:
    with open(os.path.join(ROOT, relative), encoding="utf-8") as handle:
        return handle.read()


API_PATH = re.compile(r"`(/(?:api)/[^`\s]*)`")

#: Paths that appear in prose but are deliberately not DAP runtime routes.
NON_DAP_PREFIXES = (
    # The external RAG service's own HTTP Search v1 surface.
    "/api/v1/",
    # Documented as WAIT_DB and outside the Community native route surface.
    "/api/common-codes",
)

DOCS_WITH_ROUTE_CLAIMS = (
    "README.md",
    "docs/modules.md",
    "docs/configuration.md",
    "docs/ai-ask-mvp.md",
    "docs/rbac/authenticated-read-model.md",
)


def _normalize(documented: str) -> re.Pattern[str]:
    """Turn a documented path into a regex that accepts OpenAPI path params."""
    path = documented.rstrip("/")
    # Drop illustrative query strings / fragments: they are not part of a route.
    path = re.split(r"[?#]", path, maxsplit=1)[0]
    pattern = re.escape(path)
    # ``/api/system/param-dicts*`` means "this prefix and its subpaths".
    pattern = pattern.replace(r"\*", "[^/]*")
    # OpenAPI renders params as ``{asset_id}``; the docs use the same shape.
    pattern = re.sub(r"\\\{[^}]*\\\}", "[^/]+", pattern)
    return re.compile(f"^{pattern}/?$")


class PublicDocsConsistencyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "public-docs-consistency-secret",
                "PUBLIC_CATALOG_PROFILE": "internal",
            },
            clear=False,
        )
        cls.environment.start()
        app = create_fastapi_app(
            capabilities=resolve_capabilities(),
            identity_resolver=lambda _request: None,
            search_provider_instance=MagicMock(),
            rag_search_service_instance=MagicMock(),
            authorization_service_instance=AuthorizationService(),
            openapi_enabled=True,
        )
        cls.client = TestClient(app)
        cls.paths = tuple(cls.client.get("/openapi.json").json()["paths"])

    @classmethod
    def tearDownClass(cls) -> None:
        cls.environment.stop()

    def test_documented_api_paths_exist_in_the_runtime_route_table(self) -> None:
        unmatched: list[str] = []
        for relative in DOCS_WITH_ROUTE_CLAIMS:
            for documented in API_PATH.findall(_read(relative)):
                if documented.startswith(NON_DAP_PREFIXES):
                    continue
                matcher = _normalize(documented)
                if not any(matcher.match(path) for path in self.paths):
                    unmatched.append(f"{relative}: {documented}")
        self.assertEqual([], unmatched, "Documented API paths missing from OpenAPI")

    def test_ai_and_recommendation_endpoints_are_documented(self) -> None:
        readme = _read("README.md")
        for endpoint in (
            "/api/search",
            "/api/search/recommendations",
            "/api/ai/status",
            "/api/ai/ask",
            "/api/ai/ask/progress",
            "/api/ai/ask/stream",
        ):
            self.assertIn(endpoint, readme, f"README must document {endpoint}")
            self.assertIn(endpoint, self.paths, f"{endpoint} must exist at runtime")

    def test_traditional_search_is_documented_as_independent_of_rag_and_llm(self) -> None:
        readme = _read("README.md")
        self.assertIn("不依赖 RAG", readme)
        self.assertIn("不依赖 LLM", readme)
        # The UI transport and the compatibility transports must stay distinct.
        self.assertIn("/api/ai/ask/stream", readme)
        self.assertIn("兼容接口", readme)

    def test_ai_capability_is_documented_as_opt_in_and_disabled_by_default(self) -> None:
        # The docs are mixed-language on purpose; assert each file's own wording.
        expectations = {
            "README.md": "AI_ASK_ENABLED` 默认 `false",
            "docs/configuration.md": "disabled by default",
            "docs/ai-ask-mvp.md": "默认关闭",
            "DEPLOYMENT.md": "`AI_ASK_ENABLED` unset or `false` by default",
        }
        for relative, wording in expectations.items():
            text = _read(relative)
            self.assertIn("AI_ASK_ENABLED", text, f"{relative} must name AI_ASK_ENABLED")
            self.assertIn("false", text, f"{relative} must state the disabled default")
            self.assertIn(
                wording,
                text,
                f"{relative} must state that the capability is off by default",
            )

    def test_retired_ai_out_of_scope_assertion_does_not_return(self) -> None:
        readme = _read("README.md")
        self.assertNotIn(
            "向量检索、Embedding 与 LLM 语义推荐",
            readme,
            "README must not re-assert that vector/Embedding/LLM work is out of scope",
        )
        self.assertIn("不内置", readme)
        self.assertIn("NL2SQL", readme)
        # The real boundary keeps both halves: no built-in vector engine AND
        # optional RAG / AI integration.
        self.assertIn("可选", readme)

    def test_public_static_demo_is_not_described_as_real_ai(self) -> None:
        readme = _read("README.md")
        self.assertIn("不是真实 DeepSeek 输出", readme)
        self.assertIn("docs/ai-ask-static-mock.md", readme)
        static_mock = _read("docs/ai-ask-static-mock.md")
        self.assertIn("不会执行真实 AI", static_mock)
        self.assertIn("VITE_API_MODE=mock", static_mock)

    def test_mock_mode_cannot_fall_back_to_a_remote_ai_response(self) -> None:
        # The isolation guarantee lives in the client; assert the guard exists
        # rather than trusting the prose.
        execution = _read("frontend/src/api/aiAskExecution.ts")
        self.assertIn('VITE_API_MODE === "mock"', execution)
        self.assertIn("当前运行模式未启用真实 AI 问答服务", execution)
        self.assertIn("/ai/ask/stream", execution)


if __name__ == "__main__":
    unittest.main()
