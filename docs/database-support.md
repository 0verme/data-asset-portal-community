# 数据库支持矩阵 · Database Support

本文是 DAP 公开数据库能力声明的**唯一权威来源**。README、DEVELOPMENT 和 DEPLOYMENT 中的
数据库描述必须与本文一致；不一致时以本文为准。

## 能力标签定义

DAP 用标签而不是笼统的「支持」来描述数据库状态，避免把不同验证强度混为一谈：

| 标签 | 含义 | 判定依据 |
| --- | --- | --- |
| **Verified** | 有可复现的自动化测试或 CI job 覆盖 | `backend/tests/` 中有对应测试，或 `.github/workflows/ci.yml` 中有对应 job |
| **Compatible** | 代码与 DDL 层面提供适配，但只有静态 / 离线验证 | 有 adapter / dialect baseline，但没有在线实例回归 |
| **Not supported** | 仓库中没有 adapter，也没有支持计划 | 不提供 adapter、baseline 或验证路径 |

判定原则：

> **没有真实执行的验证，不会被写成 Verified。**
> 静态 DDL 校验不等于运行时验证，离线 verify 不等于在线回归。

## 支持矩阵

| 数据库 | Runtime | Migration | CI 验证 | 生产建议 |
| --- | --- | --- | --- | --- |
| SQLite | Verified | Verified | Verified | 仅用于 Community 本地开发、一键 Demo 与部分 CI，**不是生产目标** |
| PostgreSQL | Verified | Verified | Verified（真实 PG 16 实例） | 推荐，Community 与完整部署的默认选择 |
| MySQL 8.0 | Verified | Verified | Verified（真实 MySQL 8 实例） | 可用，需要安装独立可选驱动 |
| GaussDB / DWS | Compatible | Compatible（offline/static DDL） | **Static verification only** | 可用于支持该方言的内网环境，但需自行完成部署前验证 |
| Cloudflare D1 | Not supported | — | — | 无 adapter，无计划 |

## 各数据库的验证边界

### SQLite — Verified

- **Runtime / Migration**：`backend/schema/sqlite.sql` 四方言 baseline 之一 + Alembic forward revision。
- **测试覆盖**：`backend/tests/` 中大量单元与契约测试运行在 SQLite 上，包括
  `test_community_boundary.py`、`test_migrations.py`、`test_migration_schema_parity.py` 等。
- **CI**：`migration-community` job 执行 Community Demo 的 fresh 初始化，并重复执行一次验证幂等性。
- **边界**：SQLite 是 Community 本地 / Demo / CI 数据库，**不是生产目标**。
  定位决策见 [工程历史归档](./archive/engineering-history/SQLITE_DECISION.md)。

### PostgreSQL — Verified

- **Runtime / Migration**：`backend/schema/postgresql.sql` + Alembic。
- **CI**：`postgres` job 使用真实 `postgres:16` service 实例，执行：
  1. fresh migration `apply`
  2. `verify`
  3. Alembic head 状态断言
  4. `demo/seed_postgres.py` 写入虚构演示数据
  5. repeat `apply` 必须为 no-op
  6. canonical repository schema 物理边界检查
  7. 启用集成测试后的**全量后端测试**（集成测试不 skip）
- **边界**：CI 使用隔离的一次性 schema（`dwp`），不连接任何生产库。

### MySQL 8.0 — Verified

- **Runtime / Migration**：`backend/schema/mysql.sql` + Alembic；需要额外的 PyMySQL 依赖
  （`pip install -r backend/requirements-mysql.txt`）。
- **CI**：`mysql` job 使用真实 `mysql:8.0` service 实例，执行：
  1. fresh baseline `apply` + `verify`
  2. `test_mysql_integration`：SQLAlchemy Core 的 CRUD、分页、唯一约束、Unicode / emoji、NULL 与 rollback 契约
  3. repeat `apply` 必须为 no-op
- **边界**：MySQL job **不执行** demo seed，也**不运行** PostgreSQL 集成测试套件；
  它的 Verified 范围就是上面列出的 baseline + Core CRUD/事务契约。

### GaussDB / DWS — Compatible

GaussDB / DWS 的准确边界是：

- 提供 `backend/schema/dws.sql` 方言 baseline，并参与 Alembic revision 的方言 parity；
- 提供 `backend/app/db/gaussdb*.py` adapter 与 JDBC 部署路径；
- `docs/dws/` 保留补充 DDL 与部署参考；
- **CI 中只有 `schema_migrate.py verify --offline --dialect dws` 一项静态校验**；
- 没有在线 GaussDB / DWS 实例，没有 CRMA/CRUD 集成测试，没有 seed 回归；
- 商业 JDBC 驱动（如 `gaussdb200.jar`）不包含在仓库中，由部署方自行提供。

因此它只能被描述为 **Compatible**，不能被描述为「已验证支持」或与 PostgreSQL / MySQL 同级。

### Cloudflare D1 — Not supported

仓库中没有 D1 adapter、没有 baseline、也没有验证路径。当前没有支持计划。

## 本地可复现的验证命令

```bash
# 四方言离线结构校验（不需要连接数据库）
python backend/scripts/schema_migrate.py verify --offline --dialect sqlite
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python backend/scripts/schema_migrate.py verify --offline --dialect mysql
python backend/scripts/schema_migrate.py verify --offline --dialect dws

# SQLite Community 初始化
python backend/scripts/schema_migrate.py apply --profile community_sqlite
python demo/seed_sqlite.py --database <absolute-local-path>/community.db

# PostgreSQL Community 初始化（需要隔离的一次性数据库）
python backend/scripts/schema_migrate.py apply --profile community_postgres
python demo/seed_postgres.py --dialect postgres

# MySQL 8.0（先安装可选驱动）
pip install -r backend/requirements-mysql.txt
python backend/scripts/schema_migrate.py apply --profile community_mysql
```

启用 PostgreSQL / MySQL 集成测试需要显式提供隔离测试库配置，见 [开发指南](../DEVELOPMENT.md) 的
「数据库集成测试」一节。未配置时这些测试自动 skip，不能把 skip 结果当作 PASS。

## 相关文档

- [开发指南 · 数据库配置与初始化](../DEVELOPMENT.md)
- [部署说明](../DEPLOYMENT.md)
- [数据库迁移（backend/schema）](../backend/schema/README.md)
- [ADR-002 Schema Canonical Source](./adr/002-schema-canonical-source.md)
