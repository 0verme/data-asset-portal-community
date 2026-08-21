"""Shared FastAPI request-context and authentication dependencies."""

from __future__ import annotations

import inspect
import time
from collections.abc import Callable
from typing import Any

from fastapi import Depends, Request  # pyright: ignore[reportAttributeAccessIssue]

from ..application import (
    RequestContext,
    current_request_context,
    reset_request_context,
    resolve_client_address,
    set_request_context,
)
from ..application.errors import (
    AuthenticationRequiredError,
    PermissionDeniedError,
)
from ..settings import get_trust_proxy_headers

IdentityResolver = Callable[[Request], Any]


def build_request_context(
    request: Request,
    identity: Any,
    *,
    started_at: float | None = None,
) -> RequestContext:
    """Translate an ASGI request into the neutral application value object."""
    return RequestContext(
        identity=identity,
        request_id=request.headers.get("X-Request-ID"),
        method=request.method or "",
        path=request.url.path or "",
        client_address=resolve_client_address(
            request.client.host if request.client else None,
            request.headers,
            trust_proxy_headers=get_trust_proxy_headers(),
        ),
        user_agent=request.headers.get("User-Agent", ""),
        started_at=time.perf_counter() if started_at is None else started_at,
    )


class RequestContextMiddleware:
    """Install neutral request metadata without creating a Flask context."""

    def __init__(self, app: Callable[..., Any], identity_resolver: IdentityResolver):
        self.app = app
        self.identity_resolver = identity_resolver

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        request = Request(scope, receive=receive)
        identity = self.identity_resolver(request)
        if inspect.isawaitable(identity):
            identity = await identity
        context = build_request_context(request, identity)
        token = set_request_context(context)
        try:
            await self.app(scope, receive, send)
        finally:
            reset_request_context(token)


async def get_request_context(request: Request) -> RequestContext:
    """Resolve the neutral context installed by the native FastAPI adapter."""
    context = current_request_context()
    if context is not None:
        return context
    resolver: IdentityResolver = request.app.state.identity_resolver
    identity = resolver(request)
    if inspect.isawaitable(identity):
        identity = await identity
    return build_request_context(request, identity)


def require_maintainer(
    context: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """FastAPI auth adapter retaining the current maintainer gate."""
    if context.identity is None:
        raise AuthenticationRequiredError("请先登录。")
    return context


def require_admin(
    context: RequestContext = Depends(get_request_context),
) -> RequestContext:
    """FastAPI auth adapter retaining the current administrator gate."""
    if context.identity is None:
        raise AuthenticationRequiredError("请先登录管理员账号。")
    if not context.identity.is_admin:
        raise PermissionDeniedError("仅系统管理员可执行此操作。")
    return context
