"""Framework-neutral application primitives.

The modules in this package must not import Flask (or any other HTTP
framework). Framework adapters translate runtime-specific state into these
small, explicit objects.
"""

from .actor import (
    Actor,
    ActorLike,
    ActorSource,
    AuditActorMixin,
    actor_aware,
    actor_scope,
    configured_system_actor,
    current_operation_actor,
    resolve_actor,
)
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
    "Actor",
    "ActorLike",
    "ActorSource",
    "AuditActorMixin",
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
    "actor_aware",
    "actor_scope",
    "configured_system_actor",
    "current_operation_actor",
    "current_request_context",
    "identity_for_session",
    "identity_from_mapping",
    "request_context_scope",
    "reset_request_context",
    "resolve_actor",
    "resolve_client_address",
    "set_current_request_identity",
    "set_request_context",
]
