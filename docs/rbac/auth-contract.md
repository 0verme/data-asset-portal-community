# RBAC Authentication Contract

> P4 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)，基于
> P3 merge `5a6a3127b24b8806e56f47bad4ee070f6e200589`。

## Success payload

`POST /api/auth/login` and `GET /api/auth/me` return the existing envelope with
an additional backend-authoritative permission collection:

```json
{
  "data": {
    "user": "alice",
    "name": "Alice",
    "role": "maintainer",
    "permissions": [
      "indicator:read",
      "operation_log:read"
    ]
  }
}
```

`permissions` is sorted lexicographically and contains only registered current
codes. The frontend must consume this list rather than re-deriving capability
from `role`.

## Current-state semantics

- Login derives the list through `AuthorizationService` after authentication.
- `/auth/me` re-reads the current user/role/mapping state; it does not use a
  permission list stored in the signed cookie.
- If an existing cookie's user is disabled or deleted, `/auth/me` returns `401`
  and sensitive API dependencies reject the same cookie.
- If the current role changes, `/auth/me` returns the new role and its current
  sorted mappings on the next request.
- If a role mapping is revoked, the next `/auth/me` returns the reduced list and
  the next protected API request returns `403`.
- A non-empty unknown/disabled role is not upgraded to `admin`; its
  `permissions` is empty and protected resources return `403` when the current
  user still exists. Missing/disabled/deleted users return `401`.
- Custom role codes are allowed in the identity contract while the product
  remains one-user/one-role.

The signed session retains only the existing minimum identity fields. It does
not cache permissions and does not add a distributed invalidation mechanism.
Logout and error envelopes remain compatible with the current FastAPI contract.
