# Authenticated-by-default Business Read Model

> Issue #140 security contract. This document describes the current FastAPI
> route boundary; the backend remains the source of enforcement truth.

## Security model

The API separates authentication from authorization:

```text
Anonymous
  → 401 for business API access
Authenticated user
  → ordinary business/catalog reads
Registered RBAC permission
  → mutations, administration, and sensitive reads
Explicit public exception
  → infrastructure/authentication lifecycle only
```

Ordinary business reads do **not** require a matching `asset:read`,
`indicator:read`, `lineage:read`, or other fine-grained read permission. The
existing read permission codes remain available for boundaries that are
materially sensitive. `require_authenticated` is the shared authentication-only
FastAPI dependency; `require_permission(...)` remains the authorization gate.

## Explicit anonymous contract

Only these routes intentionally accept anonymous requests:

| Route | Classification | Anonymous behavior |
| --- | --- | --- |
| `GET /healthz` | Public infrastructure | `200`; reports only the native runtime health contract |
| `GET /api/capabilities` | Public infrastructure metadata | `200`; reports repository module capability metadata, not business rows |
| `POST /api/auth/login` | Authentication lifecycle | Login request is evaluated without an existing session |
| `GET /api/auth/me` | Authentication lifecycle probe | `401` when no valid identity exists; never returns business data |
| `POST /api/auth/logout` | Authentication lifecycle | Idempotent cookie cleanup; no business data |

There are no anonymous readiness, liveness, version, diagnostics, or public
catalog routes in the current FastAPI surface. `/api/capabilities` is kept
public as an explicit, bounded module-manifest contract; it is not a business
read exception.

## Business route inventory

All routes in the following router families carry the router-level
`Depends(require_authenticated)` dependency:

- `/api/portal/stats` and `/api/search`;
- `/api/assets/*`;
- `/api/field-mappings/*`;
- `/api/lineage/*`;
- `/api/roots/*`;
- `/api/indicators/*`;
- `/api/reports/*`;
- `/api/api-assets/*`;
- `/api/manual-code-tables/*`;
- `/api/upstreams/*`;
- `/api/push/*`;
- `/api/system/*`;
- `/api/operation-logs/*`;
- `/api/metadata/*`.

This includes table/field/DDL metadata, search filters and pagination,
lineage/bootstrap graphs, mappings, menus, ordinary upstream/push
list/detail, report/API/code-table catalogs, and portal statistics. A new
route in one of these routers inherits authentication by default instead of
becoming public because a handler omitted a dependency.

## Sensitive and administrative routes

Authentication is retained in front of the existing authorization boundary.
The following permissions are not weakened:

- `asset:write`, `root:write`, `indicator:write`, `report:write`,
  `api_asset:write`, `code_table:write`, `upstream:write`, and `push:write`
  for mutations;
- `upstream:read` and `push:read` for admin detail;
- `metadata:read` for ingestion lookup and `metadata:write` for ingestion;
- `operation_log:read` for audit log reads;
- `system:user:*`, `system:role:*`, and `system:param:*` for management APIs;
- `system:menu:write` for menu mutations.

`GET /api/system/menus` requires authentication but does not turn the menu
payload into an authorization engine. Menu visibility remains UX/presentation;
direct business and management API calls are enforced by the backend.

## Public Catalog policy

No Public Catalog mode was introduced. There is no public-catalog setting, and
no `.env` opt-in is required: ordinary business reads are authenticated in
all deployments. The existing Community module set remains available to any
properly authenticated user; this change does not add an enterprise feature
gate, SSO requirement, or new IAM system.

## Frontend compatibility

Remote-mode authentication is hydrated through `/api/auth/me` before business
navigation and business module data are requested. Anonymous remote sessions do
not request menus, portal statistics, search, or module catalog data. After a
successful login, navigation and the current business module can load normally.
The shared HTTP client still turns a real `401` into the existing login-state
event, while the `/auth/me` probe and menu bootstrap suppress duplicate login
prompts.

## Regression coverage

- Route inventory tests require `require_authenticated` on every non-exempt
  FastAPI route.
- Anonymous representative reads cover assets, indicators, portal/search,
  lineage, field mappings, and system menus and assert `401`.
- A normal authenticated user with no special read permissions can read the
  ordinary catalog.
- A user without a sensitive permission receives `403` for sensitive reads and
  mutations; an administrator retains the expected access.
- Public infrastructure and authentication lifecycle exceptions are tested
  separately from business reads.
