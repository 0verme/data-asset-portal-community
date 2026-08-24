"""Pure FastAPI/Uvicorn production entrypoint."""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from backend.app.authorization.repository import DatabaseAuthorizationRepository
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi.request_body import RequestSizeLimitMiddleware
from backend.app.fastapi_app import create_fastapi_app
from backend.app.settings import get_runtime_config, load_runtime_env
from fastapi import FastAPI  # pyright: ignore[reportAttributeAccessIssue]
from fastapi.middleware.cors import (  # pyright: ignore[reportMissingImports]
    CORSMiddleware,
)


class SecurityHeadersMiddleware:
    """Apply the configured security headers to FastAPI responses."""

    def __init__(self, app: Callable[..., Awaitable[Any]], headers: dict[str, str]):
        self.app = app
        self.headers = headers

    async def __call__(self, scope, receive, send):
        async def send_with_headers(message):
            if message.get("type") == "http.response.start":
                current = {key.lower() for key, _value in message.get("headers", [])}
                headers = list(message.get("headers", []))
                for key, value in self.headers.items():
                    encoded_key = key.lower().encode("latin-1")
                    if encoded_key not in current:
                        headers.append((encoded_key, value.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


def create_native_app(
    *,
    capabilities: dict[str, Any] | None = None,
    fastapi_application: FastAPI | None = None,
):
    """Build the only supported production runtime composition."""
    effective_capabilities = capabilities or resolve_capabilities()
    native_app = fastapi_application or create_fastapi_app(
        capabilities=effective_capabilities,
        identity_resolver=get_native_session_identity,
        authorization_repository_instance=DatabaseAuthorizationRepository(),
    )

    @native_app.get("/healthz")
    def healthz():
        return {
            "status": "ok",
            "runtime": "fastapi",
            "fastapiPrimary": True,
            "flaskFallback": False,
        }

    settings = get_runtime_config()
    runtime: Callable[..., Awaitable[Any]] = native_app
    origins = settings.get("CORS_ORIGINS") or []
    if origins:
        runtime = CORSMiddleware(
            runtime,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    try:
        max_content_length = int(settings.get("MAX_CONTENT_LENGTH") or 0)
    except (TypeError, ValueError):
        max_content_length = 0
    runtime = RequestSizeLimitMiddleware(runtime, max_content_length)
    return SecurityHeadersMiddleware(
        runtime,
        settings.get("SECURITY_HEADERS") or {},
    )


_demo_bootstrap = os.environ.get("COMMUNITY_DEMO_BOOTSTRAP") == "1"
load_runtime_env(overwrite=not _demo_bootstrap)
app = create_native_app()
