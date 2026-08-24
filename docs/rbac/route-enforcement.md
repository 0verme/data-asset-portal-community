# RBAC Backend Route Enforcement

> Current FastAPI route boundary for the RBAC phases and Issue #140.

## Enforcement rule

Authentication and authorization are separate dependencies:

```python
APIRouter(dependencies=[Depends(require_authenticated)])

# only where the operation is sensitive or mutating
_context: RequestContext = Depends(require_permission("resource:action"))
```

`require_authenticated` validates the current enabled identity without
requiring a read permission. `require_permission` re-resolves the current
user, role, and Role-Permission mapping through the existing authorization
core. Frontend visibility, menu status, OpenAPI exposure, and network
placement do not authorize an API call.

## Authenticated-by-default router groups

The following router families inherit authentication at the router boundary:

- portal statistics and unified search;
- assets, field mappings, lineage, roots, indicators, reports, API assets;
- manual code tables, upstream, push, system management, operation logs;
- metadata ingestion and lookup.

Therefore ordinary catalog reads return `401` for an anonymous request and
`200` for an enabled authenticated user, even when that user has no special
read permission. This prevents a new GET handler from silently becoming an
anonymous business read.

## Existing protected groups

| Group | Protected permission |
| --- | --- |
| asset | `asset:write` on table/field mutations |
| root | `root:write` on create/update/delete/import |
| indicator | `indicator:write` on create/update/delete/status |
| report | `report:write` on create/update/delete |
| api asset | `api_asset:write` on asset/params/response-fields/relations mutations |
| upstream | `upstream:read` on admin detail; `upstream:write` on mutations |
| push | `push:read` on admin detail; `push:write` on system/job mutations |
| code table | `code_table:write` on create/update/status/delete |
| metadata | `metadata:read` on lookup; `metadata:write` on ingestion aliases |
| operation log | `operation_log:read` on list/detail |
| system user | `system:user:read/write` |
| system role | `system:role:read/write` |
| system menu | `system:menu:write` on mutations; ordinary menu read is authentication-only |
| system param | `system:param:read/write` |

These permissions are not used as a blanket `*:read` requirement for ordinary
business browsing. Sensitive read and administration boundaries retain their
existing permission vocabulary and `401`/`403` semantics.

## Explicit exceptions

The anonymous contract is intentionally small and tested separately:

- `GET /healthz` — native runtime health only;
- `GET /api/capabilities` — bounded repository module metadata;
- `POST /api/auth/login` — authentication lifecycle;
- `GET /api/auth/me` — authentication probe, returns `401` without identity;
- `POST /api/auth/logout` — idempotent authentication lifecycle cleanup.

No Public Catalog mode was introduced. All business data, including tables,
fields, DDL, indicators, search results, mappings, lineage, menus, and portal
statistics, requires authentication. See
[authenticated-read-model.md](./authenticated-read-model.md) for the route
inventory and frontend bootstrap contract.

## Regression contract

- anonymous ordinary business read: `401`;
- authenticated ordinary user without special read permission: `200`;
- authenticated user missing a sensitive permission: `403`;
- anonymous sensitive/mutation request: `401`;
- administrator: existing permitted reads and mutations remain available;
- direct API calls are checked before the business service runs.
