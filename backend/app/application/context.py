"""Explicit request context passed across framework-neutral boundaries."""

from __future__ import annotations

from dataclasses import dataclass

from .errors import AuthenticationRequiredError, PermissionDeniedError
from .identity import Identity


@dataclass(frozen=True, slots=True)
class RequestContext:
    """Request metadata that application code may safely depend on.

    Flask and FastAPI adapters create this value at their boundary. The
    object intentionally contains no request/session proxy or response type.
    """

    identity: Identity | None = None
    request_id: str | None = None
    client_address: str | None = None

    def require_authenticated(self) -> Identity:
        if self.identity is None:
            raise AuthenticationRequiredError("请先登录。")
        return self.identity

    def require_role(self, role: str) -> Identity:
        identity = self.require_authenticated()
        if identity.role != role:
            raise PermissionDeniedError("无权限执行此操作。")
        return identity
