"""Cancellation-proof, exactly-once teardown for an admitted AI ask request.

``StreamingResponse`` finalizers run inside an already-cancelled AnyIO scope
when the client disconnects: every ``await`` in that scope raises
``CancelledError`` again, not just once.  The previous implementation awaited
``asyncio.to_thread(worker.cancel_and_stop)`` inside ``finally``, so cleanup
was aborted before ``lease.release()`` while the OS child kept running.  Two
such disconnects permanently consumed the bounded AI admission budget and
every later request answered ``llm_busy``.

This guard removes the dependency on the request cancellation scope:

* the child process is terminated and reaped from a bounded cleanup thread
  that no cancellation scope can interrupt;
* the admission lease is released from that thread, exactly once, so capacity
  cannot leak on disconnect;
* every step is idempotent, so repeated cancel/cleanup calls are safe;
* every wait is bounded (``AIAskProcessWorker.cancel_and_stop`` finishes
  within ~1.75s), so cleanup can never hang a request or the interpreter.
"""

from __future__ import annotations

import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

from .ai_ask_admission import AIAskAdmissionLease

LOGGER = logging.getLogger(__name__)

# Bounded pool: cleanup tasks are short and only exist for admitted requests.
_CLEANUP_MAX_WORKERS = 4
_CLEANUP_POOL: ThreadPoolExecutor | None = None
_CLEANUP_POOL_LOCK = threading.Lock()


def _cleanup_pool() -> ThreadPoolExecutor:
    global _CLEANUP_POOL
    with _CLEANUP_POOL_LOCK:
        if _CLEANUP_POOL is None:
            _CLEANUP_POOL = ThreadPoolExecutor(
                max_workers=_CLEANUP_MAX_WORKERS,
                thread_name_prefix="dap-ai-ask-cleanup",
            )
        return _CLEANUP_POOL


def shutdown_cleanup_pool(*, wait: bool = True) -> None:
    """Drain and stop the cleanup pool (used by tests and interpreter exit)."""
    global _CLEANUP_POOL
    with _CLEANUP_POOL_LOCK:
        pool, _CLEANUP_POOL = _CLEANUP_POOL, None
    if pool is not None:
        pool.shutdown(wait=wait)


class AIAskRequestGuard:
    """Owns one admission lease and at most one isolated worker process."""

    def __init__(self, lease: AIAskAdmissionLease) -> None:
        self._lease = lease
        self._lock = threading.Lock()
        self._worker: Any | None = None
        self._released = False
        self._closed = False
        self._closed_event = threading.Event()

    # -- registration ---------------------------------------------------
    def attach_worker(self, worker: Any) -> None:
        with self._lock:
            self._worker = worker

    def has_worker(self) -> bool:
        with self._lock:
            return self._worker is not None

    def detach_worker(self) -> None:
        """Stop tracking an already reaped worker without releasing the lease."""
        with self._lock:
            self._worker = None

    # -- teardown -------------------------------------------------------
    def release_once(self) -> bool:
        """Release the admission lease at most once; safe from any thread."""
        with self._lock:
            if self._released:
                return False
            self._released = True
        try:
            self._lease.release()
        except Exception:  # pragma: no cover - defensive
            LOGGER.warning("AI ask admission lease release failed")
            return False
        return True

    def stop_worker(self) -> bool:
        """Terminate and reap the isolated worker with bounded waits."""
        with self._lock:
            worker, self._worker = self._worker, None
        if worker is None:
            return True
        try:
            return bool(worker.cancel_and_stop())
        except Exception:  # pragma: no cover - defensive
            LOGGER.warning("AI ask worker termination raised")
            return False

    def close(self) -> None:
        """Bounded, idempotent: reap the child, then free admission capacity."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
        try:
            if not self.stop_worker():
                # Releasing keeps the service usable; the bounded stop already
                # ran terminate/kill and must never be retried forever.
                LOGGER.error(
                    "AI ask worker could not be reaped; admission released after bounded stop"
                )
            self.release_once()
        finally:
            self._closed_event.set()

    def begin_cleanup(self) -> Future | None:
        """Start teardown outside the request scope; never await while cancelled.

        Returns the cleanup future when process termination must run off-thread,
        or ``None`` when nothing blocking was left to do.
        """
        with self._lock:
            needs_thread = self._worker is not None and not self._closed
        if not needs_thread:
            self.close()
            return None
        try:
            return _cleanup_pool().submit(self.close)
        except RuntimeError:  # pragma: no cover - interpreter shutdown
            self.close()
            return None

    def wait_closed(self, timeout: float = 5.0) -> bool:
        return self._closed_event.wait(max(0.0, timeout))


def defer_release_until(guard: AIAskRequestGuard, task: Any) -> None:
    """Release the lease when an unkillable in-process worker finally exits."""
    if task is None:
        guard.release_once()
        return
    if task.done():
        guard.release_once()
        return

    def _release(_task: Any) -> None:
        guard.release_once()

    task.add_done_callback(_release)
