"""Framework-neutral application primitives.

The modules in this package must not import Flask (or any other HTTP
framework). Framework adapters translate runtime-specific state into these
small, explicit objects.
"""

from .context import (
    RequestContext,
    current_request_context,
    request_context_scope,
    reset_request_context,
    resolve_client_address,
    set_current_request_identity,
    set_request_context,
)
from .errors import ApplicationError, AuthenticationRequiredError, PermissionDeniedError
from .identity import (
    ADMIN_ROLE,
    MAINTAINER_ROLE,
    MAINTENANCE_ROLES,
    Identity,
    identity_for_session,
    identity_from_mapping,
)
from .session import SESSION_COOKIE_NAME, SESSION_PAYLOAD_KEY, SignedSessionCodec

__all__ = [
    "ADMIN_ROLE",
    "MAINTAINER_ROLE",
    "MAINTENANCE_ROLES",
    "ApplicationError",
    "AuthenticationRequiredError",
    "Identity",
    "PermissionDeniedError",
    "RequestContext",
    "SESSION_COOKIE_NAME",
    "SESSION_PAYLOAD_KEY",
    "SignedSessionCodec",
    "current_request_context",
    "identity_for_session",
    "identity_from_mapping",
    "request_context_scope",
    "reset_request_context",
    "resolve_client_address",
    "set_current_request_identity",
    "set_request_context",
]
