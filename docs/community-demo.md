# Community Demo 指南

本指南说明两种本地路径：

- **One-command evaluation/demo**：第一次接触项目时使用 `scripts/demo.sh` 或 `scripts/demo.ps1`，自动完成 SQLite、migration、seed、backend 和 frontend。
- **Manual development workflow**：需要单独调试前后端或迁移时，仍可按文末的手工命令运行。

所有演示数据来自仓库内的虚构全渠道零售数据，不包含真实公司、账号、地址或业务数据。

## 三个 Demo 运行面

本文的 **Repository Community Demo**、前端 **mock mode** 和线上 **static Demo** 不是同一个运行面：

1. **Repository Community/remote Demo**：`scripts/community_demo.py` 使用 Community SQLite baseline + Alembic + seed，通过 `backend/asgi.py` 和 Uvicorn 启动真实 FastAPI API。仓库模块默认按 open repository module contract 注册；数据库驱动、外部依赖、凭据和 persistent storage readiness 可能影响部署能力，但不隐藏源码模块。
2. **Frontend mock mode**：`VITE_API_MODE=mock` 只读取 `frontend/src/data/` 和 API 文件中的受控数据，不需要后端或数据库；默认 registry 可以展示全部源码模块，因此 mock coverage 不能冒充 remote backend deployment readiness。
3. **Online static Demo**：[https://data.overme.cn/](https://data.overme.cn/) 是独立发布的静态/mock bundle。当前可见 footer 为 `V1.0.0`，页面 HTML 没有仓库 revision/build metadata；它不自动等同于当前 `origin/main`、Repository Community Demo 或 GitHub published release `v0.2.0`。

## Prerequisites

- Python 3.10+
- Node.js 22.13+
- npm 10+

Bootstrap 不会安装系统级 Python、Node.js、npm、Homebrew、Chocolatey 或 apt 包。缺少工具时会给出安装提示。
首次运行时，如果项目依赖不存在，脚本只会在仓库内创建 `backend/.venv` 并执行 `npm ci`；随后检查 lineage workspace 的 package entry。entry 缺失时再执行现有的 `npm run build:lineage`，不会执行 global npm install、sudo 或系统级 pip 安装。构建产物已被 Git 忽略，重复运行时 entry 完整则不会重复构建。

## One-command Demo

### Linux/macOS

```bash
./scripts/demo.sh
```

### Windows PowerShell

```powershell
.\scripts\demo.ps1
```

脚本内部使用现有的 Alembic baseline CLI 和 Community seed，并通过 `backend/asgi.py` 以 Uvicorn 启动纯 FastAPI backend，执行：

```text
preflight
→ project-local dependencies
→ generated Demo config/secret
→ SQLite database
→ backend/schema baseline + Alembic upgrade
→ demo/seed_sqlite.py
→ backend readiness
→ Vite frontend readiness
```

成功后终端会显示实际访问信息：

```text
Community Demo ready
Frontend:    http://127.0.0.1:5173/
Backend/API: http://127.0.0.1:15099
Demo administrator:
  Username: admin
  Password: 12346
Database:    <repository>/.demo/community-demo/community.sqlite
Stop: Ctrl+C
```

前端使用 Vite `/api` proxy 访问后端，浏览器不需要再编辑 remote/API 配置。默认代表性 API 为：

```text
http://127.0.0.1:15099/api/portal/stats
```

### 端口参数

默认端口为 backend `15099`、frontend `5173`。三个入口都会把参数同步到 CORS、`VITE_BACKEND_URL`、Uvicorn/Vite 启动参数、readiness URL、端口冲突检查和成功输出：

```bash
# Linux/macOS
./scripts/demo.sh --backend-port 15099 --frontend-port 5173

# 直接调用 Python
python scripts/community_demo.py --backend-port 15099 --frontend-port 5173
```

```powershell
# Windows PowerShell
.\scripts\demo.ps1 -BackendPort 15099 -FrontendPort 5173
```

端口必须在 `1`～`65535` 之间。Windows 某些机器会把 `5041`～`5140` 标记为 excluded/reserved port；即使没有监听进程，socket 检查也可能显示未占用，实际启动仍可能失败并报 `WinError 10013`。当前默认 backend `15099` 已避开该范围；如果自定义其他端口，请确认该端口未被其他服务使用。

Lineage workspace 的 `dist/` 不属于 Git checkout 内容。bootstrap 会检查 `lineage-viewer`、`@lineage-viewer/domain-adapter` 和 `@lineage-viewer/react` 的 package entry；首次 checkout 缺失时自动在 `frontend/` 执行：

```bash
npm run build:lineage
```

该步骤只在 entry 缺失时执行，成功后后续启动保持幂等。

### Init-only

CI 或只想初始化数据库时，不启动常驻服务：

```bash
./scripts/demo.sh --init-only
```

```powershell
.\scripts\demo.ps1 -InitOnly
```

该模式会检查 runtime、依赖、lineage workspace package entry、Demo 配置、SQLite、migration、seed，并通过 bootstrap 注入前端 remote 配置，然后退出 `0`。端口参数仍会校验，但不会启动服务或执行端口冲突检查。
可连续运行多次；第二次会显示 `applied=-`，seed 不会复制用户、资产或关系数据。

## Generated files and safety

所有 bootstrap 生成内容都在 `.demo/community-demo/`，该目录已加入 `.gitignore`：

| Path | Purpose | Gitignored | Secret |
| --- | --- | --- | --- |
| `.demo/community-demo/community.sqlite` | Community 专属 SQLite 数据库 | 是 | 否 |
| `.demo/community-demo/database.yaml` | 仅包含上述 SQLite 路径的 profile | 是 | 否 |
| `.demo/community-demo/session-secret.key` | 随机 development session secret | 是 | 是 |

脚本不会覆盖或 merge 用户已有的 `.env`、`.env.local`、`backend/.env*` 或 `frontend/.env.local`。
后端 Demo 子进程会显式固定 `community` + `community_sqlite` + 已知本地 SQLite 路径，并隔离继承的
`LINEAGE_DB_PROFILE`、`DATABASE_URL`、`PG*`、`MYSQL_*`、`DB_*` 和 `ASSET_DB_*` 变量；血缘保持 POC/in-memory 模式，因此不会因为用户 shell 或配置文件中的外部数据库设置而连接生产库。

默认不提供 destructive reset。若要重新开始，请在确认路径确实是本 bootstrap 创建的
`.demo/community-demo/` 后，手工移除该目录，再重新运行命令；不要删除用户 `.env` 或其他 SQLite 文件。

## Stop and repeat

完整 Demo 运行时按 `Ctrl+C`。Bootstrap 只会终止它自己创建的 backend/frontend child process；不会按进程名杀掉其他 Python、Node 或 Vite 进程。

默认端口为 backend `15099`、frontend `5173`，也可使用上一节的参数选择其他端口。如果任一实际端口被占用，脚本会安全失败并提示端口，不会终止未知进程；Windows excluded/reserved port 即使没有监听进程也可能在启动时失败。

完整 Demo 停止后可再次运行：

```text
Run #1 → migration/seed → HTTP smoke → Ctrl+C
Run #2 → migration no-op/seed idempotent → HTTP smoke
```

## Demo account

```text
username: admin
password: 12346
```

这是 canonical Community seed 的虚构本地账号，仅用于 Community Demo / 本地体验，不是生产环境默认管理员。正式部署请修改密码或创建独立管理员账号。

## Troubleshooting

- **Python not found / version too old**：安装 Python 3.10+，重新执行入口脚本。
- **Node.js not found / version too old**：安装 Node.js 22.13+（包含 npm），重新执行入口脚本。
- **依赖安装失败**：查看终端中对应的 `pip` 或 `npm ci` 错误；脚本不会尝试系统级安装。
- **端口冲突**：停止占用实际 backend/frontend 端口的你自己的服务后重试；如果 `15099` 报 `WinError 10013`，改用其他未被占用的端口，例如 `-BackendPort 15100` 或对应的 `--backend-port 15100`；bootstrap 不会自动杀进程。
- **frontend 返回 API 错误**：确认 backend 已在所选 backend 端口 ready；默认可直接请求 `http://127.0.0.1:15099/api/portal/stats` 检查 API。
- **数据库异常**：确认 `.demo/community-demo/community.sqlite` 是本 Demo 路径。不要把外部 `DATABASE_URL` 改写到 Demo 配置中。

## Manual development workflow

手工流程仍然是受支持的开发路径。后端依赖和前端依赖可按 [DEVELOPMENT.md](../DEVELOPMENT.md) 安装；Community 初始化的 canonical 命令为：

```bash
python backend/scripts/schema_migrate.py apply \
  --profile community_sqlite \
  --config backend/configs/database.community.yaml
python demo/seed_sqlite.py --database <absolute-local-path>/community.sqlite
```

后端默认监听 `127.0.0.1:15099`，使用与生产一致的 ASGI entrypoint；也可以选择与前端配置匹配的其他端口：

```bash
# 默认端口
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 15099

# 自定义端口示例
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 15100
```

默认使用纯 FastAPI/Uvicorn runtime。Flask compatibility mode 与 direct Flask runtime 已退休；应用配置只读取 `APP_*` 名称，旧 `FLASK_*` 名称已移除。

前端另开终端，先确保 lineage workspace 已构建，再使用 `frontend/.env.local` 设置：

```bash
npm --prefix frontend run build:lineage
```

```env
VITE_API_MODE=remote
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=http://127.0.0.1:15099
```

然后运行（默认 frontend `5173`、backend `15099`）：

```bash
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

如果后端使用其他端口，将 `VITE_BACKEND_URL` 改为对应的后端地址；例如使用 `15100` 时，PowerShell 可先执行 `$env:VITE_BACKEND_URL="http://127.0.0.1:15100"`。手工路径中请自行确保 `APP_SECRET_KEY` 已设置、Community SQLite profile 和配置文件不会指向外部数据库。

## 演示数据

- 11 个业务菜单（portal landing page 不占菜单行）
- 30 张 DWD / DWM / DWS 主题表、251 个字段、40 个词根、16 个指标和 10 个 API 资产
- 8 个数据源、8 个上游系统、48 个字段映射、11 类 / 49 项参数字典
- 6 个下游系统、6 个推送作业、8 个报表资产和 3 个手工码值表元数据
- 关系数据包含指标路径、持久化 lineage snapshot/node/edge 和有限血缘示例

执行 Public Data Guard 可检查演示数据和公开仓库安全边界：

```bash
python demo/validate_demo_data.py --strict
```

## PostgreSQL

PostgreSQL 不是 one-command local Demo 的目标。Community PostgreSQL 初始化仍使用受管 migration 和 demo seed，且必须指向隔离的 Community 数据库：

```bash
python backend/scripts/schema_migrate.py apply --profile community_postgres
python demo/seed_postgres.py --dialect postgres
```

请先审阅生成的 SQL，再导入专用数据库。不要把生产连接串、密码或真实数据粘贴到命令、Issue、日志或文档中。

## 模块与部署能力边界

仓库中的 `portal`、`dwm`、`mapping`、`lineage`、`root`、`indicator`、`report`、`apiAsset`、`upstream`、`push`、`codeTable`、`system` 默认使用同一 open module contract：route、menu visibility、repository-module capability contract、schema、seed、search 和 portal statistics 保持一致。Demo seed 会创建这些模块的 canonical tables 和完全虚构的 metadata。

外部 Collector、实际推送、上游连接、数据库驱动、凭据和 persistent lineage storage 是 deployment/integration readiness concerns。它们未配置时，页面/API 展示 metadata、POC 或明确的 not-configured/error state，但不会用 404 隐藏模块。实例管理员仍可通过 `p_menu.status` 配置菜单可见性。

相关文档：

- [开发指南](../DEVELOPMENT.md)
- [部署说明](../DEPLOYMENT.md)
- [架构说明](./architecture.md)
- [模块清单](./modules.md)
