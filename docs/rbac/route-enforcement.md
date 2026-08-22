# RBAC Backend Route Enforcement

> P3 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)，基于
> P2 merge `98dfe58efe486935bb43f779ed34bd419cd1c582`。

## Enforcement rule

当前 FastAPI route 的敏感边界使用统一的：

```python
Depends(require_permission("resource:action"))
```

`require_permission` 通过 P2 `AuthorizationService` 重新解析当前 user、role
和 Role-Permission mapping。Frontend 是否隐藏按钮不会影响 API decision。

## Current protected groups

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
| metadata | `metadata:write` on both ingestion aliases; `metadata:read` on ingestion lookup |
| operation log | `operation_log:read` on list/detail |
| system user | `system:user:read/write` |
| system menu | `system:menu:write`; public menu read remains filtered |
| system param | `system:param:read/write` |

The P0 public query contract remains open for ordinary module reads, portal,
search, field mapping, lineage, public code-table reads, and ordinary upstream/
push list/detail. No GET was made login-only only because it has a matching
`*:read` code.

## Legacy classification

- `require_admin` / `require_maintainer` no longer appear in FastAPI route
  declarations; P2 keeps them only as compatibility dependencies for routes
  not yet migrated in future branches.
- `adminOnly` remains UI/menu metadata and is not an API security boundary.
- `system.py` still uses role labels while filtering the public menu response.
  This is **KEEP — presentation compatibility**, not a protected authorization
  decision; writes use `system:menu:write`.
- `system_management_service.py` role checks used by last-administrator
  protection and the current user-form compatibility contract are **KEEP —
  bootstrap/data-integrity compatibility**. They are not route authorization.

## Regression contract

- unauthenticated protected mutation/read: `401`;
- authenticated identity without the required code: `403`;
- custom role with exact mapping: only mapped protected operations pass;
- direct API calls are checked before the mutation service runs;
- public reads remain callable without a session.
