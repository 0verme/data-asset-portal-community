"""Framework-neutral signed-session codecs."""

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

# Native cookies use an application-owned contract.  The legacy reader below
# is intentionally read-only so a deployment can roll existing sessions
# forward without keeping the old signer as its write format.
SESSION_SALT = "dap-native-session-v2"
LEGACY_SESSION_SALT = "cookie-session"


class _SignedSessionCodec:
    _salt: str
    _digest_method: Any

    def __init__(self, secret: str, *, max_age: int):
        if not isinstance(secret, str) or not secret.strip():
            raise ValueError("A non-empty session secret is required.")
        if not isinstance(max_age, int) or max_age <= 0:
            raise ValueError("Session max_age must be a positive integer.")
        self._serializer = URLSafeTimedSerializer(
            secret,
            salt=self._salt,
            signer_kwargs={
                "key_derivation": "hmac",
                "digest_method": self._digest_method,
            },
        )
        self.max_age = max_age

    def encode(self, payload: Mapping[str, Any]) -> str:
        """Return a signed representation of *payload*."""
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


class SignedSessionCodec(_SignedSessionCodec):
    """Encode and validate the native application session cookie."""

    _salt = SESSION_SALT
    _digest_method = hashlib.sha256


class LegacySignedSessionCodec(_SignedSessionCodec):
    """Read the pre-#145 cookie wire format during its bounded migration window."""

    _salt = LEGACY_SESSION_SALT
    _digest_method = hashlib.sha1
