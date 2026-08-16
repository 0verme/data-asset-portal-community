# Database migrations

`backend/migrations` is the **schema source of truth**: the migration manifest
(`manifest.json`) plus the dialect SQL trees (`sqlite/`, `postgresql/`, `dws/`)
are the only official schema initialization path for new **Community** installs
(migration apply → `demo/seed_*.py` seed). The per-module DDL under
`docs/{pg,dws}` is **reference documentation** for the full edition (it also
creates private-module tables such as push/upstream/report/codeTable and the
lineage snapshot tables); it is no longer an alternative initialization
mechanism for Community and must not contradict the migrations.

Migration entries may provide **sqlite**, **postgresql**, and **dws** files.
SQLite is used by the Community/local isolated runtime, PostgreSQL is shared by
Community and full deployments, and DWS files serve GaussDB/DWS deployments. A
migration only supports the dialects declared by that manifest entry.

## Layout

- `manifest.json` is the ordered migration manifest.
- `sqlite/`, `postgresql/`, and `dws/` contain the post-baseline SQL selected for each declared dialect.
- `backend/app/migrations/` contains the manifest loader and runner.
- `backend/scripts/schema_migrate.py` is the explicit CLI.
- `backend/tests/test_migrations.py` covers manifest, ledger, checksum, baseline, and runner contracts.

## Adding a post-baseline migration

Versions are four-digit, unique, strictly increasing identifiers and describe changes relative to the consolidated baseline. Each manifest entry has a stable name, description, module ownership, `transactional` flag, and one in-tree SQL file for every dialect it supports.

Add the required dialect files and one manifest entry, then run `verify`, `plan`, a test-database `apply`, and the automated tests. Core migrations normally cover SQLite and PostgreSQL and add DWS when the capability is supported there; private-only migrations may omit SQLite. Never edit an applied migration; add a later forward migration or restore a verified backup. Do not add down scripts to the managed runner.

## CLI

All commands require an existing named database profile; the CLI never accepts a password or DSN.

```bash
python backend/scripts/schema_migrate.py status --profile NAME
python backend/scripts/schema_migrate.py verify --profile NAME
python backend/scripts/schema_migrate.py plan --profile NAME
python backend/scripts/schema_migrate.py apply --profile NAME
```

The CLI mirrors Flask startup: when `ASSET_RUNTIME_PROFILE` is set (e.g.
`community`), the runtime profile is applied first — it points the database
configuration at the profile file (e.g. `configs/database.community.yaml`) and
declares the enabled module set. So the Community quick start needs no extra
flags:

```bash
ASSET_RUNTIME_PROFILE=community ASSET_DB_PROFILE=community_sqlite \
  python backend/scripts/schema_migrate.py apply --profile community_sqlite
```

`--modules` can still override the enabled module set explicitly; `core`
entries are always selected.
# Module ownership

Each manifest entry declares `module` or `modules`. Pass the effective module
codes to `schema_migrate.py --modules`; `core` entries are always selected.
Dialect files may be a subset of `sqlite`, `postgresql`, and `dws`.
