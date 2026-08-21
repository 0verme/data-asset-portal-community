# Community Demo 指南

本指南说明两种本地路径：

- **One-command evaluation/demo**：第一次接触项目时使用 `scripts/demo.sh` 或 `scripts/demo.ps1`，自动完成 SQLite、migration、seed、backend 和 frontend。
- **Manual development workflow**：需要单独调试前后端或迁移时，仍可按文末的手工命令运行。

所有演示数据来自仓库内的虚构全渠道零售数据，不包含真实公司、账号、地址或业务数据。

## Prerequisites

- Python 3.10+
- Node.js 22.13+
- npm 10+

Bootstrap 不会安装系统级 Python、Node.js、npm、Homebrew、Chocolatey 或 apt 包。缺少工具时会给出安装提示。
首次运行时，如果项目依赖不存在，脚本只会在仓库内创建 `backend/.venv` 并执行 `npm ci`；不会执行 global npm install、sudo 或系统级 pip 安装。

## One-command Demo

### Linux/macOS

```bash
./scripts/demo.sh
```

### Windows PowerShell

```powershell
.\scripts\demo.ps1
```

脚本内部使用现有的 Alembic baseline CLI 和 Community seed，并通过 `backend/asgi.py` 以 FastAPI primary + Flask fallback 启动后端，执行：

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
Backend/API: http://127.0.0.1:5099
Demo account:
  username: community_demo
  password: demo-change-me
Database:    <repository>/.demo/community-demo/community.sqlite
Stop: Ctrl+C
```

前端使用 Vite `/api` proxy 访问后端，浏览器不需要再编辑 remote/API 配置。代表性 API 为：

```text
http://127.0.0.1:5099/api/portal/stats
```

### Init-only

CI 或只想初始化数据库时，不启动常驻服务：

```bash
./scripts/demo.sh --init-only
```

```powershell
.\scripts\demo.ps1 -InitOnly
```

该模式会检查 runtime、依赖、Demo 配置、SQLite、migration、seed，并通过 bootstrap 注入前端 remote 配置，然后退出 `0`。
可连续运行多次；第二次会显示 `applied=-`，seed 不会复制用户、资产或关系数据。

## Generated files and safety

所有 bootstrap 生成内容都在 `.demo/community-demo/`，该目录已加入 `.gitignore`：

| Path | Purpose | Gitignored | Secret |
| --- | --- | --- | --- |
| `.demo/community-demo/community.sqlite` | Community 专属 SQLite 数据库 | 是 | 否 |
| `.demo/community-demo/database.yaml` | 仅包含上述 SQLite 路径的 profile | 是 | 否 |
| `.demo/community-demo/flask-secret.key` | 随机 development session secret | 是 | 是 |

脚本不会覆盖或 merge 用户已有的 `.env`、`.env.local`、`backend/.env*` 或 `frontend/.env.local`。
后端 Demo 子进程会显式固定 `community` + `community_sqlite` + 已知本地 SQLite 路径，并隔离继承的
`LINEAGE_DB_PROFILE`、`DATABASE_URL`、`PG*`、`MYSQL_*`、`DB_*` 和 `ASSET_DB_*` 变量；血缘保持 POC/in-memory 模式，因此不会因为用户 shell 或配置文件中的外部数据库设置而连接生产库。

默认不提供 destructive reset。若要重新开始，请在确认路径确实是本 bootstrap 创建的
`.demo/community-demo/` 后，手工移除该目录，再重新运行命令；不要删除用户 `.env` 或其他 SQLite 文件。

## Stop and repeat

完整 Demo 运行时按 `Ctrl+C`。Bootstrap 只会终止它自己创建的 backend/frontend child process；不会按进程名杀掉其他 Python、Node 或 Vite 进程。

端口固定为 backend `5099`、frontend `5173`。如果任一端口被占用，脚本会安全失败并提示端口，不会终止未知进程。

完整 Demo 停止后可再次运行：

```text
Run #1 → migration/seed → HTTP smoke → Ctrl+C
Run #2 → migration no-op/seed idempotent → HTTP smoke
```

## Demo account

```text
username: community_demo
password: demo-change-me
```

这是 canonical Community seed 的虚构本地账号，不是生产凭据。不要在共享环境或部署环境复用它。

## Troubleshooting

- **Python not found / version too old**：安装 Python 3.10+，重新执行入口脚本。
- **Node.js not found / version too old**：安装 Node.js 22.13+（包含 npm），重新执行入口脚本。
- **依赖安装失败**：查看终端中对应的 `pip` 或 `npm ci` 错误；脚本不会尝试系统级安装。
- **端口冲突**：停止占用 `5099` 或 `5173` 的你自己的服务后重试；bootstrap 不会自动杀进程。
- **frontend 返回 API 错误**：确认 backend 已在 `5099` ready；直接请求 `/api/portal/stats` 检查 API。
- **数据库异常**：确认 `.demo/community-demo/community.sqlite` 是本 Demo 路径。不要把外部 `DATABASE_URL` 改写到 Demo 配置中。

## Manual development workflow

手工流程仍然是受支持的开发路径。后端依赖和前端依赖可按 [DEVELOPMENT.md](../DEVELOPMENT.md) 安装；Community 初始化的 canonical 命令为：

```bash
python backend/scripts/schema_migrate.py apply \
  --profile community_sqlite \
  --config backend/configs/database.community.yaml \
  --modules portal,dwm,mapping,lineage,root,indicator,apiAsset,system
python demo/seed_sqlite.py --database <absolute-local-path>/community.sqlite
```

后端默认监听 `127.0.0.1:5099`，使用与生产一致的 ASGI entrypoint：

```bash
python -m uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

默认 `BACKEND_RUNTIME=fastapi`；如需专门验证兼容模式，可设置 `BACKEND_RUNTIME=flask`。直接 `python backend/run.py` 仅用于 Flask development / emergency rollback。

前端另开终端，使用 `frontend/.env.local` 设置：

```env
VITE_API_MODE=remote
VITE_API_BASE_URL=/api
VITE_BACKEND_URL=http://127.0.0.1:5099
```

然后运行：

```bash
npm --prefix frontend run dev
```

手工路径中请自行确保 `FLASK_SECRET_KEY`、Community SQLite profile 和配置文件不会指向外部数据库。

## 演示数据

- 30 张 DWD / DWM / DWS 主题表
- 251 个字段、40 个词根、16 个指标和 10 个 API 资产
- 8 个数据源、48 个字段映射、9 类 / 33 项参数字典
- 关系数据包含指标路径和有限血缘示例

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

## 可选模块的边界

Community profile 默认禁用 `upstream`、`push`、`report` 和 `codeTable`。这些模块源码仍按 Apache-2.0 License 提供，但默认运行时不注册对应路由、菜单或 Community migration 表。

相关文档：

- [开发指南](../DEVELOPMENT.md)
- [部署说明](../DEPLOYMENT.md)
- [架构说明](./architecture.md)
- [模块清单](./modules.md)
