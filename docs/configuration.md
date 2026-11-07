# Backend configuration

`backend/.env.example` is the first-deployment template, not an inventory of every
runtime knob. Advanced settings remain supported in code and are listed here for
operators who need them.

## Application configuration contract

The native runtime reads only `APP_SECRET_KEY`, `APP_ENV`, `APP_DEBUG`,
`APP_CORS_ORIGINS`, and `APP_MAX_CONTENT_LENGTH_MB` for application security,
session, CORS, and the finite global request-size setting. Metadata ingestion also
uses the narrower `METADATA_MAX_BODY_MB` limit. `APP_*` is the only supported
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
| `FLASK_MAX_CONTENT_LENGTH_MB` | `APP_MAX_CONTENT_LENGTH_MB` | Removed; default is 128 MiB |

The secret is required and must come from a secret manager or equivalent secure
store. Debug must remain disabled in production. An old `FLASK_*` value does not
satisfy a missing `APP_*` setting and is never logged or echoed by the runtime.

## Optional catalog snapshot composition

The authorized read-only catalog snapshot exporter is **not enabled by default**.
It introduces no environment variable, required secret, startup probe, database
change, or model dependency. A trusted DAP composition may explicitly inject
`catalog_snapshot_service_instance` into `create_fastapi_app`; issuance is a
trusted Python operation, not an HTTP mint endpoint. Its short-lived workload
proof is generated independently of `APP_SECRET_KEY` and browser cookies.

Only file-backed SQLite capture is currently supported. Other providers fail
closed; no live PostgreSQL/MySQL/GaussDB-DWS snapshot support is implied by
existing CRUD CI. Deployment TLS, secret delivery and worker affinity require
separate verification. Limits, expiry, authorization rechecks, disabled behavior,
rollback and remaining integration gates are documented in
[the catalog snapshot contract](./catalog-snapshot.md).

## Optional single-turn AI asset Q&A

The AI Q&A feature is **disabled by default** and is separate from deterministic
`GET /api/search` and optional RAG recommendations. It only accepts a single
metadata question and uses the existing server-side RAG HTTP adapter plus an
OpenAI-compatible LLM Provider. DAP does not load an embedding model/vector
index or let the browser access the LLM endpoint.

| Setting | Default / bounds | Purpose |
|---|---|---|
| `AI_ASK_ENABLED` | `false` | Explicit feature switch. |
| `AI_LLM_BASE_URL` | required when enabled | OpenAI-compatible API base URL. HTTPS is required except HTTP loopback; URL credentials, query strings and fragments are rejected. |
| `AI_LLM_MODEL` | required when enabled | Server-side provider model identifier. |
| `AI_LLM_API_KEY` | required when enabled | Provider secret, injected from deployment Secret storage only; never stored in DAP parameter rows or returned to the browser. |
| `AI_LLM_TIMEOUT_MS` | `10000` (250–60000) | Absolute Provider request/response deadline, including streaming-body delivery (not only per-read inactivity). |
| `AI_LLM_MAX_TOKENS` | `512` (64–4096) | Output token ceiling. |
| `AI_LLM_MAX_CONCURRENCY` | `2` (1–16) | Non-blocking Provider concurrency bound. |
| `AI_LLM_DISABLE_THINKING` | `false` | Send `thinking: {"type": "disabled"}` to providers that enable reasoning by default (DeepSeek). Omitted unless enabled, so providers that reject unknown request fields keep working. |

Some OpenAI-compatible providers (notably DeepSeek) enable a reasoning mode by
default. Reasoning tokens are billed inside `AI_LLM_MAX_TOKENS` and can consume
the budget before the strict selection JSON is emitted, which surfaces as
`invalid_model_output`. Set `AI_LLM_DISABLE_THINKING=true` to add
`"thinking": {"type": "disabled"}` to the request body. The field is omitted by
default so providers that reject unknown request fields keep working.

The browser-safe `GET /api/ai/status` exposes only `{"enabled": boolean}`. It
also requires the existing RAG search configuration to be enabled and its
server-to-server token configured; it does not perform a live health probe.
`POST /api/ai/ask` reuses the current public-catalog profile and existing RAG
HTTP service, then validates every model citation against the exact DAP-verified
candidate identities. Missing/invalid configuration fails closed. See
[the architecture, contract, test and rollback guide](./ai-ask-mvp.md) for the
API state semantics and isolated-environment handoff. This configuration does
not claim that an external RAG HTTP service or DeepSeek endpoint is available.

Three request transports share one service and one evidence contract:

| Transport | Shape | Consumer |
|---|---|---|
| `POST /api/ai/ask/stream` | SSE `step_start` / `step_complete` / `step_error` / `answer` / `done` / `keep_alive` | Current frontend UI (`frontend/src/api/aiAskExecution.ts`) |
| `POST /api/ai/ask/progress` | SSE `progress` + single `result` | Compatibility client |
| `POST /api/ai/ask` | Single JSON `AiAskResponse` | Compatibility client |

None of them streams model tokens; the answer is delivered as one validated
payload. The search page exposes these as two result tabs —「搜索结果」(deterministic
`GET /api/search`) and「AI 问答」(the explicit AI action). Ordinary search never
invokes the model.

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

The Community Edition route inventory remains static, but anonymous catalog
visibility is configurable independently from route registration:

| Setting | Default | Values / behavior |
|---|---|---|
| `PUBLIC_CATALOG_PROFILE` | `internal` | `internal` publishes and searches safe connection locator metadata (host, port, database, schema, sanitized JDBC endpoint) plus business contacts; `strict` hides connection locators and person identity, and excludes them from anonymous search; `disabled` rejects anonymous business reads and hides guest menus. Invalid values fail startup. |
| `PUBLIC_CATALOG_EXPORT_ENABLED` | `false` | Enables anonymous batch export only; an enabled export still uses the selected public projection, and `disabled` always blocks guest export. |

Public Catalog display fields and searchable fields use the same profile
policy, so a field hidden from a profile is also excluded from anonymous
search, upstream keyword matching, and `matchedFields` — avoiding a search
side channel. Credentials, database accounts, authentication material,
internal paths, and diagnostics are always removed from ordinary catalog
responses in every profile. Connection strings and JDBC endpoints are
sanitized so credential query parameters (`user`, `password`, `token`, ...)
never leak even in `internal`. Health checks, authentication, and the
non-secret catalog policy endpoint remain available. Mutations,
administration, sensitive reads, and audit data continue to use their
existing backend authentication/RBAC rules.

See the [deployment guide](../DEPLOYMENT.md) and [Public Catalog contract](./rbac/authenticated-read-model.md).

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
| `PORTAL_STATS_CACHE_TTL_SECONDS` | portal aggregate statistics cache TTL | `600` |
| `APP_SLOW_SERVICE_SECONDS` | slow-service logging threshold | `3` |
| `SEARCH_DEFAULT_LIMIT`, `SEARCH_MODULE_LIMIT`, `SEARCH_MAX_LIMIT` | search result limits | `5`, `10`, `50` |
| `APP_LOG_MAX_BYTES`, `APP_LOG_BACKUP_COUNT` | log rotation | `2097152`, `5` |
| `ASSET_DB_TYPE` | provider type override | selected profile; provider-specific |
| `ASSET_DB_JDBC_URL` | GaussDB JDBC URL override | selected profile; GaussDB only |
| `ASSET_DB_JAR_PATH` | GaussDB JDBC driver path | profile/default; GaussDB only |
| `METADATA_MAX_BODY_MB` | finite metadata-ingestion body cap; effective cap is the minimum of this and `APP_MAX_CONTENT_LENGTH_MB` | `96`; hard max `128` MiB |
| `METADATA_MAX_LINEAGE_NODES` | maximum nodes in one complete replace snapshot | `30000`; hard max `200000` |
| `METADATA_MAX_LINEAGE_EDGES` | maximum edges in one complete replace snapshot | `75000`; hard max `1000000` |

For the large-lineage defaults, the example Nginx configuration uses
`client_max_body_size 128m`; deployments with another reverse proxy must set its
body limit at least as high as the effective metadata cap. The application does
not control an external proxy or load balancer.

`ASSET_DB_HOST`, `ASSET_DB_PORT`, `ASSET_DB_DATABASE`, and `ASSET_DB_USER` are
also supported as provider/profile overrides. `ASSET_DB_PASSWORD` and DSNs/JDBC
URLs are sensitive and should not be placed in committed files.

## Lineage storage: same DAP metadata database (#536)

The lineage API always uses the configured `ASSET_DB_PROFILE` and its effective
physical schema to read the persisted `p_lineage_snapshot`, `p_lineage_node`,
and `p_lineage_edge` tables. It does **not** select a separate database through
`LINEAGE_DB_PROFILE`, nor does `LINEAGE_STORAGE_MODE` enable POC data. Both
legacy lineage-specific variables are ignored and should be removed from
existing deployment environments. This applies to development, test and
production backend runtimes; synthetic lineage is only suitable for isolated
test fixtures or an explicitly separated frontend Mock build.

An absent/invalid `ASSET_DB_PROFILE` causes a configuration error; missing
lineage tables or database access failures are reported as data-source errors.
A configured database without an ACTIVE snapshot returns the existing
`no_active_snapshot` empty-state contract, never an in-memory demo graph.
Do not interpret switching to the shared DB as having collected lineage: a
real ACTIVE snapshot still needs to be created and published separately.

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
   This is **global to every selected named profile**, including the optional
   authentication profile. The lineage module always consumes the final
   `ASSET_DB_PROFILE` configuration; it has no independent profile override.
   A separate authentication profile is not isolated from these environment
   overrides merely by choosing a distinct profile name.
4. `ASSET_DB_JAR_PATH` overrides a GaussDB `jar_path`.
5. A relative GaussDB `jar_path` is resolved against `backend/` (the parent of
   `configs/`); with the default `backend/configs/database.yaml`,
   `resources/jars/gaussdb200.jar` resolves to `backend/resources/jars/gaussdb200.jar`,
   independent of process cwd.
   Use `ASSET_DB_JAR_PATH` for an environment-specific absolute path.
6. PostgreSQL uses `dsn` when present; otherwise it uses host, port, database,
   user, and password.

### GaussDB/DWS JDBC Java compatibility

GaussDB/DWS JDBC dependencies are selected for the JVM used by the backend, not
for the database release. Choose the Java 8 legacy profile or the Java 11+
current profile before installing optional dependencies; the compatibility
matrix, install commands, upstream evidence, and preflight checks are maintained
in the [canonical GaussDB/DWS JDBC compatibility section](../backend/README.md#gaussdbdws-jdbc-compatibility-by-java-version).

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
