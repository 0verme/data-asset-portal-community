"""ASGI runtime with a reversible FastAPI primary / Flask compatibility boundary.

The default runtime dispatches migrated API prefixes to FastAPI and delegates
all other paths to the existing Flask WSGI application. Set
``BACKEND_RUNTIME=flask`` for an immediate rollback to the Flask runtime.
"""

# pyright: reportMissingImports=false
# pyright: reportAttributeAccessIssue=false

from __future__ import annotations

import os
from collections.abc import Awaitable, Callable
from typing import Any

from backend.app import create_app
from backend.app.core.capabilities import resolve_capabilities
from backend.app.fastapi.auth import get_native_session_identity
from backend.app.fastapi_app import create_fastapi_app
from backend.app.settings import get_flask_runtime_config, load_runtime_env
from fastapi.responses import JSONResponse
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.wsgi import WSGIMiddleware

FASTAPI_ALWAYS_PREFIXES = {
    "/api/auth",
    "/api/capabilities",
    "/api/portal",
    "/api/search",
}

FASTAPI_MODULE_PREFIXES = {
    "indicator": "/api/indicators",
    "dwm": "/api/assets",
    "mapping": "/api/field-mappings",
    "root": "/api/roots",
    "codeTable": "/api/manual-code-tables",
    "report": "/api/reports",
    "apiAsset": "/api/api-assets",
    "lineage": "/api/lineage",
    "system": ("/api/system", "/api/operation-logs"),
    "upstream": "/api/upstreams",
}


class FlaskRequestContextMiddleware:
    """Keep Flask session/audit compatibility while FastAPI is primary."""

    def __init__(self, app: Callable[..., Awaitable[Any]], flask_app: Any):
        self.app = app
        self.flask_app = flask_app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        query_string = scope.get("query_string", b"").decode("latin-1")
        path = scope.get("path", "/")
        if query_string:
            path = f"{path}?{query_string}"
        headers = {
            key.decode("latin-1"): value.decode("latin-1")
            for key, value in scope.get("headers", [])
        }
        client = scope.get("client")
        environ_base = {"REMOTE_ADDR": client[0] if client else ""}
        with self.flask_app.test_request_context(
            path=path,
            method=scope.get("method", "GET"),
            headers=headers,
            environ_base=environ_base,
        ):
            await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Apply the same security headers to FastAPI responses as Flask."""

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


class RuntimeDispatcher:
    """Route migrated prefixes to FastAPI and everything else to Flask."""

    def __init__(
        self,
        fastapi_app: Callable[..., Awaitable[Any]],
        flask_app: Callable[..., Awaitable[Any]],
        *,
        runtime_mode: str,
        migrated_prefixes: set[str],
        security_headers: dict[str, str],
    ):
        self.fastapi_app = fastapi_app
        self.flask_app = flask_app
        self.runtime_mode = runtime_mode
        self.migrated_prefixes = migrated_prefixes
        self.security_headers = security_headers

    def _uses_fastapi(self, path: str) -> bool:
        if self.runtime_mode != "fastapi":
            return False
        return any(
            path == prefix or path.startswith(f"{prefix}/")
            for prefix in self.migrated_prefixes
        )

    async def __call__(self, scope, receive, send):
        if scope.get("type") == "http" and scope.get("path") == "/healthz":
            response = JSONResponse(
                {
                    "status": "ok",
                    "runtime": self.runtime_mode,
                    "fastapiPrimary": self.runtime_mode == "fastapi",
                    "flaskFallback": True,
                },
                headers=self.security_headers,
            )
            await response(scope, receive, send)
            return
        if self._uses_fastapi(scope.get("path", "")):
            await self.fastapi_app(scope, receive, send)
            return
        await self.flask_app(scope, receive, send)


def _runtime_mode() -> str:
    mode = os.getenv("BACKEND_RUNTIME", "fastapi").strip().lower()
    if mode not in {"fastapi", "flask"}:
        raise RuntimeError("BACKEND_RUNTIME must be either 'fastapi' or 'flask'")
    return mode


def create_runtime_app(
    *,
    runtime_mode: str | None = None,
    capabilities=None,
    flask_application=None,
    fastapi_application=None,
):
    """Build the reversible production runtime boundary."""
    selected_runtime = runtime_mode or _runtime_mode()
    if selected_runtime not in {"fastapi", "flask"}:
        raise RuntimeError("BACKEND_RUNTIME must be either 'fastapi' or 'flask'")
    effective_capabilities = capabilities or resolve_capabilities()
    flask_application = flask_application or create_app(
        capabilities=effective_capabilities
    )

    def resolve_identity(request):
        return get_native_session_identity(request)

    fastapi_application = fastapi_application or create_fastapi_app(
        capabilities=effective_capabilities,
        identity_resolver=resolve_identity,
    )
    settings = get_flask_runtime_config()
    fastapi_asgi = FlaskRequestContextMiddleware(fastapi_application, flask_application)
    origins = settings.get("CORS_ORIGINS") or []
    if origins:
        fastapi_asgi = CORSMiddleware(
            fastapi_asgi,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    fastapi_asgi = SecurityHeadersMiddleware(
        fastapi_asgi, settings.get("SECURITY_HEADERS") or {}
    )
    flask_asgi = WSGIMiddleware(flask_application)
    enabled_codes = set(effective_capabilities.get("enabled_codes") or [])
    migrated_prefixes = FASTAPI_ALWAYS_PREFIXES | {
        prefix
        for code, configured_prefixes in FASTAPI_MODULE_PREFIXES.items()
        if code in enabled_codes
        for prefix in (
            configured_prefixes
            if isinstance(configured_prefixes, tuple)
            else (configured_prefixes,)
        )
    }
    return RuntimeDispatcher(
        fastapi_asgi,
        flask_asgi,
        runtime_mode=selected_runtime,
        migrated_prefixes=migrated_prefixes,
        security_headers=settings.get("SECURITY_HEADERS") or {},
    )


_demo_bootstrap = os.environ.get("COMMUNITY_DEMO_BOOTSTRAP") == "1"
load_runtime_env(overwrite=not _demo_bootstrap)
app = create_runtime_app()
