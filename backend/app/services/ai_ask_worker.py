"""Killable child-process boundary for AI execution that may enter JDBC."""

from __future__ import annotations

import logging
import multiprocessing
import os
import queue
import time
from collections.abc import Callable
from typing import Any

from ..contracts.ai_ask import AiAskProgressStep, AiAskRequest, AiAskResponse
from ..settings import (
    get_ai_ask_db_timeout_seconds,
    get_ai_ask_worker_timeout_seconds,
)
from .ai_ask_service import AIAskCancelled

LOGGER = logging.getLogger(__name__)
_EVENT_QUEUE_SIZE = 128
# A child that already exited can still have queue records readable here: the
# queue is handed to the OS through a feeder thread, and the child flushes it
# during normal interpreter shutdown. Records are therefore drained before an
# exit is turned into a failure answer.
EXIT_DRAIN_BUDGET_SECONDS = 1.0
EXIT_GRACE_SECONDS = 1.0


def _queue_put(output_queue, message, *, required: bool = False) -> bool:
    try:
        if required:
            output_queue.put(message, block=True, timeout=1.0)
        else:
            output_queue.put_nowait(message)
        return True
    except (queue.Full, OSError, ValueError):
        return False


def _ai_ask_process_entry(
    output_queue,
    cancel_event,
    mode: str,
    payload: dict[str, Any],
    profile: str,
    request_id: str,
    database_timeout_seconds: int,
) -> None:
    """Import runtime services only inside the isolated process.

    The worker's local DB socket, connection and server statement limits are
    tightened for AI work. If the JDBC implementation ignores cancellation or
    blocks while reading rows, the parent can terminate this entire process;
    no Python thread timeout is represented as a completed JDBC operation.
    """
    os.environ["ASSET_DB_CONNECT_TIMEOUT_SECONDS"] = str(
        min(5, database_timeout_seconds)
    )
    os.environ["ASSET_DB_SOCKET_TIMEOUT_SECONDS"] = str(database_timeout_seconds)
    os.environ["ASSET_DB_STATEMENT_TIMEOUT_MS"] = str(
        database_timeout_seconds * 1000
    )

    def emit(message) -> None:
        _queue_put(output_queue, message)

    try:
        from .ai_ask_service import ai_ask_service

        request = AiAskRequest.model_validate(payload)
        if mode == "stream":
            from .ai_ask_execution_service import AIAskExecutionService
            from .assets_service import assets_service

            execution_service = AIAskExecutionService(ai_ask_service, assets_service)
            response = execution_service.ask(
                request,
                profile=profile,
                request_id=request_id,
                event_callback=lambda event, data: emit(("event", event, data)),
                cancel_event=cancel_event,
            )
        elif mode == "progress":
            def report_progress(step: AiAskProgressStep) -> None:
                emit(("progress", step.model_dump(by_alias=True, exclude_none=True)))

            response = ai_ask_service.ask(
                request,
                profile=profile,
                progress_callback=report_progress,
                cancel_event=cancel_event,
            )
        elif mode == "ask":
            response = ai_ask_service.ask(
                request,
                profile=profile,
                cancel_event=cancel_event,
            )
        else:
            raise ValueError("unsupported AI ask worker mode")
        _queue_put(
            output_queue,
            ("result", response.model_dump(by_alias=True)),
            required=True,
        )
    except AIAskCancelled:
        emit(("cancelled", None))
    except Exception:
        LOGGER.warning("Isolated AI ask worker failed without provider details")
        try:
            fallback = AiAskResponse(
                status="generation_unavailable",
                answer="AI 问答暂不可用，请稍后重试。",
                candidates=[],
                citations=[],
                retrievalStatus="not_run",
                generationStatus="unavailable",
                reasonCode="llm_unavailable",
                elapsedMs=0,
            )
            _queue_put(
                output_queue,
                ("result", fallback.model_dump(by_alias=True)),
                required=True,
            )
        except Exception:
            emit(("worker_error", None))
    finally:
        _queue_put(output_queue, ("__end__", None), required=True)


class AIAskProcessWorker:
    """One bounded, recyclable OS process for a single AI request."""

    def __init__(
        self,
        *,
        mode: str,
        payload: dict[str, Any],
        profile: str,
        request_id: str = "",
        timeout_seconds: int | None = None,
        database_timeout_seconds: int | None = None,
        process_target: Callable | None = None,
    ) -> None:
        self._context = multiprocessing.get_context("spawn")
        self._output_queue = self._context.Queue(maxsize=_EVENT_QUEUE_SIZE)
        self.cancel_event = self._context.Event()
        self.timeout_seconds = (
            timeout_seconds or get_ai_ask_worker_timeout_seconds()
        )
        self.database_timeout_seconds = (
            database_timeout_seconds or get_ai_ask_db_timeout_seconds()
        )
        self._deadline: float | None = None
        self._started = False
        self._closed = False
        self.process = self._context.Process(
            target=process_target or _ai_ask_process_entry,
            args=(
                self._output_queue,
                self.cancel_event,
                mode,
                payload,
                profile,
                request_id,
                self.database_timeout_seconds,
            ),
            name="dap-ai-ask-worker",
        )
        # A crashed/restarted ASGI worker must not leave JDBC child processes orphaned.
        self.process.daemon = True

    def start(self) -> None:
        if self._started:
            raise RuntimeError("AI ask worker already started")
        self._deadline = time.monotonic() + self.timeout_seconds
        self.process.start()
        self._started = True

    def get_message(self, timeout: float = 0.1):
        if not self._started:
            raise RuntimeError("AI ask worker has not started")
        try:
            return self._output_queue.get(timeout=max(0.0, timeout))
        except queue.Empty:
            return None
        except (EOFError, OSError, ValueError):
            # A child killed mid-write closes the pipe / the queue is closed
            # after teardown; both mean "no further message" here.
            return None

    def drain_messages(
        self,
        *,
        timeout: float = 0.05,
        budget_seconds: float = EXIT_DRAIN_BUDGET_SECONDS,
    ) -> list:
        """Read records the child already queued, bounded by ``budget_seconds``.

        Used before process exit is treated as a failure so a completed child
        that queued ``result``/``__end__`` still yields its real answer.
        """
        drained: list = []
        deadline = time.monotonic() + max(0.0, budget_seconds)
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return drained
            message = self.get_message(min(timeout, remaining))
            if message is None:
                return drained
            drained.append(message)
            if message[0] == "__end__":
                return drained

    def is_alive(self) -> bool:
        return self._started and self.process.is_alive()

    def has_timed_out(self) -> bool:
        return bool(
            self.is_alive()
            and self._deadline is not None
            and time.monotonic() >= self._deadline
        )

    def cancel_and_stop(self, *, grace_seconds: float = 0.25) -> bool:
        """Signal cooperative cancellation, then terminate/kill and reap the child.

        Bounded and idempotent: the worst case is ``grace_seconds`` + 0.5s
        terminate + 1.0s kill, so repeated cancellation or cleanup never waits
        forever.
        """
        self.cancel_event.set()
        if not self._started:
            self.close()
            return True
        if self.process.is_alive():
            self.process.join(max(0.0, grace_seconds))
        if self.process.is_alive():
            self.process.terminate()
            self.process.join(0.5)
        if self.process.is_alive() and hasattr(self.process, "kill"):
            self.process.kill()
            self.process.join(1.0)
        stopped = not self.process.is_alive()
        if stopped:
            self.close()
        return stopped

    def join_after_completion(self, *, timeout: float = 1.0) -> bool:
        if not self._started:
            self.close()
            return True
        self.process.join(max(0.0, timeout))
        if self.process.is_alive():
            return self.cancel_and_stop(grace_seconds=0)
        self.close()
        return True

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        try:
            self._output_queue.cancel_join_thread()
            self._output_queue.close()
        except (AttributeError, OSError, ValueError):
            pass
