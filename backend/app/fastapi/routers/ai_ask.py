"""Optional single-turn AI metadata Q&A endpoints."""

from __future__ import annotations

import asyncio
import collections
import json
import logging
import threading
import time
import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import StreamingResponse

from ...application import RequestContext
from ...contracts.ai_ask import AiAskAvailability, AiAskRequest, AiAskResponse
from ...services.ai_ask_admission import AIAskAdmissionLease, ai_ask_admission
from ...services.ai_ask_service import AIAskCancelled, AIAskService
from ...services.ai_ask_execution_service import AIAskExecutionService
from ...services.ai_ask_request_guard import (
    AIAskRequestGuard,
    defer_release_until,
)
from ...services.ai_ask_worker import (
    AIAskProcessWorker,
    EXIT_DRAIN_BUDGET_SECONDS,
    EXIT_GRACE_SECONDS,
)
from ..dependencies import (
    get_authorization_service,
    get_request_context,
    require_public_catalog_access,
)
from ..public_catalog import profile_for_request

LOGGER = logging.getLogger(__name__)


def _sse_message(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def _busy_response() -> AiAskResponse:
    return AiAskResponse(
        status="generation_unavailable",
        answer="当前 AI 问答资源繁忙，请稍后重试。",
        candidates=[],
        citations=[],
        retrievalStatus="not_run",
        generationStatus="unavailable",
        reasonCode="llm_busy",
        elapsedMs=0,
    )


def _timeout_response(query: str, *, stage: str | None, elapsed_ms: float) -> AiAskResponse:
    if stage == "metadata-count":
        return AiAskResponse(
            status="metadata_count_unavailable",
            answer="DAP 目录统计超过本次问答时限；未返回未核实的统计结果，请稍后重试。",
            candidates=[],
            citations=[],
            retrievalStatus="not_run",
            generationStatus="not_run",
            reasonCode="metadata_count_unavailable",
            elapsedMs=max(0.0, elapsed_ms),
        )
    if stage in {"planning", "organizing", "generating"}:
        return AiAskResponse(
            status="generation_unavailable",
            answer="AI 问答生成超过本次时限，请稍后重试。",
            candidates=[],
            citations=[],
            retrievalStatus="unavailable",
            generationStatus="unavailable",
            reasonCode="llm_timeout",
            elapsedMs=max(0.0, elapsed_ms),
        )
    return AiAskResponse(
        status="retrieval_unavailable",
        answer="DAP 目录检索超过本次时限，隔离执行进程已终止；未基于未核实数据回答，请稍后重试。",
        candidates=[],
        citations=[],
        retrievalStatus="unavailable",
        generationStatus="not_run",
        reasonCode="retrieval_timeout",
        elapsedMs=max(0.0, elapsed_ms),
    )


def _generic_failure_response() -> AiAskResponse:
    return AiAskResponse(
        status="generation_unavailable",
        answer="AI 问答暂不可用，请稍后重试。",
        candidates=[],
        citations=[],
        retrievalStatus="not_run",
        generationStatus="unavailable",
        reasonCode="llm_unavailable",
        elapsedMs=0,
    )


async def _wait_for_admission(
    lease: AIAskAdmissionLease,
    request: Request,
) -> tuple[bool, bool]:
    """Wait fairly without occupying an executor thread; return (admitted, disconnected)."""
    deadline = time.monotonic() + ai_ask_admission.queue_wait_ms / 1000
    while not lease.active:
        if await request.is_disconnected():
            lease.cancel()
            return False, True
        if time.monotonic() >= deadline:
            lease.cancel()
            return False, False
        await asyncio.sleep(0.025)
    return True, False


def _observe_database_step(event: str, data: dict[str, Any], active: dict[str, float]) -> None:
    step_id = data.get("step_id")
    if not isinstance(step_id, str):
        return
    if event == "step_start":
        step_data = data.get("data")
        if isinstance(step_data, dict) and step_data.get("phase") == "database":
            active[step_id] = time.monotonic()
    elif event in {"step_complete", "step_error"}:
        active.pop(step_id, None)


def _slow_database_step(active: dict[str, float], timeout_seconds: int) -> str | None:
    now = time.monotonic()
    timed_out = [
        (step_id, started)
        for step_id, started in active.items()
        if now - started >= timeout_seconds * (4 if step_id == "metadata-count" else 2) + 2
    ]
    return min(timed_out, key=lambda item: item[1])[0] if timed_out else None


async def _recover_exited_worker_messages(worker: Any, pending: collections.deque) -> bool:
    """Buffer records that an already-exited child still has queued.

    ``is_alive() == False`` is not proof of failure: the child may have queued
    its ``result`` and ``__end__`` records just before exiting. Recovering them
    keeps a completed request from being answered with ``llm_unavailable``.
    """
    leftover = await asyncio.to_thread(
        worker.drain_messages,
        budget_seconds=EXIT_DRAIN_BUDGET_SECONDS,
    )
    if not leftover:
        return False
    pending.extend(leftover)
    return True


def _register_ai_ask_routes(
    app: FastAPI,
    ai_ask_service: AIAskService | Any,
    ai_ask_execution_service: AIAskExecutionService | Any | None = None,
    *,
    isolate_execution: bool = False,
) -> None:
    router = APIRouter(
        prefix="/api/ai",
        tags=["ai-ask-native"],
        dependencies=[Depends(require_public_catalog_access)],
    )

    @router.get("/status", response_model=AiAskAvailability)
    def get_ai_ask_status():
        try:
            enabled = bool(ai_ask_service.enabled())
        except Exception:
            # Configuration errors fail closed and never disclose deployment data.
            enabled = False
        return AiAskAvailability(enabled=enabled)

    @router.post("/ask/progress")
    async def ask_ai_with_progress(
        payload: AiAskRequest,
        request: Request,
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        profile = profile_for_request(context, authorization)

        async def event_stream():
            loop = asyncio.get_running_loop()
            queue: asyncio.Queue[tuple[str, dict[str, Any] | None]] = asyncio.Queue()
            cancel_event = threading.Event()
            lease = ai_ask_admission.reserve()
            if lease is None:
                yield _sse_message("result", _busy_response().model_dump(by_alias=True))
                return
            guard = AIAskRequestGuard(lease)
            worker: AIAskProcessWorker | None = None
            local_worker: asyncio.Task | None = None
            pending: collections.deque = collections.deque()
            response: AiAskResponse | None = None

            def enqueue(event: str, data: dict[str, Any] | None) -> None:
                if loop.is_closed():
                    return
                try:
                    loop.call_soon_threadsafe(queue.put_nowait, (event, data))
                except RuntimeError:
                    return

            def report_progress(step) -> None:
                enqueue("progress", step.model_dump(by_alias=True, exclude_none=True))

            def run_ask() -> None:
                try:
                    result = ai_ask_service.ask(
                        payload,
                        profile=profile,
                        progress_callback=report_progress,
                        cancel_event=cancel_event,
                    )
                except AIAskCancelled:
                    result = None
                except Exception:
                    LOGGER.warning("AI ask progress execution failed without provider details")
                    result = _generic_failure_response()
                if result is not None:
                    enqueue("result", result.model_dump(by_alias=True))
                enqueue("__end__", None)

            try:
                admitted, disconnected = await _wait_for_admission(lease, request)
                if disconnected:
                    return
                if not admitted:
                    yield _sse_message("result", _busy_response().model_dump(by_alias=True))
                    return
                if isolate_execution:
                    worker = AIAskProcessWorker(
                        mode="progress",
                        payload=payload.model_dump(by_alias=True),
                        profile=profile,
                    )
                    guard.attach_worker(worker)
                    try:
                        await asyncio.to_thread(worker.start)
                    except Exception:
                        LOGGER.warning("AI ask progress worker failed to start")
                        yield _sse_message("result", _generic_failure_response().model_dump(by_alias=True))
                        return
                else:
                    local_worker = asyncio.create_task(asyncio.to_thread(run_ask))

                active_step: dict[str, Any] | None = None
                active_started = 0.0
                last_heartbeat = 0.0
                dead_since: float | None = None
                while True:
                    if await request.is_disconnected():
                        # Teardown happens in the finalizer thread so an
                        # already-cancelled scope cannot skip worker reaping
                        # or the admission release.
                        cancel_event.set()
                        return
                    if not queue.empty():
                        event, data = queue.get_nowait()
                    elif worker is not None:
                        if pending:
                            message = pending.popleft()
                        else:
                            message = await asyncio.to_thread(worker.get_message, 0.1)
                        if message is None:
                            if worker.has_timed_out():
                                elapsed_ms = worker.timeout_seconds * 1000
                                LOGGER.warning(
                                    "AI ask worker terminated reason=worker_timeout elapsed_ms=%.2f",
                                    elapsed_ms,
                                )
                                progress_stage = active_step.get("id") if active_step else None
                                timeout_stage = {
                                    "counting": "metadata-count",
                                    "organizing": "organizing",
                                    "generating": "generating",
                                }.get(progress_stage, progress_stage)
                                response = _timeout_response(
                                    payload.query,
                                    stage=timeout_stage,
                                    elapsed_ms=elapsed_ms,
                                )
                                if await asyncio.to_thread(worker.cancel_and_stop):
                                    guard.detach_worker()
                                    worker = None
                                yield _sse_message("result", response.model_dump(by_alias=True))
                                break
                            if not worker.is_alive():
                                if await _recover_exited_worker_messages(worker, pending):
                                    dead_since = None
                                    continue
                                if dead_since is None:
                                    dead_since = time.monotonic()
                                elif time.monotonic() - dead_since > EXIT_GRACE_SECONDS:
                                    LOGGER.warning(
                                        "AI ask progress worker exited without a terminal message"
                                    )
                                    yield _sse_message("result", _generic_failure_response().model_dump(by_alias=True))
                                    break
                                continue
                            if active_step is not None and time.monotonic() - last_heartbeat >= 1.0:
                                heartbeat = dict(active_step)
                                heartbeat["elapsedMs"] = max(
                                    0.0, (time.monotonic() - active_started) * 1000
                                )
                                yield _sse_message("progress", heartbeat)
                                last_heartbeat = time.monotonic()
                            continue
                        kind = message[0]
                        if kind == "progress":
                            event, data = "progress", message[1]
                        elif kind == "result":
                            response = AiAskResponse.model_validate(message[1])
                            event, data = "result", response.model_dump(by_alias=True)
                        elif kind == "__end__":
                            if await asyncio.to_thread(worker.join_after_completion):
                                guard.detach_worker()
                                worker = None
                            break
                        elif kind == "cancelled":
                            continue
                        else:
                            continue
                    else:
                        try:
                            event, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            if local_worker is not None and local_worker.done() and queue.empty():
                                break
                            if active_step is not None and time.monotonic() - last_heartbeat >= 1.0:
                                heartbeat = dict(active_step)
                                heartbeat["elapsedMs"] = max(
                                    0.0, (time.monotonic() - active_started) * 1000
                                )
                                yield _sse_message("progress", heartbeat)
                                last_heartbeat = time.monotonic()
                            continue

                    if event == "__end__":
                        if local_worker is not None:
                            await local_worker
                        break
                    if data is None:
                        continue
                    if event == "progress":
                        if data.get("status") == "running":
                            active_step = data
                            active_started = time.monotonic()
                            last_heartbeat = active_started
                        elif active_step is not None and data.get("id") == active_step.get("id"):
                            active_step = None
                    yield _sse_message(event, data)
            finally:
                cancel_event.set()
                if local_worker is not None and not local_worker.done():
                    # An injected in-process worker cannot be killed: the lease
                    # is released only once it really exits.
                    defer_release_until(guard, local_worker)
                else:
                    # Bounded, idempotent, and independent of this cancelled scope.
                    guard.begin_cleanup()

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/ask/stream")
    async def ask_ai_stream(
        payload: AiAskRequest,
        request: Request,
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        profile = profile_for_request(context, authorization)
        request_id = uuid.uuid4().hex
        execution_service = ai_ask_execution_service or ai_ask_service

        async def event_stream():
            loop = asyncio.get_running_loop()
            queue: asyncio.Queue[tuple[str, dict[str, Any] | None]] = asyncio.Queue()
            cancel_event = threading.Event()
            step_ids: set[str] = set()
            answer_emitted = False
            step_lock = threading.Lock()
            lease = ai_ask_admission.reserve()
            if lease is None:
                response = _busy_response()
                yield _sse_message("answer", {
                    "request_id": request_id,
                    "step_id": "answer",
                    "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "message": response.answer,
                    "data": {"response": response.model_dump(by_alias=True)},
                })
                yield _sse_message("done", {
                    "request_id": request_id,
                    "step_id": "done",
                    "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                    "message": response.answer,
                    "data": {"status": "failed", "stepCount": 0, "reasonCode": "llm_busy"},
                })
                return
            guard = AIAskRequestGuard(lease)
            worker: AIAskProcessWorker | None = None
            local_worker: asyncio.Task | None = None
            pending: collections.deque = collections.deque()
            result_response: AiAskResponse | None = None
            cancelled = False

            def enqueue(event: str, data: dict[str, Any] | None) -> None:
                if loop.is_closed():
                    return
                try:
                    loop.call_soon_threadsafe(queue.put_nowait, (event, data))
                except RuntimeError:
                    return

            def report_execution(event: str, data: dict[str, Any]) -> None:
                nonlocal answer_emitted
                step_id = data.get("step_id")
                with step_lock:
                    if event == "answer":
                        if answer_emitted:
                            return
                        answer_emitted = True
                    elif isinstance(step_id, str) and step_id not in {"answer", "done"}:
                        step_ids.add(step_id)
                enqueue(event, data)

            def run_ask() -> None:
                try:
                    if hasattr(execution_service, "ask") and execution_service is not ai_ask_service:
                        result = execution_service.ask(
                            payload,
                            profile=profile,
                            request_id=request_id,
                            event_callback=report_execution,
                            cancel_event=cancel_event,
                        )
                    else:
                        result = ai_ask_service.ask(
                            payload,
                            profile=profile,
                            progress_callback=None,
                            cancel_event=cancel_event,
                        )
                        timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                        report_execution("answer", {
                            "request_id": request_id,
                            "step_id": "answer",
                            "timestamp": timestamp,
                            "message": "已返回兼容问答结果。",
                            "data": {"response": result.model_dump(by_alias=True)},
                        })
                except AIAskCancelled:
                    result = None
                except Exception:
                    LOGGER.warning("AI ask stream execution failed without provider details")
                    result = _generic_failure_response()
                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    report_execution("answer", {
                        "request_id": request_id,
                        "step_id": "answer",
                        "timestamp": timestamp,
                        "message": "问答未能完成。",
                        "data": {"response": result.model_dump(by_alias=True)},
                    })
                if result is not None:
                    with step_lock:
                        answer_sent = answer_emitted
                    if not answer_sent:
                        timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                        report_execution("answer", {
                            "request_id": request_id,
                            "step_id": "answer",
                            "timestamp": timestamp,
                            "message": "已返回问答结果。",
                            "data": {"response": result.model_dump(by_alias=True)},
                        })
                    success = result.status in {
                        "answered", "partial_answer", "insufficient_evidence", "metadata_count_answered",
                    }
                    with step_lock:
                        count = len(step_ids)
                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    done_data: dict[str, Any] = {
                        "status": "completed" if success else "failed",
                        "stepCount": count,
                    }
                    if result.reason_code:
                        done_data["reasonCode"] = result.reason_code
                    enqueue("done", {
                        "request_id": request_id,
                        "step_id": "done",
                        "timestamp": timestamp,
                        "message": "问答执行完成。" if success else "问答执行失败。",
                        "data": done_data,
                    })
                else:
                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    enqueue("done", {
                        "request_id": request_id,
                        "step_id": "done",
                        "timestamp": timestamp,
                        "message": "问答请求已取消。",
                        "data": {"status": "cancelled", "stepCount": len(step_ids)},
                    })
                enqueue("__end__", None)

            try:
                admitted, disconnected = await _wait_for_admission(lease, request)
                if disconnected:
                    return
                if not admitted:
                    response = _busy_response()
                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                    yield _sse_message("answer", {
                        "request_id": request_id,
                        "step_id": "answer",
                        "timestamp": timestamp,
                        "message": response.answer,
                        "data": {"response": response.model_dump(by_alias=True)},
                    })
                    yield _sse_message("done", {
                        "request_id": request_id,
                        "step_id": "done",
                        "timestamp": timestamp,
                        "message": response.answer,
                        "data": {"status": "failed", "stepCount": 0, "reasonCode": "llm_busy"},
                    })
                    return

                process_terminal = False
                if isolate_execution:
                    worker = AIAskProcessWorker(
                        mode="stream",
                        payload=payload.model_dump(by_alias=True),
                        profile=profile,
                        request_id=request_id,
                    )
                    guard.attach_worker(worker)
                    try:
                        await asyncio.to_thread(worker.start)
                    except Exception:
                        LOGGER.warning("AI ask stream worker failed to start")
                        result_response = _generic_failure_response()
                        process_terminal = True
                        timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                        report_execution("answer", {
                            "request_id": request_id,
                            "step_id": "answer",
                            "timestamp": timestamp,
                            "message": result_response.answer,
                            "data": {"response": result_response.model_dump(by_alias=True)},
                        })
                        enqueue("done", {
                            "request_id": request_id,
                            "step_id": "done",
                            "timestamp": timestamp,
                            "message": "问答执行失败。",
                            "data": {"status": "failed", "stepCount": 0, "reasonCode": "llm_unavailable"},
                        })
                        enqueue("__end__", None)
                else:
                    local_worker = asyncio.create_task(asyncio.to_thread(run_ask))

                last_keepalive = time.monotonic()
                active_database_steps: dict[str, float] = {}
                active_worker_stage: str | None = None
                worker_started = time.monotonic()
                dead_since: float | None = None
                while True:
                    if await request.is_disconnected():
                        # Teardown happens in the finalizer thread so an
                        # already-cancelled scope cannot skip worker reaping
                        # or the admission release.
                        cancel_event.set()
                        return
                    if not queue.empty():
                        event, data = queue.get_nowait()
                    elif worker is not None and not process_terminal:
                        if pending:
                            message = pending.popleft()
                        else:
                            message = await asyncio.to_thread(worker.get_message, 0.1)
                        if message is None:
                            stage = _slow_database_step(
                                active_database_steps,
                                worker.database_timeout_seconds,
                            )
                            if stage is not None or worker.has_timed_out():
                                timed_stage = (
                                    stage
                                    or next(iter(active_database_steps), None)
                                    or active_worker_stage
                                )
                                elapsed_ms = max(0.0, (time.monotonic() - worker_started) * 1000)
                                LOGGER.warning(
                                    "AI ask worker terminated reason=%s stage=%s elapsed_ms=%.2f database_timeout_seconds=%s",
                                    "database_phase_timeout" if stage else "worker_timeout",
                                    timed_stage or "unknown",
                                    elapsed_ms,
                                    worker.database_timeout_seconds,
                                )
                                result_response = _timeout_response(
                                    payload.query,
                                    stage=timed_stage,
                                    elapsed_ms=elapsed_ms,
                                )
                                process_terminal = True
                                if await asyncio.to_thread(worker.cancel_and_stop):
                                    guard.detach_worker()
                                    worker = None
                                timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                                if not answer_emitted:
                                    report_execution("answer", {
                                        "request_id": request_id,
                                        "step_id": "answer",
                                        "timestamp": timestamp,
                                        "message": result_response.answer,
                                        "data": {"response": result_response.model_dump(by_alias=True)},
                                    })
                                done_data = {
                                    "status": "failed",
                                    "stepCount": len(step_ids),
                                    "reasonCode": result_response.reason_code,
                                }
                                enqueue("done", {
                                    "request_id": request_id,
                                    "step_id": "done",
                                    "timestamp": timestamp,
                                    "message": result_response.answer,
                                    "data": done_data,
                                })
                                enqueue("__end__", None)
                                continue
                            if not worker.is_alive():
                                if await _recover_exited_worker_messages(worker, pending):
                                    dead_since = None
                                    continue
                                if dead_since is None:
                                    dead_since = time.monotonic()
                                elif time.monotonic() - dead_since > EXIT_GRACE_SECONDS:
                                    LOGGER.warning(
                                        "AI ask stream worker exited without a terminal message"
                                    )
                                    result_response = _generic_failure_response()
                                    process_terminal = True
                                    if not answer_emitted:
                                        timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                                        report_execution("answer", {
                                            "request_id": request_id,
                                            "step_id": "answer",
                                            "timestamp": timestamp,
                                            "message": result_response.answer,
                                            "data": {"response": result_response.model_dump(by_alias=True)},
                                        })
                                    enqueue("done", {
                                        "request_id": request_id,
                                        "step_id": "done",
                                        "timestamp": datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                                        "message": "问答执行失败。",
                                        "data": {"status": "failed", "stepCount": len(step_ids), "reasonCode": "llm_unavailable"},
                                    })
                                    enqueue("__end__", None)
                                continue
                            if time.monotonic() - last_keepalive >= 15:
                                yield ": keep-alive\n\n"
                                last_keepalive = time.monotonic()
                            continue

                        kind = message[0]
                        if kind == "event":
                            _kind, child_event, child_data = message
                            if isinstance(child_data, dict):
                                _observe_database_step(child_event, child_data, active_database_steps)
                                if child_event == "step_start":
                                    active_worker_stage = child_data.get("step_id")
                                elif (
                                    child_event in {"step_complete", "step_error"}
                                    and child_data.get("step_id") == active_worker_stage
                                ):
                                    active_worker_stage = None
                                report_execution(child_event, child_data)
                            continue
                        if kind == "result":
                            result_response = AiAskResponse.model_validate(message[1])
                            continue
                        if kind == "cancelled":
                            cancelled = True
                            continue
                        if kind == "worker_error":
                            result_response = _generic_failure_response()
                            continue
                        if kind == "__end__":
                            process_terminal = True
                            if await asyncio.to_thread(worker.join_after_completion):
                                guard.detach_worker()
                                worker = None
                            if result_response is not None:
                                if not answer_emitted:
                                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                                    report_execution("answer", {
                                        "request_id": request_id,
                                        "step_id": "answer",
                                        "timestamp": timestamp,
                                        "message": "已返回问答结果。",
                                        "data": {"response": result_response.model_dump(by_alias=True)},
                                    })
                                success = result_response.status in {
                                    "answered", "partial_answer", "insufficient_evidence", "metadata_count_answered",
                                }
                                done_data = {"status": "completed" if success else "failed", "stepCount": len(step_ids)}
                                if result_response.reason_code:
                                    done_data["reasonCode"] = result_response.reason_code
                            elif cancelled:
                                done_data = {"status": "cancelled", "stepCount": len(step_ids)}
                            else:
                                result_response = _generic_failure_response()
                                if not answer_emitted:
                                    timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                                    report_execution("answer", {
                                        "request_id": request_id,
                                        "step_id": "answer",
                                        "timestamp": timestamp,
                                        "message": result_response.answer,
                                        "data": {"response": result_response.model_dump(by_alias=True)},
                                    })
                                done_data = {"status": "failed", "stepCount": len(step_ids), "reasonCode": "llm_unavailable"}
                            timestamp = datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
                            enqueue("done", {
                                "request_id": request_id,
                                "step_id": "done",
                                "timestamp": timestamp,
                                "message": "问答请求已取消。" if cancelled else ("问答执行完成。" if done_data["status"] == "completed" else "问答执行失败。"),
                                "data": done_data,
                            })
                            enqueue("__end__", None)
                            continue
                        continue
                    else:
                        if local_worker is not None and local_worker.done() and queue.empty():
                            break
                        try:
                            event, data = await asyncio.wait_for(queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            if time.monotonic() - last_keepalive >= 15:
                                yield ": keep-alive\n\n"
                                last_keepalive = time.monotonic()
                            continue

                    if event == "__end__":
                        if local_worker is not None:
                            await local_worker
                        break
                    if data is not None:
                        yield _sse_message(event, data)
            finally:
                cancel_event.set()
                if local_worker is not None and not local_worker.done():
                    # An injected in-process worker cannot be killed: the lease
                    # is released only once it really exits.
                    defer_release_until(guard, local_worker)
                else:
                    # Bounded, idempotent, and independent of this cancelled scope.
                    guard.begin_cleanup()

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @router.post("/ask", response_model=AiAskResponse)
    def ask_ai(
        payload: AiAskRequest,
        context: RequestContext = Depends(get_request_context),
        authorization: Any = Depends(get_authorization_service),
    ):
        profile = profile_for_request(context, authorization)
        lease = ai_ask_admission.acquire()
        if lease is None:
            return _busy_response()
        guard = AIAskRequestGuard(lease)
        pending: collections.deque = collections.deque()
        try:
            if isolate_execution:
                worker = AIAskProcessWorker(
                    mode="progress",
                    payload=payload.model_dump(by_alias=True),
                    profile=profile,
                )
                guard.attach_worker(worker)
                worker.start()
                started = time.monotonic()
                active_stage: str | None = None
                result: AiAskResponse | None = None
                dead_since: float | None = None
                while True:
                    message = pending.popleft() if pending else worker.get_message(0.1)
                    if message is not None:
                        if message[0] == "progress":
                            progress = message[1]
                            progress_id = progress.get("id") if isinstance(progress, dict) else None
                            progress_stage = {
                                "counting": "metadata-count",
                                "retrieving": "retrieving",
                                "organizing": "organizing",
                                "generating": "generating",
                            }.get(progress_id)
                            if isinstance(progress, dict) and progress.get("status") == "running":
                                active_stage = progress_stage or active_stage
                            elif progress_stage == active_stage:
                                active_stage = None
                        elif message[0] == "result":
                            result = AiAskResponse.model_validate(message[1])
                        elif message[0] == "__end__":
                            if worker.join_after_completion():
                                guard.detach_worker()
                            return result or _generic_failure_response()
                        dead_since = None
                        continue
                    if worker.has_timed_out():
                        elapsed_ms = (time.monotonic() - started) * 1000
                        LOGGER.warning(
                            "AI ask worker terminated reason=worker_timeout stage=%s elapsed_ms=%.2f",
                            active_stage or "unknown",
                            elapsed_ms,
                        )
                        if worker.cancel_and_stop():
                            guard.detach_worker()
                        return _timeout_response(
                            payload.query,
                            stage=active_stage,
                            elapsed_ms=elapsed_ms,
                        )
                    if worker.is_alive():
                        dead_since = None
                        continue
                    # The child exited, but ``is_alive() == False`` does not
                    # prove failure: its ``result``/``__end__`` records may
                    # still be readable. Recover them before deciding.
                    leftover = worker.drain_messages(
                        budget_seconds=EXIT_DRAIN_BUDGET_SECONDS
                    )
                    if leftover:
                        pending.extend(leftover)
                        dead_since = None
                        continue
                    if dead_since is None:
                        dead_since = time.monotonic()
                        continue
                    if time.monotonic() - dead_since >= EXIT_GRACE_SECONDS:
                        LOGGER.warning(
                            "AI ask JSON worker exited without a terminal message"
                        )
                        return result or _generic_failure_response()
            return ai_ask_service.ask(payload, profile=profile)
        except Exception:
            LOGGER.warning("AI ask failed without provider details")
            return _generic_failure_response()
        finally:
            # This is a sync endpoint running in a worker thread, so a bounded
            # synchronous teardown is safe and guarantees the child is reaped
            # and the admission slot is free before the response is returned.
            guard.close()

    app.include_router(router)
