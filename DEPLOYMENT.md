# 部署说明 · Deployment

面向内网 / 服务器部署，覆盖前端构建、后端启动、Nginx 反向代理、环境变量与数据库初始化。
本地开发请参见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

> 下文以 `/opt/data-asset-portal` 作为示例安装目录，请按实际路径替换。

## 部署产物

- 前端静态资源：`frontend/dist/`
- 后端服务入口：`backend/asgi.py`（纯 FastAPI/Uvicorn）
- Community/local 数据库初始化：`backend/schema/<dialect>.sql` + `backend/scripts/schema_migrate.py` + 对应 seed 脚本
- 完整部署或扩展模块的补充 DDL：`docs/pg/`、`docs/dws/`；它们不是 Community/local 默认初始化入口

## 一、准备配置

### 前端环境变量

```env
VITE_API_MODE=remote
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=http://127.0.0.1:5099
```

### 后端环境变量

后端始终连库、无模式开关，只需指定数据库 profile。下列 `FLASK_*` 是保留的安全、Session Cookie 和 CORS configuration contract 名称，不代表仍存在 Flask runtime：

```env
ASSET_DB_PROFILE=primary
ASSET_AUTH_DB_PROFILE=primary
ASSET_DB_CONFIG_PATH=/opt/data-asset-portal/backend/configs/database.yaml
FLASK_DEBUG=false
FLASK_SECRET_KEY=<generate-a-strong-random-value>
# FLASK_ENV defaults to production; production cookies are Secure.
# FLASK_ENV=production
# Same-origin Nginx deployment does not need this. If API is cross-origin,
# provide exact comma-separated origins; never use * with session cookies.
# FLASK_CORS_ORIGINS=https://portal.example.com
```

`FLASK_SECRET_KEY` 是所有环境的必填 signed-session 安全配置：缺失、空字符串或纯空白会在应用启动时失败。使用密码管理器或部署平台的 secret store 生成和保存强随机值；不要把真实值提交到仓库、写入日志或拼进 shell 命令历史。可在受控终端本地生成候选值：`python -c "import secrets; print(secrets.token_urlsafe(32))"`。

`FLASK_DEBUG` 默认关闭，只有 `1`、`true`、`yes`、`on`（忽略大小写和首尾空格）会开启。`FLASK_ENV` 未设置时采用安全的生产行为：Session Cookie 为 `HttpOnly=True`、`SameSite=Lax`、`Secure=True`。仅本地 HTTP 开发可显式设置 `FLASK_ENV=development` 使 `Secure=False`；这些变量名属于 retained compatibility/configuration contract，不表示 Flask 进程或 Flask WSGI runtime。

此文档的 Nginx 配置将静态前端和 `/api` 放在同一来源，因此不需要 CORS。若必须拆分来源，设置 `FLASK_CORS_ORIGINS` 为完整、精确的逗号分隔 allowlist（如 `https://portal.example.com`）；未设置时不会返回 CORS 允许头，空项会忽略，且不会允许 `*` 与 Cookie 凭据的组合。

如使用 GaussDB JDBC 覆盖路径，可额外设置：

```env
ASSET_DB_JAR_PATH=/opt/data-asset-portal/backend/resources/jars/gaussdb200.jar
```

## 二、后端部署

当前生产入口是 `backend.asgi:app`：由 Uvicorn 启动纯 FastAPI native backend。Auth、Capabilities、Portal、Search、Operation Log 以及仓库已有模块 routes 均由 FastAPI 承载；数据库、驱动、凭据、storage 或外部 integration 未就绪时，由对应 Service error contract 返回诊断状态，不把源码模块变成 404。FastAPI 使用保留历史 signed-session cookie format 的 native codec。

```bash
cd /opt/data-asset-portal
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
# 唯一推荐 production runtime
uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

Runtime：

- `uvicorn backend.asgi:app --host 127.0.0.1 --port 5099` 是唯一推荐 production runtime；
- `backend/run.py`、Waitress 以及旧 runtime switch 均已退休；当前没有 Flask/WSGI fallback。

健康检查：

```bash
curl --fail http://127.0.0.1:5099/healthz
```

Native FastAPI 下预期响应包含 `"status":"ok"`、`"runtime":"fastapi"`、`"fastapiPrimary":true` 和 `"flaskFallback":false`。其中 `flaskFallback=false` 是用于明确证明 fallback 已退休的 health contract 字段，不表示存在第二套 runtime。`/healthz` 只报告进程/runtime 状态，不执行数据库查询；数据库与业务 API 的可用性仍由对应回归和监控验证。默认监听值为 `127.0.0.1:5099`（仅本机，前端由 Nginx 反代）。`asgi.py` 加载仓库 runtime env 文件；系统环境变量和 demo bootstrap 规则保持现有行为。

### 安全默认值（生产）

- `FLASK_DEBUG` 默认关闭；**生产环境显式开启 debug 会在启动时失败**（fail-fast），禁止 Werkzeug debugger 运行
- Session Cookie：`HttpOnly=True`、`SameSite=Lax`、`Secure=True`（仅 `FLASK_ENV=development` 本地 HTTP 开发关闭 `Secure`）
- 请求体上限：保留配置名 `FLASK_MAX_CONTENT_LENGTH_MB`（默认 16，上限存在时超限返回统一 JSON 413；该名称不代表 Flask runtime）
- 响应安全头：`X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: strict-origin-when-cross-origin`
- 4xx/5xx 错误响应统一为 JSON 结构，不向客户端泄露内部路径/连接串/底层驱动异常
- 转发头信任：**默认不受信任**。审计日志如需真实客户端 IP，仅当请求只经受信反代（如 Nginx）时设置 `ASSET_TRUST_PROXY_HEADERS=true`；否则客户端可直接伪造 `X-Forwarded-For`。Nginx 已设置 `X-Forwarded-For` 的同源部署请开启该项

## 三、前端构建

```bash
cd /opt/data-asset-portal/frontend
npm ci
VITE_API_MODE=remote \
VITE_API_BASE_URL=/api \
VITE_BACKEND_URL=http://127.0.0.1:5099 \
npm run build
```

构建输出到 `frontend/dist/`。

## 四、数据库初始化与迁移

应用启动不会自动迁移 schema。新用户应先选择与部署 profile 对应的 canonical repository baseline，再使用 `schema_migrate.py` 应用 Alembic head；不要把方言参考 DDL 当作默认入口。

### Community / local 默认路径

`backend/schema/<dialect>.sql` 是覆盖全部仓库模块的四方言 canonical baseline，`backend/alembic/versions/` 管理后续 forward revisions，`backend/scripts/schema_migrate.py` 负责 apply、verify、plan 和既有库 baseline stamp。推荐顺序：

```bash
# SQLite 本地 / Community Demo
python backend/scripts/schema_migrate.py apply --profile community_sqlite
python demo/seed_sqlite.py --database <absolute-local-path>/community.sqlite

# PostgreSQL Community 部署（使用隔离的 Community 数据库）
python backend/scripts/schema_migrate.py apply --profile community_postgres
python demo/seed_postgres.py --dialect postgres
```

既有环境必须先备份并执行 `verify`；只有在 schema 与 baseline 契约一致时才允许 `baseline` stamp，不能用初始化 SQL 覆盖升级。后续结构变更只通过新的 Alembic revision 管理。

### 方言参考 / external dependency 路径

`docs/pg/` 与 `docs/dws/` 保存按模块拆分的 PostgreSQL、GaussDB/DWS 方言参考、历史兼容 DDL 与外部 storage/collector 说明。它们不是 `backend/schema` + Alembic 的替代，也不是隐藏仓库模块的产品边界。

如果部署需要 vendor-specific DDL 或 external integration，应先阅读对应 SQL、确认 profile 和依赖，再使用 `psql -f` 或 `gsql -f` 按模块执行；不要把所有 SQL 无条件应用到目标数据库。

persistent lineage 模式需要配置 `LINEAGE_DB_PROFILE`；development/test 未配置时使用受控 POC，Community Demo 会在隔离 SQLite 中准备 demo snapshot 并使用其 profile。

> 🚫 仓库不再包含整库快照（`app-*-init-data.sql` 与 `docs/*/sample/*.sql` 已从公开树移除）；
> 需要 SQL 形式演示数据时用 `python demo/generate_demo_sql.py` 从安全演示源生成。

### 血缘快照

血缘查询不在请求过程中实时扫描调度源表。初始化 `lineage-app-*-ddl.sql` 后，先验证并发布首个快照：

```bash
python backend/scripts/collect_lineage_snapshot.py --profile <profile> --dry-run
python backend/scripts/collect_lineage_snapshot.py --profile <profile>
```

生产环境设置 `LINEAGE_DB_PROFILE=<profile>`，并由现有调度平台、cron 或 Windows Task Scheduler
在调度元数据表更新后定时执行采集命令。采集失败会回滚并继续保留原 ACTIVE 快照。
完整运行、验证和回退方法见 [血缘快照采集与发布指南](docs/lineage_bulk_import_guide.md)。

## 五、Nginx 示例

```nginx
server {
    listen 80;
    server_name _;

    root /opt/data-asset-portal/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5099/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 六、部署检查项

- 确认 `ASSET_DB_CONFIG_PATH` 指向正确文件，且 `ASSET_DB_PROFILE` 在配置中存在
- 如使用 GaussDB，确认 JDBC jar 可访问
- 确认数据库 `schema` 与 SQL 脚本一致（当前为 `dwp`）
- 确认 `/healthz` 返回 `status=ok`，并确认 runtime 为预期值
- 确认 `/api/assets/tables` 返回 JSON 而不是 HTML
- 确认前端为 `VITE_API_MODE=remote`，且 `/api` 已正确代理到纯 FastAPI ASGI runtime
- 确认保留配置名 `FLASK_SECRET_KEY` 由部署 secret store 提供，且 `FLASK_DEBUG=false`；这些名称不代表 Flask runtime
- HTTPS 终止后仍应保持 `FLASK_ENV=production`，以发送 Secure Cookie；FastAPI native auth 使用 signed cookie contract；本阶段未扩大转发头信任范围
- `backend/configs/database.yaml` 与 `.env.local` 不入库（见 `.gitignore`）；请从 `backend/configs/database.example.yaml` 与 `backend/.env.example` 复制后按环境填写

## 七、配置来源

- 数据库实连配置：复制 `backend/configs/database.example.yaml` → `backend/configs/database.yaml`（或用 `ASSET_DB_CONFIG_PATH` 指向环境专用路径）
- 后端环境变量：复制 `backend/.env.example` → `backend/.env.local`
- 前端环境变量：复制 `frontend/.env.example` → `frontend/.env.local`

以上三类实配文件均不提交到仓库，仓库仅保留 `.example` 模板。
