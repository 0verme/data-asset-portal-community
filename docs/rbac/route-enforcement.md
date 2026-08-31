# RBAC Backend Route Enforcement

> Current FastAPI route boundary for the Public Catalog + Authenticated
> Management model introduced by Issue #180.

## Enforcement rule

Public catalog routes are explicit. They do not use the authentication-only
router dependency, while sensitive and mutating handlers retain the existing
permission dependency:

```python
# public catalog GET — response projection/redaction still applies
router = APIRouter(prefix="/api/catalog")

# only where the operation is sensitive or mutating
_context: RequestContext = Depends(require_permission("resource:action"))
```

`require_authenticated` validates a current enabled identity for protected
router groups. `require_permission` re-resolves the current user, role, and
Role-Permission mapping through the existing authorization core. Frontend
visibility, menu status, OpenAPI exposure, and network placement never
authorize an API call.

## Public catalog route groups

The following ordinary read routes explicitly accept anonymous requests:

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
- `GET /api/system/menus`.

These routes return public catalog data with the necessary response projection.
The upstream/push `admin-detail` routes, metadata-ingestion lookup, operation
logs, system users/roles/parameters, and all mutations remain protected.

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
| system menu | `system:menu:write` on mutations; public navigation read is filtered |
| system param | `system:param:read/write` |

The public read contract is the explicit `PUBLIC_PERMISSION_CODES` registry
set, not a blanket `*:read` rule. It covers the ordinary catalog projections
for assets, roots, indicators, reports, API assets, code tables, field
mappings, and lineage. Sensitive reads and administration retain their existing
permission vocabulary and `401`/`403` semantics. Role configuration consumes
only the complementary role-assignable set.

## Explicit authentication lifecycle exceptions

The anonymous contract also includes:

- `GET /healthz` — native runtime health only;
- `GET /api/capabilities` — bounded repository module metadata;
- `POST /api/auth/login` — authentication lifecycle;
- `GET /api/auth/me` — authentication probe, returns `401` without identity;
- `POST /api/auth/logout` — idempotent authentication lifecycle cleanup.

`/api/auth/me` returning `401` is not a catalog failure. It is translated by the
frontend into the anonymous state, after which public menus and business data
are loaded.

## Public response boundary

`backend/app/fastapi/public_catalog.py` is the single adapter-side projection
module. It removes connection/contact fields, credential-like parameters,
examples, audit actors, internal lineage identifiers, diagnostics, and
connection-string/URL values where those values are not required for catalog
browsing. It does not grant access to protected endpoints and it does not alter
service write paths.

## Regression contract

- anonymous public catalog read: `200` with the public projection;
- authenticated ordinary user without special read permission: `200` for public reads;
- authenticated user missing a sensitive permission: `403`;
- anonymous sensitive/mutation request: `401`;
- administrator: existing permitted reads and mutations remain available;
- direct API calls are checked before protected business services run.
