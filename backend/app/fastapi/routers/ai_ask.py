"""Optional single-turn AI metadata Q&A endpoints."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from typing import Any

from fastapi import APIRouter, Depends, FastAPI, Request
from fastapi.responses import StreamingResponse

from ...application import RequestContext
from ...contracts.ai_ask import AiAskAvailability, AiAskRequest, AiAskResponse
from ...services.ai_ask_service import AIAskCancelled, AIAskService
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


def _register_ai_ask_routes(
    app: FastAPI,
    ai_ask_service: AIAskService | Any,
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
            terminal_event = ("__end__", None)

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
                    response = ai_ask_service.ask(
                        payload,
                        profile=profile,
                        progress_callback=report_progress,
                        cancel_event=cancel_event,
                    )
                except AIAskCancelled:
                    response = None
                except Exception:
                    LOGGER.warning("AI ask progress execution failed without provider details")
                    response = AiAskResponse(
                        status="generation_unavailable",
                        answer="AI 问答暂不可用，请稍后重试。",
                        candidates=[],
                        citations=[],
                        retrievalStatus="not_run",
                        generationStatus="unavailable",
                        reasonCode="llm_unavailable",
                        elapsedMs=0,
                    )
                if response is not None:
                    enqueue("result", response.model_dump(by_alias=True))
                enqueue(*terminal_event)

            worker = asyncio.create_task(asyncio.to_thread(run_ask))
            active_step: dict[str, Any] | None = None
            active_started = 0.0
            try:
                while True:
                    if await request.is_disconnected():
                        cancel_event.set()
                        return
                    try:
                        event, data = await asyncio.wait_for(queue.get(), timeout=1.0)
                    except asyncio.TimeoutError:
                        if active_step is not None:
                            heartbeat = dict(active_step)
                            heartbeat["elapsedMs"] = max(
                                0.0, (time.monotonic() - active_started) * 1000
                            )
                            yield _sse_message("progress", heartbeat)
                        if worker.done() and queue.empty():
                            break
                        continue
                    if event == "__end__":
                        await worker
                        break
                    if data is None:
                        continue
                    if event == "progress":
                        if data.get("status") == "running":
                            active_step = data
                            active_started = time.monotonic()
                        elif active_step is not None and data.get("id") == active_step.get("id"):
                            active_step = None
                    yield _sse_message(event, data)
            finally:
                if not worker.done():
                    cancel_event.set()

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
        try:
            return ai_ask_service.ask(payload, profile=profile)
        except Exception:
            LOGGER.warning("AI ask failed without exposing provider details")
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

    app.include_router(router)
