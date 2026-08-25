"""Direct ASGI regression tests for actual request-body size enforcement."""

from __future__ import annotations

import asyncio
import json
import unittest
from unittest.mock import MagicMock

from fastapi import Body, FastAPI
from fastapi.responses import JSONResponse, Response

from backend.app.application import Identity
from backend.app.fastapi.errors import register_exception_handlers
from backend.app.fastapi_app import create_fastapi_app
from backend.app.fastapi.request_body import (
    METADATA_INGESTION_PATHS,
    RequestSizeLimitMiddleware,
    resolve_request_body_limit,
)
from backend.app.contracts.metadata_ingestion import MAX_METADATA_BODY_BYTES


async def invoke_asgi(
    app,
    messages,
    *,
    headers=(),
    path="/probe",
    method="POST",
    scope_type="http",
):
    scope = {
        "type": scope_type,
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode("ascii"),
        "query_string": b"",
        "headers": list(headers),
        "client": ("127.0.0.1", 12345),
        "server": ("127.0.0.1", 80),
    }
    pending = list(messages)
    receive_count = 0
    sent = []

    async def receive():
        nonlocal receive_count
        receive_count += 1
        if not pending:
            raise AssertionError("ASGI receive was consumed beyond the supplied messages")
        return pending.pop(0)

    async def send(message):
        sent.append(message)

    await app(scope, receive, send)
    starts = [message for message in sent if message.get("type") == "http.response.start"]
    body = b"".join(
        message.get("body", b"")
        for message in sent
        if message.get("type") == "http.response.body"
    )
    return {
        "status": starts[0]["status"] if starts else None,
        "body": body,
        "sent": sent,
        "receive_count": receive_count,
    }


def body_reader(captured, disconnected):
    async def app(scope, receive, send):
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                disconnected.append(True)
                await Response(status_code=204)(scope, receive, send)
                return
            captured.append(message)
            if not message.get("more_body", False):
                break
        await JSONResponse({"ok": True})(scope, receive, send)

    return app


class RequestBodyPolicyTests(unittest.TestCase):
    def test_metadata_limit_is_stricter_than_default_global_limit(self):
        policy = resolve_request_body_limit(
            "/api/metadata/assets/ingestions",
            "POST",
            16 * 1024 * 1024,
        )
        self.assertEqual(MAX_METADATA_BODY_BYTES, policy.max_bytes)
        self.assertEqual("METADATA_PAYLOAD_TOO_LARGE", policy.code)
        self.assertEqual(MAX_METADATA_BODY_BYTES, policy.details["maxBytes"])

    def test_global_limit_wins_when_it_is_stricter(self):
        policy = resolve_request_body_limit(
            "/api/metadata/lineage:snapshots",
            "POST",
            4 * 1024 * 1024,
            metadata_limit=8 * 1024 * 1024,
        )
        self.assertEqual(4 * 1024 * 1024, policy.max_bytes)
        self.assertEqual(4 * 1024 * 1024, policy.details["maxBytes"])

    def test_all_metadata_write_aliases_are_policy_protected(self):
        for path in METADATA_INGESTION_PATHS:
            with self.subTest(path=path):
                policy = resolve_request_body_limit(path, "POST", 100, metadata_limit=10)
                self.assertEqual(10, policy.max_bytes)
                self.assertEqual("METADATA_PAYLOAD_TOO_LARGE", policy.code)

    def test_metadata_read_route_uses_only_global_policy(self):
        policy = resolve_request_body_limit(
            "/api/metadata/ingestions/ingestion-1",
            "GET",
            100,
            metadata_limit=10,
        )
        self.assertEqual(100, policy.max_bytes)
        self.assertEqual("HTTP_413", policy.code)


class DirectASGIRequestBodyTests(unittest.TestCase):
    def _run(self, messages, **kwargs):
        captured = []
        disconnected = []
        runtime = RequestSizeLimitMiddleware(
            body_reader(captured, disconnected),
            10,
            metadata_body_limit=10,
        )
        result = asyncio.run(invoke_asgi(runtime, messages, **kwargs))
        return result, captured, disconnected

    def test_content_length_over_limit_fails_before_downstream_or_receive(self):
        result, captured, _ = self._run(
            [{"type": "http.request", "body": b"never-read", "more_body": False}],
            headers=[(b"Content-Length", b"11")],
        )
        self.assertEqual(413, result["status"])
        self.assertEqual(0, result["receive_count"])
        self.assertEqual([], captured)
        self.assertEqual(1, len([m for m in result["sent"] if m["type"] == "http.response.start"]))

    def test_no_content_length_under_limit_forwards_exact_frames(self):
        messages = [
            {"type": "http.request", "body": b"ab", "more_body": True},
            {"type": "http.request", "body": b"", "more_body": True},
            {"type": "http.request", "body": b"cde", "more_body": False},
        ]
        result, captured, _ = self._run(messages)
        self.assertEqual(200, result["status"])
        self.assertEqual(messages, captured)
        self.assertEqual(b"abcde", b"".join(message["body"] for message in captured))

    def test_no_content_length_oversized_stream_returns_413(self):
        result, captured, _ = self._run(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"5678", "more_body": True},
                {"type": "http.request", "body": b"90!", "more_body": False},
            ]
        )
        self.assertEqual(413, result["status"])
        self.assertEqual(3, result["receive_count"])
        self.assertEqual(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"5678", "more_body": True},
            ],
            captured,
        )

    def test_declared_length_smaller_than_actual_body_still_returns_413(self):
        result, captured, _ = self._run(
            [{"type": "http.request", "body": b"12345678901", "more_body": False}],
            headers=[(b"content-length", b"4")],
        )
        self.assertEqual(413, result["status"])
        self.assertEqual([], captured)

    def test_multiple_messages_are_counted_by_actual_bytes(self):
        result, captured, _ = self._run(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"5678", "more_body": True},
                {"type": "http.request", "body": b"9012", "more_body": False},
            ]
        )
        self.assertEqual(413, result["status"])
        self.assertEqual(
            [
                {"type": "http.request", "body": b"1234", "more_body": True},
                {"type": "http.request", "body": b"5678", "more_body": True},
            ],
            captured,
        )

    def test_exact_limit_is_allowed(self):
        result, captured, _ = self._run(
            [{"type": "http.request", "body": b"1234567890", "more_body": False}]
        )
        self.assertEqual(200, result["status"])
        self.assertEqual(b"1234567890", b"".join(message["body"] for message in captured))

    def test_empty_body_is_allowed(self):
        result, captured, _ = self._run(
            [{"type": "http.request", "body": b"", "more_body": False}]
        )
        self.assertEqual(200, result["status"])
        self.assertEqual([b""], [message["body"] for message in captured])

    def test_invalid_content_length_does_not_disable_actual_limit(self):
        under, captured, _ = self._run(
            [{"type": "http.request", "body": b"123", "more_body": False}],
            headers=[(b"content-length", b"abc")],
        )
        self.assertEqual(200, under["status"])
        self.assertEqual(b"123", b"".join(message["body"] for message in captured))

        over, captured, _ = self._run(
            [{"type": "http.request", "body": b"12345678901", "more_body": False}],
            headers=[(b"content-length", b"abc")],
        )
        self.assertEqual(413, over["status"])
        self.assertEqual([], captured)

    def test_disconnect_is_forwarded_without_false_413(self):
        frame = {"type": "http.request", "body": b"abc", "more_body": True}
        result, captured, disconnected = self._run([frame, {"type": "http.disconnect"}])
        self.assertEqual(204, result["status"])
        self.assertEqual([frame], captured)
        self.assertEqual([True], disconnected)

    def test_non_http_scope_is_passthrough(self):
        seen = []

        async def websocket_app(scope, receive, send):
            seen.append(await receive())
            await send({"type": "websocket.accept"})

        async def run():
            sent = []

            async def receive():
                return {"type": "websocket.connect"}

            async def send(message):
                sent.append(message)

            await RequestSizeLimitMiddleware(websocket_app, 10)(
                {"type": "websocket", "path": "/probe", "headers": []},
                receive,
                send,
            )
            return sent

        self.assertEqual([{"type": "websocket.accept"}], asyncio.run(run()))
        self.assertEqual([{"type": "websocket.connect"}], seen)


class MetadataASGIBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.service = MagicMock()
        self.service.ingest_assets.return_value = {
            "ingestionId": "ingestion-1",
            "correlationId": "request-1",
            "status": "completed",
            "contractVersion": "1.0",
            "dryRun": False,
            "source": {"type": "postgresql", "name": "warehouse"},
            "collector": {"name": "test", "version": "1.0"},
            "summary": {"received": 0, "valid": 0},
            "items": [],
        }
        app = create_fastapi_app(
            identity_resolver=lambda _request: Identity("maintainer", "collector", "Collector"),
            metadata_ingestion_service_instance=self.service,
        )
        self.runtime = RequestSizeLimitMiddleware(
            app,
            100,
            metadata_body_limit=10,
        )

    def test_all_metadata_write_aliases_reject_before_pydantic_or_service(self):
        for path in METADATA_INGESTION_PATHS:
            with self.subTest(path=path):
                result = asyncio.run(
                    invoke_asgi(
                        self.runtime,
                        [{"type": "http.request", "body": b"x" * 11, "more_body": False}],
                        path=path,
                    )
                )
                self.assertEqual(413, result["status"])
                self.assertEqual(
                    "METADATA_PAYLOAD_TOO_LARGE",
                    json.loads(result["body"])["error"]["code"],
                )
        self.service.ingest_assets.assert_not_called()
        self.service.ingest_lineage.assert_not_called()

    def test_metadata_body_under_limit_is_consumed_once_by_fastapi(self):
        payload = {
            "contractVersion": "1.0",
            "source": {"type": "postgresql", "name": "warehouse"},
            "collector": {"name": "test", "version": "1.0"},
            "assets": [],
        }
        body = json.dumps(payload, separators=(",", ":")).encode()
        runtime = RequestSizeLimitMiddleware(
            self.runtime.app,
            1_000,
            metadata_body_limit=1_000,
        )
        result = asyncio.run(
            invoke_asgi(
                runtime,
                [{"type": "http.request", "body": body, "more_body": False}],
                headers=[(b"content-type", b"application/json")],
                path="/api/metadata/assets/ingestions",
            )
        )
        self.assertEqual(201, result["status"])
        self.service.ingest_assets.assert_called_once()


class FastAPIParserBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.endpoint_calls = []
        app = FastAPI()
        register_exception_handlers(app)

        @app.post("/probe")
        async def probe(payload: dict = Body(...)):
            self.endpoint_calls.append(payload)
            return JSONResponse({"received": payload})

        self.runtime = RequestSizeLimitMiddleware(app, 20)

    def test_receive_exception_is_one_413_not_400_422_or_500(self):
        result = asyncio.run(
            invoke_asgi(
                self.runtime,
                [
                    {"type": "http.request", "body": b'{"ok":true}', "more_body": True},
                    {"type": "http.request", "body": b"xxxxxxxxxxx", "more_body": False},
                ],
            )
        )
        self.assertEqual(413, result["status"])
        self.assertEqual("HTTP_413", json.loads(result["body"])["error"]["code"])
        self.assertEqual([], self.endpoint_calls)
        self.assertEqual(1, len([m for m in result["sent"] if m["type"] == "http.response.start"]))

    def test_under_limit_body_reaches_pydantic_once(self):
        result = asyncio.run(
            invoke_asgi(
                self.runtime,
                [{"type": "http.request", "body": b'{"ok":true}', "more_body": False}],
                headers=[(b"content-type", b"application/json")],
            )
        )
        self.assertEqual(200, result["status"])
        self.assertEqual([{"ok": True}], self.endpoint_calls)


if __name__ == "__main__":
    unittest.main()
