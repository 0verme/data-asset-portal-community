# 更新日志 · Changelog

本文档记录 Data Asset Portal 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

本文不是 Git 提交历史，而是基于仓库状态整理的阶段性变更摘要。
条目按发布时间倒序排列；最新发布 tag 为 `v0.2.4`。

> **版本元数据说明**：`frontend/package.json` 的 `version` 当前仍为 `0.2.0`，因此页脚显示的
> `V0.2.0` 是前端构建元数据，不等于最新 GitHub Release tag。两者的对齐属于独立事项，不在本文范围内。

## [Unreleased]

### 指标维度目录（Fixed）

- 指标维护页不再使用写死的 8 个零售维度：新增 `GET /api/indicators/dimensions` 从 `p_indicator_item` 真实数据自动发现维度目录，计数与列表接口共用同一套删除标记、权限投影与筛选口径，各维度计数之和恒等于指标总数。
- 维度名称改为配置驱动：参数字典 `INDICATOR_DIMENSION` 分类 → `p_indicator_path_config` 一级路径名称 → 维度码本身（大写展示）。系统不内置任何行业维度中文名，不再把中文标签反向映射成业务码。
- 修复未知维度码被静默过滤的问题：后端维度归一不再把未登记码折叠成空串，前端维度解析新增码值回退，徽标不再显示 `--`；`dimension_code` 为空串的指标归入「未标注维度」桶。
- 侧边栏、分组视图、筛选标签与 `?dimension=` 深链统一改为维度目录驱动，新增业务维度无需改动前端代码。
- 去掉维度写入的业务白名单：删除 `ALLOWED_DIMENSIONS` / `DIMENSION_CODE_MAP` / `DIMENSION_LABEL_MAP` 与「路径配置已声明才能写」的限制，`dimension_code` 只校验通用格式、长度与必要性。DAP 是跨行业通用门户，金融、零售、制造或自定义维度码均通过数据直接接入，不修改代码即可创建、查询、展示、筛选与编辑。
- 保留原有动态维度目录、计数一致性、深链与错误包络；格式非法的 `?dimension=` 不再回退到「未标注」桶，而是不命中任何行。
- 与本变更相关的指标数据未被清理或修改，未重新执行 Seed；SQLite / PostgreSQL / MySQL / GaussDB(DWS) 通用。

### 语义基础设施（Foundation）

- 建立指标稳定资产/字段引用、最小聚合 contract 与 deterministic validation。
- 既有指标只在唯一精确匹配时 backfill，保留原字符串快照。

> 本条目描述的是**指标语义 contract 本身**，它不引入 Embedding 或向量存储。
> 可选 RAG 相关资产推荐与单轮 AI 资产问答是独立的默认关闭能力，已分别随 `v0.2.4` 落地，
> 见下方 `[0.2.4]` 与 [docs/ai-ask-mvp.md](./docs/ai-ask-mvp.md)、
> [docs/semantic-recommendation-roadmap.md](./docs/semantic-recommendation-roadmap.md)。

## [0.2.4] - 2026-11-06

### 搜索与 AI（Added，默认关闭）

- 搜索页新增默认关闭的单轮 AI 数据资产问答（#514），随后补充真实执行阶段进度（#516）、已验证的部分回答（#517）、基于权威元数据的表数统计（#521）、搜索与 AI 问答互斥结果 Tab（#522）、实时 SSE 与有界多查询 RAG 编排（#526）。
- `GET /api/ai/status`、`POST /api/ai/ask`、`POST /api/ai/ask/progress`、`POST /api/ai/ask/stream` 共享同一服务与证据契约；`AI_ASK_ENABLED` 默认 `false`，配置不完整时 fail closed。
- 前端 UI 使用 `/api/ai/ask/stream`；`/api/ai/ask` 与 `/api/ai/ask/progress` 作为兼容接口保留。SSE 只传真实阶段与完整最终结果，不逐 token 输出。
- 新增 `VITE_API_MODE=mock` 专用 AI 演示适配器（#542），Remote 零回退，CI 校验 Remote Bundle 不含 Mock AI 语料。
- 真实 RAG 服务与真实 LLM 端点联调、回答准确率验收仍为 **NOT VERIFIED**。

### 部署与代理（Fixed）

- 纳管 Linux 前端代理并修复 SSE 实时转发（#541）：代理不再按 `select()` 门控 `read1()`，SSE 事件不再被延迟；静态目录索引走与其他路径一致的 realpath 包含检查；上游 `Cache-Control` 在缓冲响应中透传。
- 血缘统一使用 `ASSET_DB_PROFILE`，移除隐式 POC / Mock 回退（#539）：`LINEAGE_DB_PROFILE` 与 `LINEAGE_STORAGE_MODE` 被忽略，无 ACTIVE 快照时返回 `no_active_snapshot` 空状态。

### 数据库与迁移（Fixed）

- AI 问答隔离阻塞 JDBC 执行并移除 RAG 全量快照（#540）。
- 默认管理 Schema 改为 `dap`，移除 PostgreSQL 隐式 `dwp` 回退（#531）。

### 血缘与字段映射（Changed）

- 血缘分析支持动态 Schema 资产导航树（#530）与 Schema 限定节点检索、精确候选选择（#535）。
- 字段映射左侧改为可搜索源系统导航并联动查询（#529）。

### 界面（Fixed）

- 修复全站宽表格裁切，提供横向滚动（#537）。

### 数据库契约（Changed）

- 全站分页 Phase 1–3：指标与报表（#509）、API 资产 / 词根 / 码值表（#518）、系统管理用户 / 角色 / 菜单 / 字典明细（#519）接通数据库分页。

## [0.2.3] - 2026-10-31

### 数据边界（Fixed）

- 将零售演示数据与通用 migration 隔离（#488），避免演示词汇进入通用 DDL / 迁移路径。

### 数据可信性（Changed）

- 统一数据可信性治理（#482）：资产详情、API 表单契约与 WebKit 焦点回归收口（#435）。
- 严格校验 Remote 集合响应格式（#485），字段映射导出补全完整结果（#486），词根导入正确解析 CSV / TSV 引号与多行内容（#487）。
- Remote 编辑器改用已配置的业务选项（#484）。

### 元数据与血缘（Added）

- 实现授权元数据读取与一致性快照契约（#474），见 [catalog-snapshot.md](./docs/catalog-snapshot.md)。
- 指标维度目录改为数据驱动，修复银行 `CUS` / `EMP` / `DUE` / `CON` / `ORG` 维度被静默过滤（#473）。
- 上游系统与下游推送接通数据库分页（#466）。
- 新增共享表格分页适配器（#500）。

### 文档（Added）

- 固化 Windows 内网 npm 镜像安装、构建与部署回滚流程（#476），见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## [0.2.2] - 2026-10-02

### 数据库（Added）

- 补齐 GaussDB/DWS 阶梯式 schema migration（#316）：按 provider capability 逐级应用 forward head。
- GaussDB/DWS fresh-init 兼容性修复：8.1.3 schema reflection（#307）、schema verify 元数据隔离（#306）、fresh-init 兼容缺口（#304）、不生成不支持的物理外键（#303）、补全 baseline 显式分布策略（#302）、按 `profile.schema` 安全执行 migration（#282）、`p_push_job.freq_desc` 扩至 `VARCHAR(1000)`（#317）。
- GaussDB JDBC 按 Java 版本区分 profile（#294），见 [backend/README.md](./backend/README.md#gaussdbdws-jdbc-compatibility-by-java-version)。

### 公共目录（Added）

- 新增可配置 Public Catalog profile（#296）：`PUBLIC_CATALOG_PROFILE=internal|strict|disabled`，展示字段与可搜索字段使用同一策略。
- 门户统计与统一搜索遵循当前数据库 Schema（#311）。
- 打通资产探索最小闭环（#269）。

### 资产身份（Changed）

- 建立 Stable Field Identity 与字段增量同步（#263）、Metadata Ownership 与资产同步 Merge Policy（#266）、统一资产身份与详情精确寻址（#262）。
- 保证整表删除后 stable identity 不被复用（#275）。
- 修复字段映射身份键，支持同源表多目标映射（#301）。

### 前端（Changed）

- 协调升级 React 19 依赖栈（#273）。
- 修复菜单在认证状态变化后不刷新的问题（#287）；优化 header 搜索与身份展示（#293）；稳定响应式全局 header（#312）。

### 安全（Fixed）

- 修复前端 `GHSA-mrhx-c7xc-m3w5` 安全公告（#448）。

## [0.2.1] - 2026-09-05

### 前端工程化（Changed）

- 完成业务模块与 HTTP / API 契约层、常量与数据层、utils、Hooks / Auth / Capabilities / Routing、Common 与共享 UI 组件的 TypeScript 迁移（#229–#236），并完成 TypeScript strict hardening（#241）。
- 修复前端测试递归发现问题，统一 capabilities HTTP 导入方式（#237）。

### 运行时（Changed）

- 后端端口统一为 `15099`，并同步 miniapp 项目设置。

### 演示与认证（Fixed）

- 统一 Community Demo 管理员口令为 `123456`（#285），并澄清 Demo 管理员与生产管理员的区别。
- 修复认证数据源故障的可诊断错误契约（#238）。
- 修复上游卸数新增系统保存失败（#235）并优化表单校验反馈（#234）。
- 修复下游推送远程数据加载。

### 安全（Fixed）

- 收敛小程序可兼容传递依赖安全风险（#239），加固 miniapp 依赖安全（#244）。

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

## [0.1.1] - 2026-08-23

正式发布的 v0.1.1 收口了 FastAPI Native 唯一运行时、Database Provider / SQLAlchemy Core / Alembic 数据层、MySQL 8 + PyMySQL acceptance、Metadata Ingestion Contract、open repository module contract，以及 permission-based RBAC（后端权限强制、角色管理和单角色用户绑定）。同时完成 backend configuration surface 收敛：`APP_*` 为主配置名，旧 `FLASK_*` 仅作兼容 fallback 名称。

## [0.1.0]

首个社区版本（Community Edition），聚焦"元数据可见、可查、可维护"。

### 新增（Added）

- **CI 质量门禁（GitHub Actions）**：`pull_request` + `main` 推送自动运行——仓库数据安全 Guard（BLOCKER / SUSPICIOUS 必须为 0）、后端单元测试（Python 3.11 / 3.13）、PostgreSQL 16 集成（fresh migration → seed → integration → repeat apply no-op）、前端 `npm ci` / test / build（Node 22 / 24）、SQLite Community 迁移契约与物理边界检查（Private 表不得出现）。
- **依赖安全策略**：`SECURITY.md`（漏洞私下报告流程）、`Dependabot`（npm / pip / GitHub Actions 每周更新）、npm audit 门禁（Critical / High = 0）。
- **贡献模板**：Issue（bug / feature）与 Pull Request 模板（含敏感数据与 Community 边界自查项）。
- **本地发布检查**：`python scripts/release_check.py fast|full`，一条命令复现 CI 关键检查。
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

- **运行模式精简（4 → 1）**：前端收敛为唯一开关 `VITE_API_MODE=mock|remote`，同时决定数据来源与认证方式（`src/auth.ts` 的 `AUTH_MODE` 跟随它）；后端始终连库、无模式开关。
- **前端构建链升级**：Vite 5 → 7、`@vitejs/plugin-react` 4 → 5（修复 vite/esbuild 安全公告，`npm audit` 清零），并声明 Node engines `>=22.13.0`。
- **版本元数据对齐**：`frontend/package.json` 与 README / CHANGELOG 统一为 `0.1.0`。

### 移除（Removed）

- 删除前端 `VITE_AUTH_MODE` 开关。
- 删除后端 `ASSET_DATA_SOURCE`、`AUTH_MODE` 开关及各 service 的 mock 分支。
- 删除 `backend/mock_data/` 目录与 `backend/scripts/db_to_mock.py`。

> 公开仓库地址将在社区版发布时确定，届时再补充版本比较链接。
