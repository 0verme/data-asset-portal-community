# RBAC Security Regression & Acceptance Matrix

> P7 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)。
> 基线：P6 merge `e7532e886b196f94c577f4879cc8bbac83a68e5b`。

## Matrix

| Subject | Public reads | Business write without mapping | Role read | Role write | Disabled user |
| --- | --- | --- | --- | --- | --- |
| guest | allowed where public contract says so | `401` | `401` | `401` | n/a |
| `maintainer` | allowed | mapped business permissions only | denied by default | denied by default | n/a |
| `admin` | allowed | all registered Community permissions | allowed | allowed | n/a |
| custom role | depends on returned `permissions[]` | only mapped permission | only if `system:role:read` | only if `system:role:write` | n/a |
| any disabled user | no sensitive API access | `401` | `401` | `401` | `401` |

The matrix is checked at the backend dependency boundary, not only through
frontend visibility. The P7 regression test directly constructs requests for
indicator mutation, role reads/writes, public menu reads, guests, custom roles,
and disabled users.

## Session refresh

P4 already verifies that `/api/auth/me` re-resolves current database-backed
subject state for an existing cookie. A role or permission change therefore
changes the returned role/`permissions[]` snapshot, and disabling the user
returns `401`; the browser auth runtime consumes the refreshed snapshot and
fails closed after permission revocation.

## Invariants

P6 SQLite tests continue to cover:

- only registered permission codes;
- immutable `admin` / `maintainer` roles;
- single-role user binding;
- assigned-role deletion rejection;
- last active administrator protection.

## Verification evidence

- `python -m unittest discover -s backend/tests -p 'test_*.py'` — PASS（342 tests，7 skipped）
- `npm ci --include=dev` — PASS（0 vulnerabilities）
- `npm test` — PASS（103 tests）
- `npm run build` — PASS（Vite 7.3.6；existing dynamic/static import warning）
- SQLite migration/schema/seed tests — PASS（included in backend suite）
- PostgreSQL / MySQL integration — CI matrix evidence; no local production credentials used
- DWS/GaussDB live integration — NOT RUN（无隔离实例与凭据；static compatibility remains covered by existing contracts）

## Boundary

This phase adds regression evidence only. It does not add Flask, edition
flags, multiple roles, ABAC/ACL, data scope, ownership, external IAM, or a
permission cache. Frontend controls remain UX; backend authorization remains
the security boundary.
