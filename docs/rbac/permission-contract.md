# RBAC Permission Contract

> P0 artifact for [#32](https://github.com/0verme/data-asset-portal-community/issues/32) and
> [#120](https://github.com/0verme/data-asset-portal-community/issues/120).
>
> **Repository Truth baseline:** `origin/main` at `47f4bf642bf6eb1286d7713820f6331a8a6b42ec`.
> This document is an audit of the code that existed at that baseline. It is not a
> copy of the historical issue description.
>
> **Status:** The P0 design has been implemented through the RBAC phases. The
> current permission registry, backend enforcement, role management and single-role
> binding are current; remaining limitations are listed below.

## 1. Current runtime boundary

- Production entry point is `backend.asgi:app`, served by FastAPI/Uvicorn.
- Authentication is a signed `session` cookie carrying the existing `dap_auth_user`
  identity payload. The native FastAPI adapter resolves it through
  `backend.app.fastapi.auth.get_native_session_identity`.
- The current application identity has `user`, `name`, and `role`; it does not yet
  contain a permission set.
- `require_authenticated` means **authenticated identity** without checking a
  permission code. `require_maintainer` remains a compatibility alias; `admin`
  and `maintainer` both pass it. `require_admin` is the current administrator
  gate.
- Current provider registrations are SQLite, PostgreSQL, MySQL/PyMySQL, and
  GaussDB/DWS. Community/local migration uses `backend/schema` plus Alembic and
  `backend/scripts/schema_migrate.py`; P1 must follow that current contract.
- Repository module availability is open by default. RBAC must not reintroduce
  Community/Private runtime gating or register Private/Enterprise-only permissions.

## 2. Permission naming contract

Permission codes use the stable form `resource:action`. A resource may contain
an additional namespace segment, for example `system:user:write`; the final
segment is always the action.

Initial action vocabulary is intentionally small:

- `read`: query, view, inspect, or export data;
- `write`: create, update, delete, import, status-change, reorder, or otherwise
  mutate a resource.

A new code is allowed only when its authorization boundary is materially
separate, a user can reasonably have one permission without the other, and the
separation has audit value. Do not create one permission per endpoint or button.

The checked-in registry is
`backend/app/authorization/permissions.py`. The registry order is stable for
seed output, API snapshots, frontend state, and debugging. Issue #185 also
makes the public/role split explicit: public catalog permissions are inherited
by anonymous and valid authenticated users, while roles store only incremental
permissions.

## 3. Permission registry

| Permission | Resource | Action | Public/API scope |
| --- | --- | --- | --- |
| `asset:read` | asset | read | Public catalog read; inherited and never role-configured. |
| `asset:write` | asset | write | Protected asset table/field mutations. |
| `root:read` | root | read | Public catalog read; inherited and never role-configured. |
| `root:write` | root | write | Protected root create/update/delete/import. |
| `indicator:read` | indicator | read | Public catalog read; inherited and never role-configured. |
| `indicator:write` | indicator | write | Protected indicator create/update/delete/status. |
| `report:read` | report | read | Public catalog read; inherited and never role-configured. |
| `report:write` | report | write | Protected report create/update/delete. |
| `api_asset:read` | api_asset | read | Public catalog read; inherited and never role-configured. |
| `api_asset:write` | api_asset | write | Protected API asset, params, response-fields, and relations mutations. |
| `upstream:read` | upstream | read | Protected upstream `admin-detail`; ordinary list/detail requires authentication only. |
| `upstream:write` | upstream | write | Protected upstream create/update/status/delete. |
| `push:read` | push | read | Protected push `admin-detail`; ordinary list/detail requires authentication only. |
| `push:write` | push | write | Protected push system/job mutations. |
| `code_table:read` | code_table | read | Public list/detail/export read with audit-field redaction; inherited and never role-configured. |
| `code_table:write` | code_table | write | Protected manual code table create/update/status/delete. |
| `field_mapping:read` | field_mapping | read | Public catalog read; inherited and never role-configured. |
| `lineage:read` | lineage | read | Public graph read with nested-value redaction; inherited and never role-configured. |
| `metadata:read` | metadata | read | Protected ingestion result lookup. |
| `metadata:write` | metadata | write | Protected asset/lineage Metadata Ingestion and preview/bulk aliases. |
| `operation_log:read` | operation_log | read | Protected operation log list/detail. |
| `system:user:read` | system:user | read | Administrator-only user list. |
| `system:user:write` | system:user | write | Administrator-only user CRUD, status, reset-password, and delete. |
| `system:menu:read` | system:menu | read | Full menu-management read; ordinary authenticated menu navigation is not permission-gated. |
| `system:menu:write` | system:menu | write | Administrator-only menu CRUD/status/move/delete. |
| `system:param:read` | system:param | read | Administrator-only parameter category/dictionary reads. |
| `system:param:write` | system:param | write | Administrator-only parameter category/dictionary mutations. |
| `system:role:read` | system:role | read | Reserved for P6 role-management API/UI; no current route at P0. |
| `system:role:write` | system:role | write | Reserved for P6 role-management API/UI; no current route at P0. |

### Evolution policy

1. Once a permission is released, its code and meaning are immutable.
2. A replacement gets a new code and an explicit migration/compatibility note;
   a deprecated code is never silently reused for another meaning.
3. The registry is the only source for valid codes. Route modules must not carry
   independent permission lists.
4. `admin` is explicitly mapped to every registered code. It does not use `*`.
   Adding a permission therefore produces a visible registry/seed diff.
5. `maintainer` is mapped only to role-controlled incremental permissions.
   Public codes are inherited by the authorization core and are not repeated in
   role mappings.
6. `PUBLIC_PERMISSION_CODES` must remain an explicit subset of registered read
   codes. A sensitive read must use a separate protected permission rather than
   broadening this set.

## 4. Historical P0 route authorization matrix

The following table records the pre-#140 FastAPI route inventory and is retained
as historical evidence. The current route contract superseding its public-read
rows is [authenticated-read-model.md](./authenticated-read-model.md). `Public`
means no login dependency is evaluated and the public projection may apply.
`Auth` means a valid enabled identity is required. `Admin` means the current
administrator gate is required. The permission column is the target contract
for P3; ordinary public catalog reads are now governed by Issue #180.

| Resource | API / action | Public | Authenticated | `maintainer` | `admin` | Mutation | Permission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| auth | `POST /api/auth/login` | Yes | — | — | — | No | — |
| auth | `GET /api/auth/me` | No | Yes | Yes | Yes | No | — |
| auth | `POST /api/auth/logout` | Yes (idempotent) | Optional | Optional | Optional | No | — |
| infrastructure | `GET /healthz`, `GET /api/capabilities` | Yes | — | — | — | No | — |
| portal/search | `GET /api/portal/stats`, `GET /api/search` | Yes | — | — | — | No | — |
| asset | `GET /api/assets/tables`, `GET /api/assets/tables/{table_name}`, `GET /api/assets/tables/{table_name}/fields`, `GET /api/assets/tables/{table_name}/ddl`, `GET /api/assets/domains`, `GET /api/assets/layers` | Yes | — | — | — | No | Public; `asset:read` reserved |
| asset | `POST /api/assets/tables`, `PUT /api/assets/tables/{table_name}`, `PUT /api/assets/tables/{table_name}/fields`, `DELETE /api/assets/tables/{table_name}` | No | Yes | Yes | Yes | Yes | `asset:write` |
| root | `GET /api/roots`, `GET /api/roots/categories`, `GET /api/roots/{abbr}` | Yes | — | — | — | No | Public; `root:read` reserved |
| root | `POST /api/roots`, `PUT /api/roots/{abbr}`, `DELETE /api/roots/{abbr}`, `POST /api/roots/import` | No | Yes | Yes | Yes | Yes | `root:write` |
| indicator | `GET /api/indicators`, `GET /api/indicators/{indicator_id}` | Yes | — | — | — | No | Public; `indicator:read` reserved |
| indicator | `POST /api/indicators`, `PUT /api/indicators/{indicator_id}`, `PATCH /api/indicators/{indicator_id}/status`, `DELETE /api/indicators/{indicator_id}` | No | Yes | Yes | Yes | Yes | `indicator:write` |
| report | `GET /api/reports`, `GET /api/reports/{report_code}` | Yes | — | — | — | No | Public; `report:read` reserved |
| report | `POST /api/reports`, `PUT /api/reports/{report_code}`, `DELETE /api/reports/{report_code}` | No | Yes | Yes | Yes | Yes | `report:write` |
| api asset | `GET /api/api-assets`, `GET /api/api-assets/downstream-systems`, `GET /api/api-assets/systems`, `GET /api/api-assets/{api_code}` | Yes | — | — | — | No | Public; `api_asset:read` reserved |
| api asset | `POST /api/api-assets`, `PUT /api/api-assets/{api_code}`, `PATCH /api/api-assets/{api_code}/status`, `DELETE /api/api-assets/{api_code}`, `PUT /api/api-assets/{api_code}/params`, `PUT /api/api-assets/{api_code}/response-fields`, `PUT /api/api-assets/{api_code}/relations` | No | Yes | Yes | Yes | Yes | `api_asset:write` |
| upstream | `GET /api/upstreams/systems`, `GET /api/upstreams/systems/{system_id}` | Yes | — | — | — | No | Public |
| upstream | `GET /api/upstreams/systems/{system_id}/admin-detail` | No | Yes | Yes | Yes | No | `upstream:read` |
| upstream | `POST /api/upstreams/systems`, `PUT /api/upstreams/systems/{system_id}`, `PATCH /api/upstreams/systems/{system_id}/status`, `DELETE /api/upstreams/systems/{system_id}` | No | Yes | Yes | Yes | Yes | `upstream:write` |
| push | `GET /api/push/systems`, `GET /api/push/systems/{system_id}` | Yes | — | — | — | No | Public |
| push | `GET /api/push/systems/{system_id}/admin-detail` | No | Yes | Yes | Yes | No | `push:read` |
| push | `POST /api/push/systems`, `PUT /api/push/systems/{system_id}`, `DELETE /api/push/systems/{system_id}`, `POST /api/push/systems/{system_id}/jobs`, `PUT /api/push/systems/{system_id}/jobs/{job_id}`, `DELETE /api/push/systems/{system_id}/jobs/{job_id}` | No | Yes | Yes | Yes | Yes | `push:write` |
| code table | `GET /api/manual-code-tables`, `GET /api/manual-code-tables/export`, `GET /api/manual-code-tables/{table_id}` | Yes | — | — | — | No | Public; `code_table:read` reserved |
| code table | `POST /api/manual-code-tables`, `PUT /api/manual-code-tables/{table_id}`, `PATCH /api/manual-code-tables/{table_id}/status`, `DELETE /api/manual-code-tables/{table_id}` | No | Yes | Yes | Yes | Yes | `code_table:write` |
| field mapping | `GET /api/field-mappings/source-systems`, `GET /api/field-mappings/stats`, `GET /api/field-mappings/fields`, `GET /api/field-mappings/tables` | Yes | — | — | — | No | Public; `field_mapping:read` reserved |
| lineage | `GET /api/lineage/bootstrap`, `GET /api/lineage/assets`, `GET /api/lineage/subgraph`, `GET /api/lineage/initial-view` | Yes | — | — | — | No | Public; `lineage:read` reserved |
| metadata | `POST /api/metadata/assets/ingestions`, hidden alias `POST /api/metadata/assets:bulk-upsert` | No | Yes | Yes | Yes | Yes | `metadata:write` |
| metadata | `POST /api/metadata/lineage/ingestions`, hidden alias `POST /api/metadata/lineage:snapshots` | No | Yes | Yes | Yes | Yes | `metadata:write` |
| metadata | `GET /api/metadata/ingestions/{ingestion_id}` | No | Yes | Yes | Yes | No | `metadata:read` |
| operation log | `GET /api/operation-logs`, `GET /api/operation-logs/{log_id}` | No | Yes | Yes | Yes | No | `operation_log:read` |
| system user | `GET /api/system/users` | No | No | No | Yes | No | `system:user:read` |
| system user | `POST /api/system/users`, `PUT /api/system/users/{username}`, `PATCH /api/system/users/{username}/status`, `POST /api/system/users/{username}/reset-password`, `DELETE /api/system/users/{username}` | No | No | No | Yes | Yes | `system:user:write` |
| system menu | `GET /api/system/menus` | Yes, filtered | Optional | Current maintainer sees enabled menu plus `system`; admin sees full list | Yes | No | Public filtered read; `system:menu:read` for management read |
| system menu | `POST /api/system/menus`, `PUT /api/system/menus/{menu_id}`, `PATCH /api/system/menus/{menu_id}/status`, `PATCH /api/system/menus/{menu_id}/move`, `DELETE /api/system/menus/{menu_id}` | No | No | No | Yes | Yes | `system:menu:write` |
| system param | `GET /api/system/param-dicts/categories`, `GET /api/system/param-dicts` | No | No | No | Yes | No | `system:param:read` |
| system param | `PATCH /api/system/param-dicts/categories/{category_code}/status`, `POST /api/system/param-dicts`, `PUT /api/system/param-dicts/{dict_id}`, `PATCH /api/system/param-dicts/{dict_id}/status`, `DELETE /api/system/param-dicts/{dict_id}` | No | No | No | Yes | Yes | `system:param:write` |
| system role | No current endpoint at P0 | — | — | — | — | — | `system:role:read/write` reserved for P6 |

The two hidden Metadata aliases are included because they are real mutation
routes even though they are omitted from OpenAPI. Public catalog projections
and the protected `admin-detail` boundaries are documented in
[authenticated-read-model.md](./authenticated-read-model.md).

## 5. Compatibility role matrix

### Existing behavior

| Identity | Current behavior at P0 | Contract decision |
| --- | --- | --- |
| guest | Public catalog reads and authentication lifecycle routes; protected reads/mutations reject the request. | Return the public projection for catalog reads; return `401` for protected business operations. |
| `maintainer` | Passes `require_maintainer`; cannot pass `require_admin`. | Preserve business maintenance and operation-log access; do not grant system user/menu/param/role management. |
| `admin` | Passes both current gates. | Preserve all current access and explicitly map every registered permission. |
| unknown role | Unknown or deleted roles resolve to no permissions. | Deny by default; protected APIs return `403` for a valid identity without the required permission. |
| disabled/deleted user | Current authentication/authorization revalidates user and role state; inactive users cannot retain access through an old cookie. | Return `401` and revoke access. |

### Built-in permission mapping

`admin` is the full explicit registry. `maintainer` is the role-controlled
compatibility set below. Public codes are included in the effective permission
snapshot for every anonymous/valid authenticated actor, but are not persisted
as maintainer mappings or shown in role configuration. Ordinary catalog GET
routes accept anonymous requests; sensitive reads and all mutations still
require the existing authentication/permission boundary.

| Permission | `admin` | `maintainer` | Custom example `indicator-maintainer` |
| --- | :---: | :---: | :---: |
| `asset:read` | Yes | Inherited | No |
| `asset:write` | Yes | Yes | No |
| `root:read` | Yes | Inherited | No |
| `root:write` | Yes | Yes | No |
| `indicator:read` | Yes | Inherited | Yes |
| `indicator:write` | Yes | Yes | Yes |
| `report:read` | Yes | Inherited | No |
| `report:write` | Yes | Yes | No |
| `api_asset:read` | Yes | Inherited | No |
| `api_asset:write` | Yes | Yes | No |
| `upstream:read` | Yes | Yes | No |
| `upstream:write` | Yes | Yes | No |
| `push:read` | Yes | Yes | No |
| `push:write` | Yes | Yes | No |
| `code_table:read` | Yes | Inherited | No |
| `code_table:write` | Yes | Yes | No |
| `field_mapping:read` | Yes | Inherited | No |
| `lineage:read` | Yes | Inherited | No |
| `metadata:read` | Yes | Yes | No |
| `metadata:write` | Yes | Yes | No |
| `operation_log:read` | Yes | Yes | Yes |
| `system:user:read` | Yes | No | No |
| `system:user:write` | Yes | No | No |
| `system:menu:read` | Yes | No | No |
| `system:menu:write` | Yes | No | No |
| `system:param:read` | Yes | No | No |
| `system:param:write` | Yes | No | No |
| `system:role:read` | Yes | No | No |
| `system:role:write` | Yes | No | No |

The `Inherited` entries are effective permissions, not persisted
`maintainer` mappings. The custom example is intentionally exact: it can
maintain indicators and read operation logs, while also inheriting the public
catalog, but cannot manage users or other system resources. Role-controlled
mapping remains persisted in the role/permission tables and user-selectable
through the role-management API while retaining one role per user.

## 6. Security and session decisions

- Authorization is deny-by-default. Unknown role, disabled role, missing
  permission, deleted user, or disabled user never upgrades to `admin`.
- `401 Unauthorized`: no valid current identity, invalid/expired session,
  missing user, or disabled user.
- `403 Forbidden`: a valid enabled identity exists but the current permission
  is absent.
- The session should retain only the minimum identity needed to locate the
  current user. Permission decisions must resolve current role and
  Role-Permission state on the backend; no first-phase permission cache is
  planned.
- `adminOnly` remains UI/menu compatibility metadata. It is not an API
  security boundary and cannot replace a backend permission check.
- Frontend menu/button/deep-link hiding is UX only. Direct API calls must be
  denied by the backend.
- No ABAC, ACL, data scope, row/column security, multi-role, hierarchy,
  tenant, external IAM, policy engine, or new authorization dependency is in
  scope.

## 7. P1 migration plan

1. Add forward-only Role, Permission, and Role-Permission persistence following
   the current schema/migration manifest and all registered providers.
2. Keep `p_admin_user.role` as the stable role code unless an actual schema
   constraint requires a compatibility column migration. Do not introduce
   `p_user_role` in this phase.
3. Seed the registry in deterministic order; seed `admin` explicitly with all
   codes and `maintainer` with only the role-controlled compatibility set.
   Public codes are inherited at authorization time. Use conflict-safe,
   non-destructive upserts that do not overwrite custom mappings.
4. Validate fresh install, upgrade from current head, existing `admin`/
   `maintainer` users, repeat seed, and bootstrap ordering.
5. Verify schema parity/offline plans for SQLite, PostgreSQL, MySQL, and
   GaussDB/DWS. A real DWS integration remains `NOT RUN` unless an isolated
   test instance and credentials are available; static contract checks are not
   reported as live database PASS.
6. Add tests for registry/seed idempotency and unknown-role fail-closed
   behavior before route enforcement.

## 8. P0 test plan and findings

- Contract unit test: code uniqueness, `resource/action` decomposition,
  deterministic order, explicit admin coverage, and no unknown role fallback.
- Route inventory test/fixture: every current mutation has a target permission;
  explicit public catalog GET routes are separated from protected reads and
  authentication lifecycle exceptions.
- P2 core unit tests: admin, maintainer, custom role, unknown role, disabled
  role/user, deleted user, missing and unknown permission.
- #185 permission-model tests: anonymous/public effective permissions,
  authenticated public inheritance, role-only writes, assignable-role
  candidates, legacy public mappings, and normalized role payloads.
- P3 direct API matrix: every sensitive POST/PUT/PATCH/DELETE returns 401 or
  403 without relying on frontend state.
- P4 session regression: role change, permission revocation, disable/delete
  take effect for an existing cookie.
- P5 UX tests: `/auth/me` permissions, `can(permission)`, menu/button/deep
  link behavior. Backend tests remain the security authority.

The original P0 gaps listed above have been addressed by the current RBAC
phases. Remaining deferred scope is limited to the explicitly excluded
multi-role, ABAC/ACL, data-scope, external-IAM, and permission-cache designs.
