# RBAC Persistence Contract

> P1 of [#32](https://github.com/0verme/data-asset-portal-community/issues/32),
> based on P0 #120 and merged baseline `7685cb54d3d654c1fb97a7cd4d869ce087579119`.

## Schema

P1 adds the minimal one-user/one-role persistence model:

```text
p_admin_user.role  ── role_code ──> p_role
                                      │
                                      ▼
                               p_role_permission
                                      ▲
                                      │
                                p_permission
```

| Table | Contract |
| --- | --- |
| `p_role` | `role_code` PK, `name`, `description`, `builtin`, `enabled`, timestamps |
| `p_permission` | `permission_code` PK, `resource`, `action`, `name`, `description` |
| `p_role_permission` | composite PK `(role_code, permission_code)`, cascading FKs to both registry tables, lookup index on `permission_code` |

`p_admin_user.role` remains the stable role code. P1 does not add
`p_user_role`, multiple roles, hierarchy, inheritance, or a role foreign key
that would reject an existing custom/unknown value before P2 can fail closed.

The forward-only RBAC Alembic revision is
`backend/alembic/versions/0005_rbac_persistence.py`; the current Alembic head also
contains the additive field-mapping identity revision `0006_field_mapping_upstream_id.py`.
Fresh baselines contain
the same tables so `schema_migrate.py verify --offline` and fresh initialization
see one identical 39-table contract. Existing SQLite/PostgreSQL/MySQL
installations at the previous RBAC head receive the tables through revision `0005`; field-mapping installations are then upgraded by revision `0006`.
The GaussDB/DWS provider has no online Alembic path in the current repository;
`seed_rbac` applies the same forward DDL when a pre-RBAC DWS database is
encountered, while fresh DWS uses the canonical baseline.

## Seed and bootstrap

`backend/app/authorization/persistence.py` provides a deterministic,
read-before-insert seed:

1. `p_role` inserts built-in `admin` and `maintainer` only when absent.
2. `p_permission` inserts every P0 registry definition in registry order.
3. `p_role_permission` inserts explicit admin-all and maintainer-compatibility
   mappings only when absent.
4. Existing custom role descriptions, custom permissions, and extra mappings
   are never overwritten or deleted.

`schema_migrate.py apply` runs the seed after baseline/Alembic work and prints
an insertion summary. The SQLite demo seed invokes the same function before
creating the fictional demo administrator. PostgreSQL/DWS demo SQL renders the
same registry and mapping rows with conflict-safe inserts; `p_admin_user` is
still intentionally left for the deployment/bootstrap operator in that SQL
path.

Repeated seed is a no-op. A new permission is an additive registry/seed diff;
it does not silently grant unrelated permissions or reset custom mappings.

## Verification contract

The P1 checks cover:

- fresh baseline table parity across SQLite, PostgreSQL, MySQL, and DWS;
- offline `verify` for all four dialects;
- upgrade from the previous Alembic head while preserving existing rows;
- explicit admin and maintainer mapping counts;
- repeat seed idempotency;
- preservation of a custom role and mapping;
- existing `admin` / `maintainer` user role codes;
- unknown role with no implicit permission mapping;
- PostgreSQL/DWS reference DDL parity.

A live DWS/GaussDB instance is environment-dependent. Without an isolated
instance and vendor JDBC driver, live integration remains `NOT RUN`; the
static baseline/provider contract is not reported as a live database PASS.
