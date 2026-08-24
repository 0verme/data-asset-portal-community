# 开发指南 · Development

面向本地开发与联调的说明。生产部署请参见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 环境要求

- **Node.js** 22.13+ —— 前端 Vite 开发与构建（`lineage-viewer` workspace 要求 `>=22.13.0`，推荐 Node 24）
- **npm** 10+ —— 安装前端依赖（npm workspaces 需要）
- **Python** 3.10+ —— 运行 FastAPI Native runtime
- **PostgreSQL** 或 **GaussDB / DWS** —— Community/完整部署的 remote 联调按 profile 选择
- **MySQL 8.0** —— 通过独立 PyMySQL 依赖和 profile 进行数据库契约验证
- **SQLite** —— Community/local 隔离运行与一键 Demo，Python 标准库已提供驱动

前端依赖定义在 `frontend/package.json`（`lineage-viewer`、`@lineage-viewer/react`、
`@lineage-viewer/domain-adapter` 为仓库内 npm workspaces，源码在 `frontend/packages/`，
不依赖公共 npm registry 上的同名包），后端依赖定义在 `backend/requirements.txt`。

## 安装依赖

### 前端

```bash
cd frontend
npm ci
```

> 三个 lineage package 是仓库内置的 npm workspace（`frontend/packages/`），
> `npm ci` 会从本地源码链接它们，无需也不可能从 npm registry 安装。

#### Lineage workspace source / artifact policy

三个 workspace 的 `src/`、配置、文档和示例是 Git source of truth；`dist/` 是由 package
build 生成的 runtime/type/release output，不是 checkout 的输入。为避免 source/artifact drift，
三个 `dist/` 目录不提交，由显式、按依赖顺序的脚本重建：

```bash
cd frontend
npm run build:lineage       # lineage-viewer -> domain-adapter -> react
npm run typecheck:lineage
npm test
npm run build              # build:lineage + root frontend production build
npm run verify:lineage-packages
```

| Artifact | Repository policy | Producer / consumer |
|---|---|---|
| `src/`、TypeScript/TSX source、配置、docs/examples | `KEEP` | 人工维护；workspace build、typecheck 和 frontend 消费 |
| `dist/*.js`、`dist/*.d.ts`、Vite hashed bundles | `IGNORE` | package build 生成；root frontend 和 npm pack 在 build 后消费 |
| `dist/*.map` | `IGNORE` | Vite/TypeScript 生成；不进入 Git，随 `files: ["dist"]` 作为 release 调试 artifact 保留在 npm package |
| npm `.tgz` tarball | `RELEASE ONLY` | `npm pack` / `npm publish` 临时生成；不提交、不部署到 frontend repository |

`package.json` 的 `main`、`module`、`types`、`exports` 继续指向 `dist/`，`files` 继续把
`dist/` 放入 npm package。因此 `npm ci` 后必须先运行 Lineage build，不能把 workspace
symlink 的存在误认为 runtime output 已经存在。当前仓库没有 npm publish 自动化；发布前从
干净 checkout 执行上述 build、typecheck、verify，再在各 package 目录运行
`npm pack --dry-run` 或按发布流程 `npm publish`。生产 frontend 的 source-map 配置不因本策略改变。

旧 checkout 若依赖已提交的 `dist/`，迁移方式为：

```text
npm ci -> npm run build:lineage -> npm run build / npm run verify:lineage-packages
```

回滚不需要数据迁移：revert 本策略 commit 即可恢复原先的 tracked `dist/`，或在隔离分支
重新生成并恢复需要的 release artifact。

### 后端

```bash
python -m venv backend/.venv
# Windows PowerShell: .\backend\.venv\Scripts\Activate.ps1
source backend/.venv/bin/activate
pip install -r backend/requirements.txt
```

## 本地启动

### 分开启动

从仓库根目录运行：

```bash
# 前端（Vite 开发服务器）
npm --prefix frontend run dev

# 后端（FastAPI Native）
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

`backend/asgi.py` 是唯一开发与生产共用的 FastAPI Native ASGI entrypoint。`python backend/run.py` 已退休，不再提供 Flask development/WSGI runtime。

> **端口约定**：后端固定使用 **5099** 端口，绝不自动切换到 5001/5002。
> 下面的写日志脚本会在启动前自动检测 5099 是否被占用，若被占用则找出 PID 并结束该进程，
> 再以 5099 端口启动。直接启动 Uvicorn 不会自动清理端口，请优先使用脚本启动。

### 写日志启动（自动清理 5099 端口）

前后端均提供后台运行并写日志到 `logs/` 的脚本：

```powershell
# Windows（PowerShell）
# 前端
powershell -ExecutionPolicy Bypass -File .\frontend\scripts\dev-frontend.ps1
# 后端（启动前自动结束占用 5099 端口的进程）
powershell -ExecutionPolicy Bypass -File .\backend\scripts\dev-backend.ps1
```

```bash
# Mac / Linux
# 后端（启动前自动结束占用 5099 端口的进程）
bash backend/scripts/dev-backend.sh
```

也可通过 npm 脚本启动后端：

```bash
# Windows
npm --prefix frontend run dev:backend
# Mac / Linux
npm --prefix frontend run dev:backend:sh
```

#### 端口清理实现说明

- **Windows**：`Get-NetTCPConnection -LocalPort 5099 -State Listen` 取得占用进程 PID，
  `Stop-Process -Force` 结束（旧系统回退 `netstat -ano`）。
- **Mac / Linux**：`lsof -nP -iTCP:5099 -sTCP:LISTEN -t` 取得 PID，`kill -9` 结束
  （无 `lsof` 时回退 `fuser 5099/tcp`）。

### 统一启动（Windows）

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\dev-all.ps1
```

## Mock / Remote 切换

前端数据来源与认证方式只有一个开关 `VITE_API_MODE`；后端始终由唯一的 FastAPI/Uvicorn runtime 连接数据库。

### 只看前端页面（mock）

适合 UI 调整或无后端场景：前端读内置 mock 数据 + 演示登录（公开凭据 `admin` / `community-demo-password`，仅 mock 模式生效）。

```env
# frontend/.env.local
VITE_API_MODE=mock
```

### 前端联调后端接口（remote）

前端调后端真实数据 + 真实登录；后端需配好 `backend/configs/database.yaml` 的 profile。

```env
# frontend/.env.local
VITE_API_MODE=remote
VITE_API_BASE_URL=/api
# 后端固定 5099，请勿改成 5001/5002
VITE_BACKEND_URL=http://localhost:5099
```

```env
# backend/.env.local
ASSET_DB_PROFILE=primary
ASSET_AUTH_DB_PROFILE=primary
APP_SECRET_KEY=<generate-a-strong-random-value>
# Explicit local-development setting: permits HTTP session cookies locally.
APP_ENV=development
# Vite uses a same-origin /api proxy by default, so normally leave this unset.
# APP_CORS_ORIGINS=http://localhost:5173
```

### 后端安全运行时配置

- `APP_DEBUG` 默认关闭；仅 `1`、`true`、`yes`、`on`（忽略大小写和首尾空格）会启用它。不要在共享或生产环境设置它。
- `APP_SECRET_KEY` 在所有环境均为必填项；缺失、空字符串或纯空白会使应用在启动时失败。用密码管理器或部署平台的 secret store 保存它，不要提交到仓库、写入日志，或把真实值粘贴进命令历史。可在受控终端本地生成候选值：`python -c "import secrets; print(secrets.token_urlsafe(32))"`，然后直接保存到 secret store / `.env.local`。
- `APP_ENV` 默认为安全的生产行为：Cookie 使用 `Secure=True`。本地 HTTP 联调必须显式设置 `APP_ENV=development`，此时 `Secure=False`；`HttpOnly=True` 与 `SameSite=Lax` 始终保留。
- `backend/asgi.py` 运行纯 FastAPI Native backend；Auth 保留既有 signed-session cookie format，仓库已有模块 routes 默认注册，数据库/驱动/外部依赖 readiness 通过 error contract 表达。Flask compatibility runtime 已退休；`FLASK_*` 变量名仅作为 retained signed-cookie/security configuration contract，不代表 Flask 进程。
- Nginx + Vite 的 `/api` 反代是同源部署，不需要 CORS。只有前端和 API 确实处于不同来源时，才设置 `APP_CORS_ORIGINS`，使用逗号分隔的完整来源，例如 `https://portal.example.com,https://admin.example.com`；空项会忽略，未配置时不发送跨域允许头，绝不使用 `*`。

### Authenticated-by-default 业务读模型

Remote API 的普通业务 GET 默认需要登录：匿名请求返回 `401`，已登录普通用户可以浏览普通目录，不需要为每个 GET 申请细粒度 read permission。写操作、管理 API 和敏感读取继续使用现有 RBAC `require_permission(...)`，`403` 表示已有身份但缺少授权。

显式匿名例外仅包括 `/healthz`、有限的 `/api/capabilities` 模块元数据以及 `/api/auth` 登录生命周期。当前没有 Public Catalog 配置或默认开放业务目录。前端 remote 模式会先完成 `/api/auth/me` 身份 bootstrap，再请求菜单、统计和业务模块；未登录时不会循环请求这些 API。完整清单见 [Authenticated-by-default Business Read Model](./docs/rbac/authenticated-read-model.md)。

### FastAPI 开发文档

本地后端显式设置 `APP_ENV=development` 后，FastAPI 的开发文档端点可用：

- Swagger UI：`http://127.0.0.1:5099/docs`
- ReDoc：`http://127.0.0.1:5099/redoc`
- OpenAPI JSON：`http://127.0.0.1:5099/openapi.json`

`APP_ENV` 未设置或不是 `development` 时，这些 HTTP 端点默认关闭；这不影响应用内部通过 `app.openapi()` 生成 schema。

## 环境文件加载顺序

后端依次加载（后者覆盖前者）：

1. 根目录 `.env`
2. 根目录 `.env.local`
3. `backend/.env`
4. `backend/.env.local`

> 复制 `frontend/.env.example` 为 `frontend/.env.local` 作为起点；不要提交本地 `.env.local`。

## 数据库配置

配置文件查找优先级：

1. `ASSET_DB_CONFIG_PATH`（环境变量指向的路径）
2. `backend/configs/database.yaml`

相关文件：

- `backend/configs/database.yaml`
- `backend/configs/database.example.yaml`
- `backend/configs/database.community.yaml`（Community/local 示例）

完整版开发使用 `postgres` 或 `gaussdb` profile。Community/local 可设置 `ASSET_RUNTIME_PROFILE=community`，运行时会默认加载 `backend/configs/database.community.yaml` 的 `community_sqlite` profile；也可显式改用其中的 `community_postgres`。Cloudflare D1 不在支持范围内。

## 数据库初始化

**Community/local 的唯一官方初始化路径 = baseline + Alembic + demo seed**（部署契约由
`backend/schema` 四方言 versioned baseline 与 `backend/alembic` immutable forward revisions 共同组成；runtime `tables.py` 不是完整 physical schema，详见 [ADR-002](./docs/adr/002-schema-canonical-source.md)）：

```bash
# SQLite 本地 / Community Demo
python backend/scripts/schema_migrate.py apply --profile community_sqlite
python demo/seed_sqlite.py --database <absolute-local-path>/community.db

# PostgreSQL Community 部署
python backend/scripts/schema_migrate.py apply --profile community_postgres
python demo/seed_postgres.py --dialect postgres
```

MySQL 8.0 先执行 `pip install -r backend/requirements-mysql.txt`，再使用 `community_mysql` profile 执行 `schema_migrate.py apply`；真实 CRUD、分页、唯一约束、中文/emoji、NULL 和 rollback 由 CI MySQL 8 integration job 验证。既有数据库先 `verify`，只有与 baseline 契约一致时才允许 `baseline` stamp；后续结构变更只走 Alembic forward revision。

### 方言参考 / external dependency 路径

`docs/pg/` 与 `docs/dws/` 是 PostgreSQL、GaussDB/DWS 的方言参考、历史兼容 DDL 和 external integration 说明，不是隐藏仓库模块的产品边界，也不是 local 新库的默认入口。需要 vendor-specific DDL 或 external storage/collector 时，确认 profile、依赖和目标数据库后再按 SQL 文件说明执行。

所有仓库模块的 runtime/schema/seed 默认 contract 已统一；persistent lineage 需要 `LINEAGE_DB_PROFILE`，development/test 未配置时使用受控 POC，实例菜单可见性仍由 `p_menu.status` 管理。

> 🚫 仓库不再包含整库快照（`app-*-init-data.sql` 与 `docs/*/sample/*.sql` 已从公开树移除）。
> 需要 SQL 形式演示数据时用 `python demo/generate_demo_sql.py` 从安全演示源生成。
> Community seed 会创建 `community_demo` 演示管理员；手动 full/extension 建库时需按目标部署自行准备管理员数据。

## 测试与质量检查

### 本地发布检查（与 CI 同一套命令）

仓库提供与 CI 对齐的本地检查脚本，提交 / 发版前建议运行：

```bash
# 快速检查：Public Data Guard + 后端单元测试 + migration offline verify + packaging + 前端 lint/typecheck/测试
python scripts/release_check.py fast

# 完整检查：fast + SQLite fresh 迁移/seed/重复 apply + 前端 npm ci/lint/build/audit
# 如需 PostgreSQL 集成（16 个 integration 测试）再设置：
#   TEST_DATABASE_PROFILE=<profile> TEST_DATABASE_CONFIG_PATH=<config>
python scripts/release_check.py full
```

> 注意：本地机器若全局设置了 `NODE_ENV=production`，`release_check.py` 会自动净化 npm 环境；
> 手动跑 `npm ci` 时请自行确认没有 `NODE_ENV=production` 污染（否则 devDependencies 会被跳过）。

### Runtime 与 Adapter focused tests

以下命令使用仓库中已有测试，不改变 API 行为：

```bash
python -m unittest backend.tests.test_p5_runtime
python -m unittest backend.tests.test_api_contracts
python -m unittest discover -s backend/tests
```

`test_p5_runtime.py` 覆盖 FastAPI Native startup、scope gate、session compatibility、CORS、security headers 与 `/healthz`；native contract tests 覆盖 API wire format 与 authorization。`test_api_contracts.py` 验证框架中立的 Pydantic API Contract。

### CI（GitHub Actions）

`.github/workflows/ci.yml` 在 `pull_request` 与 `main` 推送时运行：

1. **Repository Guard** —— `python demo/validate_demo_data.py --strict`（BLOCKER / SUSPICIOUS 必须为 0）、二进制 / dump / 环境文件检查、workflow YAML 自检；
2. **Backend / Python 3.11 + 3.13** —— `python -m unittest discover -s backend/tests` + baseline offline verify（sqlite / postgresql / mysql / dws）+ packaging contract tests；
3. **PostgreSQL Integration（PG 16 service）** —— fresh migration → seed → integration tests（16 个不再 skip）→ repeat apply no-op → 当前 Community 表物理边界检查；
4. **MySQL 8 Integration** —— fresh baseline → verify → SQLAlchemy Core CRUD / pagination / uniqueness / Unicode / NULL / rollback → repeat apply no-op；
5. **Frontend / Node 22 + 24** —— `npm ci` → `npm run lint` → `npm test` → `npm run build` → `npm audit --audit-level=high`；
6. **Community Migration（SQLite）** —— fresh apply → verify → plan → seed → repeat apply no-op → 当前 Community 表物理边界检查。

CI 权限为只读、仅用 GitHub 官方 Actions、无生产连接。

### 数据库集成测试

PostgreSQL integration 测试（16 个）通过 `TEST_DATABASE_PROFILE` + `TEST_DATABASE_CONFIG_PATH`
环境变量启用（详见 `backend/tests/db_test_support.py`），指向**专用隔离测试库**，
绝不使用默认 `database.yaml` 或生产库。未设置时这些测试自动 skip。

## 开发期常用脚本

| 脚本 | 作用 |
| --- | --- |
| `scripts/dev-all.ps1` | 统一启动前后端 |
| `frontend/scripts/dev-frontend.ps1` | 前端后台运行并写日志 |
| `backend/scripts/dev-backend.ps1` | 后端后台运行并写日志（Windows，启动前清理 5099 端口） |
| `backend/scripts/dev-backend.sh` | 后端后台运行并写日志（Mac/Linux，启动前清理 5099 端口） |
| `backend/scripts/db_to_init_sql.py` | 从数据库导出整库快照 SQL（默认输出到 git-ignored `tmp/db-init-sql/`，写仓库需显式 `--allow-repository-output`） |

## 代码组织约定

### 前端（`frontend/src/`）

- `api/` —— 按模块拆分的数据访问层，公共 HTTP 封装在 `api/http.js`
- `components/views/` —— 各模块主视图
- `components/sidebar/` —— 各模块侧边栏
- `components/common/` —— 公共组件（确认弹窗、toast、弹窗、状态卡片）
- `components/system/`、`components/OperationLog/` —— 系统管理与操作日志子模块
- `hooks/` —— 领域业务 hook（数据加载、状态、主题、会话等）
- `data/` —— mock 数据（仅 `VITE_API_MODE=mock` 时使用）
- `routing/`、`utils/`、`config/`、`styles/` —— 路由解析、工具、默认配置与样式

### 前端渐进 TypeScript 采用

主应用采用 **JS/TS 共存**，不是一次性重写。`frontend/tsconfig.app.json` 只覆盖已经建立类型边界的基础模块；它不会通过 `checkJs` 扫描 legacy JavaScript。主应用边界和既有 lineage workspace 可以分别检查，也可以用统一命令检查：

```bash
cd frontend
npm run typecheck:app      # main-app TypeScript boundary only
npm run typecheck          # app boundary + lineage workspaces
```

| 区域 | 默认策略 |
| --- | --- |
| 新增 routing / serialization / shared contract | TypeScript preferred |
| 新增 API / auth / domain adapter boundary | TypeScript preferred |
| 既有 JS hooks | 只有发生实质重构时迁移 |
| 既有 JSX components / views | JS/JSX allowed |
| `src/App.jsx` | 本阶段保持 JSX |
| `packages/lineage-viewer*` | 继续遵循现有 workspace TypeScript policy |

新增代码不应仅为更换扩展名制造 churn；迁移应当带来边界类型价值。边界可以用靠近 legacy JS 配置的 `.d.ts` 描述文件接入，但不复制完整后端 schema。已有 URL、API/auth wire contract 和模块代码保持不变。Node 22+ 的原生 type stripping 仅用于现有 Node tests 加载少量 `.ts` runtime boundary，不引入 `ts-node`、`tsx` 或新的测试运行时。

### 后端（`backend/app/`）

- `asgi.py` / `fastapi_app.py` / `fastapi/` —— ASGI runtime 与 FastAPI HTTP adapter；`fastapi_app.py` 保留薄 import facade，历史 Flask bootstrap/routes 已由 F7 清理
- `services/` —— 业务与数据读写，供 FastAPI adapter 与框架中立 Application boundary 复用
- `contracts/` —— FastAPI/Application 复用的框架中立 API Contract
- `db/` —— 数据库连接与 profile 解析

## 代码风格约定

- 与周边既有代码保持一致的命名、缩进与注释密度
- 前端按页面和领域拆分，不引入额外状态管理框架
- 模式切换逻辑保留在 API 层与 service 层，不在页面里散落判断
- 写操作交互统一使用公共 `ConfirmDialog` / toast，禁用原生 `alert` / `confirm`
- 文档与配置应明确区分"默认值"和"本地联调值"

## 相关文档

- [架构说明](./docs/architecture.md)
- [FastAPI cutover 与兼容边界](./docs/fastapi-cutover.md)
- [模块清单](./docs/modules.md)
- [API 契约](./docs/api-contract.md)
- [部署说明](./DEPLOYMENT.md)
