"""Framework-neutral compatibility codec for the existing signed session cookie."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from itsdangerous import (  # pyright: ignore[reportMissingImports]
    BadData,
    URLSafeTimedSerializer,
)


SESSION_COOKIE_NAME = "session"
SESSION_PAYLOAD_KEY = "dap_auth_user"
SESSION_SALT = "cookie-session"


class SignedSessionCodec:
    """Encode and validate the legacy Flask-compatible signed cookie.

    The current cookie stores only a small JSON mapping.  Itsdangerous' default
    JSON serializer produces the same payload format as Flask's tagged JSON
    serializer for that mapping, while the explicit salt and signer arguments
    preserve the existing cookie signature contract.
    """

    def __init__(self, secret: str, *, max_age: int):
        if not isinstance(secret, str) or not secret.strip():
            raise ValueError("A non-empty session secret is required.")
        if not isinstance(max_age, int) or max_age <= 0:
            raise ValueError("Session max_age must be a positive integer.")
        self._serializer = URLSafeTimedSerializer(
            secret,
            salt=SESSION_SALT,
            signer_kwargs={
                "key_derivation": "hmac",
                "digest_method": hashlib.sha1,
            },
        )
        self.max_age = max_age

    def encode(self, payload: Mapping[str, Any]) -> str:
        """Return a Flask-compatible signed representation of *payload*."""
        return self._serializer.dumps(dict(payload))

    def decode(self, value: str | None) -> dict[str, Any] | None:
        """Return a verified session mapping, or ``None`` for invalid input."""
        if not isinstance(value, str) or not value:
            return None
        try:
            payload = self._serializer.loads(value, max_age=self.max_age)
        except (BadData, TypeError, ValueError):
            return None
        return dict(payload) if isinstance(payload, Mapping) else None
