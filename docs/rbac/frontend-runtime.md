# RBAC Frontend Permission Runtime

> Current frontend compatibility contract for Issue #140.

## Single source

`frontend/src/auth/permissions.js` provides the only frontend permission
predicate:

```js
can("indicator:write")
```

`useAuthSession` exposes `can`, and the auth context carries it to the app
shell. In remote mode, `auth.permissions` comes from the backend authentication
contract. Mock mode uses the built-in maps only for its local deterministic
demo; it does not replace backend authorization.

## Authenticated business bootstrap

Remote mode hydrates identity through `/api/auth/me` before requesting
business data. While there is no valid identity:

- menu bootstrap is not requested;
- portal statistics and unified search are not requested;
- inactive module hooks do not issue catalog reads;
- direct/deep-linked business modules show a login prompt instead of entering
  a `401` request loop.

After login, the app retries navigation loading and the current module can
request its authenticated catalog data. The shared HTTP client keeps the
existing `401` event for expired sessions; `/auth/me` and menu bootstrap
suppress duplicate login prompts. After logout, business state is not fetched
again until a new identity is available.

## UX coverage

- ordinary business reads are available to an authenticated user even when
  they have no special `*:read` permission;
- system UI still uses `system:*` and `operation_log:read` to control sensitive
  pages and presentation;
- module edit compatibility flags are derived from resource write permissions;
- root, asset, indicator, report, API asset, push, upstream, and code-table
  mutation entry points pass their resource permission to the shared login /
  mutation guard;
- `adminOnly`, menu status, route guards, and hidden buttons remain UX only;
- search and menu loading do not serve as the authentication boundary.

The backend enforces authentication and authorization for direct API calls.
No frontend control can authorize a request, and no public catalog mode was
added.
