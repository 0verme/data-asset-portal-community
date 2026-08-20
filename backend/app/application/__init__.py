"""Framework-neutral application primitives.

The modules in this package must not import Flask (or any other HTTP
framework). Framework adapters translate runtime-specific state into these
small, explicit objects.
"""

from .context import RequestContext
from .errors import ApplicationError, AuthenticationRequiredError, PermissionDeniedError
from .identity import (
    ADMIN_ROLE,
    MAINTAINER_ROLE,
    MAINTENANCE_ROLES,
    Identity,
    identity_from_mapping,
    identity_for_session,
)

__all__ = [
    "ADMIN_ROLE",
    "MAINTAINER_ROLE",
    "MAINTENANCE_ROLES",
    "ApplicationError",
    "AuthenticationRequiredError",
    "Identity",
    "PermissionDeniedError",
    "RequestContext",
    "identity_for_session",
    "identity_from_mapping",
]
