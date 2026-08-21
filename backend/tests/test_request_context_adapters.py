"""Focused parity tests for neutral request-context adapters in F1."""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from backend.app import create_app
from backend.app.application import Identity, current_request_context
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.operation_log_service import OperationLogService
from fastapi.testclient import TestClient
from flask import has_request_context

# pyright: reportMissingImports=false


class RequestContextAdapterTests(unittest.TestCase):
    def setUp(self):
        self.capabilities = resolve_capabilities(edition="community")

    def test_fastapi_adapter_supplies_operation_log_metadata_without_flask(self):
        service = OperationLogService()
        with patch.dict(
            os.environ,
            {"ASSET_TRUST_PROXY_HEADERS": "true"},
            clear=False,
        ):
            app = create_fastapi_app(
                capabilities=self.capabilities,
                identity_resolver=lambda _request: Identity(
                    "maintainer", "alice", "Alice"
                ),
            )

            @app.get("/_test-request-context")
            def probe():
                context = current_request_context()
                metadata = service._request_context()
                metadata["costTimeMs"] = service._cost_time_ms()
                return {
                    "metadata": metadata,
                    "requestId": context.request_id if context else None,
                    "flaskRequestContext": has_request_context(),
                }

            response = TestClient(app).get(
                "/_test-request-context",
                headers={
                    "X-Request-ID": "request-1",
                    "X-Forwarded-For": "203.0.113.10, 198.51.100.1",
                    "User-Agent": "fastapi-neutral-test",
                },
            )

        self.assertEqual(200, response.status_code)
        body = response.json()
        self.assertFalse(body["flaskRequestContext"])
        self.assertEqual("request-1", body["requestId"])
        self.assertEqual(
            {
                "userId": "alice",
                "userName": "Alice",
                "deptName": "",
                "requestMethod": "GET",
                "requestUrl": "/_test-request-context",
                "ipAddress": "203.0.113.10",
                "userAgent": "fastapi-neutral-test",
                "costTimeMs": body["metadata"]["costTimeMs"],
            },
            body["metadata"],
        )
        self.assertGreaterEqual(body["metadata"]["costTimeMs"], 0)

    def test_flask_adapter_supplies_same_metadata_and_session_actor(self):
        service = OperationLogService()
        with patch.dict(
            os.environ,
            {
                "FLASK_ENV": "development",
                "FLASK_SECRET_KEY": "f1-neutral-context-test",
                "ASSET_TRUST_PROXY_HEADERS": "true",
            },
            clear=False,
        ):
            app = create_app(capabilities=self.capabilities)

            @app.get("/_test-request-context")
            def probe():
                context = current_request_context()
                metadata = service._request_context()
                metadata["costTimeMs"] = service._cost_time_ms()
                return {
                    "metadata": metadata,
                    "requestId": context.request_id if context else None,
                    "flaskRequestContext": has_request_context(),
                }

            client = app.test_client()
            with client.session_transaction() as session:
                session["dap_auth_user"] = {
                    "role": "maintainer",
                    "user": "alice",
                    "name": "Alice",
                }
            response = client.get(
                "/_test-request-context",
                headers={
                    "X-Request-ID": "request-1",
                    "X-Forwarded-For": "203.0.113.10, 198.51.100.1",
                    "User-Agent": "flask-neutral-test",
                },
            )

        self.assertEqual(200, response.status_code)
        body = response.get_json()
        self.assertTrue(body["flaskRequestContext"])
        self.assertEqual("request-1", body["requestId"])
        self.assertEqual("alice", body["metadata"]["userId"])
        self.assertEqual("Alice", body["metadata"]["userName"])
        self.assertEqual("203.0.113.10", body["metadata"]["ipAddress"])
        self.assertEqual("GET", body["metadata"]["requestMethod"])
        self.assertEqual("flask-neutral-test", body["metadata"]["userAgent"])
        self.assertGreaterEqual(body["metadata"]["costTimeMs"], 0)


if __name__ == "__main__":
    unittest.main()
