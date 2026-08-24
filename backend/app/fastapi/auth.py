"""FastAPI-native signed-session adapter."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request  # pyright: ignore[reportAttributeAccessIssue]
from starlette.responses import Response

from ..application import (
    LegacySignedSessionCodec,
    SESSION_COOKIE_NAME,
    SESSION_PAYLOAD_KEY,
    SignedSessionCodec,
    identity_for_session,
    identity_from_mapping,
)
from ..settings import (
    get_auth_session_days,
    get_session_cookie_config,
    get_session_secret,
)

COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60
_LEGACY_SESSION_IDENTITY_STATE = "dap_legacy_session_identity"


def get_session_codec() -> SignedSessionCodec:
    """Build the native codec from the current deployment secret and lifetime."""
    return SignedSessionCodec(
        get_session_secret(),
        max_age=get_auth_session_days() * COOKIE_MAX_AGE_SECONDS,
    )


def get_legacy_session_codec() -> LegacySignedSessionCodec:
    """Build the bounded read-only codec for pre-#145 session cookies."""
    return LegacySignedSessionCodec(
        get_session_secret(),
        max_age=get_auth_session_days() * COOKIE_MAX_AGE_SECONDS,
    )


def _decode_session(request: Request) -> tuple[dict[str, Any] | None, bool]:
    value = request.cookies.get(SESSION_COOKIE_NAME)
    payload = get_session_codec().decode(value)
    if payload is not None:
        return payload, False
    payload = get_legacy_session_codec().decode(value)
    return payload, payload is not None


def get_native_session_payload(request: Request) -> dict[str, Any] | None:
    """Decode a native cookie or a valid pre-#145 cookie during migration."""
    payload, _legacy = _decode_session(request)
    return payload


def get_native_session_identity(request: Request):
    """Resolve a verified session payload into the neutral identity value."""
    payload, legacy = _decode_session(request)
    session_identity = payload.get(SESSION_PAYLOAD_KEY) if payload else None
    identity = identity_from_mapping(session_identity)
    if legacy and identity is not None:
        # The migration middleware re-signs this verified identity with the
        # native codec after a successful response.  It never copies a raw or
        # unverified cookie value into the new wire format.
        setattr(request.state, _LEGACY_SESSION_IDENTITY_STATE, identity.as_dict())
    return identity


def set_native_session_cookie(response: Any, user: dict, remember: bool) -> None:
    """Write the native signed session with the deployment cookie policy."""
    identity = identity_for_session(user)
    payload = {SESSION_PAYLOAD_KEY: identity.as_dict()}
    config = get_session_cookie_config()
    expires = None
    if remember:
        expires = datetime.now(timezone.utc) + timedelta(days=get_auth_session_days())
    response.set_cookie(
        SESSION_COOKIE_NAME,
        get_session_codec().encode(payload),
        expires=expires,
        path="/",
        secure=bool(config["SESSION_COOKIE_SECURE"]),
        httponly=bool(config["SESSION_COOKIE_HTTPONLY"]),
        samesite=str(config["SESSION_COOKIE_SAMESITE"]).lower(),
    )


class LegacySessionMigrationMiddleware:
    """Reissue a verified legacy identity once using the native wire format."""

    def __init__(self, app: Callable[..., Awaitable[Any]]):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_migration(message):
            if message.get("type") != "http.response.start":
                await send(message)
                return

            headers = list(message.get("headers", []))
            status = int(message.get("status", 500))
            state = scope.get("state") or {}
            identity = state.get(_LEGACY_SESSION_IDENTITY_STATE)
            has_session_cookie = any(
                key.lower() == b"set-cookie" and b"session=" in value.lower()
                for key, value in headers
            )
            if status < 400 and isinstance(identity, dict) and not has_session_cookie:
                migrated = Response()
                set_native_session_cookie(migrated, identity, remember=False)
                headers.extend(
                    (key, value)
                    for key, value in migrated.raw_headers
                    if key.lower() == b"set-cookie"
                )
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_migration)


def clear_native_session_cookie(response: Any) -> None:
    """Clear the session cookie using the same security attributes."""
    config = get_session_cookie_config()
    response.delete_cookie(
        SESSION_COOKIE_NAME,
        path="/",
        secure=bool(config["SESSION_COOKIE_SECURE"]),
        httponly=bool(config["SESSION_COOKIE_HTTPONLY"]),
        samesite=str(config["SESSION_COOKIE_SAMESITE"]).lower(),
    )
