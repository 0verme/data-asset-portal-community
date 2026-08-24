"""ASGI request-body size policy and streaming enforcement."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse

from ..contracts.metadata_ingestion import MAX_METADATA_BODY_BYTES


METADATA_INGESTION_PATHS = frozenset(
    {
        "/api/metadata/assets/ingestions",
        "/api/metadata/assets:bulk-upsert",
        "/api/metadata/lineage/ingestions",
        "/api/metadata/lineage:snapshots",
    }
)


@dataclass(frozen=True)
class RequestBodyLimitPolicy:
    """The effective limit and public error contract for one request path."""

    max_bytes: int
    code: str
    message: str
    details: dict[str, Any] | None = None

    def payload(self) -> dict[str, Any]:
        error: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
        }
        if self.details is not None:
            error["details"] = dict(self.details)
        return {"error": error}


class RequestBodyTooLargeError(StarletteHTTPException):
    """Raised when the ASGI receive stream crosses its effective limit."""

    def __init__(self, policy: RequestBodyLimitPolicy):
        self.policy = policy
        super().__init__(status_code=413, detail=policy.payload())


def _coerce_limit(value: Any) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return 0


def resolve_request_body_limit(
    path: str,
    method: str,
    global_limit: int,
    *,
    metadata_limit: int = MAX_METADATA_BODY_BYTES,
) -> RequestBodyLimitPolicy:
    """Resolve the stricter global/metadata limit before body parsing starts."""
    effective_global = _coerce_limit(global_limit)
    if str(method or "").upper() == "POST" and path in METADATA_INGESTION_PATHS:
        effective = min(effective_global, _coerce_limit(metadata_limit))
        return RequestBodyLimitPolicy(
            max_bytes=effective,
            code="METADATA_PAYLOAD_TOO_LARGE",
            message=f"metadata request body exceeds {effective} bytes",
            details={"code": "PAYLOAD_TOO_LARGE", "maxBytes": effective},
        )
    return RequestBodyLimitPolicy(
        max_bytes=effective_global,
        code="HTTP_413",
        message="请求体过大",
    )


def _content_length_values(scope: dict[str, Any]):
    """Yield valid non-negative declarations; invalid values remain advisory only."""
    for header in scope.get("headers", ()):
        if not isinstance(header, (tuple, list)) or len(header) < 2:
            continue
        key, value = header[0], header[1]
        if isinstance(key, bytes):
            is_content_length = key.lower() == b"content-length"
        else:
            is_content_length = str(key).lower() == "content-length"
        if not is_content_length:
            continue
        try:
            text = value.decode("ascii").strip() if isinstance(value, bytes) else str(value).strip()
            if not text or not text.isascii() or not text.isdecimal():
                continue
            parsed = int(text)
        except (AttributeError, TypeError, ValueError):
            continue
        if parsed >= 0:
            yield parsed


class RequestSizeLimitMiddleware:
    """Enforce request limits while forwarding each ASGI body frame unchanged.

    ``Content-Length`` is used only for an early rejection.  The receive wrapper
    counts bytes in every ``http.request`` message and raises as soon as the
    effective limit is crossed, without collecting or replaying the body.
    """

    def __init__(
        self,
        app: Callable[..., Awaitable[Any]],
        max_content_length: int,
        *,
        metadata_body_limit: int = MAX_METADATA_BODY_BYTES,
    ):
        self.app = app
        self.max_content_length = max_content_length
        self.metadata_body_limit = metadata_body_limit

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        policy = resolve_request_body_limit(
            str(scope.get("path") or ""),
            str(scope.get("method") or ""),
            self.max_content_length,
            metadata_limit=self.metadata_body_limit,
        )
        if any(length > policy.max_bytes for length in _content_length_values(scope)):
            await JSONResponse(
                policy.payload(),
                status_code=413,
            )(scope, receive, send)
            return

        received = 0
        response_started = False

        async def send_with_state(message):
            nonlocal response_started
            if message.get("type") == "http.response.start":
                response_started = True
            await send(message)

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body") or b"")
                if received > policy.max_bytes:
                    raise RequestBodyTooLargeError(policy)
            return message

        try:
            await self.app(scope, limited_receive, send_with_state)
        except RequestBodyTooLargeError as error:
            # FastAPI's registered exception handler normally handles this path.
            # The fallback keeps the ASGI middleware deterministic for a plain
            # downstream app, while never attempting a second response.
            if not response_started:
                await JSONResponse(
                    error.policy.payload(),
                    status_code=413,
                )(scope, receive, send)
