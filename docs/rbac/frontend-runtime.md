# RBAC Frontend Permission Runtime

> P5 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32)，基于
> P4 merge `4d0aa4ba0e58b43755177b6bd3c744add572278c`。

## Single source

`frontend/src/auth/permissions.js` provides the only frontend permission
predicate:

```js
can("indicator:write")
```

`useAuthSession` exposes `can`, and the auth context carries it to the app
shell. `auth.permissions` always comes from the backend authentication
contract in remote mode. `normalizePermissions` removes unknown/duplicate codes
and sorts the snapshot for deterministic rendering.

The built-in maps in the same file are used only for Mock mode. They keep local
demo login deterministic and mirror the P0 registry; they do not replace the
backend decision in remote mode.

## UX coverage

- menu filtering uses `system:*` and `operation_log:read` rather than role
  equality;
- system deep-link fallback uses the operation-log permission;
- module edit compatibility flags are derived from resource write permissions;
- root, asset, indicator, report, API asset, push, upstream, and code-table
  mutation entry points pass their resource permission to the shared login/
  mutation guard;
- public reads remain visible to guests according to the P0 route contract;
- `adminOnly` remains menu presentation metadata only.

The backend remains the security boundary. Hiding a button or deep-link entry
cannot authorize a direct API call.
