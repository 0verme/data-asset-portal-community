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
      "api_asset:read",
      "asset:read",
      "code_table:read",
      "field_mapping:read",
      "indicator:read",
      "indicator:write",
      "lineage:read",
      "operation_log:read",
      "report:read",
      "root:read"
    ]
  }
}
```

`permissions` is sorted lexicographically and contains only registered current
codes. It is the effective snapshot: public catalog permissions are included
for every anonymous/valid authenticated actor, and role permissions add the
incremental capabilities. The frontend must consume this permission set rather
than re-deriving authorization from `role`.

## Current-state semantics

- Login derives the list through `AuthorizationService` after authentication.
- `/auth/me` re-reads the current user/role/mapping state; it does not use a
  permission list stored in the signed cookie.
- If an existing cookie's user is disabled or deleted, `/auth/me` returns `401`
  and sensitive API dependencies reject the same cookie.
- If the current role changes, `/auth/me` returns the new role and its current
  sorted effective permissions on the next request.
- If a role mapping is revoked, the next `/auth/me` keeps the public catalog
  permissions but removes that role delta, and the next protected API request
  returns `403`.
- A non-empty unknown/disabled role is not upgraded to `admin`; its
  `permissions` is empty and protected resources return `403` when the current
  user still exists. Missing/disabled/deleted users return `401`.
- Custom role codes are allowed in the identity contract while the product
  remains one-user/one-role.

The signed session retains only the existing minimum identity fields. It does
not cache permissions and does not add a distributed invalidation mechanism.
Logout and error envelopes remain compatible with the current FastAPI contract.

The application-owned `session` cookie is signed with the native HMAC-SHA256
codec. Pre-#145 cookies are verified by a read-only migration reader and
reissued after a successful request; deployments must preserve the existing
secret while renaming it to `APP_SECRET_KEY`. The legacy reader is removed only
after the maximum configured session lifetime has elapsed.
