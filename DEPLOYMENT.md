# 部署说明 · Deployment

面向内网 / 服务器部署，覆盖前端构建、后端启动、Nginx 反向代理、环境变量与数据库初始化。
本地开发请参见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

> 下文以 `/opt/data-asset-portal` 作为示例安装目录，请按实际路径替换。

## 部署产物

- 前端静态资源：`frontend/dist/`
- 后端服务入口：`backend/run.py`
- 数据库初始化：手动执行 `docs/pg/` 或 `docs/dws/` 下的模块 DDL（无一键脚本）

## 一、准备配置

### 前端环境变量

```env
VITE_API_MODE=remote
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=http://127.0.0.1:5099
```

### 后端环境变量

后端始终连库、无模式开关，只需指定数据库 profile：

```env
ASSET_DB_PROFILE=primary
ASSET_AUTH_DB_PROFILE=primary
ASSET_DB_CONFIG_PATH=/opt/data-asset-portal/backend/configs/database.yaml
FLASK_HOST=127.0.0.1
FLASK_PORT=5099
FLASK_DEBUG=false
FLASK_SECRET_KEY=<generate-a-strong-random-value>
# FLASK_ENV defaults to production; production cookies are Secure.
# FLASK_ENV=production
# Same-origin Nginx deployment does not need this. If API is cross-origin,
# provide exact comma-separated origins; never use * with session cookies.
# FLASK_CORS_ORIGINS=https://portal.example.com
```

`FLASK_SECRET_KEY` 是所有环境的必填安全配置：缺失、空字符串或纯空白会在应用启动时失败。使用密码管理器或部署平台的 secret store 生成和保存强随机值；不要把真实值提交到仓库、写入日志或拼进 shell 命令历史。可在受控终端本地生成候选值：`python -c "import secrets; print(secrets.token_urlsafe(32))"`。

`FLASK_DEBUG` 默认关闭，只有 `1`、`true`、`yes`、`on`（忽略大小写和首尾空格）会开启。`FLASK_ENV` 未设置时采用安全的生产行为：Session Cookie 为 `HttpOnly=True`、`SameSite=Lax`、`Secure=True`。仅本地 HTTP 开发可显式设置 `FLASK_ENV=development` 使 `Secure=False`；不要在生产环境使用该值。

此文档的 Nginx 配置将静态前端和 `/api` 放在同一来源，因此不需要 CORS。若必须拆分来源，设置 `FLASK_CORS_ORIGINS` 为完整、精确的逗号分隔 allowlist（如 `https://portal.example.com,https://admin.example.com`）；未设置时不会返回 CORS 允许头，空项会忽略，且不会允许 `*` 与 Cookie 凭据的组合。

如使用 GaussDB JDBC 覆盖路径，可额外设置：

```env
ASSET_DB_JAR_PATH=/opt/data-asset-portal/backend/resources/jars/gaussdb200.jar
```

## 二、后端部署

```bash
cd /opt/data-asset-portal/backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

- 默认代码值为 `127.0.0.1:5099`
- 若提供了 `.env.local` 或系统环境变量，则以环境变量为准

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

应用启动不会自动迁移 schema。历史迁移已合并到 `docs` 初始化 DDL，当前 manifest 管理 consolidated baseline 之后的增量变更；新环境先执行模块 DDL，再按 `backend/migrations/README.md` 核对和应用待执行迁移。既有环境应先备份并检查 `status` / `verify` / `plan`，不能用初始化 DDL 覆盖升级。

**手动逐个执行模块 DDL，无一键脚本。** 根据数据库类型选择脚本目录并用对应客户端执行：

- PostgreSQL → `docs/pg/*-app-pg-ddl.sql`（`psql -f`）
- DWS / GaussDB → `docs/dws/*-app-dws-ddl.sql`（`gsql -f`）

覆盖模块：common-codes、assets、field-mappings、indicators、roots、upstream、push、reports、api-assets、lineage、manual-code-tables、auth、operation-logs、menus。
每份 DDL 均为幂等（`IF NOT EXISTS` / `INSERT ... WHERE NOT EXISTS`），可安全重复执行；
具体命令见 [README 的「数据库初始化（手动执行 SQL）」](../README.md#-快速开始)。管理员账号手动插入 `p_admin_user`。

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
- 确认 `/api/assets/tables` 返回 JSON 而不是 HTML
- 确认前端为 `VITE_API_MODE=remote`，且 `/api` 已正确代理到 Flask
- 确认 `FLASK_SECRET_KEY` 由部署 secret store 提供，且 `FLASK_DEBUG=false`
- HTTPS 终止后仍应保持 `FLASK_ENV=production`，以发送 Secure Cookie；本阶段未扩大 Flask 对转发头的信任范围
- `backend/configs/database.yaml` 与 `.env.local` 不入库（见 `.gitignore`）；请从 `backend/configs/database.example.yaml` 与 `backend/.env.example` 复制后按环境填写

## 七、配置来源

- 数据库实连配置：复制 `backend/configs/database.example.yaml` → `backend/configs/database.yaml`（或用 `ASSET_DB_CONFIG_PATH` 指向环境专用路径）
- 后端环境变量：复制 `backend/.env.example` → `backend/.env.local`
- 前端环境变量：复制 `frontend/.env.example` → `frontend/.env.local`

以上三类实配文件均不提交到仓库，仓库仅保留 `.example` 模板。
