# Public Catalog Permission Model — Security Regression Matrix

> Current Issue #180 contract layered on the existing RBAC phases.

## Matrix

| Subject | Public catalog read | Sensitive read | Mutation |
| --- | --- | --- | --- |
| anonymous | `200` with public projection | `401` | `401` |
| authenticated normal user, no special read permission | `200` | `403` when permission is required | `403` when permission is required |
| authenticated user with unrelated permissions | `200` | `403` when permission is missing | `403` when permission is missing |
| admin | `200` | `200` where permitted | `200` where permitted |
| disabled/deleted user | public projection or normal service result; no privileged projection | `401` | `401` |

The matrix is checked at the backend dependency and response boundary, not only
through frontend visibility. Public representative reads include assets,
fields/DDL, portal statistics, search, mappings, lineage, menus, roots,
indicators, reports, API assets, code-table metadata, upstream catalogs, and
push catalogs.

## Public catalog boundary

Only ordinary business/catalog reads are public. In particular:

- `GET /api/system/menus` returns enabled, non-management menu entries for an
  anonymous request;
- upstream/push public reads exclude connection, credential, internal-path, and
  contact details;
- API public reads omit arbitrary examples, credential-like parameters, and
  audit actors;
- report/code-table public reads omit audit actors;
- lineage public reads redact connection-like keys, URLs, source record IDs,
  and diagnostics;
- metadata-ingestion lookup, operation logs, system users/roles/parameters,
  and upstream/push `admin-detail` remain protected.

There is no blanket rule that makes every GET public. The explicit route
inventory is maintained in [authenticated-read-model.md](./authenticated-read-model.md)
and enforced by the FastAPI router composition.

## Session refresh

`/api/auth/me` re-resolves current database-backed subject state for an
existing cookie. A role or permission change therefore changes the returned
role/`permissions[]` snapshot, and disabling the user returns `401`. The
browser auth runtime treats a missing session as anonymous for public catalog
bootstrap while failing closed for protected operations.

## Information leakage

Authentication and authorization failures use the existing minimal error
contract: `UNAUTHORIZED`/`请先登录。` for missing identity and
`FORBIDDEN`/`无权限执行此操作。` for a missing permission. Protected error
responses do not include permission names, roles, database/schema identifiers,
or stack traces. Public projections additionally remove known connection,
credential, contact, audit, and arbitrary-example data.

## Verification evidence

Focused and full backend tests cover the public route inventory, direct API
mutation matrix, public detail redaction, authenticated compatibility,
sensitive RBAC reads, and Community seeded routes. Frontend tests cover the
`/auth/me` anonymous bootstrap, public search/stat/menu behavior, and hidden
write controls. PostgreSQL/MySQL integration remains CI-owned unless an
isolated local instance is configured; unexecuted live validation is reported
as `NOT RUN`, never inferred as PASS.

The backend remains the security boundary. This change adds no edition gate,
ABAC/ACL, data scope, multi-role model, external IAM, or permission cache.
