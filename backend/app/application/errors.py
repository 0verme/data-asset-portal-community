"""Framework-neutral application errors used at adapter boundaries."""

from __future__ import annotations

from typing import Any


class ApplicationError(Exception):
    """An expected application failure with transport-independent metadata."""

    code = "APPLICATION_ERROR"
    status_code = 400

    def __init__(self, message: str, *, details: Any = None):
        super().__init__(message)
        self.message = message
        self.details = details

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details is not None:
            payload["details"] = self.details
        return payload


class AuthenticationRequiredError(ApplicationError):
    code = "UNAUTHORIZED"
    status_code = 401


class PermissionDeniedError(ApplicationError):
    code = "FORBIDDEN"
    status_code = 403
