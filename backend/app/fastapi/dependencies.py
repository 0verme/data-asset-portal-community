"""Shared FastAPI request-context and authentication dependencies."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any

from fastapi import Depends, Request

from ..application import RequestContext
from ..application.errors import (
    AuthenticationRequiredError,
    PermissionDeniedError,
)

IdentityResolver = Callable[[Request], Any]

async def get_request_context(request: Request) -> RequestContext:
    """Resolve an identity at the adapter boundary and build core context."""
    resolver: IdentityResolver = request.app.state.identity_resolver
    identity = resolver(request)
    if inspect.isawaitable(identity):
        identity = await identity
    client_address = request.client.host if request.client else None
    return RequestContext(
        identity=identity,
        request_id=request.headers.get("X-Request-ID"),
        client_address=client_address,
    )


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
