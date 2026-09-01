# ADR-002：Schema Canonical Source 与多方言 Baseline 职责

- Status: **Accepted**
- Date: 2026-08-23
- Scope: Issue #150
- Decision: **KEEP CURRENT DESIGN**

## Context

仓库同时维护 SQLite、PostgreSQL、MySQL 8 和 GaussDB/DWS 四份 fresh-install SQL。Issue #150 评估是否应以一个 logical model、SQLAlchemy metadata 或 Alembic model 自动生成这些文件。

本 ADR 只决定职责和演进方向，不删除 baseline、不改写已发布 migration，也不实施 generator。

## Current Artifact Responsibilities

| Artifact | Role | Runtime / build-time | Hand-edited? | Generated? | Consumer | Validation |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/schema/sqlite.sql` | SQLite fresh-install deployment artifact；baseline contract | Runtime initialization input | Yes | No | `schema_migrate.py apply` → `initialize()`；SQLite seed/tests | offline verify/plan；SQLite reflection and migration tests |
| `backend/schema/postgresql.sql` | PostgreSQL fresh-install deployment artifact；baseline contract | Runtime initialization input | Yes | No | `schema_migrate.py apply` → `initialize()`；PostgreSQL deployment/seed | offline verify/plan；PostgreSQL CI migration/reflection |
| `backend/schema/mysql.sql` | MySQL 8 fresh-install deployment artifact；baseline contract | Runtime initialization input | Yes | No | `schema_migrate.py apply` → `initialize()`；MySQL deployment/seed | offline verify/plan；MySQL provider/CI migration contract |
| `backend/schema/dws.sql` | GaussDB/DWS fresh-install deployment artifact；vendor-compatible baseline | Runtime initialization input | Yes | No | `schema_migrate.py apply` through JDBC baseline path；DWS deployment | offline verify/plan；static DWS/provider checks; no local vendor execution |
| `backend/alembic/versions/0001_baseline.py` | Ledger marker for the baseline; it does not create tables | Runtime migration ledger | Yes | No | Alembic ledger and `schema_migrate.py` | fresh apply/status tests |
| `backend/alembic/versions/0002_*.py`–`0008_*.py` | Immutable forward revisions for existing databases and post-baseline changes | Runtime upgrade path | Yes | No | Alembic for SQLite/PostgreSQL/MySQL; DWS has no online Alembic path | migration lifecycle, CI integration and revision-head gates |
| `backend/app/migrations/schema.py` | Baseline path resolution, lightweight SQL parsing, reflection and drift comparison | Runtime verification/build-time test helper | Yes | No | migration CLI and schema tests | parity, reflection and migration tests |
| `backend/scripts/schema_migrate.py` | Orchestrates offline checks, baseline initialization, stamp, verify and Alembic head upgrade | Runtime/build-time CLI | Yes | No | operators, CI and release checks | CLI contract and offline checks |
| `backend/app/db/metadata.py` + `backend/app/db/tables.py` | Logical-schema namespace and runtime SQLAlchemy Core query declarations | Runtime query compilation | Yes | No | migrated services and provider adapters | Core dialect compilation and provider contracts |
| `demo/seed_loader.py`, `demo/seed_sqlite.py`, `demo/seed_postgres.py` | DML seed plan and demo data consumers of the physical column contract | Runtime/deployment data initialization | Yes | SQL seed output only for PostgreSQL/DWS; not DDL generation | fresh Community/demo databases | seed volume, idempotency and public-data guard tests |
| `docs/pg/*.sql`, `docs/dws/*.sql` | Supplementary module/vendor DDL and deployment reference; not the Community fresh-install entry point | Deployment reference | Yes | No | manual full/extension deployment | paired PG/DWS contract tests and document review |
| `backend/tests/*schema*`, `*migration*`, `*provider*`, `*reflection*` | Contract and regression checks | Build/test-time | Yes | No | CI and local release checks | unittest suites and CI jobs |

### Four baseline consumers

- `sqlite.sql`、`postgresql.sql`、`mysql.sql` 和 `dws.sql` 都由 `backend/app/migrations/schema.py` 的 `baseline_path()` 读取；`initialize()` 在空库中执行相应 SQL，随后写入 `0001_baseline`。
- `schema_migrate.py verify/plan --offline` 读取 `backend/schema`，不连接数据库；`verify` 由共享 table parser 检查四方言 baseline 的 table inventory，`plan` 选择对应文件。
- `test_migration_schema_parity.py`、`test_migrations.py`、`test_schema_migrate_cli.py` 和相关 CI job 直接或间接消费这些文件。
- seed 脚本不读取 DDL 文本，但其列清单和表名直接依赖 baseline；`demo/seed_sqlite.py` 还调用 RBAC persistence 写入 baseline 中的 RBAC 表。

## Canonical Responsibility Map

### `backend/schema/*.sql`

四个文件组成一个**versioned schema artifact set**。它们是当前 fresh-install 的物理部署输入、offline artifact 和 baseline contract，而不是可以被一份可移植业务模型无损替代的单一逻辑模型。

当前四方言共享 table/column/primary-key/unique/foreign-key/index inventory，但物理表达必须保留方言语义：

- SQLite 使用 attached `dwp` database、SQLite 类型和 `AUTOINCREMENT`；
- PostgreSQL 使用 `dwp` schema、`BIGINT`/`VARCHAR`/identity；
- MySQL 不使用 schema qualification，使用 InnoDB、`utf8mb4_0900_ai_ci`、`AUTO_INCREMENT`，并将报表长文本使用 `TEXT` 以满足 InnoDB row-size 约束；
- DWS 使用 JDBC/provider 路径以及 `DISTRIBUTE BY REPLICATION/HASH` 等 vendor storage clauses。

### Alembic

`0001_baseline` 是 ledger marker，不是 fresh-install DDL。空库流程是：

```text
selected backend/schema/<dialect>.sql
        → stamp 0001_baseline
        → Alembic head (SQLite/PostgreSQL/MySQL)
```

`0002`–`0008` 同时承担两项职责：为已有数据库提供 forward upgrade，为 baseline 之后的 head 提供增量行为。fresh baseline 已经包含当前模块表，因此后续 revision 中存在兼容/补齐逻辑；不能把 revision history 改写成 generator 输出。

`backend/alembic/env.py` 的 `target_metadata` 为 `None`，当前 Alembic 不是从 SQLAlchemy metadata 自动 diff 的 model registry。GaussDB provider 声明 `JDBC`、没有 SQLAlchemy engine，也没有 `ALEMBIC_ONLINE`；`schema_migrate.py` 对 GaussDB 不运行 online Alembic。DWS 因此保留 baseline/offline/static compatibility 边界，不能假设 PostgreSQL Alembic compiler 可以表达完整 DWS physical schema。

### SQLAlchemy Core metadata

`metadata = MetaData(schema="__app__")` 和 `tables.py` 是 runtime query metadata，不是完整 physical schema。静态审计结果：

- baseline 与 runtime metadata 当前均声明 39 张表、478 个列；metadata 仍是面向运行时查询的 SQLAlchemy Core 声明，不是 DDL generator；
- runtime metadata 的列名与 baseline 的公共列名保持对齐，包括 Phase 1 的指标语义列；
- metadata 没有完整表达 physical baseline 的显式 index、foreign-key、unique/check constraint；`p_lineage_node`/`p_lineage_edge` 的复合主键也没有完整表达；
- `__app__` 是 provider translation 的逻辑 schema，不等于 SQLite attached database、PostgreSQL/DWS `dwp` 或 MySQL database。

所以 metadata 可以继续服务 runtime query portability，但当前信息不完整，不能成为 fresh-install canonical source。

### Contract tests

当前测试能发现：

- 四方言的 table/column-name、primary-key、unique、foreign-key 和 explicit-index inventory 漂移；
- SQLite fresh schema 的 table、column、type、nullable、default、primary-key、unique、foreign-key 和 expected-index 漂移；
- fresh baseline → Alembic head、existing compatible database stamp、repeat apply、demo seed 和 provider capability contract 问题。

当前测试不能完整发现：

- 四方言之间的 type length、identity/sequence、nullable 和 default 差异；
- DWS `DISTRIBUTE BY`、JDBC vendor execution 和 storage characteristics；
- MySQL engine/collation/row-size 约束；
- `compare_schema()` 对实际数据库中**额外 index**的报告；
- metadata 与完整 baseline 的全量约束/默认值 parity；
- 本地 PostgreSQL、MySQL、DWS 的实际 reflection/seed（CI 提供 PostgreSQL/MySQL ephemeral jobs，DWS 当前没有 vendor integration job）。

这些是已记录的 test gaps，而不是把正常方言差异误判为 drift。

## Evidence

### Static and structural inventory

在 `origin/main` 的当前 revision 上，四份 baseline 的 parser inventory 均为：

```text
39 tables
478 columns
22 explicit indexes
24 unique constraints
13 foreign-key constraints
```

四方言的 table-name、column-name、primary-key、unique、foreign-key 和 index-name/columns inventory 一致。以下差异是物理 dialect contract，不应被逐行 diff 机械归类为 drift：

- SQLite `INTEGER/TEXT` 与其他方言的 `BIGINT/VARCHAR/CHAR`；
- SQLite `AUTOINCREMENT`、PostgreSQL/DWS identity、MySQL `AUTO_INCREMENT`；
- MySQL InnoDB/charset/collation 和报表长文本 `TEXT`；
- MySQL `p_indicator_path_config.full_path` 为 `VARCHAR(512)`，PostgreSQL/DWS 为 `VARCHAR(1000)`；这属于需要继续显式审查的 dialect-specific difference，不能由 generator 默认抹平；
- MySQL 报表 JSON-like columns 没有 `DEFAULT '[]'`，该差异由 MySQL row-size/default compatibility 修复保留；
- DWS baseline 的 11 个 `DISTRIBUTE BY` clauses。

### Git history

审计了 `backend/schema`、`backend/alembic`、`tables.py`、`metadata.py` 和 migration helper 的历史：

| Commit | Evidence | Classification |
| --- | --- | --- |
| `43d6548` (2026-08-21) | 首次建立四方言 baseline、`0001`/`0002` 和 schema verification | Initial artifact set |
| `7a438a4` (2026-08-22) | open repository modules 同时更新四份 baseline，并新增 401 行 `0003` forward migration；DWS 增加 distribution、MySQL 保留 engine clauses | Repeated manual maintenance; intentional dialect extensions |
| `47f4bf6` + `61f03ae` (2026-08-22) | metadata ingestion 同时更新四份 baseline 与 `0004`；`61f03ae` 修复 PostgreSQL baseline syntax 和 MySQL reflection drift，并统一 source-identity unique constraint | Real cross-dialect contract correction, not a missing-file incident |
| `1f792d9` (2026-08-22) | 只改 MySQL baseline 和 migration renderer，将报表长文本改为 `TEXT` | Intentional MySQL-specific compatibility fix |
| `9ac81d4` (2026-08-22) | RBAC 表同时加入四份 baseline、`0005`、seed 和 parity tests | Repeated manual maintenance |

已查看的 schema-wide commits 均同时触及四份 baseline；没有找到“某一次 schema change 只更新了其中一个 baseline”的历史证据。因此，当前最强证据是重复维护成本和测试 blind spot，而不是已经反复发生的 baseline omission incident。

### Drift findings

- **REAL DRIFT / contract correction**：`61f03ae` 的 PostgreSQL syntax / MySQL reflection 修复说明人工同步并不等于跨方言语义自动正确。
- **INTENTIONAL DIALECT DIFFERENCE**：DWS distribution strategy、MySQL storage/row-size/default、SQLite attached schema 和各方言 identity 语法是部署约束，不应为了 single source 被删除。
- **TRANSITIONAL DEBT**：RBAC 合入后 baseline 已是 39 表，但 `backend/schema/README.md` 和 `docs/TABLE_OWNERSHIP.md` 仍写 36 表。这是本次文档修正的直接依据，不是 SQL baseline 漏同步。
- **TEST GAP**：结构 parity 未覆盖完整 defaults/types/nullability/vendor storage，metadata 也未覆盖全物理 schema；这些 gap 限制了“自动生成一定能保持等价”的结论。
- **MAINTENANCE COST**：过去两天至少有四次跨四文件 baseline 变更；每次新增/修改表、列、约束或 index 都需要同步 fresh artifact、必要的 forward revision、seed 和 tests。

## Constraints

### Offline deployment

`verify --offline` 和 `plan --offline` 必须在没有数据库、driver 或 vendor service 时工作。当前它们读取提交到仓库的 SQL artifact；依赖运行期 metadata compiler 会削弱该保证。generated SQL 只有在生成结果仍提交并在 CI 中检查 stale 时才满足同样的 contract。

### SQLite

SQLite 是可执行的 Community/local fresh-install 和 test oracle。其 `dwp` attached database、`AUTOINCREMENT`、DDL splitting 和 Alembic batch/upgrade behavior 不能被只针对 PostgreSQL 的 compiler 假设覆盖。

### PostgreSQL / MySQL

PostgreSQL 有 CI ephemeral migration/reflection/seed；MySQL 8 有独立 provider、InnoDB/charset/row-size 和 CI baseline/CRUD contract。MySQL 的 `TEXT`/JSON default 等差异已经在历史修复中证明需要显式 renderer/patch 语义。

### DWS

DWS provider 是 JDBC-only compatibility boundary，当前没有 SQLAlchemy engine 或 online Alembic。baseline 中的 `DISTRIBUTE BY`、identity、schema qualification 和 vendor syntax 必须保留；没有真实 vendor execution 证据，不宣称 PostgreSQL dialect 能完整生成 DWS。

### Alembic and existing databases

已发布 revision immutable、migration forward-only、没有自动 downgrade。fresh baseline 与 existing database upgrade 是两个不同 contract；generator 不能替代已有 migration history，也不能让 fresh output 改变既有 revision 的语义。

### Seed and provider

seed 是 DML consumer，不是 schema source；它要求完整模块表和准确列名，并且 SQLite seed 已验证幂等。Provider 统一 schema/placeholder/transaction boundary，但并没有把四方言 physical DDL 变成同一种能力。

## Options Considered

### Option A — KEEP CURRENT MANUAL BASELINES

```text
Four versioned dialect deployment artifacts
        + immutable Alembic forward revisions
        + runtime SQLAlchemy Core subset
        + schema/reflection/seed contract tests
```

**优点**

- fresh install 和 offline artifact 直接、可审查、可复制；
- DWS distribution/vendor syntax、MySQL storage clauses、SQLite behavior 可以独立表达；
- 不需要 runtime/compiler/driver 才能获得可发布 SQL；
- 现有 migration、seed、provider 和 rollback 语义保持不变；
- 当前 parity/reflection/CI 已能阻止主要 table/constraint drift。

**缺点**

- 新表/列/index 需要四方言人工同步；
- reviewers 需要区分正常 dialect difference 与 real drift；
- 当前 defaults/types/vendor-specific parity 仍有测试盲区；
- baseline 与 Alembic forward revision 可能重复描述部分结构。

### Option B — GENERATED DIALECT BASELINES

```text
canonical logical schema
        → dialect renderers / extensions
        → committed sqlite.sql/postgresql.sql/mysql.sql/dws.sql
```

这可以降低重复列定义，但不会消除 renderer 维护：至少需要 SQLite attached-schema/identity 规则、PostgreSQL identity、MySQL engine/collation/row-size/default 规则和 DWS distribution/JDBC-specific extension。当前 baseline 中已有 11 个 DWS distribution clauses、MySQL `TEXT`/default 例外和 identity 差异，说明 renderer 不是简单 SQLAlchemy `create_all()`。

若采用该方案，生成结果必须继续提交到仓库，generator 输出必须 deterministic，CI 必须用 clean environment 运行 stale-generated check，offline deployment 必须只依赖提交产物；Alembic 仍须独立维护 existing DB upgrades。以当前证据，Option B 把四份 SQL 的复杂度搬到 logical model + 四方言 renderer/patch，尚未证明总复杂度下降。

### Option C — Metadata-driven / stronger single source

候选包括 `SQLAlchemy MetaData → dialect DDL` 或用 Alembic model/revision 反向生成 baseline。

当前 metadata 缺 5 张表/81 个列，缺 physical defaults、foreign keys、indexes、unique/check constraints 和完整 lineage composite PK；Alembic `target_metadata` 为 `None`，revision 本身是历史行为而非完整 current model。DWS 也没有 SQLAlchemy/Alembic online capability。直接采用该方案会丢失 physical contract 或新增大量 extension code，且会把 fresh-install、existing upgrade、offline artifact 和 rollback 的风险集中到一次迁移。

## Decision Matrix

| Dimension | Current manual baselines | Generated dialect baselines | Metadata-driven / strong single source |
| --- | --- | --- | --- |
| Drift prevention | **ACCEPTABLE**：结构 parity/reflection 已覆盖核心，但 defaults/types/vendor 有 gap | **STRONG** only with deterministic output + stale CI; otherwise weak | **WEAK** today because metadata is incomplete |
| Maintenance cost | **WEAK**：四份 artifact + revision/seed/tests | **ACCEPTABLE** if renderer ownership stays small; current DWS/MySQL evidence makes that unproven | **HIGH RISK**：must first rebuild the missing model |
| DWS fidelity | **STRONG**：explicit `DISTRIBUTE BY` and JDBC boundary | **ACCEPTABLE** with tested DWS extension; high implementation cost | **HIGH RISK**: PG compiler is not a DWS compiler |
| SQLite fidelity | **STRONG** and executable locally | **ACCEPTABLE** with attached-schema/identity rules | **ACCEPTABLE** for basic DDL, weak for current install contract |
| PostgreSQL fidelity | **STRONG** and CI-backed | **ACCEPTABLE** with renderer tests | **ACCEPTABLE** after model completion |
| MySQL fidelity | **STRONG** and CI/provider-backed | **ACCEPTABLE** with storage/row-size patches | **WEAK** until MySQL exceptions are modeled |
| Offline deployment | **STRONG**: committed SQL is directly available | **STRONG** only if generated artifacts remain committed | **WEAK** if generation requires runtime dependencies |
| Fresh install | **STRONG** | **ACCEPTABLE** with reproducible checked-in output | **ACCEPTABLE** after full model/renderer validation |
| Incremental upgrade | **STRONG**: existing Alembic history remains separate | **ACCEPTABLE** only as a fresh artifact layer; Alembic still required | **HIGH RISK** if history is conflated with model generation |
| Reflection verification | **ACCEPTABLE**: SQLite tested; PG/MySQL CI; DWS static only | **ACCEPTABLE**; generated output still needs reflection | **WEAK** until generated and physical schemas are both verified |
| Seed compatibility | **STRONG**: current seed contract passes | **ACCEPTABLE** if columns remain stable | **ACCEPTABLE** after seed contract migration |
| Provider compatibility | **STRONG**: explicit capability matrix | **ACCEPTABLE** with provider-aware renderers | **HIGH RISK** for JDBC-only DWS |
| Reviewability | **STRONG**: deploy SQL is visible | **ACCEPTABLE** if output is committed and source/patches are reviewable | **WEAK**: important physical behavior becomes indirect |
| Deterministic artifacts | **STRONG**: current files are committed | **STRONG** if generator is deterministic and pinned | **ACCEPTABLE** only after compiler rules are fixed |
| CI complexity | **STRONG**: existing gates are understood | **WEAK**: add generator, stale-output and renderer matrix gates | **WEAK**: add full model/compiler/physical parity gates |
| Migration risk | **STRONG**: no history rewrite | **WEAK** during transition | **HIGH RISK**: broad schema infrastructure rewrite |
| Rollback simplicity | **STRONG**: revert docs/artifact commit or restore DB backup | **ACCEPTABLE** if old artifacts remain usable | **HIGH RISK** until migration and rollback are proven |

## Decision

**DECISION = KEEP CURRENT DESIGN**

### Rationale

1. Git history shows repeated four-file maintenance and one real cross-dialect correction, but no recurring baseline omission incident that justifies a high-risk rewrite.
2. The four SQL files are deployment artifacts with genuine physical differences; DWS distribution/JDBC behavior and MySQL/SQLite constraints are not fully represented by current metadata or a generic PostgreSQL compiler.
3. SQLAlchemy metadata is a runtime query subset, not a complete schema model: 5 tables, 81 columns, defaults, constraints, indexes and composite keys are outside its current responsibility.
4. Offline fresh-install, SQLite lifecycle, seed idempotency and existing migration history are currently executable and reviewable. Replacing them would add a generator/renderer layer before the repository has the evidence or tests to prove semantic equivalence.

The maintenance cost is accepted and is controlled by the editing contract below. This is a deliberate “not now”, not a claim that four files are free of risk.

## Artifact Ownership and Editing Contract

### Add a table

1. Assign the table to a repository module and update all four `backend/schema/*.sql` files with equivalent table/PK/unique/FK/index semantics, preserving dialect-specific syntax.
2. If existing installations need the table, add a new immutable Alembic forward revision. Do not edit `0001`–`0005`.
3. Update `demo/seed_loader.py`/seed scripts only when demo data needs the table.
4. Add or update parity, reflection, migration, provider and seed contracts. Run all four offline checks and the isolated SQLite fresh flow; PostgreSQL/MySQL CI remains required for their physical execution.
5. Update `docs/pg`/`docs/dws` only when the supplementary deployment/reference contract is affected.

### Add a column

- The authoritative fresh-install entries are the four dialect baselines as a coordinated set.
- The authoritative existing-database change is a new Alembic forward revision (or an explicitly provider-specific DWS forward DDL path).
- Add the column to `tables.py` only when runtime SQLAlchemy Core queries use it; metadata is not required to mirror every physical column.
- Update seed columns and tests when applicable.

### Add an index or constraint

- Put the fresh-install definition in all applicable baseline files, with vendor syntax where needed.
- Put existing-database creation in a new revision; never rely on changing a baseline to upgrade an existing database.
- Keep metadata constraints/indexes synchronized only when they are part of a runtime Core expression or a future explicitly expanded metadata contract; baseline/reflection tests remain the physical contract.

### PostgreSQL versus DWS difference

Write the difference in `postgresql.sql` and `dws.sql` (and in their forward/provider-specific migration paths when required). Do not “fix” it by copying PostgreSQL text into DWS or by claiming SQLAlchemy’s PostgreSQL dialect fully renders DWS.

### Revision and baseline meaning

- `backend/schema/<dialect>.sql` is the current fresh-install baseline artifact, not an immutable initial-release snapshot.
- `0001_baseline` records that the selected baseline was applied; it does not contain the baseline DDL.
- Existing databases must pass `verify` before `baseline` stamp; initialization SQL must never overwrite an existing database.
- Fresh SQLite/PostgreSQL/MySQL apply runs baseline then Alembic head. DWS currently has baseline/offline/static compatibility and a JDBC-specific RBAC compatibility step, not online Alembic parity.
- Offline `verify/plan` reads the committed baseline files; it does not prove vendor execution.

## Consequences

### Positive

- No generator, metadata rewrite, baseline deletion or migration-history rewrite is introduced by #150.
- Existing offline deployment and fresh SQLite/CI contracts remain stable.
- DWS and MySQL physical behavior remains visible and reviewable at the deployment boundary.
- The next schema change has an explicit ownership and validation sequence.

### Negative / accepted risk

- Four baseline files remain manually synchronized.
- The repository still has a test gap for cross-dialect type/default/nullability parity, extra indexes and DWS physical execution.
- Runtime metadata can remain a partial query model and must not be described as the complete schema source.

## Migration / Transition

No implementation transition is scheduled by this ADR. The PR for #150 only records this decision and corrects the stale 36-table documentation. Existing baselines and revisions keep their current behavior.

A future generator evaluation must first be a separate, reversible pilot that produces committed artifacts without changing the default installer. It must prove deterministic output, DWS extension fidelity, offline use, fresh-install parity, existing-upgrade compatibility, seed compatibility and rollback before any baseline ownership changes.

## Rollback

This ADR changes documentation only. Rollback is a normal Git revert; no database object is changed by this PR. The current database rollback contract remains backup/restore or deployment of a previously verified application commit, because repository migrations intentionally do not provide automatic downgrade.

## Re-evaluation Triggers

Re-open canonical-generation evaluation when one or more evidence thresholds is met:

- two independent releases contain a baseline omission or cross-dialect semantic drift incident;
- a fifth supported dialect is added, or DWS/vendor extensions materially expand;
- the metadata model covers all 39 current tables and the required defaults, constraints, indexes, composite keys and provider-specific extensions;
- a deterministic renderer can execute cleanly offline and produce a clean diff for all four committed artifacts;
- CI can execute the generated DWS artifact with an isolated vendor-compatible test environment, not only parse it;
- manual baseline changes become a measured release bottleneck rather than an observed review cost.

## Validation Matrix

| Check | SQLite | PostgreSQL | MySQL | DWS |
| --- | --- | --- | --- | --- |
| CLI help / command contract | PASS | PASS | PASS | PASS |
| Offline verify | PASS | PASS | PASS | PASS |
| Offline plan | PASS | PASS | PASS | PASS |
| Fresh apply | PASS (isolated SQLite) | NOT RUN locally; CI job defined | NOT RUN locally; CI job defined | NOT RUN; JDBC/vendor environment unavailable |
| Status / verify after apply | PASS | NOT RUN locally | NOT RUN locally | NOT RUN |
| Reflection | PASS (fresh and drift tests) | NOT RUN locally; CI path exists | NOT RUN locally; CI path exists | NOT RUN |
| Seed | PASS (fresh, repeat and idempotency) | NOT RUN locally | NOT RUN locally | NOT RUN |
| Repeat apply | PASS (`applied=-`) | NOT RUN locally | NOT RUN locally | NOT RUN |
| Targeted schema/migration tests | PASS: 30 tests | static/CI contracts present | static/CI contracts present | static/offline contracts present |
| Provider/schema/seed tests | PASS: 54 tests, one MySQL integration skip | no local isolated database | no local isolated database | provider capability/static tests pass |
| Full backend unittest suite | PASS: 358 tests, 7 expected skips | integration not enabled locally | integration not enabled locally | no vendor execution |
| Public Data Guard | PASS | PASS | PASS | PASS |

## Follow-up

No implementation follow-up Issue is required for `KEEP CURRENT DESIGN`. A future generator pilot must be a new, independently scoped Issue and must satisfy the re-evaluation triggers above.
