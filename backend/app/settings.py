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

from __future__ import annotations

import os
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parents[2]
BACKEND_DIR = ROOT_DIR / "backend"
LOGS_DIR = ROOT_DIR / "logs"

_ENV_FILES = (
    ROOT_DIR / ".env",
    ROOT_DIR / ".env.local",
    BACKEND_DIR / ".env",
    BACKEND_DIR / ".env.local",
)

_TRUE_VALUES = {"1", "true", "yes", "on"}


def parse_bool(value: str | None) -> bool:
    """Return true only for explicitly supported, case-insensitive values."""
    return isinstance(value, str) and value.strip().lower() in _TRUE_VALUES


def parse_comma_separated_values(value: str | None) -> list[str]:
    """Return trimmed non-empty values without applying wildcard matching."""
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def get_int_env(
    name: str, default: int, *, minimum: int | None = None, maximum: int | None = None
) -> int:
    """Read a bounded integer setting, using *default* for blank or invalid input."""
    try:
        value = int(str(os.getenv(name, "")).strip())
    except (TypeError, ValueError):
        return default
    if (minimum is not None and value < minimum) or (
        maximum is not None and value > maximum
    ):
        return default
    return value


def get_float_env(name: str, default: float, *, minimum: float | None = None) -> float:
    """Read a bounded float setting, using *default* for blank or invalid input."""
    try:
        value = float(str(os.getenv(name, "")).strip())
    except (TypeError, ValueError):
        return default
    return default if minimum is not None and value < minimum else value


def get_string_env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip() or default


def get_compatible_env(name: str, legacy_name: str, default: str | None = None) -> str | None:
    """Read the APP_* name first, retaining the historical name as fallback."""
    value = os.getenv(name)
    if value is not None and value.strip():
        return value
    legacy_value = os.getenv(legacy_name)
    if legacy_value is not None and legacy_value.strip():
        return legacy_value
    return default


def get_int_env_from_compatible(name, legacy_name, default, **kwargs):
    value = get_compatible_env(name, legacy_name)
    return get_int_env(name, default, **kwargs) if value is None else _bounded_int(value, default, **kwargs)


def _bounded_int(value, default, *, minimum=None, maximum=None):
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    if (minimum is not None and parsed < minimum) or (maximum is not None and parsed > maximum):
        return default
    return parsed


def get_page_size_limits(default_size: int) -> tuple[int, int]:
    """Return the shared page-size override and its safe maximum."""
    maximum = get_int_env("APP_PAGE_SIZE_MAX", 200, minimum=1)
    default = get_int_env(
        "APP_PAGE_SIZE_DEFAULT", default_size, minimum=1, maximum=maximum
    )
    return default, maximum


def get_default_operator() -> str:
    return get_string_env("ASSET_OPERATOR", "system")


def get_auth_session_days() -> int:
    return get_int_env("AUTH_SESSION_DAYS", 14, minimum=1)


def get_session_secret() -> str:
    """Return the shared signed-session secret without importing Flask."""
    secret_key = get_compatible_env("APP_SECRET_KEY", "FLASK_SECRET_KEY")
    if not secret_key or not secret_key.strip():
        raise RuntimeError(
            "APP_SECRET_KEY must be set to a non-empty secret value (FLASK_SECRET_KEY remains a compatibility fallback)."
        )
    return secret_key


def get_session_cookie_config() -> dict[str, object]:
    """Return cookie security flags shared by Flask and FastAPI adapters."""
    environment = (get_compatible_env("APP_ENV", "FLASK_ENV", "production") or "production").strip().lower()
    return {
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        "SESSION_COOKIE_SECURE": environment != "development",
    }


def get_db_connect_timeout_seconds() -> int:
    return get_int_env("ASSET_DB_CONNECT_TIMEOUT_SECONDS", 30, minimum=1)


def get_db_statement_timeout_ms() -> int:
    return get_int_env("ASSET_DB_STATEMENT_TIMEOUT_MS", 120000, minimum=1)


def get_db_profile_overrides() -> dict[str, object]:
    """Return non-blank environment overrides for the selected DB profile."""
    fields = {
        "ASSET_DB_TYPE": "type",
        "ASSET_DB_HOST": "host",
        "ASSET_DB_PORT": "port",
        "ASSET_DB_DATABASE": "database",
        "ASSET_DB_USER": "user",
        "ASSET_DB_PASSWORD": "password",
        "ASSET_DB_DSN": "dsn",
        "ASSET_DB_JDBC_URL": "jdbc_url",
    }
    overrides: dict[str, object] = {
        target: value.strip()
        for source, target in fields.items()
        if (value := os.getenv(source)) and value.strip()
    }
    if "port" in overrides:
        overrides["port"] = get_int_env("ASSET_DB_PORT", 5432, minimum=1, maximum=65535)
    return overrides


def get_runtime_debug() -> bool:
    return parse_bool(get_compatible_env("APP_DEBUG", "FLASK_DEBUG"))


def get_trust_proxy_headers() -> bool:
    """Return whether the app trusts client-supplied proxy/forwarded headers.

    Security default is ``False``. Reverse-proxy deployments (Nginx) that want
    accurate client IPs in audit logs must explicitly opt in, so that a client
    cannot forge ``X-Forwarded-For`` on a direct connection.
    """
    return parse_bool(os.getenv("ASSET_TRUST_PROXY_HEADERS"))


def get_runtime_config() -> dict[str, object]:
    """Build the small, security-sensitive runtime configuration surface."""
    environment = (get_compatible_env("APP_ENV", "FLASK_ENV", "production") or "production").strip().lower()
    if environment == "production" and get_runtime_debug():
        raise RuntimeError(
            "APP_DEBUG (legacy FLASK_DEBUG) must be disabled in production; the Werkzeug debugger must never run there."
        )

    max_content_length = (
        get_int_env_from_compatible("APP_MAX_CONTENT_LENGTH_MB", "FLASK_MAX_CONTENT_LENGTH_MB", 16, minimum=1, maximum=512)
        * 1024
        * 1024
    )
    return {
        "SECRET_KEY": get_session_secret(),
        **get_session_cookie_config(),
        "CORS_ORIGINS": parse_comma_separated_values(get_compatible_env("APP_CORS_ORIGINS", "FLASK_CORS_ORIGINS")),
        "MAX_CONTENT_LENGTH": max_content_length,
        "SECURITY_HEADERS": {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "SAMEORIGIN",
            "Referrer-Policy": "strict-origin-when-cross-origin",
        },
    }


def load_runtime_env(*, overwrite: bool = True):
    """Load repository env files, optionally preserving process-owned values.

    Normal development keeps the historical file precedence.  The Community
    Demo uses ``overwrite=False`` so its explicit child-process environment
    cannot be redirected by a user's unrelated ``.env`` database settings.
    """
    for env_file in _ENV_FILES:
        if not env_file.exists():
            continue

        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            if not key:
                continue

            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                value = value[1:-1]

            if overwrite or key not in os.environ:
                os.environ[key] = value
