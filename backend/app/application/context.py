"""Explicit request context passed across framework-neutral boundaries."""

from __future__ import annotations

import time
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, replace
from typing import Any

from .errors import AuthenticationRequiredError, PermissionDeniedError
from .identity import Identity

_CURRENT_REQUEST_CONTEXT: ContextVar[RequestContext | None] = ContextVar(
    "current_request_context", default=None
)


def resolve_client_address(
    remote_address: str | None,
    headers: Mapping[str, Any],
    *,
    trust_proxy_headers: bool,
) -> str:
    """Resolve the audit client address without depending on an HTTP framework.

    A forwarded address is used only when the deployment explicitly opts in;
    otherwise the directly observed peer address remains authoritative.
    """
    forwarded = headers.get("X-Forwarded-For", "") if trust_proxy_headers else ""
    return forwarded.split(",", 1)[0].strip() if forwarded else (remote_address or "")


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Request metadata that application code may safely depend on.

    Flask and FastAPI adapters create this value at their boundary. The
    object intentionally contains no request/session proxy or response type.
    ``started_at`` and ``elapsed_time_ms`` are mutually compatible inputs:
    adapters normally provide the former, while deterministic tests may use
    the latter.
    """

    identity: Identity | None = None
    request_id: str | None = None
    method: str = ""
    path: str = ""
    client_address: str = ""
    user_agent: str = ""
    started_at: float | None = None
    elapsed_time_ms: int | None = None

    def elapsed_ms(self) -> int:
        try:
            if self.elapsed_time_ms is not None:
                return max(0, int(self.elapsed_time_ms))
            if self.started_at is None:
                return 0
            return max(0, int((time.perf_counter() - self.started_at) * 1000))
        except (TypeError, ValueError):
            return 0

    def with_identity(self, identity: Identity | None) -> RequestContext:
        """Return this context with the adapter's current actor identity."""
        return replace(self, identity=identity)

    def require_authenticated(self) -> Identity:
        if self.identity is None:
            raise AuthenticationRequiredError("请先登录。")
        return self.identity

    def require_role(self, role: str) -> Identity:
        identity = self.require_authenticated()
        if identity.role != role:
            raise PermissionDeniedError("无权限执行此操作。")
        return identity


def current_request_context() -> RequestContext | None:
    """Return the request context installed by the active HTTP adapter."""
    return _CURRENT_REQUEST_CONTEXT.get()


def set_request_context(context: RequestContext):
    """Install *context* and return the token needed to restore the caller."""
    return _CURRENT_REQUEST_CONTEXT.set(context)


def reset_request_context(token) -> None:
    """Restore the context that was active before an adapter installed one."""
    _CURRENT_REQUEST_CONTEXT.reset(token)


def set_current_request_identity(identity: Identity | None) -> None:
    """Update the actor in the active adapter context after session mutation."""
    context = current_request_context()
    if context is not None:
        set_request_context(context.with_identity(identity))


@contextmanager
def request_context_scope(context: RequestContext):
    """Temporarily install a context for framework-neutral code and tests."""
    token = set_request_context(context)
    try:
        yield context
    finally:
        reset_request_context(token)
