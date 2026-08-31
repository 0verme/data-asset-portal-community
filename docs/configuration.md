# Backend configuration

`backend/.env.example` is the first-deployment template, not an inventory of every
runtime knob. Advanced settings remain supported in code and are listed here for
operators who need them.

## Application configuration contract

The native runtime reads only `APP_SECRET_KEY`, `APP_ENV`, `APP_DEBUG`,
`APP_CORS_ORIGINS`, and `APP_MAX_CONTENT_LENGTH_MB` for application security,
session, CORS, and request-size settings. `APP_*` is the only supported
configuration namespace after Issue #145; the old names are ignored rather than
silently falling back.

This is the documented breaking cleanup after the published v0.1.1 migration
window. Migrate deployments before upgrading:

| Legacy name | Native name | Policy |
|---|---|---|
| `FLASK_SECRET_KEY` | `APP_SECRET_KEY` | Removed; copy the existing secret value to preserve sessions |
| `FLASK_ENV` | `APP_ENV` | Removed; default is the secure production behavior |
| `FLASK_DEBUG` | `APP_DEBUG` | Removed; default is disabled |
| `FLASK_CORS_ORIGINS` | `APP_CORS_ORIGINS` | Removed; use the exact comma-separated allowlist |
| `FLASK_MAX_CONTENT_LENGTH_MB` | `APP_MAX_CONTENT_LENGTH_MB` | Removed; default is 16 MiB |

The secret is required and must come from a secret manager or equivalent secure
store. Debug must remain disabled in production. An old `FLASK_*` value does not
satisfy a missing `APP_*` setting and is never logged or echoed by the runtime.

## Signed-session contract

The application now writes an application-owned signed `session` cookie using
`itsdangerous`, an application-owned salt, and HMAC-SHA256. This is a native
browser-session security primitive, not a Flask compatibility layer. The cookie
still contains only the minimum identity mapping and retains `HttpOnly`,
`SameSite=Lax`, production `Secure`, tamper detection, and bounded expiration.

For rolling migration, the runtime reads the pre-#145 `cookie-session`/HMAC-SHA1
wire format only when the native codec fails, and reissues a verified identity
with the native codec after a successful response. The reader is bounded by the
configured `AUTH_SESSION_DAYS` max age and is read-only; future cleanup may
remove it after one complete maximum legacy-cookie lifetime. Keep the existing
secret value when changing the configuration name. Rotating the secret at the
same time intentionally invalidates both cookie formats. If an emergency
rollback is needed before the legacy lifetime ends, roll back through a bridge
that reads both formats; a direct pre-#145 binary can read legacy cookies but
cannot read cookies already reissued in the native format.

## Compatibility inventory (#145)

| Surface | Decision | Current result |
|---|---|---|
| `FLASK_*` runtime names | REMOVE | `APP_*` only; migration table above |
| Native signed-session codec | KEEP — signed browser session is a native requirement | HMAC-SHA256; writes only native format |
| Legacy session reader | DEPRECATE UNTIL all pre-#145 cookies expire | Read-only rolling migration; no forced logout when the secret is preserved |
| `flaskFallback` health field | REMOVE | `/healthz` reports only the native runtime contract |
| `backend/app/fastapi_app.py` | KEEP — stable internal import path | Thin facade with no framework compatibility logic |
| Werkzeug | KEEP — password hashing | Used directly by `AuthService`; not a Flask runtime dependency |

There is intentionally no Public Catalog feature flag. Community Edition
uses the fixed `Public Catalog + Authenticated Management` contract: ordinary
catalog GET routes are public with necessary response redaction, while
mutations, administration, sensitive reads, connection data, credentials and
audit data remain protected. The complete route inventory is listed in [the
Public Catalog contract](./rbac/authenticated-read-model.md).

## OpenAPI and interactive docs exposure

`APP_ENV` also defines the default HTTP exposure policy for the FastAPI-generated
OpenAPI schema and interactive documentation:

| Normalized environment | `/docs` | `/redoc` | `/openapi.json` |
|---|---:|---:|---:|
| `development` | enabled | enabled | enabled |
| unset (defaults to production) | disabled | disabled | disabled |
| `production` or any other value | disabled | disabled | disabled |

Only the exact normalized value `development` enables these endpoints. The
runtime reads `APP_ENV` only; no separate OpenAPI deployment variable is
required. Production can still generate its schema internally with
`app.openapi()`; the policy only prevents registering the HTTP documentation
endpoints. The app factory's optional `openapi_enabled` seam is for tests or
embedded composition only; its default `None` follows this policy and it is not
a deployment environment variable.

## Advanced runtime settings

Change these only when the deployment has a concrete operational requirement.
Defaults are shown for orientation and are implemented by the runtime.

| Variable | Purpose | Default / scope |
|---|---|---|
| `ASSET_DB_CONNECT_TIMEOUT_SECONDS` | DB connection timeout | `30`; provider dependent |
| `ASSET_DB_STATEMENT_TIMEOUT_MS` | query statement timeout | `120000`; PostgreSQL/GaussDB |
| `ASSET_SCHEMA_PREFIX` | logical schema prefix for asset services | unset; optional |
| `ASSET_OPERATOR` | name used by explicitly declared system/background actors; not an HTTP fallback | `system` |
| `APP_PAGE_SIZE_DEFAULT`, `APP_PAGE_SIZE_MAX` | pagination bounds | service defaults; runtime |
| `FIELD_MAPPING_STATS_CACHE_TTL_SECONDS`, `PORTAL_STATS_CACHE_TTL_SECONDS` | service cache TTLs | `300`, `600` |
| `APP_SLOW_SERVICE_SECONDS` | slow-service logging threshold | `3` |
| `SEARCH_DEFAULT_LIMIT`, `SEARCH_MODULE_LIMIT`, `SEARCH_MAX_LIMIT` | search result limits | `5`, `10`, `50` |
| `APP_LOG_MAX_BYTES`, `APP_LOG_BACKUP_COUNT` | log rotation | `2097152`, `5` |
| `ASSET_DB_TYPE` | provider type override | selected profile; provider-specific |
| `ASSET_DB_JDBC_URL` | GaussDB JDBC URL override | selected profile; GaussDB only |
| `ASSET_DB_JAR_PATH` | GaussDB JDBC driver path | profile/default; GaussDB only |

`ASSET_DB_HOST`, `ASSET_DB_PORT`, `ASSET_DB_DATABASE`, and `ASSET_DB_USER` are
also supported as provider/profile overrides. `ASSET_DB_PASSWORD` and DSNs/JDBC
URLs are sensitive and should not be placed in committed files.

## Database files and precedence

The repository does not include `backend/configs/database.yaml`. For a normal
deployment, copy `backend/configs/database.example.yaml` to
`backend/configs/database.yaml` and edit the selected profile. Leave
`ASSET_DB_CONFIG_PATH` unset so the runtime uses that default path (resolved
from the backend package, not process cwd). Set `ASSET_DB_CONFIG_PATH` only when
you need an absolute, environment-specific YAML. Community runtime
(`ASSET_RUNTIME_PROFILE=community`) selects `database.community.yaml`.
`ASSET_AUTH_DB_PROFILE` is optional; when unset, auth falls back to
`ASSET_DB_PROFILE` (and then to an available `primary` profile when present).

Resolution is:

1. `ASSET_DB_PROFILE` (and optional `ASSET_AUTH_DB_PROFILE`) selects profiles.
2. YAML `defaults` are merged with the selected profile.
3. Non-empty `ASSET_DB_*` environment overrides replace YAML/profile values.
4. `ASSET_DB_JAR_PATH` overrides a GaussDB `jar_path`.
5. PostgreSQL uses `dsn` when present; otherwise it uses host, port, database,
   user, and password.

The profile/provider abstraction remains the supported path for SQLite,
PostgreSQL, MySQL, and GaussDB/DWS, including SQLAlchemy, DBAPI, and JDBC
providers. `TEST_DATABASE_PROFILE` and `TEST_DATABASE_CONFIG_PATH` are test/CI
inputs only; they are intentionally absent from the deployment template.

## One-time administrator bootstrap

After applying the database schema migration, run:

```bash
python backend/scripts/create_admin.py
```

The command prompts for username, display name, password, and confirmation.
Passwords are hidden and never written to environment files or logs. It refuses
to overwrite an existing username and reports that migration is required when
the schema is not initialized. There is no default administrator password.
