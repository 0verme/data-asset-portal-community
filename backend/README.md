# 后端说明

> 说明：本文件保留为后端补充说明。项目主文档请优先查看根目录 `README.md`，开发与部署请优先查看根目录 `DEVELOPMENT.md`、`DEPLOYMENT.md`。

后端唯一通过 `uvicorn backend.asgi:app` 运行 FastAPI Native；所有仓库模块 route 与 infrastructure routes 由 FastAPI 处理，外部 database/credential/storage readiness 通过 Service error contract 表达。Flask compatibility runtime 与 `backend/run.py` 已退休，当前没有 Flask/WSGI fallback。认证与数据统一使用 database profile，演示用的 mock 数据位于前端（`VITE_API_MODE=mock`）。外部元数据通过 [Metadata Ingestion Contract](../docs/metadata-ingestion.md) 的 `/api/metadata` 接入，Collector 不直接依赖 DAP 内部 schema。

## 安装

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 启动

从仓库根目录以前台方式启动默认 runtime：

```bash
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

生产与本地联调均使用同一条 FastAPI/Uvicorn entrypoint；不再提供 Flask compatibility mode 或 direct Flask runtime。这里的 `FLASK_*` 配置名仅保留 signed-session/security contract 兼容性，不表示运行 Flask。

后台启动并写日志：

```powershell
cd backend
powershell -ExecutionPolicy Bypass -File .\scripts\dev-backend.ps1
```

日志输出位置：

- 标准输出：`logs/backend/backend.out.log`
- 标准错误：`logs/backend/backend.err.log`
- 应用日志：`logs/backend/app.log`

## 环境变量

后端按以下顺序读取环境文件：

1. `backend/.env`
2. `backend/.env.local`

数据库配置查找顺序：

1. `ASSET_DB_CONFIG_PATH`
2. `backend/configs/database.yaml`

关键变量：

| 变量 | 说明 | 常见值 |
| --- | --- | --- |
| `ASSET_DB_PROFILE` | 资产接口使用的数据库 profile | `primary` |
| `ASSET_AUTH_DB_PROFILE` | 登录鉴权使用的数据库 profile | `primary` |
| `ASSET_DB_CONFIG_PATH` | 数据库配置文件路径 | `backend/configs/database.yaml` |
| `ASSET_DB_JAR_PATH` | GaussDB JDBC jar 路径（驱动不随仓库分发，自行从官方渠道获取） | `/opt/data-asset-portal/backend/resources/jars/gaussdb200.jar` |
| `ASSET_DB_CONNECT_TIMEOUT_SECONDS` | 数据库连接超时秒数 | `30` |
| `ASSET_DB_STATEMENT_TIMEOUT_MS` | PostgreSQL / GaussDB 查询超时毫秒数 | `120000` |
| `FLASK_DEBUG` | Native FastAPI 的 debug 配置（默认关闭；仅 `1`/`true`/`yes`/`on` 为真） | `false` |
| `FLASK_SECRET_KEY` | 必填的 signed-session 密钥（缺失或空白即启动失败；保留配置名不代表 Flask） | `<generate-a-strong-random-value>` |
| `FLASK_ENV` | Cookie/security contract 的运行环境（默认安全生产行为；开发必须显式设置） | `production`、`development` |
| `FLASK_CORS_ORIGINS` | Native FastAPI 使用的精确跨域来源 allowlist，逗号分隔 | `https://portal.example.com` |

Session Cookie 始终使用 `HttpOnly=True` 和 `SameSite=Lax`。默认/生产环境使用 `Secure=True`；只有显式 `FLASK_ENV=development` 才为本地 HTTP 联调关闭 Secure。Nginx 或 Vite 的 `/api` 同源代理不需要 CORS；跨域部署才设置 `FLASK_CORS_ORIGINS`，不设置就不返回 CORS 允许头，禁止使用 `*`。不要将真实 `FLASK_SECRET_KEY` 写入仓库、日志或命令历史；可在受控终端本地执行 `python -c "import secrets; print(secrets.token_urlsafe(32))"` 生成后交由 secret store 保存。

内网数据库链路较慢时，可在 `backend/.env.local` 中设置：

```env
ASSET_DB_CONNECT_TIMEOUT_SECONDS=30
ASSET_DB_STATEMENT_TIMEOUT_MS=120000
```

## 数据库配置示例

参考 [configs/database.example.yaml](./configs/database.example.yaml)。

PostgreSQL 示例：

```yaml
defaults:
  type: postgres
  connect_timeout: 30
  statement_timeout_ms: 120000
  socket_timeout: 120

profiles:
  primary:
    type: postgres
    host: 127.0.0.1
    port: 5432
    database: asset_portal
    schema: dwp
    user: change_me
    password: change_me
```

MySQL 8.0 示例（PyMySQL 为可选依赖，使用 `pip install -r backend/requirements-mysql.txt` 安装）：

```yaml
profiles:
  mysql_primary:
    type: mysql
    host: 127.0.0.1
    port: 3306
    database: asset_portal
    user: change_me
    password: change_me
    charset: utf8mb4
    collation: utf8mb4_unicode_ci
```

GaussDB 示例（JDBC 驱动不随仓库分发，需自行获取并指定路径，见 `resources/jars/README.md`）：

```yaml
defaults:
  type: gaussdb
  driver: com.huawei.gauss200.jdbc.Driver
  jar_path: /opt/data-asset-portal/backend/resources/jars/gaussdb200.jar

profiles:
  gauss_primary:
    type: gaussdb
    jdbc_url: jdbc:gaussdb://127.0.0.1:25308/asset_portal?currentSchema=dwp
    user: change_me
    password: change_me
```

完整版正式部署支持 `postgres`、`mysql` 与 `gaussdb`；Community/local 隔离 profile 还可使用 `sqlite`（定位见 `docs/SQLITE_DECISION.md`）。Cloudflare D1 不受支持。非法 `type`、缺失连接信息或未安装可选驱动会 fail fast，不会静默回退到其他数据库。

## 初始化数据库

**Community 的唯一官方初始化路径 = 完整 baseline + Alembic + demo seed**（Schema Source of Truth 为
`backend/schema` 与 `backend/alembic`）：

```bash
python backend/scripts/schema_migrate.py apply --profile community_sqlite
python demo/seed_sqlite.py --database <绝对路径>/community.db
```

MySQL 8.0 使用独立可选驱动和 profile：

```bash
pip install -r backend/requirements-mysql.txt
python backend/scripts/schema_migrate.py apply --profile community_mysql
```

`community_mysql` 必须指向隔离的 MySQL 8.0 数据库；密码通过安全配置或环境变量注入，
不得写入仓库。

Full/module-specific/external-dependency 部署可手动逐个执行模块 DDL，没有一键脚本，后端启动也不会自动初始化：
按数据库类型选 `docs/pg/*-app-pg-ddl.sql`（PostgreSQL）或 `docs/dws/*-app-dws-ddl.sql`（DWS / GaussDB），
用对应客户端（`psql -f` / `gsql -f`）逐个执行。它们是补充 DDL，不是 Community/local 的默认入口；后者必须走 `backend/schema` + `schema_migrate.py` + seed。具体边界见
[根目录部署说明](../DEPLOYMENT.md#四数据库初始化与迁移)。

> 🚫 仓库不再包含整库快照（`app-*-init-data.sql` 与 `docs/*/sample/*.sql` 已从公开树移除）；
> 需要 SQL 形式演示数据时用 `python demo/generate_demo_sql.py` 从安全演示源生成。
> 管理员账号手动插入 `p_admin_user`。

## PostgreSQL migration 验证 checklist

本 checklist 针对 Community 的 `backend/scripts/schema_migrate.py`、Alembic baseline 和 `demo/seed_postgres.py`。CLI 的 `apply` 已包含 baseline 初始化以及 Alembic `head` upgrade；仓库没有另一个独立的 `upgrade` 子命令。所有验证都必须使用一次性、可丢弃的 PostgreSQL 数据库或专用测试库，不要使用生产库。

以下命令中的 `DAP38_PG_CONFIG`、`DAP38_PG_PROFILE` 和 `DAP38_PG_DSN` 只代表本地未跟踪配置 / secret-store 变量，不能把真实密码、Token 或完整连接串写入仓库、Issue、PR 或日志。

### 1. 准备隔离环境

- 创建带备份/恢复方案的隔离 PostgreSQL 数据库，例如 `dap_38_postgresql` 对应的专用测试对象；不要复用归属不明的共享库。
- 准备一个不在 Git 中的 profile YAML，`type` 必须是 `postgres`，并指向该隔离数据库；将 profile 名称放入 `DAP38_PG_PROFILE`，文件路径放入 `DAP38_PG_CONFIG`。
- 为执行 `psql` 的终端准备同一个测试库的 `DAP38_PG_DSN`，密码通过 `.pgpass` 或 secret store 提供，避免出现在命令历史中。
- 设置 `ASSET_RUNTIME_PROFILE=community`；启动应用前将 `ASSET_DB_PROFILE` 指向同一个 `DAP38_PG_PROFILE`，并设置非空的本地 `FLASK_SECRET_KEY`。环境变量和安全边界详见 [首次贡献指南](../docs/first-contribution.md) 与 [开发指南](../DEVELOPMENT.md)。

### 2. 离线 baseline 检查

从仓库根目录执行；这两条命令只读取 `backend/schema/`，不连接数据库：

```bash
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python backend/scripts/schema_migrate.py plan --offline --dialect postgresql
```

预期：`verify` 输出 `verify=ok`，`plan` 输出 `0001_baseline` 和 `postgresql.sql`。如果这一步失败，先修复 baseline 或 schema contract，不要继续连接测试库。

### 3. Fresh DB：apply → verify → seed → repeat apply

确认隔离数据库为空后执行：

```bash
python backend/scripts/schema_migrate.py apply \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py status \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py verify \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"
```

- 首次 `apply` 应报告 `applied=0001_baseline`，并把 Alembic ledger 推进到当前 head。
- `status` 应显示已管理的 revision；`verify` 应成功完成 schema reflection/contract 对照。
- `schema_migrate.py` 不负责写入演示数据。按当前 seed 脚本生成 SQL，并通过隔离库的 `psql` 执行：

```bash
python demo/seed_postgres.py --dialect postgres \
  | psql --dbname "$DAP38_PG_DSN" --set=ON_ERROR_STOP=1
```

- 记录 seed 前后的代表性表/行数，并确认只创建 Community 数据；该 seed 使用 `ON CONFLICT DO NOTHING`，可在同一隔离库重复执行一次验证幂等性。
- 再次运行完全相同的 `apply` 命令，输出必须包含 `applied=-`，证明重复 apply 是 no-op；不要用 `downgrade` 代替该验证。

### 4. Existing DB：baseline verify → safe stamp → apply

仅对**预期 schema 已存在但没有 Alembic ledger**的数据库使用以下流程：

```bash
python backend/scripts/schema_migrate.py status \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py baseline \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG" \
  --dry-run
```

`baseline --dry-run` 会先反射并对照 PostgreSQL baseline，预期输出 `baseline=0001_baseline dry_run=true`。只有 dry-run 成功、已完成备份且确认对象属于本次测试时，才执行实际 stamp：

```bash
python backend/scripts/schema_migrate.py baseline \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py apply \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py status \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"

python backend/scripts/schema_migrate.py verify \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"
```

实际 `baseline` 会写入 `alembic_version`，因此不应对已经在当前 head 上的数据库重复执行；先看 `status`，已管理数据库直接 `verify`，不要把 ledger 重置回 `0001_baseline`。

### 5. Drift rejection

在隔离数据库中使用测试库的 `psql` 人为增加一个仅用于验证的 schema 差异：

```bash
psql --dbname "$DAP38_PG_DSN" --set=ON_ERROR_STOP=1 \
  --command "ALTER TABLE dwp.p_asset_table ADD COLUMN dap38_drift_marker TEXT;"

python backend/scripts/schema_migrate.py verify \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"
```

第二条命令必须以非零状态失败，并输出可定位的 schema mismatch；不要因为失败而执行 stamp 或 apply。验证后只清理本次创建的测试列，再重复 `verify` 确认恢复：

```bash
psql --dbname "$DAP38_PG_DSN" --set=ON_ERROR_STOP=1 \
  --command "ALTER TABLE dwp.p_asset_table DROP COLUMN dap38_drift_marker;"

python backend/scripts/schema_migrate.py verify \
  --profile "$DAP38_PG_PROFILE" \
  --config "$DAP38_PG_CONFIG"
```

### 6. 应用与 CI 验证

在新终端使用同一个隔离 profile 启动后端并保持进程运行（端口约定见 [开发指南](../DEVELOPMENT.md)），再验证健康检查和一个只读资产请求：

```bash
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
curl --fail http://127.0.0.1:5099/healthz
curl --fail --get http://127.0.0.1:5099/api/assets/tables \
  --data-urlencode "keyword=DWM_MEMBER_ACTIVITY_STAT_1D"
```

提交 PR 前检查：

- 本地至少执行 `python backend/scripts/schema_migrate.py verify --offline --dialect postgresql` 和 `python -m unittest discover -s backend/tests`。
- GitHub Actions 的 `PostgreSQL Integration` 必须完成 fresh migration、seed、schema contract、代表性集成测试和 repeat apply no-op。
- 同时确认 `Backend / Python 3.11`、`Backend / Python 3.13`、`Community Migration (SQLite)` 与 `Repository Guard` 为绿色；这些 CI 结果不能用未执行的本地 PostgreSQL 验证替代。

### 7. 安全边界与回滚

- 不连接生产库，不把测试配置、密码、Token、cookie 或 DSN 提交到 Git。
- 不执行生产 `DROP`、实例级 reset 或 destructive downgrade；迁移回滚以隔离库备份恢复或直接销毁本次创建的测试库为准。
- Drift 验证、seed 验证和测试日志完成后，清理本次创建的列、对象和临时文件；保留脱敏的命令输出即可。
- 发现 profile、schema 归属或备份状态不明确时停止，不要猜测或扩大操作范围。
