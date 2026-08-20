"""Framework-neutral authenticated identity value object."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Mapping


ADMIN_ROLE = "admin"
MAINTAINER_ROLE = "maintainer"
MAINTENANCE_ROLES = frozenset({ADMIN_ROLE, MAINTAINER_ROLE})


@dataclass(frozen=True, slots=True)
class Identity:
    """The minimum identity shared by HTTP adapters and application code."""

    role: str
    user: str | None = None
    name: str | None = None

    def as_dict(self) -> dict[str, str | None]:
        return asdict(self)

    @property
    def is_admin(self) -> bool:
        return self.role == ADMIN_ROLE


def identity_from_mapping(value: Mapping[str, Any] | None) -> Identity | None:
    """Parse a persisted identity without depending on a web framework."""
    if not isinstance(value, Mapping) or value.get("role") not in MAINTENANCE_ROLES:
        return None
    user = value.get("user") or None
    name = value.get("name") or user
    return Identity(role=str(value["role"]), user=user, name=name)


def identity_for_session(value: Mapping[str, Any] | None) -> Identity:
    """Normalize a successful login result for the legacy session format.

    The existing Flask implementation defaults unknown roles to ``admin``.
    Keeping that behavior here makes the rule explicit and reusable by a
    future adapter without changing current authentication semantics.
    """
    if not isinstance(value, Mapping):
        value = {}
    role = value.get("role")
    if role not in MAINTENANCE_ROLES:
        role = ADMIN_ROLE
    user = value.get("user") or None
    return Identity(role=str(role), user=user, name=value.get("name") or user)
