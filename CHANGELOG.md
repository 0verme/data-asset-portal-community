# 更新日志 · Changelog

本文档记录 Data Asset Portal 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

本文不是 Git 提交历史，而是基于仓库状态整理的阶段性变更摘要。

## [0.1.1] - 2026-08-23

正式发布的 v0.1.1 收口了 FastAPI Native 唯一运行时、Database Provider / SQLAlchemy Core / Alembic 数据层、MySQL 8 + PyMySQL acceptance、Metadata Ingestion Contract、open repository module contract，以及 permission-based RBAC（后端权限强制、角色管理和单角色用户绑定）。同时完成 backend configuration surface 收敛：`APP_*` 为主配置名，旧 `FLASK_*` 仅作兼容 fallback 名称。

## [Unreleased]

## [0.2.0] - 2026-08-25

### 安全与认证（Security）

- 退休剩余 Flask authentication/runtime compatibility surface；FastAPI Native signed-session 成为唯一当前认证运行面，并保留有界的旧 cookie 只读迁移以维持会话连续性。
- 普通业务读取接口默认要求认证；写操作、管理操作和敏感读取继续由 permission-based RBAC 强制授权。
- 增加按用户名与请求上下文身份计数的登录失败 backoff，限制短时间重复失败但不永久锁定账号。
- 在 ASGI 层执行请求体大小上限，超限请求返回统一的 `413` 错误契约。
- 收紧 production OpenAPI 暴露策略：生产默认不注册 `/docs`、`/redoc` 和 `/openapi.json`；仅显式 `APP_ENV=development` 开启。
- 统一审计 actor identity，并继续以安全回归测试固化 RBAC route enforcement、认证边界和 Community 数据边界。

### 运行时与架构（Changed）

- FastAPI Native-only runtime 稳定为 `Uvicorn → backend/asgi.py → FastAPI`；健康检查只报告当前 native runtime 状态。
- 建立 module-level `APIRouter` convention pilot，并固化 public/stable route registration contract。
- 收敛 Module、Capability 与 Readiness 职责：仓库模块默认注册，数据库、驱动、凭据和外部 storage readiness 通过诊断/error contract 表达，不作为 Edition 或 route gate。
- 兼容 FastAPI `0.141.1`、Pydantic `2.13.4` 和 Uvicorn `0.52.4`，并同步 backend runtime dependency baseline。

### 数据库与迁移（Changed）

- 退休 legacy service SQL path，统一通过 Database Provider、SQLAlchemy Core 和 Alembic/schema canonical source 访问与初始化数据库。
- 刷新 SQLAlchemy `2.0.52`、Alembic `1.19.1` 与 PyMySQL `1.2.0`；PostgreSQL / MySQL contract 由 CI integration jobs 验证。
- 本版本未新增不可逆数据库 schema migration；新库仍使用 canonical baseline + Alembic head，既有库升级前应先执行 schema verify。

### 前端工程化（Changed）

- 升级 Vite 至 `8.2.2`、`@vitejs/plugin-react` 至 `6.1.0`，并保持 ESLint quality gate。
- 完成 App routing/navigation decomposition 与增量 TypeScript boundary，重新建立 lineage workspace source/dist 构建契约。

### 兼容性说明（Upgrade Notes）

- Legacy Flask authentication compatibility surface has been removed. Deployments must use `uvicorn backend.asgi:app` and the current `APP_*` configuration names.
- Business read APIs now require authentication where applicable; existing RBAC rules still govern writes, administration and sensitive reads.
- Review [DEPLOYMENT.md](./DEPLOYMENT.md) and [backend/.env.example](./backend/.env.example), especially `APP_SECRET_KEY`, `APP_ENV`, OpenAPI exposure and request-size settings.
- Fresh Community/local databases use `backend/schema` + Alembic + demo seed. For existing databases, verify the schema before applying the current head; this release does not provide a general database downgrade.
- ESLint 10 is intentionally not included because upstream `eslint-plugin-react` peer compatibility does not yet cover ESLint 10.

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
- **系统管理**：后台用户管理（启用 / 禁用、重置密码）、参数字典管理。
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
