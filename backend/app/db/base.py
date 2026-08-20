"""Database backend provider contract shared by runtime engines."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
import re
from typing import Protocol, runtime_checkable


class BackendCapability(str, Enum):
    """Infrastructure capabilities that a backend may expose."""

    SQLALCHEMY_ENGINE = "sqlalchemy_engine"
    DBAPI_CONNECTION = "dbapi_connection"
    TRANSACTIONS = "transactions"
    SAVEPOINTS = "savepoints"
    CONNECTION_POOL = "connection_pool"
    SCHEMA_TRANSLATION = "schema_translation"
    ALEMBIC_ONLINE = "alembic_online"
    JDBC = "jdbc"
    BATCH_EXECUTION = "batch_execution"


@dataclass(frozen=True)
class BackendCapabilities:
    """Typed, honest capability declaration for one provider.

    The flags describe infrastructure that is implemented today.  They are
    deliberately independent of database brand so callers can ask what a
    backend does rather than which vendor it represents.
    """

    sqlalchemy_engine: bool = False
    dbapi_connection: bool = False
    transactions: bool = False
    savepoints: bool = False
    connection_pool: bool = False
    schema_translation: bool = False
    alembic_online: bool = False
    jdbc: bool = False
    batch_execution: bool = False

    def supports(self, capability: BackendCapability) -> bool:
        """Return whether this provider supports *capability*."""
        return bool(getattr(self, capability.value))


@runtime_checkable
class DatabaseBackendProvider(Protocol):
    """The stable plug-in boundary for one database family."""

    @property
    def name(self) -> str: ...

    @property
    def aliases(self) -> tuple[str, ...]: ...

    @property
    def migration_dialect(self) -> str: ...

    @property
    def placeholder(self) -> str: ...

    @property
    def capabilities(self) -> BackendCapabilities: ...

    def validate(self, profile: str, config: dict, *, config_path):
        """Validate and normalize one profile without opening a connection."""

    def create_engine(self, config: dict):
        """Return a SQLAlchemy Engine, or ``None`` for a non-SQLAlchemy backend."""

    def connect(self, config: dict):
        """Return a DB-API/JDBC-compatible connection with transactions enabled."""

    def physical_schema(self, config: dict) -> str | None:
        """Resolve the logical application schema for this backend."""


def validate_provider_contract(provider: DatabaseBackendProvider) -> None:
    """Fail fast when a built-in or third-party provider is malformed."""
    name = getattr(provider, "name", None)
    aliases = getattr(provider, "aliases", None)
    if not isinstance(name, str) or not name.strip():
        raise TypeError("database provider name must be a non-empty string")
    if not isinstance(aliases, tuple) or not all(isinstance(alias, str) for alias in aliases):
        raise TypeError("database provider aliases must be a tuple of strings")

    names = [name, *aliases]
    normalized = [item.strip().lower() for item in names]
    if any(not item for item in normalized):
        raise ValueError("database provider names must not be empty")
    if len(normalized) != len(set(normalized)):
        raise ValueError("database provider names and aliases must be unique")

    if not isinstance(getattr(provider, "migration_dialect", None), str) or not provider.migration_dialect.strip():
        raise TypeError("database provider migration_dialect must be a non-empty string")
    if not isinstance(getattr(provider, "placeholder", None), str) or not provider.placeholder:
        raise TypeError("database provider placeholder must be a non-empty string")
    if not isinstance(getattr(provider, "capabilities", None), BackendCapabilities):
        raise TypeError("database provider capabilities must be BackendCapabilities")

    for method in ("validate", "create_engine", "connect", "physical_schema"):
        if not callable(getattr(provider, method, None)):
            raise TypeError(f"database provider must implement {method}()")


def redact_sensitive_text(message: object, config: dict | None = None) -> str:
    """Remove credentials and URL secrets from provider errors and logs."""
    text = str(message)
    secrets = []
    for key in ("password", "token", "secret", "api_key", "access_token", "dsn", "jdbc_url", "connection_url", "url"):
        value = (config or {}).get(key)
        if value:
            secrets.append(str(value))
    for secret in sorted(set(secrets), key=len, reverse=True):
        text = text.replace(secret, "***")
    text = re.sub(r"(?i)(password|passwd|pwd|token|secret|api[_-]?key)=([^&\s,;]+)", r"\1=***", text)
    text = re.sub(r"(?i)(://[^:/@\s]+:)[^@\s]+@", r"\1***@", text)
    return text


class DatabaseConnectionError(RuntimeError):
    """Controlled, credential-safe connection failure."""

    def __init__(self, profile: str, provider: str, reason: object, config: dict | None = None):
        safe_reason = redact_sensitive_text(reason, config)
        super().__init__(f"database connection failed for provider={provider} profile={profile}: {safe_reason}")


class DatabaseTransactionError(RuntimeError):
    """Infrastructure transaction contract violation."""


class CrossProfileTransactionError(DatabaseTransactionError):
    """Raised when one transaction attempts to use another profile."""


DatabaseAdapter = DatabaseBackendProvider
