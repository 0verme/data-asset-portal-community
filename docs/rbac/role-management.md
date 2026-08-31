# RBAC Role Management

> P6 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)。

## API contract

The FastAPI system adapter exposes:

- `GET /api/system/permissions` — the complete permission registry;
- `GET /api/system/permissions?assignableOnly=true` — only role-assignable
  incremental permissions for the role form;
- `GET /api/system/roles` — roles, enabled state, mapped permission codes, and
  assigned-user count;
- `POST /api/system/roles` — create a custom role;
- `PUT /api/system/roles/{role_code}` — replace a custom role's metadata and
  permission mapping atomically;
- `DELETE /api/system/roles/{role_code}` — delete an unassigned custom role;
- `PATCH /api/system/users/{username}/role` — bind exactly one role to a user.

The existing user create/update contract also accepts the single `role` code.
All role-management writes require `system:role:write`; reads require
`system:role:read`; user bindings require `system:user:write`.

## Invariants

- `admin` and `maintainer` are seeded built-in roles and cannot be created,
  updated, or deleted through the management API.
- Permission mappings accept only registered P0 permission codes; unknown codes
  are rejected and mappings are normalized, deduplicated, and sorted.
- Public catalog read codes are inherited by the effective permission model and
  are ignored/removed from role mappings; they are not role-assignable.
- Disabled or missing custom roles cannot be assigned to a user.
- A role that is still assigned to any user cannot be deleted.
- User binding remains single-role (`p_admin_user.role`); multi-role and ABAC/
  ACL/data-scope semantics are intentionally out of scope.
- An active `admin` user must remain after role binding, user status, user
  update, or user deletion operations.

The backend database authorization repository remains the security boundary.
Frontend role controls only shape navigation and mutation UX; direct API calls
still require the server-side permission dependency.

## Community boundary

P6 reuses the existing portable `p_role`, `p_permission`, and
`p_role_permission` tables from P1. It does not add private routes, edition
flags, proprietary permissions, or a new database dialect requirement.
