"""Framework-neutral authenticated identity value object."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass
from typing import Any


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
    """Normalize a successful login result without upgrading unknown roles."""
    if not isinstance(value, Mapping):
        value = {}
    role = str(value.get("role") or "").strip().lower()
    user = value.get("user") or None
    return Identity(role=role, user=user, name=value.get("name") or user)
