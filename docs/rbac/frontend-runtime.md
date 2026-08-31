# Frontend Permission Runtime

> Current frontend contract for Public Catalog + Authenticated Management
> (Issue #180).

## Single source

`frontend/src/auth/permissions.ts` provides the only frontend permission
predicate:

```js
can("indicator:write")
```

`useAuthSession` exposes `can`, and the auth context carries it to the app
shell. In remote mode, `auth.permissions` comes from the backend authentication
contract. Mock mode uses the built-in maps only for its local deterministic
demo; it does not replace backend authorization.

## Public catalog bootstrap

Remote mode hydrates identity through `/api/auth/me` before requesting business
data. The result is interpreted as follows:

```text
/auth/me 200
  → authenticated user, current permissions, public catalog + permitted management
/auth/me 401
  → anonymous state, public menus/stats/search/catalog remain enabled
```

The app waits for the probe to settle, but it does not require `auth.user` to
load public menus, portal statistics, unified search, or catalog module data.
The shared HTTP client keeps the existing `401` event for unexpected protected
requests; the `/auth/me` probe suppresses duplicate login prompts.

Mock mode follows the same public-read contract: its menu projection hides
system management for guests, its catalog data remains browsable, and write
controls are derived from the mock permission snapshot.

## UX coverage

- ordinary catalog reads are available anonymously and to authenticated users;
- public navigation is loaded from the existing menu API, not a second hardcoded
  anonymous menu tree;
- portal statistics and unified search are usable without login;
- asset, field mapping, lineage, root, indicator, report, API asset, upstream,
  push, and code-table pages retain their read paths;
- mutation entry points are hidden unless the relevant resource write
  permission is present;
- deep-linked edit routes are reset or blocked without the relevant write
  permission;
- system management navigation is hidden for anonymous users, and a direct
  system-management deep link does not issue protected reads as a guest;
- `adminOnly`, menu status, route guards, and hidden buttons remain UX only;
  the backend is still the security boundary.

The frontend never authorizes a request. It only makes the public catalog and
the existing authenticated/admin capabilities visible in a coherent UX.
