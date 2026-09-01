# 部署说明 · Deployment

本说明面向 Linux 内网单机部署，覆盖前端构建、Python 环境、数据库迁移、管理员初始化、FastAPI/Uvicorn、systemd、Nginx、HTTP Demo、HTTPS Production 和部署验收。
本地开发请参见 [DEVELOPMENT.md](./DEVELOPMENT.md)。

> 文中的 `/opt/data-asset-portal`、`dataasset`、`data-asset.example` 和证书路径均为示例，请按实际服务器替换。不要把真实密码、`APP_SECRET_KEY`、证书或 TLS private key 提交到仓库。

## 1. 部署架构

推荐的正式拓扑如下：

```text
浏览器
  │ HTTP Demo: :80 / HTTPS Production: :443
  ▼
Nginx ──────────────── frontend/dist（静态文件）
  │ /api/ ──────────── 127.0.0.1:5099
  ▼
FastAPI Native / Uvicorn（backend.asgi:app）
  │
  ▼
Database Provider → PostgreSQL / MySQL / GaussDB-DWS / SQLite
```

当前 Runtime Truth：

| 部件 | 生产部署契约 |
| --- | --- |
| 前端源码 / 构建器 | React + Vite；`npm run build` 会先构建 lineage workspaces，再执行 Vite build |
| 前端产物 | `frontend/dist/`，入口文件为 `frontend/dist/index.html` |
| 后端 | FastAPI Native |
| ASGI entrypoint | `backend.asgi:app` |
| 进程运行时 | Uvicorn |
| 后端监听 | `127.0.0.1:5099`，只允许本机 Nginx 访问 |
| Nginx API 入口 | `/api/` → `http://127.0.0.1:5099/api/` |
| 健康检查 | 后端本机 `http://127.0.0.1:5099/healthz` |

`backend/run.py`、Waitress、Flask/WSGI fallback 和旧 runtime switch 不是当前生产运行方式。不要为了部署重新引入它们。

示例 Nginx 与 systemd 文件：

- [`deploy/systemd/data-asset-portal.service.example`](./deploy/systemd/data-asset-portal.service.example)
- [`deploy/nginx/data-asset-portal.conf.example`](./deploy/nginx/data-asset-portal.conf.example)

## 2. Prerequisites

### 2.1 服务器组件

- Linux、systemd 和 Nginx。
- Python 3.10 或更高版本。
- PostgreSQL、MySQL 8.0、GaussDB/DWS 或受支持的 SQLite 数据库；正式内网部署通常使用 PostgreSQL、MySQL 或 GaussDB/DWS。
- Node.js **22.13+** 和 npm **10+**，仅在服务器构建前端时需要。版本要求来自 `frontend/package.json` 的 `engines.node` 和 lineage workspace。
- 一个专用的服务账号，例如示例中的 `dataasset`；请按组织账号规范替换。

将防火墙或安全组配置为只暴露 Nginx 的 80/443（按部署模式选择）；后端固定监听 loopback，不要将 `5099` 作为外部入口暴露。

### 2.2 获取固定版本

正式部署建议从固定 release、tag 或 commit 获取源码，而不是依赖某次未记录的工作树状态：

```bash
git fetch --tags origin
git checkout <release-tag-or-commit>
```

`<release-tag-or-commit>` 是示例占位符。升级时也应记录实际版本，详见[升级](#12-升级)。

## 3. Runtime Configuration

### 3.1 准备本地配置文件

从仓库模板复制配置；两个目标文件都被 `.gitignore` 排除，不要提交：

```bash
cd /opt/data-asset-portal
cp backend/.env.example backend/.env.local
cp backend/configs/database.example.yaml backend/configs/database.yaml
```

编辑 `backend/.env.local`，至少准备以下生产配置：

```env
APP_ENV=production
APP_SECRET_KEY=<generate-a-strong-random-value>
APP_DEBUG=false

ASSET_DB_PROFILE=primary
ASSET_AUTH_DB_PROFILE=primary
ASSET_DB_CONFIG_PATH=/opt/data-asset-portal/backend/configs/database.yaml

# 只有后端只监听 127.0.0.1 且只能由可信 Nginx 访问时才开启。
ASSET_TRUST_PROXY_HEADERS=true
```

编辑 `backend/configs/database.yaml` 中的 `primary` profile，填写目标数据库的 type、host、port、database、schema、user 和 password。`change_me` 等模板值不是生产凭据；真实值应由受控文件或 secret store 提供。GaussDB/DWS 还需要通过 `ASSET_DB_JAR_PATH` 指向自行获取的 JDBC 驱动，仓库不分发商业驱动。

`APP_SECRET_KEY` 是必填的 signed-session 密钥。请使用密码管理器、部署平台 secret store 或受控终端生成并保存强随机值；不要把真实值写进 Git、日志或命令历史。若使用 secret store 将它注入进程环境，请从 `backend/.env.local` 删除对应的占位行，让注入值不被本地模板覆盖；若使用受控 `.env.local` 保存，则将占位符替换为真实值并限制文件权限。

### 3.2 配置加载与环境变量优先级

`backend/asgi.py` 会在创建 FastAPI application 前自动加载以下文件，后加载文件覆盖先加载文件：

1. 仓库根目录 `.env`
2. 仓库根目录 `.env.local`
3. `backend/.env`
4. `backend/.env.local`

`backend/scripts/schema_migrate.py` 和 `backend/scripts/create_admin.py` 也会加载同一套 runtime env。systemd 示例因此**没有**另设 `EnvironmentFile`，避免 systemd 和应用各维护一套可能冲突的配置。请确保 `backend/.env.local` 对 service `User` 可读，并将其权限限制为只有部署账号/服务账号可读，例如：

```bash
# dataasset 是 systemd 示例中的 User；若改用其他账号，请替换它
sudo chown dataasset:dataasset backend/.env.local backend/configs/database.yaml
sudo chmod 600 backend/.env.local backend/configs/database.yaml
```

如果系统环境或 systemd `Environment=` 设置了同名变量，而上述文件也定义了该变量，应用加载文件时会以最后一个文件的值为准；不要让两处出现不同值。使用 secret store 注入 `APP_SECRET_KEY` 等变量时，先删除 `.env.local` 中同名占位行。`PYTHONUNBUFFERED=1` 这类只由 unit 使用、且不在应用配置文件中的变量可以保留在 systemd 中。

单机部署推荐让 `ASSET_AUTH_DB_PROFILE` 与 `ASSET_DB_PROFILE` 相同。只有在明确设计了分离的用户/授权数据库时才使用不同 profile，并确保认证 profile 对应的用户和授权表已按仓库 schema 初始化；不要只迁移资产 profile 后直接启动。

### 3.3 生产安全配置

- `APP_ENV` 未设置时也采用生产安全行为；正式环境保持 `production`。
- `APP_DEBUG=false`。生产环境开启 debug 会导致应用启动失败。
- Session Cookie 保持 `HttpOnly=True`、`SameSite=Lax`、`Secure=True`。
- 同源 Nginx 部署不需要 `APP_CORS_ORIGINS`。只有前后端确实跨来源时，才配置精确的来源 allowlist，不要使用 `*` 配合 Cookie。
- `ASSET_TRUST_PROXY_HEADERS=true` 只适用于后端保持 loopback、外部请求只能经过可信 Nginx 的拓扑；如果 `5099` 可被不可信客户端直接访问，应保持 `false`。
- 应用只读取 `APP_*` 安全配置名称；旧 `FLASK_*` 名称不会作为 runtime 配置读取。升级既有部署时迁移变量名称，并保留原 `APP_SECRET_KEY`，避免已有 signed session 无法迁移。
- `APP_MAX_CONTENT_LENGTH_MB` 默认限制为 16 MB；应用同时返回 `nosniff`、`SAMEORIGIN` 和严格来源策略等安全响应头。若调整请求体上限，应同时检查 Nginx 的 `client_max_body_size`。
- `APP_ENV=production` 或未设置时不会注册 `/docs`、`/redoc`、`/openapi.json`；只有显式 `development` 才启用它们。关闭 HTTP interactive docs 不是业务 API 的 authentication/authorization 替代。

### 3.4 API authentication boundary

Community Edition 使用 `Public Catalog + Authenticated Management`：普通业务目录 GET 可以匿名浏览并按规则脱敏；写操作、管理 API、操作日志、Metadata ingestion、上/下游 `admin-detail`、用户/角色/参数和连接/凭据字段仍由后端 authentication 与 permission-based RBAC 保护。不要用 Nginx、隐藏菜单或关闭 OpenAPI 代替后端授权。完整 route inventory 见 [`docs/rbac/authenticated-read-model.md`](./docs/rbac/authenticated-read-model.md)。

## 4. Backend Installation

从仓库根目录创建虚拟环境并安装固定依赖：

```bash
cd /opt/data-asset-portal
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
```

交互式 shell 可以使用 `source backend/.venv/bin/activate`，但 systemd 不依赖 shell activate，而是直接调用虚拟环境中的绝对路径。

手动前台启动（用于首次验证，不是最终托管方式）：

```bash
backend/.venv/bin/uvicorn \
  backend.asgi:app \
  --host 127.0.0.1 \
  --port 5099
```

## 5. Database Migration

应用启动**不会自动执行 schema migration**。必须先完成配置、依赖安装和 migration，再创建管理员、启动服务。

### 5.1 Fresh database

`schema_migrate.py apply` 使用对应数据库 profile 的 canonical baseline，应用 Alembic head，并初始化仓库要求的 RBAC 数据。生产 PostgreSQL 示例：

```bash
cd /opt/data-asset-portal

# 可选：只检查仓库内 PostgreSQL baseline，不连接数据库
backend/.venv/bin/python backend/scripts/schema_migrate.py \
  verify --offline --dialect postgresql

# primary 必须是 database.yaml 中真实存在的 profile 名称
backend/.venv/bin/python backend/scripts/schema_migrate.py \
  apply \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml

backend/.venv/bin/python backend/scripts/schema_migrate.py \
  status \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml

backend/.venv/bin/python backend/scripts/schema_migrate.py \
  verify \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml
```

如果使用 MySQL 8.0，先安装可选依赖 `backend/requirements-mysql.txt`，再将 `--profile` 替换为实际 MySQL profile；GaussDB/DWS 使用对应的 profile 和 JDBC 驱动。不要编造 profile，也不要把数据库密码放进命令行参数。

`demo/seed_sqlite.py`、`demo/seed_postgres.py` 只用于受控 Community Demo 数据。正式数据库是否导入虚构 Demo 数据应由部署方明确决定，不要把 Demo seed 当作生产业务数据初始化。

如果是 Community/local 隔离运行，并已在 runtime env 中设置 `ASSET_RUNTIME_PROFILE=community`，可以使用仓库提供的 Community profile：

```bash
backend/.venv/bin/python backend/scripts/schema_migrate.py apply --profile community_sqlite
backend/.venv/bin/python demo/seed_sqlite.py --database /opt/data-asset-portal/instance/community.db

# 或使用隔离的 Community PostgreSQL 数据库
backend/.venv/bin/python backend/scripts/schema_migrate.py apply --profile community_postgres
backend/.venv/bin/python demo/seed_postgres.py --dialect postgres
```

`docs/pg/`、`docs/dws/` 中的方言 SQL 和 external integration 说明是补充参考，不是 `backend/schema` + Alembic 的替代。需要 vendor-specific DDL 时先确认目标 profile、依赖和对象归属，不要无条件执行全部 SQL。

如果启用了 persistent lineage，先设置 `LINEAGE_DB_PROFILE`，再按 [`血缘快照采集与发布指南`](./docs/lineage_bulk_import_guide.md) 执行 `collect_lineage_snapshot.py --dry-run` 和正式发布；采集失败应保留原 ACTIVE 快照。

### 5.2 Existing database

既有数据库先备份，再检查当前 ledger 和 schema：

```bash
backend/.venv/bin/python backend/scripts/schema_migrate.py status \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml

backend/.venv/bin/python backend/scripts/schema_migrate.py verify \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml
```

如果 schema 已存在但没有 Alembic ledger，只有在备份完成且 `verify` 已确认 baseline 一致时，才使用以下安全流程：

```bash
backend/.venv/bin/python backend/scripts/schema_migrate.py baseline \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml \
  --dry-run

# 确认 dry-run 成功、备份可恢复且对象属于本次部署后，再执行实际 stamp
backend/.venv/bin/python backend/scripts/schema_migrate.py baseline \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml

backend/.venv/bin/python backend/scripts/schema_migrate.py apply \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml
```

不要用初始化 SQL 覆盖已有数据库，也不要对生产库执行未经确认的 destructive downgrade 或 reset。后续结构变更只通过新的 Alembic forward revision 管理。

## 6. Admin Initialization

migration 成功后，使用交互式 CLI 创建第一个管理员：

```bash
cd /opt/data-asset-portal
backend/.venv/bin/python backend/scripts/create_admin.py
```

CLI 会提示用户名、显示名、密码和密码确认；密码不会作为命令行参数或环境变量传入。脚本会读取当前 runtime 配置，不支持通过 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 自动创建管理员，也没有弱默认密码。若数据库 schema 尚未初始化，先回到[migration](#5-database-migration)。

## 7. Frontend Build

### 7.1 在服务器构建

只有选择服务器构建模式时，才需要在生产服务器安装 Node.js。前端当前的 build contract 必须从 `frontend` 目录执行完整 `npm run build`：

```bash
cd /opt/data-asset-portal/frontend
npm ci

VITE_API_MODE=remote \
VITE_API_BASE_URL=/api \
npm run build

test -f dist/index.html
```

`npm run build` 等价于先按顺序构建三个仓库内 lineage workspaces，再执行 Vite production build；不要用单独的 `vite build` 或 `npm run build:frontend` 替代它。最终产物是：

```text
/opt/data-asset-portal/frontend/dist/index.html
/opt/data-asset-portal/frontend/dist/assets/...
```

`VITE_API_BASE_URL=/api` 让 production bundle 使用同源 `/api`。`VITE_BACKEND_URL` 只用于 Vite development server 的 proxy target，不参与 production bundle；同源生产构建不需要设置它。生产构建不需要把后端 loopback 地址暴露到浏览器。

### 7.2 在构建机或 CI 构建

更推荐在构建机/CI 使用相同 Node/npm contract 执行：

```text
构建机或 CI
  └─ npm ci + npm run build
       └─ frontend/dist/
            └─ 以版本化 artifact 部署到生产服务器
```

服务器只托管已经构建的 `frontend/dist` 时，不需要长期安装 Node.js 或 npm。无论哪种模式，都要确认 `frontend/dist/index.html` 与静态资源属于同一个版本，不要跨 worktree 复制旧的 `dist`。

## 8. systemd

仓库示例 [`deploy/systemd/data-asset-portal.service.example`](./deploy/systemd/data-asset-portal.service.example) 使用当前唯一的 FastAPI/Uvicorn runtime：

```ini
WorkingDirectory=/opt/data-asset-portal
ExecStart=/opt/data-asset-portal/backend/.venv/bin/uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

复制并编辑 unit：

```bash
cd /opt/data-asset-portal
sudo cp deploy/systemd/data-asset-portal.service.example \
  /etc/systemd/system/data-asset-portal.service
sudoedit /etc/systemd/system/data-asset-portal.service
```

至少确认并按实际环境修改：

- `User` / `Group`：示例是 `dataasset`，不是仓库强制名称；
- `WorkingDirectory`：实际 checkout 根目录；
- `ExecStart`：实际 `.venv/bin/uvicorn` 绝对路径、`backend.asgi:app`、`127.0.0.1:5099`；
- service 账号对仓库、`backend/.env.local`、数据库配置和所需本地 snapshot 有读取权限。

示例 unit 不使用 `source backend/.venv/bin/activate`，也不加入未经验证的 `ProtectSystem`、`ProtectHome`、`ReadWritePaths` 等 sandbox 参数，避免遮断 SQLite、配置、snapshot 或其他项目运行所需访问。

加载、开机自启和常用生命周期操作：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now data-asset-portal

sudo systemctl status data-asset-portal
sudo systemctl restart data-asset-portal
sudo systemctl stop data-asset-portal

journalctl -u data-asset-portal -f
journalctl -u data-asset-portal -n 200 --no-pager
```

## 9. Nginx

### 9.1 HTTP Demo

示例 [`deploy/nginx/data-asset-portal.conf.example`](./deploy/nginx/data-asset-portal.conf.example) 的第一个 server block 是 HTTP Demo 配置。安装前替换 `server_name` 和 `root`：

```bash
sudo cp deploy/nginx/data-asset-portal.conf.example \
  /etc/nginx/sites-available/data-asset-portal.conf
sudoedit /etc/nginx/sites-available/data-asset-portal.conf

# Debian/Ubuntu 常见布局；如果系统没有 sites-enabled，放入已被 nginx.conf include 的 conf.d 目录
sudo ln -s /etc/nginx/sites-available/data-asset-portal.conf \
  /etc/nginx/sites-enabled/data-asset-portal.conf

sudo nginx -t
sudo systemctl reload nginx
```

如果目标系统使用 `/etc/nginx/conf.d/`，将最终 `.conf` 文件放入该目录，不要同时加载两份相同 server 配置。关键路径必须保持如下语义：

```nginx
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
```

`location /api/` 与带 `/api/` 的 `proxy_pass` 会把 `/api/assets/tables` 原样转发为 FastAPI 的 `/api/assets/tables`；不要删除 `proxy_pass` 末尾的 `/api/`，也不要再拼接一层 `/api`。`try_files` 保证直接刷新 `/assets`、`/indicators`、`/reports`、`/system/...` 等 React client-side route 时回到 `index.html` 而不是 404。

示例还将 `client_max_body_size` 设为 `16m`，与应用默认请求体限制保持一致；如部署方有不同限制，应同时评估 Nginx 和应用配置。

### 9.2 HTTPS Production

正式需要登录/session 的内网部署应使用 HTTPS。可以使用企业 CA、内网 CA 或现有可信内网网关签发的证书；不要假设公网 Let's Encrypt 一定能验证内网域名，也不要关闭浏览器 TLS 校验。证书和 private key 只放在服务器受控路径，绝不提交仓库。

示例文件中已提供一组注释掉的 HTTPS server blocks。启用正式配置时：

1. 准备证书和 key，例如示例中的 `/etc/nginx/ssl/data-asset-portal.crt` 与 `/etc/nginx/ssl/data-asset-portal.key`；
2. 修改 `server_name`、静态 root 和证书路径；
3. 用 HTTP → HTTPS redirect block 和 443 block 替换/注释 HTTP Demo block，避免同一 hostname 同时运行两个互相冲突的 HTTP server；
4. 保留相同的 SPA fallback、`/api/` proxy 和 `X-Forwarded-Proto`；
5. 执行 `nginx -t` 后再 reload。

HTTPS Production 保持：

```env
APP_ENV=production
ASSET_TRUST_PROXY_HEADERS=true
```

当 Nginx 终止 TLS 并将请求转给 loopback backend 时，浏览器通过 HTTPS 访问，Production 的 `Secure` Cookie 才会随后续请求发送。普通 HTTP 不会发送 `Secure` Cookie，因此 HTTP Demo 可以用于静态页面、通过 loopback 执行的 `/healthz` 和 `/api` 连通性检查，但不适合验证需要登录/session 的管理操作。不要用 `APP_ENV=development` 绕过正式内网 HTTP 的 Cookie 行为；`development` 只用于本地 HTTP 开发联调，正式部署应改用 HTTPS。

本示例没有将 `/healthz` 暴露为 Nginx 外部路径；请按下一节使用后端 loopback 地址检查它，不要把 `https://data-asset.example/healthz` 当作既有契约。

## 10. Verification

### 10.1 后端进程

```bash
sudo systemctl status data-asset-portal
curl --fail --silent --show-error http://127.0.0.1:5099/healthz
```

预期 JSON 至少包含：

```json
{"status":"ok","runtime":"fastapi","fastapiPrimary":true}
```

`/healthz` 只报告进程和 native runtime 状态，不执行数据库查询；数据库可用性还要通过 migration 和业务 API 验收。

### 10.2 Nginx

```bash
sudo nginx -t
sudo systemctl status nginx
```

### 10.3 外部入口与 SPA

将 `data-asset.example` 替换为实际 DNS/hosts 中可解析的内网 hostname：

```bash
# 首页应返回 frontend/dist/index.html
curl --fail --silent --show-error -I http://data-asset.example/

# 业务 API 应返回 JSON，而不是 Nginx/SPA HTML
curl --fail --silent --show-error \
  -H 'Accept: application/json' \
  http://data-asset.example/api/assets/tables

# client-side route 直接访问/刷新不能返回 404
curl --fail --silent --show-error http://data-asset.example/assets > /dev/null
curl --fail --silent --show-error http://data-asset.example/indicators > /dev/null
curl --fail --silent --show-error http://data-asset.example/reports > /dev/null
```

HTTPS Production 将上述 `http://` 替换为 `https://`。最终至少确认：

```text
/                 → 前端 index
/api/assets/tables → FastAPI JSON
127.0.0.1:5099/healthz → fastapi runtime health JSON
```

然后在浏览器通过 HTTPS 登录，确认 session 在页面刷新和后续管理请求中保持。HTTP Demo 下不要把 Secure Cookie 登录失败误判为后端进程故障。

## 11. Recommended Deployment Sequence

全新单机部署按以下顺序执行：

1. 获取固定 release/tag/commit，准备安装目录、服务账号、Nginx 和数据库。
2. 复制并填写 `backend/.env.local` 与 `backend/configs/database.yaml`；生成 `APP_SECRET_KEY`。
3. 创建 `backend/.venv` 并安装 `backend/requirements.txt`（MySQL/GaussDB 按需安装额外依赖/驱动）。
4. 执行 `schema_migrate.py apply`，再执行 `status`/`verify`。
5. 执行 `create_admin.py` 创建管理员。
6. 通过服务器或构建机执行 `cd frontend && npm ci && npm run build`，确认 `frontend/dist/index.html`；或部署已验证的 `frontend/dist` artifact。
7. 安装并启用 systemd unit，确认 backend 监听 `127.0.0.1:5099`。
8. 安装 Nginx HTTP Demo 或 HTTPS Production 配置，执行 `nginx -t` 并 reload。
9. 按[验收命令](#10-verification)检查 systemd、`/healthz`、Nginx、首页、`/api` 和 SPA refresh。

## 12. 升级

正式升级使用固定 release/tag/commit，并保留数据库备份和回滚路径；不要把 `git pull main` 作为唯一生产升级契约：

```bash
cd /opt/data-asset-portal
git fetch --tags origin
git checkout <new-release-tag-or-commit>

sudo systemctl stop data-asset-portal
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python backend/scripts/schema_migrate.py apply \
  --profile primary \
  --config /opt/data-asset-portal/backend/configs/database.yaml

cd frontend
npm ci
VITE_API_MODE=remote VITE_API_BASE_URL=/api npm run build
test -f dist/index.html
cd ..

sudo systemctl start data-asset-portal
sudo nginx -t
sudo systemctl reload nginx
curl --fail --silent --show-error http://127.0.0.1:5099/healthz
```

如果前端由 CI/build machine 构建，则在停止服务前将该版本的 `frontend/dist` artifact 部署到服务器。升级后重新执行 API JSON、SPA refresh 和 HTTPS 登录验收。

## 13. Troubleshooting

### systemd 启动失败

```bash
sudo systemctl status data-asset-portal
journalctl -u data-asset-portal -n 200 --no-pager
```

优先检查 `.venv/bin/uvicorn` 是否存在、`WorkingDirectory`/`ExecStart` 是否为实际绝对路径、service 账号是否可读配置，以及 `APP_SECRET_KEY` 是否非空。不要把 `source .../activate` 写进 `ExecStart`。

### API 返回 502 或 HTML

先检查 loopback runtime：

```bash
curl --fail http://127.0.0.1:5099/healthz
```

然后检查 Nginx `location /api/` 与 `proxy_pass http://127.0.0.1:5099/api/;` 是否同时保留 `/api/`，并执行 `nginx -t`。前端收到 HTML 而不是 JSON 通常表示 `/api` 没有正确代理到 backend。

### SPA 刷新返回 404

确认 Nginx 的前端 location 包含：

```nginx
try_files $uri $uri/ /index.html;
```

同时确认 `root` 指向当前版本的 `frontend/dist`，且 `dist/index.html` 存在并可被 Nginx 读取。

### 登录后刷新丢失 session

如果入口是 HTTP，Production `Secure` Cookie 不会被浏览器发送。为正式内网部署配置企业 CA、内网 CA 或可信网关 HTTPS，并保持 `APP_ENV=production`；不要改成 `APP_ENV=development`。

### migration 或管理员初始化失败

确认 `ASSET_DB_CONFIG_PATH`、`ASSET_DB_PROFILE` 与 YAML 中 profile 名称一致，数据库 schema 已准备且 service/部署账号可访问。先执行 `status`/`verify`，不要跳过 baseline 一致性检查，也不要把真实密码写进命令行或日志。
