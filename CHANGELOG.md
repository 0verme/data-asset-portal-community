# 更新日志 · Changelog

本文档记录 Data Asset Portal 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

本文不是 Git 提交历史，而是基于仓库状态整理的阶段性变更摘要。

## [0.1.1] - 2026-08-23

正式发布的 v0.1.1 收口了 FastAPI Native 唯一运行时、Database Provider / SQLAlchemy Core / Alembic 数据层、MySQL 8 + PyMySQL acceptance、Metadata Ingestion Contract、open repository module contract，以及 permission-based RBAC（后端权限强制、角色管理和单角色用户绑定）。同时完成 backend configuration surface 收敛：`APP_*` 为主配置名，旧 `FLASK_*` 仅作兼容 fallback 名称。

## [Unreleased]

### 运行时与数据层（Changed）

- FastAPI Native runtime 已收口为唯一当前入口：Uvicorn → `backend/asgi.py` → FastAPI；`/healthz` 固定报告 `runtime=fastapi`、`fastapiPrimary=true`、`flaskFallback=false`。
- Flask / Flask-Cors runtime dependency、WSGI fallback、Waitress 和 runtime switch 已退休；`Werkzeug`、`itsdangerous` 与 `FLASK_*` 名称仅因密码哈希、signed-session/security configuration contract 保留。
- Database Provider、SQLAlchemy Core 与 Alembic baseline/forward migration 已成为当前数据库访问与 Community/local 初始化路径；`docs/pg` / `docs/dws` 保留为 full/extension deployment 的补充 DDL。
- 建立版本化 Metadata Ingestion Contract：外部 Collector 通过 `/api/metadata` 批量提交 Asset / Lineage snapshot；支持 source-scoped idempotency、dry-run、replace activation、audit summary 和 ingestion status query，不暴露内部 database schema。

### Repository Truth（Documentation）

- 对齐 README、Architecture、Deployment、Development、API Contract、Modules、Community Demo、Screenshots 与 generated architecture artifact 的当前 FastAPI/Uvicorn、schema/migration、Demo 和版本语义。
- 明确 published `v0.1.1`、application/package version sync debt 与独立线上 mock bundle `V1.0.0` 的区别；已发布的 `[0.1.0]` 历史章节保持不变。
- Issue #116 已移除 Community / Private / Optional artificial runtime gating；仓库已有模块统一进入 open-by-default runtime、schema、seed、search 和 portal statistics contract。

### 优化（Changed）

- 前端完成组件化拆分：页面视图收敛到 `components/views/`、侧边栏收敛到 `components/sidebar/`，业务逻辑抽取为 `hooks/` 下的领域 hook（`useAssetModule`、`useRootModule`、`useIndicatorModule`、`usePushModule`、`useUpstreamModule`、`useSystemModule` 等）。
- 统一交互反馈：新增公共 `ConfirmDialog` / `confirmDelete` 确认弹窗与 toast 提示组件（`components/common/`），全面禁用原生 `alert` / `confirm`。
- 整理项目文档体系：重构 `README.md`，新增根级 `CHANGELOG.md` / `DEPLOYMENT.md` / `DEVELOPMENT.md`，对齐 `docs/` 下各文档。

## [0.1.0]

首个社区版本（Community Edition），聚焦"元数据可见、可查、可维护"。

### 新增（Added）

- **CI 质量门禁（GitHub Actions）**：`pull_request` + `main` 推送自动运行——仓库数据安全 Guard（BLOCKER / SUSPICIOUS 必须为 0）、后端单元测试（Python 3.11 / 3.13）、PostgreSQL 16 集成（fresh migration → seed → integration → repeat apply no-op）、前端 `npm ci` / test / build（Node 22 / 24）、SQLite Community 迁移契约与物理边界检查（Private 表不得出现）。
- **依赖安全策略**：`SECURITY.md`（漏洞私下报告流程）、`Dependabot`（npm / pip / GitHub Actions 每周更新）、npm audit 门禁（Critical / High = 0）。
- **贡献模板**：Issue（bug / feature）与 Pull Request 模板（含敏感数据与 Community 边界自查项）。
- **本地发布检查**：`python scripts/release_check.py fast|full`，一条命令复现 CI 关键检查。

### 新增（Added）

- **数据仓库**：DWM 表资产列表、详情、字段、DDL，支持新增 / 编辑 / 删除。
- **字段映射**：字段视图、表视图、统计卡片、CSV 导出（以查询治理为主，无前端编辑入口）。
- **词根管理**：列表、分类、新增 / 编辑 / 删除、批量导入（含预览）。
- **指标维护**：列表、详情、新增 / 编辑 / 启停 / 删除，支持维度与状态筛选。
- **上游卸数**：系统列表、详情、新增 / 编辑 / 启停 / 删除，支持多卸数时间点。
- **下游推送**：系统管理、作业管理、作业字段管理。
- **系统管理**：后台用户管理（启用 / 停用 / 锁定、重置密码）、参数字典管理。
- **认证**：登录、当前用户、登出（mock 演示登录 / 数据库真实登录）。
- **通用码值**：上游 / 下游选项由参数字典驱动（数据库类型、部门、推送协议、认证方式、分隔符、频率、编码、频率类型、系统状态等）。
- **数据库脚本**：按模块拆分维护两套 SQL（`docs/pg/` PostgreSQL、`docs/dws/` GaussDB / DWS），覆盖 common-codes、assets、field-mappings、indicators、roots、upstream、push、auth。
- **数据库初始化**：手动执行 `docs/pg/` 或 `docs/dws/` 下的模块 DDL（无自动初始化脚本）。

### 优化（Changed）

- **运行模式精简（4 → 1）**：前端收敛为唯一开关 `VITE_API_MODE=mock|remote`，同时决定数据来源与认证方式（`src/auth.js` 的 `AUTH_MODE` 跟随它）；后端始终连库、无模式开关。
- **前端构建链升级**：Vite 5 → 7、`@vitejs/plugin-react` 4 → 5（修复 vite/esbuild 安全公告，`npm audit` 清零），并声明 Node engines `>=22.13.0`。
- **版本元数据对齐**：`frontend/package.json` 与 README / CHANGELOG 统一为 `0.1.0`。

### 移除（Removed）

- 删除前端 `VITE_AUTH_MODE` 开关。
- 删除后端 `ASSET_DATA_SOURCE`、`AUTH_MODE` 开关及各 service 的 mock 分支。
- 删除 `backend/mock_data/` 目录与 `backend/scripts/db_to_mock.py`。

> 公开仓库地址将在社区版发布时确定，届时再补充版本比较链接。
