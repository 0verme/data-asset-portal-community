# Backend configuration

`backend/.env.example` is the first-deployment template, not an inventory of every
runtime knob. Advanced settings remain supported in code and are listed here for
operators who need them.

## Application names and compatibility

Use `APP_SECRET_KEY`, `APP_ENV`, `APP_DEBUG`, `APP_CORS_ORIGINS`, and
`APP_MAX_CONTENT_LENGTH_MB`. During the compatibility period each falls back to
its historical `FLASK_*` counterpart when the new value is blank or absent;
`APP_*` wins if both are set. Existing deployments can migrate without a
breaking change. New documentation and templates use only `APP_*` names.

The secret is required and must come from a secret manager or equivalent secure
store. Debug must remain disabled in production. The old names are retained for
migration and are deprecated; they may be removed in a future release after
operators have migrated.

## OpenAPI and interactive docs exposure

`APP_ENV` also defines the default HTTP exposure policy for the FastAPI-generated
OpenAPI schema and interactive documentation:

| Normalized environment | `/docs` | `/redoc` | `/openapi.json` |
|---|---:|---:|---:|
| `development` | enabled | enabled | enabled |
| unset (defaults to production) | disabled | disabled | disabled |
| `production` or any other value | disabled | disabled | disabled |

Only the exact normalized value `development` enables these endpoints. `APP_ENV`
wins over the retained `FLASK_ENV` fallback when both are present. No separate
OpenAPI deployment variable is required. Production can still generate its
schema internally with `app.openapi()`; the policy only prevents registering the
HTTP documentation endpoints. The app factory's optional `openapi_enabled` seam is
for tests or embedded composition only; its default `None` follows this policy
and it is not a deployment environment variable.

## Advanced runtime settings

Change these only when the deployment has a concrete operational requirement.
Defaults are shown for orientation and are implemented by the runtime.

| Variable | Purpose | Default / scope |
|---|---|---|
| `ASSET_DB_CONNECT_TIMEOUT_SECONDS` | DB connection timeout | `30`; provider dependent |
| `ASSET_DB_STATEMENT_TIMEOUT_MS` | query statement timeout | `120000`; PostgreSQL/GaussDB |
| `ASSET_SCHEMA_PREFIX` | logical schema prefix for asset services | unset; optional |
| `ASSET_OPERATOR` | default audit operator | `system` |
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
