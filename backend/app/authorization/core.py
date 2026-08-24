# Copyright 2025 Jearhe
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Framework-neutral authorization decisions.

The core accepts an application identity and a repository contract.  It does
not know about HTTP, FastAPI, cookies, sessions, SQL, or response status
codes.  Adapters translate the returned decision into their own transport
semantics.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Protocol

from ..application.identity import Identity
from .permissions import (
    ADMIN_ROLE,
    BUILTIN_ROLE_PERMISSION_CODES,
    PERMISSION_CODES,
    is_registered_permission,
)


@dataclass(frozen=True, slots=True)
class AuthorizationSubject:
    """Current user/role state returned by an authorization repository."""

    username: str
    role_code: str | None
    user_enabled: bool = True
    role_enabled: bool = True


@dataclass(frozen=True, slots=True)
class AuthorizationDecision:
    """A transport-independent authorization result."""

    authenticated: bool
    allowed: bool
    permission: str | None = None
    subject: AuthorizationSubject | None = None
    reason: str = ""


class AuthorizationRepository(Protocol):
    """Minimal current-state contract required by the core."""

    def get_subject(self, identity: Identity) -> AuthorizationSubject | None:
        """Return current user/role state, or ``None`` when the user is gone."""

    def get_permissions(self, role_code: str) -> Iterable[str]:
        """Return current permission codes for one role."""
        return ()


class IdentityAuthorizationRepository:
    """Safe compatibility repository used by isolated adapter tests.

    The production ASGI composition injects the database repository.  This
    fallback deliberately knows only built-in mappings and fails closed for
    unknown roles; it never turns an arbitrary session role into admin.
    """

    def get_subject(self, identity: Identity) -> AuthorizationSubject | None:
        if not identity.user:
            return None
        return AuthorizationSubject(
            username=identity.user,
            role_code=identity.role,
            role_enabled=identity.role in BUILTIN_ROLE_PERMISSION_CODES,
        )

    def get_permissions(self, role_code: str) -> Iterable[str]:
        return BUILTIN_ROLE_PERMISSION_CODES.get(role_code, frozenset())


class AuthorizationService:
    """Resolve current role mappings and make deny-by-default decisions."""

    def __init__(self, repository: AuthorizationRepository | None = None):
        self.repository = repository or IdentityAuthorizationRepository()

    def current_subject(self, identity: Identity | None) -> AuthorizationSubject | None:
        if identity is None or not identity.user:
            return None
        return self.repository.get_subject(identity)

    def authenticate(self, identity: Identity | None) -> AuthorizationDecision:
        """Validate current identity/user/role state without checking a code."""
        if identity is None or not identity.user:
            return AuthorizationDecision(
                authenticated=False,
                allowed=False,
                reason="unauthenticated",
            )
        subject = self.current_subject(identity)
        if subject is None:
            return AuthorizationDecision(
                authenticated=False,
                allowed=False,
                subject=None,
                reason="user_not_found",
            )
        if not subject.user_enabled:
            return AuthorizationDecision(
                authenticated=False,
                allowed=False,
                subject=subject,
                reason="user_disabled",
            )
        if not subject.role_enabled or not subject.role_code:
            return AuthorizationDecision(
                authenticated=True,
                allowed=False,
                subject=subject,
                reason="role_unknown_or_disabled",
            )
        return AuthorizationDecision(
            authenticated=True,
            allowed=True,
            subject=subject,
            reason="authenticated",
        )

    def get_permissions(
        self,
        identity: Identity | None,
        *,
        authentication: AuthorizationDecision | None = None,
    ) -> tuple[str, ...]:
        """Return a stable current permission snapshot, or an empty set."""
        authentication = authentication or self.authenticate(identity)
        if (
            not authentication.authenticated
            or authentication.subject is None
            or not authentication.subject.role_enabled
            or not authentication.subject.role_code
        ):
            return ()
        current = self.repository.get_permissions(authentication.subject.role_code)
        return tuple(sorted({code for code in current if is_registered_permission(code)}))

    def authorize(
        self,
        identity: Identity | None,
        permission: str,
        *,
        authentication: AuthorizationDecision | None = None,
    ) -> AuthorizationDecision:
        """Check one registered permission against current repository state."""
        authentication = authentication or self.authenticate(identity)
        if not authentication.authenticated:
            return AuthorizationDecision(
                authenticated=False,
                allowed=False,
                permission=permission,
                subject=authentication.subject,
                reason=authentication.reason,
            )
        if authentication.reason == "role_unknown_or_disabled":
            return AuthorizationDecision(
                authenticated=True,
                allowed=False,
                permission=permission,
                subject=authentication.subject,
                reason=authentication.reason,
            )
        if not is_registered_permission(permission):
            return AuthorizationDecision(
                authenticated=True,
                allowed=False,
                permission=permission,
                subject=authentication.subject,
                reason="unknown_permission",
            )
        allowed = permission in self.get_permissions(
            identity,
            authentication=authentication,
        )
        return AuthorizationDecision(
            authenticated=True,
            allowed=allowed,
            permission=permission,
            subject=authentication.subject,
            reason="allowed" if allowed else "missing_permission",
        )

    def has_permission(self, identity: Identity | None, permission: str) -> bool:
        """Return ``True`` only for a current registered permission grant."""
        return self.authorize(identity, permission).allowed

    def is_admin(self, identity: Identity | None) -> bool:
        """Check the current role, not the role string cached in a session."""
        authentication = self.authenticate(identity)
        return bool(
            authentication.authenticated
            and authentication.subject
            and authentication.subject.role_code == ADMIN_ROLE
        )

    @property
    def registered_permissions(self) -> tuple[str, ...]:
        """Expose the deterministic registry for adapters and tests."""
        return PERMISSION_CODES
