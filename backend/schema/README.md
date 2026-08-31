# 数据库 Schema 与增量迁移

`backend/schema/` 是新库初始化的唯一结构基线，四份 SQL 是一个 versioned schema artifact set：必须保持相同的 repository module table/column/primary-key/unique/foreign-key/index inventory，同时保留各方言的物理语法和部署约束。所有仓库已有模块均进入 baseline：

- `sqlite.sql`
- `postgresql.sql`
- `dws.sql`
- `mysql.sql`（MySQL 8.0、InnoDB、`utf8mb4_0900_ai_ci`）

当前 baseline 包含 shared/system、RBAC、dwm、mapping、root、indicator、apiAsset、upstream、push、report、codeTable 和 lineage storage 的 39 张表。`backend/app/db/tables.py` 是 runtime SQLAlchemy Core 查询子集，不是完整 physical schema；职责详见 [ADR-002](../../docs/adr/002-schema-canonical-source.md)。

新库执行完整基线后会写入 Alembic revision `0001_baseline`。既有库只能在 `verify` 通过后执行 `baseline`（stamp），不会重放历史 DDL：

```bash
python backend/scripts/schema_migrate.py apply --profile <profile>
python backend/scripts/schema_migrate.py verify --profile <profile>
python backend/scripts/schema_migrate.py baseline --profile <profile> --dry-run
python backend/scripts/schema_migrate.py baseline --profile <profile>
```

离线检查四类基线：

```bash
python backend/scripts/schema_migrate.py verify --offline --dialect sqlite
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python backend/scripts/schema_migrate.py verify --offline --dialect mysql
python backend/scripts/schema_migrate.py verify --offline --dialect dws
```

后续结构变更只新增 `backend/alembic/versions/` revision，不修改已发布 revision，不提供自动 downgrade。`0002_portable_asset_filter`、`0003_open_repository_modules`、`0004_metadata_ingestion_identity`、`0005_rbac_persistence` 和 `0006_field_mapping_upstream_id` 是增量示例；`0004` 为 Asset source-scoped identity、Lineage import/content bookkeeping 提供 forward migration，并移除 legacy `table_name` global unique 约束；`0006` 将字段映射已有的 `upstream_system_id` 收口为 `p_upstream_system.system_pk` 外键，并对历史数据执行不猜测的 backfill。SQLite、PostgreSQL 与 MySQL 的 fresh/upgrade 路径都会从 baseline 升级到同一 head。DWS 目前保留离线基线验证与静态兼容验证；其 JDBC/provider 路径不宣称 online Alembic parity。

业务服务使用 `__app__.` 逻辑 schema 或 SQLAlchemy Core；物理 schema、参数风格和连接池由 `backend/app/db/` Provider 统一处理。禁止在服务层写 `dwp.`、数据库类型分支或手工替换占位符。
