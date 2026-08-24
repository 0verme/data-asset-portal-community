# RBAC Security Regression & Acceptance Matrix

> Current Issue #140 read-boundary contract layered on the RBAC phases.

## Matrix

| Subject | Ordinary business read | Sensitive read | Mutation |
| --- | --- | --- | --- |
| anonymous | `401` | `401` | `401` |
| authenticated normal user, no special read permission | `200` | `403` when permission is required | `403` when permission is required |
| authenticated user with unrelated permissions | `200` | `403` when permission is missing | `403` when permission is missing |
| admin | `200` | `200` where permitted | `200` where permitted |
| disabled/deleted user | `401` | `401` | `401` |

The matrix is checked at the backend dependency boundary, not only through
frontend visibility. Representative ordinary reads include assets,
indicators, portal/search, lineage bootstrap, field mappings, and system
menus. A normal authenticated user can browse these routes without receiving
an artificial `*:read` permission requirement.

Sensitive management reads continue to use the existing registered permission
codes. In particular, users/roles/parameters, operation logs, metadata lookup,
and upstream/push admin detail are not downgraded by the authenticated read
model.

## Explicit public exceptions

The anonymous routes are intentionally limited to:

- `GET /healthz`;
- `GET /api/capabilities`;
- `POST /api/auth/login`;
- `GET /api/auth/me` as a `401` authentication probe;
- `POST /api/auth/logout` as idempotent cookie cleanup.

There is no anonymous Public Catalog mode. Business reads are never public
because a handler happens to omit an individual dependency.

## Session refresh

`/api/auth/me` re-resolves current database-backed subject state for an
existing cookie. A role or permission change therefore changes the returned
role/`permissions[]` snapshot, and disabling the user returns `401`. The
browser auth runtime consumes the refreshed snapshot and fails closed after
permission revocation.

## Information leakage

Authentication and authorization failures use the existing minimal error
contract: `UNAUTHORIZED`/`请先登录。` for missing identity and
`FORBIDDEN`/`无权限执行此操作。` for a missing permission. Responses do not
include permission names, roles, database/schema identifiers, or stack traces.

## Verification evidence

Focused and full backend tests cover route inventory, the direct API matrix,
ordinary authenticated reads, sensitive RBAC reads, explicit public
exceptions, and Community seeded routes. PostgreSQL/MySQL integration remains
CI-owned unless an isolated local instance is configured; unexecuted live
validation is reported as `NOT RUN`, never inferred as PASS.

The backend remains the security boundary. This phase adds no edition gate,
ABAC/ACL, data scope, multi-role model, external IAM, or permission cache.
