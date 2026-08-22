# RBAC Authorization Core

> P2 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)，基于
> P1 merge `9ac81d4e5a0d6b66abf3dae32c1a9afbb9d76ca7`。

## Boundary

`backend/app/authorization/core.py` 只依赖 application `Identity`、Permission
Contract 和一个 `AuthorizationRepository` protocol。Core 不导入 FastAPI、
Starlette、Request、Response、Cookie、Session、HTTPException 或数据库驱动。

```text
Identity + current repository state
              ↓
      AuthorizationService
              ↓
  AuthorizationDecision / permissions[]
```

The current production ASGI composition injects
`DatabaseAuthorizationRepository`. It resolves the current `p_admin_user`
status/role and current Role-Permission rows on each authorization decision.
The no-repository fallback is only a safe built-in compatibility repository
for isolated adapter tests; unknown roles still receive no permissions.

## Core API

- `AuthorizationService.authenticate(identity)` checks current user and role
  state without a permission code.
- `get_permissions(identity)` returns a deterministic sorted tuple of current
  registered codes.
- `has_permission(identity, permission)` and `authorize(identity, permission)`
  deny unknown codes, missing mappings, unknown roles, disabled roles, disabled
  users, and deleted users.
- `current_subject(identity)` exposes the current role/status value object to
  adapters; it does not trust a role cached in the signed session.

An enabled user with an unknown/disabled role remains an authenticated subject
but receives no permissions, so a protected resource is `403`. A missing,
deleted, or disabled user is not an authenticated subject, so the adapter maps
it to `401`.

## FastAPI adapter

`backend/app/fastapi/dependencies.py` provides:

```python
Depends(require_permission("indicator:write"))
```

The adapter resolves `RequestContext.identity`, invokes the neutral core, and
translates the decision to `AuthenticationRequiredError` (`401`) or
`PermissionDeniedError` (`403`). `require_admin` and `require_maintainer` remain
compatibility adapters for P3 route migration; they now revalidate current
user/role state and no longer trust a stale session role for administrator
checks.

The official runtime passes `DatabaseAuthorizationRepository` from
`backend.asgi:create_native_app`. There is no Flask adapter and no second
authorization implementation.

## Session security

P2 removes the old unknown-role-to-admin normalization from
`identity_for_session` and `AuthService.authenticate`. `identity_from_mapping`
still rejects unknown signed session roles at the native session boundary, so
an invalid/unknown cookie cannot become an administrator. Current database
role/status checks provide the stronger protection for existing valid cookies;
P4 will expose the resulting permissions in the authentication contract.

No permission cache, TTL, version counter, event bus, multi-role, ABAC, ACL,
data scope, or external IAM dependency is introduced.
