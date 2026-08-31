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
from ..authorization.core import AuthorizationService
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


def get_authorization_service(request: Request) -> AuthorizationService:
    """Return the current application authorization service."""
    return request.app.state.authorization_service


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


_AUTHENTICATION_CACHE_ATTRIBUTE = "_dap_authentication_decision"


def _authentication_decision(
    request: Request | None,
    context: RequestContext,
    service: AuthorizationService,
):
    if request is not None:
        cached = getattr(request.state, _AUTHENTICATION_CACHE_ATTRIBUTE, None)
        if cached is not None:
            return cached
    decision = service.authenticate(context.identity)
    if request is not None:
        setattr(request.state, _AUTHENTICATION_CACHE_ATTRIBUTE, decision)
    return decision


def _require_authenticated(
    context: RequestContext,
    service: AuthorizationService,
    *,
    admin_only: bool = False,
    request: Request | None = None,
) -> RequestContext:
    decision = _authentication_decision(request, context, service)
    if not decision.authenticated:
        raise AuthenticationRequiredError("请先登录。")
    if decision.reason == "role_unknown_or_disabled":
        raise PermissionDeniedError("当前角色不可执行此操作。")
    if admin_only and not service.is_admin(context.identity):
        raise PermissionDeniedError("仅系统管理员可执行此操作。")
    return context


def require_authenticated(
    request: Request,
    context: RequestContext = Depends(get_request_context),
    service: AuthorizationService = Depends(get_authorization_service),
) -> RequestContext:
    """Require a current enabled identity without checking a permission code."""
    return _require_authenticated(context, service, request=request)


def require_maintainer(
    context: RequestContext = Depends(get_request_context),
    service: AuthorizationService = Depends(get_authorization_service),
) -> RequestContext:
    """Backward-compatible alias for the authentication-only dependency."""
    return _require_authenticated(context, service)


def require_admin(
    request: Request,
    context: RequestContext = Depends(get_request_context),
    service: AuthorizationService = Depends(get_authorization_service),
) -> RequestContext:
    """Compatibility gate resolved against the current database role."""
    return _require_authenticated(context, service, admin_only=True, request=request)


def require_permission(permission: str) -> Callable[..., RequestContext]:
    """Build a FastAPI dependency backed by the neutral authorization core."""
    normalized = str(permission or "").strip()
    if not normalized:
        raise ValueError("permission code must be non-empty")

    def dependency(
        request: Request,
        context: RequestContext = Depends(get_request_context),
        service: AuthorizationService = Depends(get_authorization_service),
    ) -> RequestContext:
        decision = service.authorize(
            context.identity,
            normalized,
            authentication=_authentication_decision(request, context, service),
        )
        if not decision.allowed:
            if not decision.authenticated:
                raise AuthenticationRequiredError("请先登录。")
            raise PermissionDeniedError("无权限执行此操作。")
        return context

    dependency.__name__ = f"require_permission_{normalized.replace(':', '_')}"
    return dependency
