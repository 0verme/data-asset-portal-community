"""Framework-neutral audit actor contract.

The request context is the authoritative source for an authenticated HTTP
request.  Explicit actors are available for non-request callers such as
ingestion jobs and CLI commands; a system actor is only selected when the
caller declares it explicitly.
"""

from __future__ import annotations

from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from enum import Enum
from functools import wraps
from typing import Any, Callable

from .context import current_request_context
from .identity import Identity


class ActorSource(str, Enum):
    """Where an audit actor was obtained."""

    REQUEST = "request"
    EXPLICIT = "explicit"
    SYSTEM = "system"
    ANONYMOUS = "anonymous"


@dataclass(frozen=True, slots=True)
class Actor:
    """The small actor value shared by business and operation auditing.

    ``name`` is the canonical human-readable username written to legacy
    ``created_by``, ``updated_by`` and ``operator_name`` columns.  ``id`` is
    retained for structured operation-log identity.  ``display_name`` keeps
    the existing operation-log display-name behavior without changing the
    business-column contract.
    """

    id: str | None
    name: str
    source: ActorSource
    display_name: str | None = None

    @classmethod
    def from_identity(cls, identity: Identity) -> "Actor":
        user = _clean(identity.user)
        display_name = _clean(identity.name) or user or "anonymous"
        return cls(
            id=user or None,
            name=user or display_name,
            source=ActorSource.REQUEST,
            display_name=display_name,
        )

    @classmethod
    def anonymous(cls) -> "Actor":
        return cls(
            id=None,
            name="anonymous",
            source=ActorSource.ANONYMOUS,
            display_name="anonymous",
        )

    @property
    def operation_name(self) -> str:
        """Name retained in the operation-log ``userName`` field."""
        return self.display_name or self.name


ActorLike = Actor | Identity | str | Mapping[str, Any] | None

_CURRENT_OPERATION_ACTOR: ContextVar[Actor | None] = ContextVar(
    "current_operation_actor", default=None
)


def _clean(value: Any) -> str:
    return str(value).strip() if value is not None and str(value).strip() else ""


def _coerce_actor(value: ActorLike, *, source: ActorSource) -> Actor:
    if isinstance(value, Actor):
        return value
    if isinstance(value, Identity):
        actor = Actor.from_identity(value)
        return Actor(actor.id, actor.name, source, actor.display_name)
    if isinstance(value, Mapping):
        user = _clean(value.get("user") or value.get("userId") or value.get("id"))
        name = _clean(value.get("name") or value.get("userName") or user)
        return Actor(id=user or None, name=name or "anonymous", source=source, display_name=name or "anonymous")
    name = _clean(value)
    return Actor(id=None, name=name or "anonymous", source=source, display_name=name or "anonymous")


def current_operation_actor() -> Actor | None:
    """Return an explicitly scoped actor, if a service operation installed one."""
    return _CURRENT_OPERATION_ACTOR.get()


@contextmanager
def actor_scope(actor: Actor | None):
    """Install an operation actor and always restore the previous value."""
    token = _CURRENT_OPERATION_ACTOR.set(actor)
    try:
        yield actor
    finally:
        _CURRENT_OPERATION_ACTOR.reset(token)


def resolve_actor(
    *,
    explicit_actor: ActorLike = None,
    system_actor: ActorLike = None,
) -> Actor:
    """Resolve the canonical audit actor.

    Resolution is deliberately strict:

    ``request identity -> explicit actor -> explicit system actor -> anonymous``

    In particular, an explicit actor cannot impersonate an authenticated HTTP
    request, and a missing identity is never silently converted to ``system``.
    """
    context = current_request_context()
    if context is not None and context.identity is not None:
        return Actor.from_identity(context.identity)
    if explicit_actor is not None:
        return _coerce_actor(explicit_actor, source=ActorSource.EXPLICIT)
    if system_actor is not None:
        return _coerce_actor(system_actor, source=ActorSource.SYSTEM)
    scoped = current_operation_actor()
    return scoped if scoped is not None else Actor.anonymous()


def configured_system_actor() -> Actor:
    """Return the deployment-configured system actor for explicit callers."""
    from ..settings import get_default_operator

    return _coerce_actor(get_default_operator(), source=ActorSource.SYSTEM)


def actor_aware(function: Callable[..., Any]) -> Callable[..., Any]:
    """Make a service mutation accept optional ``actor``/``system_actor``.

    The wrapped implementation keeps its existing business signature.  This
    avoids threading an actor through every private SQL builder while still
    giving CLI, ingestion and background callers an explicit entry point.
    """

    @wraps(function)
    def wrapped(*args: Any, actor: ActorLike = None, system_actor: ActorLike = None, **kwargs: Any):
        resolved = resolve_actor(explicit_actor=actor, system_actor=system_actor)
        with actor_scope(resolved):
            return function(*args, **kwargs)

    return wrapped


class AuditActorMixin:
    """Compatibility surface for legacy service SQL builders."""

    @property
    def _default_operator(self) -> str:
        """Return the current canonical actor name, never a global fallback."""
        return resolve_actor().name

    @property
    def _operator(self) -> str:
        """Metadata-ingestion alias for the canonical actor name."""
        return resolve_actor().name


__all__ = [
    "Actor",
    "ActorLike",
    "ActorSource",
    "AuditActorMixin",
    "actor_aware",
    "actor_scope",
    "configured_system_actor",
    "current_operation_actor",
    "resolve_actor",
]
