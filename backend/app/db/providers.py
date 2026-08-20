"""Built-in database backend providers."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool, StaticPool

from ..settings import get_db_connect_timeout_seconds, get_db_statement_timeout_ms
from .base import BackendCapabilities

LOGICAL_SCHEMA = "__app__"
DEFAULT_GAUSS_DRIVER = "com.huawei.gauss200.jdbc.Driver"


def with_jdbc_timeouts(jdbc_url: str, *, connect_timeout_seconds=None, socket_timeout_seconds=None) -> str:
    raw_url = (jdbc_url or "").strip()
    if not raw_url:
        return raw_url
    connect_timeout_seconds = connect_timeout_seconds or get_db_connect_timeout_seconds()
    socket_timeout_seconds = socket_timeout_seconds or max(1, get_db_statement_timeout_ms() // 1000)
    split = urlsplit(raw_url.replace("jdbc:", "", 1))
    params = dict(parse_qsl(split.query, keep_blank_values=True))
    params.setdefault("loginTimeout", str(int(connect_timeout_seconds)))
    params.setdefault("connectTimeout", str(int(connect_timeout_seconds) * 1000))
    params.setdefault("socketTimeout", str(int(socket_timeout_seconds) * 1000))
    rebuilt = urlunsplit((split.scheme, split.netloc, split.path, urlencode(params), split.fragment))
    return f"jdbc:{rebuilt}"


SQLALCHEMY_CAPABILITIES = BackendCapabilities(
    sqlalchemy_engine=True,
    dbapi_connection=True,
    transactions=True,
    connection_pool=True,
    schema_translation=True,
    alembic_online=True,
    batch_execution=True,
)
JDBC_CAPABILITIES = BackendCapabilities(
    dbapi_connection=True,
    transactions=True,
    schema_translation=True,
    jdbc=True,
    batch_execution=True,
)


def _positive_int(config: dict, key: str, default: int, profile: str) -> int:
    value = config.setdefault(key, default)
    try:
        value = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"database profile '{profile}' requires {key} to be a positive integer") from exc
    if value < 1:
        raise ValueError(f"database profile '{profile}' requires {key} to be a positive integer")
    config[key] = value
    return value


def _port(config: dict, profile: str, default: int) -> int:
    value = _positive_int(config, "port", default, profile)
    if value > 65535:
        raise ValueError(f"database profile '{profile}' requires port between 1 and 65535")
    return value


@dataclass(frozen=True)
class SQLiteProvider:
    name: str = "sqlite"
    aliases: tuple[str, ...] = ()
    migration_dialect: str = "sqlite"
    placeholder: str = "?"
    capabilities: BackendCapabilities = SQLALCHEMY_CAPABILITIES

    def validate(self, profile: str, config: dict, *, config_path: Path):
        database = str(config.get("database") or "").strip()
        if not database:
            raise ValueError(f"sqlite profile '{profile}' requires database")
        config["database"] = database
        return config

    def create_engine(self, config: dict):
        from .sqlite_adapter import connect

        options = {"creator": lambda: connect(config), "pool_pre_ping": True}
        if config["database"] == ":memory:":
            options["poolclass"] = StaticPool
        else:
            options["poolclass"] = NullPool
        return create_engine("sqlite+pysqlite://", **options)

    def connect(self, config: dict):
        return self.create_engine(config).raw_connection()

    def physical_schema(self, config: dict):
        return "dwp"


@dataclass(frozen=True)
class PostgreSQLProvider:
    name: str = "postgres"
    aliases: tuple[str, ...] = ("postgresql",)
    migration_dialect: str = "postgresql"
    placeholder: str = "%s"
    capabilities: BackendCapabilities = SQLALCHEMY_CAPABILITIES

    def validate(self, profile: str, config: dict, *, config_path: Path):
        config.setdefault("host", "127.0.0.1")
        _port(config, profile, 5432)
        _positive_int(config, "connect_timeout", get_db_connect_timeout_seconds(), profile)
        _positive_int(config, "statement_timeout_ms", get_db_statement_timeout_ms(), profile)
        _positive_int(config, "pool_size", 5, profile)
        _positive_int(config, "pool_timeout", 30, profile)
        _positive_int(config, "pool_recycle", 1800, profile)
        if "database" not in config and "dbname" in config:
            config["database"] = config["dbname"]
        if not config.get("database") and not config.get("dsn"):
            raise ValueError(f"postgres profile '{profile}' requires database or dsn")
        if not config.get("dsn"):
            required = [key for key in ("user", "password") if not config.get(key)]
            if required:
                raise ValueError(f"postgres profile '{profile}' requires {', '.join(required)}")
        return config

    @staticmethod
    def _options(config: dict):
        options = []
        if config.get("schema"):
            options.append(f"-c search_path={config['schema']}")
        if config.get("statement_timeout_ms") is not None:
            options.append(f"-c statement_timeout={int(config['statement_timeout_ms'])}")
        return " ".join(options) or None

    def create_engine(self, config: dict):
        from .postgres_adapter import connect

        return create_engine(
            "postgresql+psycopg://",
            creator=lambda: connect(config, options=self._options(config)),
            pool_pre_ping=True,
            pool_size=int(config.get("pool_size", 5)),
            max_overflow=int(config.get("max_overflow", 10)),
            pool_timeout=int(config.get("pool_timeout", 30)),
            pool_recycle=int(config.get("pool_recycle", 1800)),
        )

    def connect(self, config: dict):
        return self.create_engine(config).raw_connection()

    def physical_schema(self, config: dict):
        return str(config.get("schema") or "dwp")


@dataclass(frozen=True)
class GaussDBProvider:
    name: str = "gaussdb"
    aliases: tuple[str, ...] = ("dws",)
    migration_dialect: str = "dws"
    placeholder: str = "?"
    capabilities: BackendCapabilities = JDBC_CAPABILITIES

    def validate(self, profile: str, config: dict, *, config_path: Path):
        config.setdefault("driver", DEFAULT_GAUSS_DRIVER)
        _positive_int(config, "connect_timeout", get_db_connect_timeout_seconds(), profile)
        _positive_int(config, "socket_timeout", max(1, get_db_statement_timeout_ms() // 1000), profile)
        _positive_int(config, "statement_timeout_ms", get_db_statement_timeout_ms(), profile)
        default_jar = Path(__file__).resolve().parents[2] / "resources" / "jars" / "gaussdb-jdbc.jar"
        configured = Path(config.get("jar_path") or default_jar)
        if not configured.is_absolute():
            configured = config_path.parent.parent / configured
        jar_path = configured if configured.exists() else default_jar
        if not jar_path.exists():
            raise ValueError(
                f"gaussdb profile '{profile}' requires a JDBC driver jar that is not present. "
                "Set ASSET_DB_JAR_PATH or jar_path to the vendor driver."
            )
        required = [key for key in ("jdbc_url", "user", "password") if not config.get(key)]
        if required:
            raise ValueError(f"gaussdb profile '{profile}' requires {', '.join(required)}")
        config["jar_path"] = str(jar_path)
        config["jdbc_url"] = with_jdbc_timeouts(
            config["jdbc_url"],
            connect_timeout_seconds=int(config["connect_timeout"]),
            socket_timeout_seconds=int(config["socket_timeout"]),
        )
        return config

    def create_engine(self, config: dict):
        return None

    def connect(self, config: dict):
        from .gaussdb_adapter import connect

        return connect(config)

    def physical_schema(self, config: dict):
        return str(config.get("schema") or "dwp")


BUILTIN_PROVIDERS = (SQLiteProvider(), PostgreSQLProvider(), GaussDBProvider())
