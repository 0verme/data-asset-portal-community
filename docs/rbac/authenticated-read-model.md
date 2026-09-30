# Public Catalog + Authenticated Management

> Issue #180 changes the ordinary business-read boundary introduced by Issue
> #140. The backend remains the source of enforcement truth.

## Security model

The API separates anonymous catalog browsing from authenticated management:

```text
Anonymous
  → public business/catalog reads with necessary redaction, unless the `disabled` profile is selected
Authenticated user
  → public reads plus the user's existing capabilities
Registered RBAC permission
  → mutations, administration, and sensitive reads
Admin
  → existing full administration capabilities
```

`GET /api/auth/me` remains an authentication probe. A missing session returns
`401`; the frontend treats that result as the anonymous state and continues the
public catalog bootstrap. Authentication is not granted merely because a route
is public, and public read access never grants a write permission.

## Public permission contract (#185)

The authorization registry is the single backend source of truth for public
permissions:

- `asset:read`
- `root:read`
- `indicator:read`
- `report:read`
- `api_asset:read`
- `code_table:read`
- `field_mapping:read`
- `lineage:read`

These codes correspond to the public catalog families and their existing
redacted/read-only projections. They are not a blanket `*:read` rule:
`upstream:read`, `push:read`, `metadata:read`, `operation_log:read`, and all
`system:*:read` codes remain protected because they cover admin detail,
ingestion, audit, or system-management data.

The effective permission snapshot is:

```text
anonymous (internal/strict) = public permissions
anonymous (disabled)        = no public catalog permissions
valid authenticated         = public permissions ∪ role permissions
admin                       = existing full registered permission set
```

The role UI requests `/api/system/permissions?assignableOnly=true`, while the
unfiltered endpoint continues to expose the complete permission registry. A
role payload and role response contain only role-assignable incremental codes;
legacy public mappings are ignored on normalization and hidden from counts.

## Explicit anonymous contract

The following routes intentionally accept anonymous requests:

| Route family | Anonymous behavior |
| --- | --- |
| `GET /healthz` | `200`; native runtime health only |
| `GET /api/capabilities` | `200`; bounded source-backed module metadata |
| `GET /api/portal/stats` | `200`; public catalog-level counts |
| `GET /api/search` | `200`; public search result projection |
| `GET /api/system/menus` | `200`; enabled, non-management navigation entries only; `disabled` returns an empty list |
| `GET /api/assets/*` | `200`; tables, fields, DDL, facets, and summaries |
| `GET /api/field-mappings/*` | `200`; field/table mapping metadata and statistics |
| `GET /api/field-mappings/export` | `401` for guests by default; `PUBLIC_CATALOG_EXPORT_ENABLED=true` opts into profile-projected anonymous CSV export |
| `GET /api/lineage/*` | `200`; public graph metadata with sensitive nested values redacted |
| `GET /api/roots/*` | `200`; root dictionary metadata |
| `GET /api/indicators/*` | `200`; indicator metadata |
| `GET /api/reports/*` | `200`; report metadata without audit actors |
| `GET /api/api-assets/*` | `200`; API catalog metadata without examples/credentials/audit actors |
| `GET /api/manual-code-tables` and `GET /api/manual-code-tables/{table_id}` | `200`; table-level code metadata without audit actors |
| `GET /api/manual-code-tables/export` | `401` for guests by default; `PUBLIC_CATALOG_EXPORT_ENABLED=true` opts into profile-projected anonymous CSV export |
| `GET /api/upstreams/systems` and `GET /api/upstreams/systems/{system_id}` | `200`; public system metadata; connection fields remain excluded |
| `GET /api/push/systems` and `GET /api/push/systems/{system_id}` | `200`; public system/job metadata; connection fields are always excluded; people fields depend on profile |
| `POST /api/auth/login` | Authentication lifecycle; no existing session required |
| `GET /api/auth/me` | `401` without a valid identity; never returns business data |
| `POST /api/auth/logout` | Idempotent authentication lifecycle cleanup |

Set `PUBLIC_CATALOG_PROFILE` to `internal` (default), `strict`, or `disabled`.
In `internal`, business owner/contact names remain visible; `strict` hides
person-identity fields while preserving organization metadata; `disabled`
returns `401` for anonymous business reads and returns no anonymous menus.
Authentication, health checks, and the non-secret `/api/public-catalog/config`
policy endpoint remain available. Invalid profile values fail application
startup. The `admin-detail` upstream/push routes are not part of the public
family and retain their existing read permissions.

## Public business route inventory

The ordinary catalog GET routes are public by explicit router registration,
not by deleting every authentication check from the application. The public
families are:

- `/api/portal/stats` and `/api/search`;
- `/api/assets/*`;
- `/api/field-mappings/*`;
- `/api/lineage/*`;
- `/api/roots/*`;
- `/api/indicators/*`;
- `/api/reports/*`;
- `/api/api-assets/*`;
- `/api/manual-code-tables/*`;
- `/api/upstreams/systems` and `/api/upstreams/systems/{system_id}`;
- `/api/push/systems` and `/api/push/systems/{system_id}`;
- `/api/system/menus`.

A route outside this inventory is not public by default. Sensitive reads,
management reads, metadata-ingestion lookups, and operation logs continue to
require authentication and/or a registered RBAC permission.

## Necessary redaction

The public projection is implemented at the FastAPI response boundary in
`backend/app/fastapi/public_catalog.py` and applies to ordinary catalog
responses for every caller, not only guests:

- credentials, database account/connection details, internal paths, and
  diagnostics are always removed from ordinary responses; protected
  `admin-detail` routes remain the explicit exception;
- upstream/push public responses do not include host, port, account, auth,
  database/schema identifiers, or internal paths; business contacts remain in
  `internal` and are removed in `strict`;
- API catalog responses omit audit actors and arbitrary parameter/response
  examples, and drop credential-like parameters;
- manual code-table and report responses omit audit actor fields;
- lineage responses remove connection-like keys, source record identifiers,
  diagnostics, and connection-string/URL values while preserving graph shape;
- public menus contain only enabled, non-`adminOnly` business entries.

The service layer still owns data access and write behavior. Redaction is not a
replacement for backend authorization: management endpoints and all mutation
routes retain `require_permission(...)`.

## Protected and administrative routes

The following permissions are not weakened:

- `asset:write`, `root:write`, `indicator:write`, `report:write`,
  `api_asset:write`, `code_table:write`, `upstream:write`, and `push:write`
  for mutations;
- `upstream:read` and `push:read` for admin detail;
- `metadata:read` and `metadata:write` for ingestion lookup/submission;
- `operation_log:read` for audit log reads;
- `system:user:*`, `system:role:*`, and `system:param:*` for system management;
- `system:menu:write` for menu mutations.

Ordinary public catalog routes are explicitly registered without an
authentication dependency. Their matching public read codes are nevertheless
part of the effective permission contract, so a valid login can never lose a
catalog capability merely because its role omits that code.

## Frontend compatibility

Remote mode loads `/api/public-catalog/config` and hydrates identity through
`/api/auth/me` before business requests. The outcomes are:

```text
/auth/me 200 + any profile
  → authenticated user + current permissions
/auth/me 401 + internal/strict
  → anonymous user + public menus/stats/search/catalog
/auth/me 401 + disabled
  → no business data requests; show sign-in prompt
```

The shared HTTP client continues to dispatch the normal unauthorized event for
unexpected protected `401` responses, while the `/auth/me` probe suppresses the
login prompt. Public catalog requests do not depend on a successful identity.
The UI uses current write permissions to hide mutation buttons, keeps
system-management navigation out of the anonymous menu, and hides anonymous
CSV exports unless explicitly enabled. The manual-code-table and field-mapping
CSV endpoints both enforce the setting server-side and apply the public
projection before producing output. These UI controls are UX layers, not
substitutes for backend profile and RBAC enforcement.

## Regression coverage

Tests cover anonymous public reads and detail redaction, anonymous protected
reads and all mutation methods, authenticated catalog compatibility,
administrator access, public menu filtering, and the frontend anonymous
bootstrap. PostgreSQL/MySQL live validation remains CI-owned unless an isolated
local instance is configured; unexecuted live validation is reported as
`NOT RUN`, never inferred as PASS.
