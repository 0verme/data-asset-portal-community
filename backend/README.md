# Flask 后端说明

> 说明：本文件保留为后端补充说明。项目主文档请优先查看根目录 `README.md`，开发与部署请优先查看根目录 `DEVELOPMENT.md`、`DEPLOYMENT.md`。

后端为 `data-asset-portal` 提供 API，始终连接数据库：认证与数据统一使用 `configs/database.yaml` 中的 profile，不再有运行模式开关。演示用的 mock 数据已迁移到前端（`VITE_API_MODE=mock`）。

## 安装

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## 启动

前台启动：

```powershell
cd backend
python run.py
```

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
| `FLASK_HOST` | Flask 监听地址 | `127.0.0.1` |
| `FLASK_PORT` | Flask 监听端口 | `5099` |
| `FLASK_DEBUG` | 是否启用调试模式（默认关闭；仅 `1`/`true`/`yes`/`on` 为真） | `false` |
| `FLASK_SECRET_KEY` | 必填的 Session 签名密钥（缺失或空白即启动失败） | `<generate-a-strong-random-value>` |
| `FLASK_ENV` | 运行环境（默认安全生产行为；开发必须显式设置） | `production`、`development` |
| `FLASK_CORS_ORIGINS` | 可选的精确跨域来源 allowlist，逗号分隔 | `https://portal.example.com` |

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

完整版（含可选模块）可手动逐个执行模块 DDL，没有一键脚本，后端启动也不会自动初始化：
按数据库类型选 `docs/pg/*-app-pg-ddl.sql`（PostgreSQL）或 `docs/dws/*-app-dws-ddl.sql`（DWS / GaussDB），
用对应客户端（`psql -f` / `gsql -f`）逐个执行。具体命令见
[根目录 README 的「数据库初始化」](../README.md#-快速开始)。

> 🚫 仓库不再包含整库快照（`app-*-init-data.sql` 与 `docs/*/sample/*.sql` 已从公开树移除）；
> 需要 SQL 形式演示数据时用 `python demo/generate_demo_sql.py` 从安全演示源生成。
> 管理员账号手动插入 `p_admin_user`。
