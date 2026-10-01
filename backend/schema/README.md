# 数据库 Schema 与增量迁移

`backend/schema/` 是新库初始化的唯一结构基线，四份 SQL 是一个 versioned schema artifact set：必须保持相同的逻辑 table/column/primary-key/unique/relationship/index contract，同时保留各方言的物理语法和部署约束。SQLite、PostgreSQL、MySQL 保持完整且相同的 physical foreign-key inventory；GaussDB(DWS) 当前不支持 `FOREIGN KEY ... REFERENCES` constraint，因此仅保留 logical relationship，不创建 physical FK。该数据库能力差异不代表业务 schema 或 Community feature 分叉。所有仓库已有模块均进入 baseline：

- `sqlite.sql`
- `postgresql.sql`
- `dws.sql`
- `mysql.sql`（MySQL 8.0、InnoDB、`utf8mb4_0900_ai_ci`）

当前 baseline 包含 shared/system、RBAC、dwm、mapping、root、indicator、apiAsset、upstream、push、report、codeTable 和 lineage storage 的 39 张表。`backend/app/db/tables.py` 是 runtime SQLAlchemy Core 查询子集，不是完整 physical schema；职责详见 [ADR-002](../../docs/adr/002-schema-canonical-source.md)。

新库执行完整基线后会写入 Alembic revision `0001_baseline`；`schema_migrate.py apply` 随后按顺序 seed RBAC 与 `config/default-menus.json` 中的默认系统菜单。菜单 seed 只补缺失项，不覆盖实例配置。既有库只能在 `verify` 通过后执行 `baseline`（stamp），不会重放历史 DDL：

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

DWS logical relationship inventory 由测试层的显式 contract 守护：逐项检查 child/parent table、列、类型和 parent PK/UNIQUE candidate key，并对 HASH child 检查 distribution compatibility；DWS baseline physical FK 必须为 0。该 baseline 调整只影响 fresh initialization，不会自动修改已有数据库。

### GaussDB(DWS) 8.1.3 fresh-baseline compatibility

当前明确的 DWS fresh-install DDL compatibility 目标为 GaussDB(DWS) 8.1.3，不代表对所有 GaussDB/DWS 8.x 版本作兼容保证。维护者提供的修复前真实 preflight 为 61 条语句中 56 PASS / 5 FAIL；本次针对全部五个实测失败点修复。相关 physical DDL decisions：所有 39 张表显式声明 `DISTRIBUTE BY REPLICATION/HASH`；不创建 physical `FOREIGN KEY`；不使用 8.1.3 不支持的 `CREATE INDEX IF NOT EXISTS`；`p_operation_log.id` 使用 `BIGSERIAL PRIMARY KEY`，逻辑 schema parser 将其视为 `BIGINT PRIMARY KEY` 并在 DWS reflection 中规范化 sequence-generated default。修复后的完整 DWS preflight 仍需在真实目标环境由维护者执行确认。

执行真实 baseline 前可运行 `python backend/scripts/dws_schema_preflight.py --profile <gaussdb-profile>`。该 runner 仅接受 GaussDB profile，拒绝已含用户表的目标 schema，逐条执行 profile-rendered DDL、收集全部失败并最终 rollback；它不写 `alembic_version`，也不执行 migration 或 seed。

GaussDB(DWS) 8.1.3 的 catalog reflection 查询直接返回 `pg_constraint.conkey/confkey`、`pg_index.indkey` 原始向量及 relation id，再由 Python 借助 `pg_attribute(attrelid, attnum)` 映射按原顺序展开，保留复合键、FK 配对和多列索引顺序。此路径不依赖 `LATERAL`、`WITH ORDINALITY`、或 FROM 子句中的 correlated set-returning function；PostgreSQL 仍保留原有 `LATERAL unnest(... WITH ORDINALITY)` 实现。DWS 8.1.3 的反射兼容性仍需维护者在真实目标环境验收，离线测试不代表在线验证通过。

对已经初始化的 DWS schema，可先运行 `python backend/scripts/dws_verify_metadata_preflight.py --profile <gaussdb-profile>`，再执行 `schema_migrate.py verify`。此 runner 复用正式 reflection query builder，单独探测 columns、attributes、constraints、referential constraints 和 indexes 五组只读 metadata SQL，报告所有独立失败；它不执行 DDL/DML、migration、seed 或 apply，不要求重新初始化数据库。

后续结构变更只新增 `backend/alembic/versions/` revision，不修改已发布 revision，不提供自动 downgrade。`0002_portable_asset_filter`、`0003_open_repository_modules`、`0004_metadata_ingestion_identity`、`0005_rbac_persistence`、`0006_field_mapping_upstream_id`、`0007_binary_status_contract`、`0008_indicator_semantic_contract`、`0009_upstream_option_contract` 和 `0010_field_mapping_identity` 是增量示例；`0004` 为 Asset source-scoped identity、Lineage import/content bookkeeping 提供 forward migration，并移除 legacy `table_name` global unique 约束；`0006` 将字段映射已有的 `upstream_system_id` 收口为 `p_upstream_system.system_pk` 外键，并对历史数据执行不猜测的 backfill；`0007` 将码值表可用状态从 legacy `active/draft/disabled` 收口为 `enabled/disabled`，并将历史 `active` / `draft` 分别迁移为 `enabled` / `disabled`；`0008` 为指标增加稳定 asset/field ID、聚合和语义生命周期字段，只对唯一精确的非删除资产/字段执行 backfill，歧义值保持 NULL，并保留原字符串快照；`0009` 仅补齐上游/下游系统表单共用的缺失码值分类和条目，不改写已有字典或业务记录；`0010` 移除字段映射旧的 source-only 唯一索引，并创建完整五元身份的普通查询索引，不改写映射数据。SQLite、PostgreSQL 与 MySQL 的 fresh/upgrade 路径都会从 baseline 升级到同一 head。DWS 保留离线基线与静态兼容验证，并提供 rollback-only `dws_schema_preflight.py` 对配置的 GaussDB 实例逐条探测 baseline DDL；其 JDBC/provider 路径不宣称 online Alembic parity。

业务服务使用 `__app__.` 逻辑 schema 或 SQLAlchemy Core；物理 schema、参数风格和连接池由 `backend/app/db/` Provider 统一处理。禁止在服务层写 `dwp.`、数据库类型分支或手工替换占位符。
