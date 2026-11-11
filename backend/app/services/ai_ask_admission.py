"""Process-local admission control for expensive AI asks.

Only admitted requests start worker threads or isolated AI child processes.
Queued requests are represented by bounded lightweight leases, not executor
futures, so overload cannot create an unbounded backlog of running work.
"""

from __future__ import annotations

import threading
from collections import deque

from ..settings import (
    get_ai_ask_max_concurrency,
    get_ai_ask_max_queue,
    get_ai_ask_queue_wait_ms,
)


class AIAskAdmissionLease:
    def __init__(self, controller: "AIAskAdmissionController") -> None:
        self._controller = controller
        self._event = threading.Event()
        self._state = "queued"

    @property
    def active(self) -> bool:
        return self._controller._is_active(self)

    @property
    def state(self) -> str:
        return self._controller._state(self)

    def wait(self, timeout: float | None = None) -> bool:
        self._event.wait(timeout)
        return self.active

    def cancel(self) -> None:
        self._controller._release(self)

    def release(self) -> None:
        self._controller._release(self)


class AIAskAdmissionController:
    """Fair active limit with a bounded FIFO and idempotent lease release."""

    def __init__(
        self,
        *,
        max_concurrent: int | None = None,
        max_queued: int | None = None,
        queue_wait_ms: int | None = None,
    ) -> None:
        self.max_concurrent = (
            get_ai_ask_max_concurrency()
            if max_concurrent is None
            else max_concurrent
        )
        self.max_queued = (
            get_ai_ask_max_queue() if max_queued is None else max(0, max_queued)
        )
        self.queue_wait_ms = (
            get_ai_ask_queue_wait_ms()
            if queue_wait_ms is None
            else max(0, queue_wait_ms)
        )
        if self.max_concurrent < 1:
            raise ValueError("AI ask concurrency must be positive")
        self._lock = threading.Lock()
        self._active = 0
        self._waiting: deque[AIAskAdmissionLease] = deque()

    def reserve(self) -> AIAskAdmissionLease | None:
        with self._lock:
            if self._active < self.max_concurrent and not self._waiting:
                lease = AIAskAdmissionLease(self)
                lease._state = "active"
                self._active += 1
                lease._event.set()
                return lease
            if len(self._waiting) >= self.max_queued:
                return None
            lease = AIAskAdmissionLease(self)
            self._waiting.append(lease)
            return lease

    def acquire(self, *, timeout: float | None = None) -> AIAskAdmissionLease | None:
        lease = self.reserve()
        if lease is None or lease.active:
            return lease
        if timeout is None:
            timeout = self.queue_wait_ms / 1000
        if lease.wait(max(0.0, timeout)):
            return lease
        lease.cancel()
        return None

    def _is_active(self, lease: AIAskAdmissionLease) -> bool:
        with self._lock:
            return lease._state == "active"

    def _state(self, lease: AIAskAdmissionLease) -> str:
        with self._lock:
            return lease._state

    def _release(self, lease: AIAskAdmissionLease) -> None:
        with self._lock:
            if lease._state == "queued":
                try:
                    self._waiting.remove(lease)
                except ValueError:
                    pass
                lease._state = "released"
                lease._event.set()
                return
            if lease._state != "active":
                return

            lease._state = "released"
            self._active -= 1
            while self._waiting:
                next_lease = self._waiting.popleft()
                if next_lease._state != "queued":
                    continue
                next_lease._state = "active"
                self._active += 1
                next_lease._event.set()
                break

    def snapshot(self) -> tuple[int, int]:
        with self._lock:
            return self._active, len(self._waiting)


ai_ask_admission = AIAskAdmissionController()
