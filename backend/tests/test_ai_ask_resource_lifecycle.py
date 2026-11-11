"""Resource-lifecycle regressions for the AI ask worker boundary.

These tests assert that the real resources are released, not only that an HTTP
status code looks reasonable:

* every cancellation path must reap the OS child process and free the bounded
  admission slot, even when the request scope is already cancelled;
* a child that exits normally must still deliver the ``result``/``__end__``
  records it queued before exiting;
* a blocked JDBC-style read must be killed by the worker deadline;
* ordinary (non-AI) API traffic must keep working while an AI child blocks.
"""

from __future__ import annotations

import os
import threading
import time
import unittest
from unittest.mock import MagicMock, patch

import anyio
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.application import RequestContext
from backend.app.authorization.core import AuthorizationService
from backend.app.contracts.ai_ask import AiAskRequest, AiAskResponse
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi_app import create_fastapi_app
from backend.app.services.ai_ask_admission import AIAskAdmissionController
from backend.app.services.ai_ask_request_guard import (
    AIAskRequestGuard,
    shutdown_cleanup_pool,
)
from backend.app.services.ai_ask_worker import AIAskProcessWorker

_ANSWER_TEXT = "子进程已返回真实结果。"
_CANDIDATE = {
    "assetId": 7,
    "fieldId": 11,
    "assetType": "field",
    "tableName": "ACCOUNT_BALANCE",
    "tableDisplayName": "账户余额表",
    "tableDescription": "余额说明",
    "fieldName": "BALANCE_AMT",
    "fieldDisplayName": "余额金额",
    "fieldDescription": "余额字段",
    "domain": "账户域",
    "layer": "DWS",
    "source": "dap_catalog",
    "matchReason": "由当前 DAP 目录校验",
    "relevance": "direct",
}
_CITATION = {"assetId": 7, "fieldId": 11, "source": "dap_catalog"}
_CONTEXT = RequestContext(
    identity=None,
    request_id="resource-lifecycle-test",
    method="POST",
    path="/api/ai/ask/stream",
)


def _answered_response() -> AiAskResponse:
    return AiAskResponse(
        status="answered",
        answer=_ANSWER_TEXT,
        citations=[dict(_CITATION)],
        candidates=[dict(_CANDIDATE)],
        retrievalStatus="available",
        generationStatus="completed",
    )


# --------------------------------------------------------------------------
# Child-process fixtures. They must stay importable (spawn re-imports them).
# --------------------------------------------------------------------------
def _child_blocked_in_jdbc(
    output_queue,
    cancel_event,
    mode,
    payload,
    profile,
    request_id,
    database_timeout_seconds,
):
    """Simulate a JayDeBeApi ResultSet read that ignores Python cancellation."""
    output_queue.put(("progress", {"id": "retrieving", "status": "running"}))
    output_queue.put((
        "event",
        "step_start",
        {
            "request_id": request_id,
            "step_id": "retrieving",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "message": "正在检索目录。",
            "data": {"phase": "database"},
        },
    ))
    threading.Event().wait(120)


def _child_result_then_exit(
    output_queue,
    cancel_event,
    mode,
    payload,
    profile,
    request_id,
    database_timeout_seconds,
):
    """Queue a real result and exit immediately afterwards."""
    # Spawn re-imports this module, so module globals are already available.
    response = _answered_response()
    output_queue.put(("result", response.model_dump(by_alias=True)))
    output_queue.put(("__end__", None))


def _child_stream_answer(
    output_queue,
    cancel_event,
    mode,
    payload,
    profile,
    request_id,
    database_timeout_seconds,
):
    """Emit a complete, protocol-compatible streamed answer."""
    # Spawn re-imports this module, so module globals are already available.
    response = _answered_response()
    output_queue.put((
        "event",
        "step_start",
        {
            "request_id": request_id,
            "step_id": "retrieving",
            "timestamp": "2026-01-01T00:00:00.000Z",
            "message": "正在检索目录。",
            "data": {"phase": "planning"},
        },
    ))
    output_queue.put((
        "event",
        "step_complete",
        {
            "request_id": request_id,
            "step_id": "retrieving",
            "timestamp": "2026-01-01T00:00:00.001Z",
            "message": "已完成检索。",
            "data": {"phase": "planning"},
        },
    ))
    output_queue.put((
        "event",
        "answer",
        {
            "request_id": request_id,
            "step_id": "answer",
            "timestamp": "2026-01-01T00:00:00.002Z",
            "message": _ANSWER_TEXT,
            "data": {"response": response.model_dump(by_alias=True)},
        },
    ))
    output_queue.put(("result", response.model_dump(by_alias=True)))
    output_queue.put(("__end__", None))


def _child_crashes(
    output_queue,
    cancel_event,
    mode,
    payload,
    profile,
    request_id,
    database_timeout_seconds,
):
    """Die without any queue record, like an interpreter-level child failure."""
    os._exit(3)


def _injected_worker(
    instances,
    *,
    stream_target=_child_blocked_in_jdbc,
    progress_target=_child_blocked_in_jdbc,
    timeout_seconds: float = 5,
    first_message_none: bool = False,
):
    """Route-compatible worker that injects a deterministic child target."""

    class _InjectedWorker(AIAskProcessWorker):
        def __init__(self, **kwargs):
            kwargs["process_target"] = (
                stream_target if kwargs.get("mode") == "stream" else progress_target
            )
            kwargs.setdefault("timeout_seconds", timeout_seconds)
            super().__init__(**kwargs)
            self._skip_first_message = first_message_none
            instances.append(self)

        def get_message(self, timeout=0.1):
            if self._skip_first_message:
                # Let the child finish and exit before the parent ever reads,
                # which is the race that used to answer ``llm_unavailable``.
                self._skip_first_message = False
                self.process.join(10)
                return None
            return super().get_message(timeout)

    return _InjectedWorker


class _QueuedResultWorker:
    """Worker stub whose child already exited with its records still queued."""

    def __init__(self, *, mode, payload, profile, request_id="", **_kwargs):
        self.mode = mode
        self.timeout_seconds = 5
        self.database_timeout_seconds = 1
        self.cancel_event = threading.Event()
        self.stopped = 0
        self.reaped = 0
        self.messages = [
            ("progress", {"id": "retrieving", "status": "running"}),
            ("result", _answered_response().model_dump(by_alias=True)),
            ("__end__", None),
        ]

    def start(self):
        pass

    def get_message(self, timeout=0.1):
        return self.messages.pop(0) if self.messages else None

    def drain_messages(self, *, timeout=0.05, budget_seconds=1.0):
        drained = list(self.messages)
        self.messages.clear()
        return drained

    def has_timed_out(self):
        return False

    def is_alive(self):
        return False

    def join_after_completion(self, timeout=1.0):
        self.reaped += 1
        return True

    def cancel_and_stop(self, **_kwargs):
        self.stopped += 1
        return True


class _FakeRequest:
    """Minimal ASGI request that can report a client disconnect on demand."""

    def __init__(self, *, disconnect_after: int | None = None):
        self.calls = 0
        self._disconnect_after = disconnect_after

    async def is_disconnected(self) -> bool:
        self.calls += 1
        if self._disconnect_after is None:
            return False
        return self.calls > self._disconnect_after


def _endpoint(endpoints, path: str):
    try:
        return endpoints[path]
    except KeyError:  # pragma: no cover - fail loudly with context
        raise AssertionError(
            f"missing route {path}; registered POST routes: {sorted(endpoints)}"
        ) from None


async def _await_until(predicate, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        await anyio.sleep(0.02)
    return predicate()


def _wait_until(predicate, timeout: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def _sse_events(text: str) -> list[str]:
    return [
        line[len("event: "):]
        for line in text.splitlines()
        if line.startswith("event: ")
    ]


async def _cancel_scope_after(scope, delay: float) -> None:
    await anyio.sleep(delay)
    scope.cancel()


async def _stream_until_cancelled(endpoint, query: str, controller, *, delay: float = 0.4):
    """Consume the SSE stream inside a cancel scope, then cancel like a client.

    A cancelled AnyIO scope re-raises ``CancelledError`` at every await point,
    which is exactly the scope ``StreamingResponse`` runs its finalizer in.
    """
    payload = AiAskRequest(query=query)
    response = await endpoint(
        payload,
        _FakeRequest(),
        context=_CONTEXT,
        authorization=AuthorizationService(),
    )
    stream = response.body_iterator
    with anyio.CancelScope() as scope:
        async with anyio.create_task_group() as group:
            group.start_soon(_cancel_scope_after, scope, delay)
            async for _chunk in stream:
                pass
    return await _await_until(lambda: controller.snapshot() == (0, 0))


class AIAskResourceLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(
            os.environ,
            {
                "APP_ENV": "development",
                "APP_SECRET_KEY": "ai-ask-resource-lifecycle-secret",
                "PUBLIC_CATALOG_PROFILE": "internal",
            },
            clear=False,
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(shutdown_cleanup_pool)

    def _app(self, *, search=None):
        """Build the default (isolated) app and resolve its POST endpoints.

        FastAPI 0.142 keeps included routers lazily in ``app.routes``, so the
        router objects are captured while the app is assembled.
        """
        routers: list = []
        original_include = FastAPI.include_router

        def capture(inner_self, router, *args, **kwargs):
            routers.append(router)
            return original_include(inner_self, router, *args, **kwargs)

        with patch.object(FastAPI, "include_router", capture):
            app = create_fastapi_app(
                capabilities=resolve_capabilities(),
                identity_resolver=lambda _request: None,
                search_provider_instance=search,
                authorization_service_instance=AuthorizationService(),
                openapi_enabled=True,
            )
        endpoints: dict = {}
        for router in routers:
            for route in getattr(router, "routes", ()):
                path = getattr(route, "path", None)
                if path and "POST" in getattr(route, "methods", ()):
                    endpoints[path] = route.endpoint
        return app, endpoints

    def _patched(self, controller, worker_class):
        return (
            patch("backend.app.fastapi.routers.ai_ask.ai_ask_admission", controller),
            patch("backend.app.fastapi.routers.ai_ask.AIAskProcessWorker", worker_class),
        )

    # -- 1. repeated SSE cancellation -----------------------------------
    def test_repeated_sse_cancellation_reaps_every_worker_and_frees_admission(self):
        controller = AIAskAdmissionController(max_concurrent=2, max_queued=2)
        instances: list = []
        worker_class = _injected_worker(instances, timeout_seconds=30)
        app, endpoints = self._app()
        endpoint = _endpoint(endpoints, "/api/ai/ask/stream")

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            for attempt in range(3):
                with self.subTest(attempt=attempt + 1):
                    released = anyio.run(
                        _stream_until_cancelled, endpoint, "连续取消合成问题", controller
                    )
                    self.assertTrue(released, "admission slot must be released after cancel")
                    self.assertEqual((0, 0), controller.snapshot())
                    self.assertEqual(attempt + 1, len(instances))
                    worker = instances[-1]
                    self.assertFalse(
                        worker.process.is_alive(), "child process must be reaped"
                    )
                    self.assertIsNotNone(
                        worker.process.exitcode, "child process must have exited"
                    )

    # -- 2. two concurrent cancellations still admit a new request ------
    def test_two_cancelled_requests_leave_admission_available(self):
        controller = AIAskAdmissionController(max_concurrent=2, max_queued=2)
        instances: list = []
        worker_class = _injected_worker(
            instances,
            stream_target=_child_blocked_in_jdbc,
            progress_target=_child_result_then_exit,
            timeout_seconds=30,
        )
        app, endpoints = self._app()
        stream_endpoint = _endpoint(endpoints, "/api/ai/ask/stream")
        json_endpoint = _endpoint(endpoints, "/api/ai/ask")

        async def scenario():
            payload = AiAskRequest(query="并发取消合成问题")
            streams = []
            for _ in range(2):
                response = await stream_endpoint(
                    payload,
                    _FakeRequest(),
                    context=_CONTEXT,
                    authorization=AuthorizationService(),
                )
                streams.append(response.body_iterator)

            with anyio.CancelScope() as scope:
                async with anyio.create_task_group() as group:
                    group.start_soon(_cancel_scope_after, scope, 0.5)
                    for stream in streams:
                        async for _chunk in stream:
                            pass

            self.assertTrue(
                await _await_until(lambda: controller.snapshot() == (0, 0)),
                f"both slots must be released, got {controller.snapshot()}",
            )
            admitted = json_endpoint(
                AiAskRequest(query="取消后新请求"),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            return admitted

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            admitted = anyio.run(scenario)

        self.assertEqual("answered", admitted.status)
        self.assertEqual(_ANSWER_TEXT, admitted.answer)
        self.assertEqual((0, 0), controller.snapshot())
        self.assertTrue(
            all(not worker.process.is_alive() for worker in instances),
            "no child process may survive the cancellation storm",
        )

    # -- 3. abrupt client disconnect ------------------------------------
    def test_abrupt_client_disconnect_reaps_worker_and_frees_admission(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        instances: list = []
        worker_class = _injected_worker(instances, timeout_seconds=30)
        app, endpoints = self._app()
        endpoint = _endpoint(endpoints, "/api/ai/ask/stream")

        async def scenario():
            response = await endpoint(
                AiAskRequest(query="断连合成问题"),
                _FakeRequest(disconnect_after=1),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            chunks = [chunk async for chunk in response.body_iterator]
            return chunks, await _await_until(lambda: controller.snapshot() == (0, 0))

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            chunks, released = anyio.run(scenario)

        self.assertTrue(released, "disconnect must free the admission slot")
        self.assertEqual([], chunks)
        self.assertEqual((0, 0), controller.snapshot())
        self.assertEqual(1, len(instances))
        self.assertFalse(instances[0].process.is_alive())
        self.assertIsNotNone(instances[0].process.exitcode)

    # -- 4a. exited worker with queued result (reviewer reproduction) ----
    def test_exited_worker_with_queued_result_returns_the_real_answer(self):
        controller = AIAskAdmissionController(max_concurrent=2, max_queued=2)
        app, endpoints = self._app()

        admission_patch = patch(
            "backend.app.fastapi.routers.ai_ask.ai_ask_admission", controller
        )
        worker_patch = patch(
            "backend.app.fastapi.routers.ai_ask.AIAskProcessWorker", _QueuedResultWorker
        )
        with admission_patch, worker_patch:
            client = TestClient(app)
            json_response = client.post("/api/ai/ask", json={"query": "队列残留合成问题"})
            stream_response = client.post(
                "/api/ai/ask/stream", json={"query": "队列残留流式问题"}
            )
            progress_response = client.post(
                "/api/ai/ask/progress", json={"query": "队列残留进度问题"}
            )

        self.assertEqual(200, json_response.status_code)
        self.assertEqual("answered", json_response.json()["status"])
        self.assertEqual(_ANSWER_TEXT, json_response.json()["answer"])
        self.assertIn('"status":"completed"', stream_response.text)
        self.assertEqual(1, stream_response.text.count("event: answer\n"))
        self.assertIn("event: result\n", progress_response.text)
        self.assertIn(_ANSWER_TEXT, progress_response.text)
        self.assertEqual((0, 0), controller.snapshot())

    # -- 4b. real child that exits before the parent reads the queue -----
    def test_real_child_that_exits_before_the_first_read_still_returns_result(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        instances: list = []
        worker_class = _injected_worker(
            instances,
            progress_target=_child_result_then_exit,
            timeout_seconds=30,
            first_message_none=True,
        )
        app, endpoints = self._app()
        endpoint = _endpoint(endpoints, "/api/ai/ask")

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            response = endpoint(
                AiAskRequest(query="子进程先退出合成问题"),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )

        self.assertEqual("answered", response.status)
        self.assertEqual(_ANSWER_TEXT, response.answer)
        self.assertEqual(1, len(instances))
        self.assertIsNotNone(instances[0].process.exitcode)
        self.assertEqual((0, 0), controller.snapshot())

    # -- 5. long blocking JDBC read -------------------------------------
    def test_blocking_jdbc_read_is_killed_by_the_worker_deadline(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        instances: list = []
        worker_class = _injected_worker(
            instances,
            stream_target=_child_blocked_in_jdbc,
            progress_target=_child_blocked_in_jdbc,
            timeout_seconds=1,
        )
        app, endpoints = self._app()
        json_endpoint = _endpoint(endpoints, "/api/ai/ask")

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            started = time.monotonic()
            response = json_endpoint(
                AiAskRequest(query="JDBC 阻塞合成问题"),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            elapsed = time.monotonic() - started

        self.assertEqual("retrieval_unavailable", response.status)
        self.assertEqual("retrieval_timeout", response.reason_code)
        self.assertLess(elapsed, 10.0, "the deadline must terminate the blocked child")
        self.assertEqual(1, len(instances))
        self.assertFalse(instances[0].process.is_alive())
        self.assertIsNotNone(instances[0].process.exitcode)
        self.assertEqual((0, 0), controller.snapshot())

    def test_blocking_jdbc_read_ends_the_sse_stream_with_a_terminal_event(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        instances: list = []
        worker_class = _injected_worker(instances, timeout_seconds=1)
        app, endpoints = self._app()
        endpoint = _endpoint(endpoints, "/api/ai/ask/stream")

        async def scenario():
            response = await endpoint(
                AiAskRequest(query="JDBC 阻塞流式问题"),
                _FakeRequest(),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            return "".join([chunk async for chunk in response.body_iterator])

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            text = anyio.run(scenario)

        events = _sse_events(text)
        self.assertIn("done", events)
        self.assertIn('"status":"failed"', text)
        self.assertEqual(1, events.count("done"))
        self.assertEqual(1, len(instances))
        self.assertFalse(instances[0].process.is_alive())
        self.assertEqual((0, 0), controller.snapshot())

    # -- 6. worker timeout and abnormal exit -----------------------------
    def test_worker_crash_terminates_quickly_and_releases_admission(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=1)
        instances: list = []
        worker_class = _injected_worker(
            instances,
            stream_target=_child_crashes,
            progress_target=_child_crashes,
            timeout_seconds=30,
        )
        app, endpoints = self._app()
        json_endpoint = _endpoint(endpoints, "/api/ai/ask")

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            started = time.monotonic()
            response = json_endpoint(
                AiAskRequest(query="子进程崩溃合成问题"),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            elapsed = time.monotonic() - started

        self.assertEqual("generation_unavailable", response.status)
        self.assertEqual("llm_unavailable", response.reason_code)
        # The worker deadline is 30s, so finishing well below it proves the
        # exit was detected from the dead child instead of waiting out the
        # deadline (Windows spawn boot time dominates the remainder).
        self.assertLess(
            elapsed, 25.0, "an abnormal exit must not wait for the worker deadline"
        )
        self.assertEqual(3, instances[0].process.exitcode)
        self.assertEqual((0, 0), controller.snapshot())

    # -- 7. repeated cancellation / repeated cleanup ---------------------
    def test_guard_cleanup_is_idempotent_and_never_double_releases(self):
        controller = AIAskAdmissionController(max_concurrent=1, max_queued=0)
        lease = controller.reserve()
        self.assertEqual((1, 0), controller.snapshot())
        guard = AIAskRequestGuard(lease)

        self.assertIsNone(guard.begin_cleanup())
        self.assertTrue(guard.wait_closed(5))
        self.assertEqual((0, 0), controller.snapshot())
        self.assertFalse(guard.release_once(), "second release must be a no-op")
        lease.release()
        guard.close()
        guard.begin_cleanup()
        self.assertEqual((0, 0), controller.snapshot())

    def test_repeated_worker_stop_is_idempotent_and_bounded(self):
        instances: list = []
        worker_class = _injected_worker(instances, timeout_seconds=30)
        worker = worker_class(mode="stream", payload={}, profile="internal")
        worker.start()
        self.assertTrue(_wait_until(lambda: worker.is_alive(), 10))
        try:
            self.assertTrue(worker.cancel_and_stop())
            self.assertTrue(worker.cancel_and_stop())
            self.assertFalse(worker.is_alive())
            self.assertIsNotNone(worker.process.exitcode)
        finally:
            worker.cancel_and_stop()

    def test_repeated_sse_cancellation_keeps_the_protocol_stable(self):
        controller = AIAskAdmissionController(max_concurrent=2, max_queued=2)
        instances: list = []
        worker_class = _injected_worker(
            instances,
            stream_target=_child_stream_answer,
            progress_target=_child_result_then_exit,
            timeout_seconds=30,
        )
        app, endpoints = self._app()
        stream_endpoint = _endpoint(endpoints, "/api/ai/ask/stream")
        progress_endpoint = _endpoint(endpoints, "/api/ai/ask/progress")

        async def cancel_twice():
            for _ in range(2):
                await _stream_until_cancelled(
                    stream_endpoint, "重复取消协议合成问题", controller
                )
            progress_response = await progress_endpoint(
                AiAskRequest(query="取消后进度问题"),
                _FakeRequest(),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            progress_text = "".join(
                [chunk async for chunk in progress_response.body_iterator]
            )
            return progress_text

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            progress_text = anyio.run(cancel_twice)
            client = TestClient(app)
            json_response = client.post("/api/ai/ask", json={"query": "取消后 JSON 问题"})
            stream_response = client.post(
                "/api/ai/ask/stream", json={"query": "取消后流式问题"}
            )

        self.assertEqual(200, json_response.status_code)
        payload = json_response.json()
        for key in (
            "status",
            "answer",
            "candidates",
            "citations",
            "retrievalStatus",
            "generationStatus",
        ):
            self.assertIn(key, payload)
        self.assertEqual("answered", payload["status"])
        self.assertEqual(1, stream_response.text.count("event: answer\n"))
        self.assertEqual(1, stream_response.text.count("event: done\n"))
        self.assertIn('"status":"completed"', stream_response.text)
        self.assertIn("event: result\n", progress_text)
        self.assertEqual((0, 0), controller.snapshot())

    # -- 9. ordinary APIs stay responsive while an AI child blocks ------
    def test_ordinary_api_is_not_blocked_by_a_blocked_ai_worker(self):
        controller = AIAskAdmissionController(max_concurrent=2, max_queued=2)
        instances: list = []
        worker_class = _injected_worker(instances, timeout_seconds=30)
        search = MagicMock()
        search.search.return_value = {
            "query": "ordinary",
            "scope": "all",
            "groups": [],
            "total": 0,
        }
        app, endpoints = self._app(search=search)
        endpoint = _endpoint(endpoints, "/api/ai/ask/stream")

        async def scenario():
            response = await endpoint(
                AiAskRequest(query="阻塞期间普通 API 合成问题"),
                _FakeRequest(),
                context=_CONTEXT,
                authorization=AuthorizationService(),
            )
            stream = response.body_iterator
            await stream.__anext__()
            self.assertTrue(
                await _await_until(lambda: controller.snapshot() == (1, 0), 10),
                "the AI worker must hold exactly one admission slot",
            )
            client = TestClient(app)
            started = time.monotonic()
            ordinary = await anyio.to_thread.run_sync(
                client.get, "/api/search?q=ordinary"
            )
            elapsed = time.monotonic() - started
            await stream.aclose()
            await _await_until(lambda: controller.snapshot() == (0, 0))
            return ordinary, elapsed

        admission_patch, worker_patch = self._patched(controller, worker_class)
        with admission_patch, worker_patch:
            ordinary, elapsed = anyio.run(scenario)

        self.assertEqual(200, ordinary.status_code)
        self.assertLess(elapsed, 10.0, "ordinary API must not wait for the AI worker")
        search.search.assert_called_once_with(
            "ordinary", scope="all", limit="5", profile="internal"
        )
        self.assertEqual((0, 0), controller.snapshot())


if __name__ == "__main__":
    unittest.main()
