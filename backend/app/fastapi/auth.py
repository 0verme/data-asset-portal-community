"""FastAPI-native adapter for the legacy signed session contract."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import Request  # pyright: ignore[reportAttributeAccessIssue]

from ..application import (
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


def get_session_codec() -> SignedSessionCodec:
    """Build a codec from the current deployment secret and lifetime."""
    return SignedSessionCodec(
        get_session_secret(),
        max_age=get_auth_session_days() * COOKIE_MAX_AGE_SECONDS,
    )


def get_native_session_payload(request: Request) -> dict[str, Any] | None:
    """Decode the existing session cookie without touching Flask globals."""
    return get_session_codec().decode(request.cookies.get(SESSION_COOKIE_NAME))


def get_native_session_identity(request: Request):
    """Resolve a verified session payload into the neutral identity value."""
    payload = get_native_session_payload(request)
    session_identity = payload.get(SESSION_PAYLOAD_KEY) if payload else None
    return identity_from_mapping(session_identity)


def set_native_session_cookie(response: Any, user: dict, remember: bool) -> None:
    """Write a Flask-compatible signed cookie with the existing flags."""
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
