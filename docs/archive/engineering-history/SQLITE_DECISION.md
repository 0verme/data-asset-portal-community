# SQLite Decision Record (P1)

**状态：** KEEP — SQLite 保留为 **Community / Local Demo Backend**（非生产目标）。

**决策日期：** 2026-08（Community Boundary & Schema Contract 阶段）

---

## 背景

历史提交 `5ef3128 refactor(database): remove SQLite compatibility` 曾移除 SQLite，
后续 `734cbd9 refactor(core): establish community runtime boundary` 又将其恢复为
Community 隔离运行方式，但 `.env.example`、部分历史文档仍残留"不支持 SQLite"
表述，形成半支持状态。本轮必须做出正式决定。

## 评估维度

### 当前代码依赖面

- `backend/app/db/registry.py`：`available_adapter_names("community")` 返回
  `("sqlite", "postgres")`，SQLite 是显式声明的 Community adapter。
- `backend/app/db/facade.py`：`SUPPORTED_DB_TYPES = {"sqlite", "postgres", "gaussdb"}`，
  SQLite 与 postgres 均为一等公民；GaussDB 通过 `_connect_gaussdb` 延迟 import。
- `backend/schema/sqlite.sql` 与 `postgresql.sql`：Community baseline 同构（类型方言不同）。
- `demo/seed_sqlite.py`：Community demo 主路径。

### 测试依赖面

- `test_community_boundary`（物理边界核心测试）跑在 SQLite 上：baseline →
  seed → 无 private 表 → API 全链路。
- `test_migrations` 的 baseline lifecycle 测试使用 SQLite。
- 16 个 PostgreSQL integration skip 需要专用 PG 实例；若删除 SQLite，这些测试
  的唯一离线覆盖就消失了。

### 文档依赖面

- `backend/README.md` / `DEVELOPMENT.md` / `backend/schema/README.md` 已把
  SQLite 定位为 Community/local 隔离运行。
- `backend/.env.example` 残留"不支持 SQLite"（本轮已修正）。

### Migration 依赖面

- SQLite 与 PostgreSQL 的 Community core 表结构完全同构，仅类型方言不同
  （TEXT vs VARCHAR/CHAR、INTEGER vs BIGINT、AUTOINCREMENT vs IDENTITY）。
- 四方言 parity 测试（`test_migration_schema_parity.py`）已固化该结构一致性。

### Community Onboarding 价值（高）

- **clone-to-run**：`pip install -r backend/requirements.txt` + migration apply +
  seed，无需外部 PostgreSQL 实例即可体验完整 Community 功能。
- CI：无数据库依赖即可跑全量边界测试。
- 贡献者无 PostgreSQL 环境的快速上手路径。

### 长期维护成本（低）

- Service 层 SQL 统一使用 `dwp.` schema + 相同列名，**无 `if sqlite` fork**。
- 方言差异全部收敛在 migration SQL 与 seed 的 placeholder 语法
  （`?` vs `%s`、`INSERT OR IGNORE` vs `ON CONFLICT`）。
- Adapter 边界清晰：registry 按 provider 类型返回适配器；facade 延迟加载 JDBC。

## 决策

**KEEP SQLite，重新定位为：**

| 场景 | 推荐数据库 |
| --- | --- |
| Community 本地演示 / 开发 / CI | **SQLite**（`community_sqlite` profile） |
| Community 正式部署 | **PostgreSQL**（`community_postgres` profile） |
| 多数据库部署与外部集成 | **PostgreSQL / MySQL / GaussDB (DWS)** |

删除 SQLite 的成本（fixture 重写、PG 依赖、Community 默认配置失效）远超其
维护成本；保留 SQLite 不污染 Service SQL，且带来 clone-to-run 与 CI 收益。

## 表述统一

本轮同步修正：

- `backend/.env.example`：删除"不支持 SQLite"，改为三类型支持说明。
- 测试 `test_no_sqlite_runtime.py` → `test_database_adapter_boundaries.py`
  （原名暗示"SQLite 已移除"，与真实语义相反）。
- README / DEVELOPMENT / architecture：明确 SQLite = Community 本地后端，
  非生产目标；生产推荐 PostgreSQL 与 GaussDB/DWS。

## 反面决策记录

- Cloudflare D1 **不支持**（无 adapter、无计划）。
- SQLite **不是**完整部署（可选模块）的运行目标；可选模块需要
  PostgreSQL/GaussDB 的 schema 能力。
