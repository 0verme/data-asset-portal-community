"""Repository-owned authorization contracts.

The registry is intentionally framework- and persistence-neutral.  FastAPI
adapters, database repositories, and the frontend contract consume the same
stable permission codes in later RBAC phases.
"""

from . import permissions
from .core import (
    AuthorizationDecision,
    AuthorizationRepository,
    AuthorizationService,
    AuthorizationSubject,
    IdentityAuthorizationRepository,
)
from .permissions import (
    ADMIN_ROLE,
    BUILTIN_ROLE_PERMISSION_CODES,
    MAINTAINER_ROLE,
    PERMISSION_CODES,
    PERMISSION_DEFINITIONS,
    PermissionDefinition,
    get_permission_definition,
    is_registered_permission,
    validate_permission_registry,
)

__all__ = [
    "ADMIN_ROLE",
    "AuthorizationDecision",
    "AuthorizationRepository",
    "AuthorizationService",
    "AuthorizationSubject",
    "BUILTIN_ROLE_PERMISSION_CODES",
    "MAINTAINER_ROLE",
    "PERMISSION_CODES",
    "PERMISSION_DEFINITIONS",
    "IdentityAuthorizationRepository",
    "PermissionDefinition",
    "permissions",
    "get_permission_definition",
    "is_registered_permission",
    "validate_permission_registry",
]
