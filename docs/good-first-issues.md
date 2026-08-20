# Good First Issue backlog 提案

本文件是经过仓库审计后的本地提案，不会自动创建公开 Issue。每个候选都应在创建前由 maintainer 再确认当前代码状态和优先级；不要把本文件中的数量当作已创建 Issue 数量。

这些候选刻意避开 #16、#18、#20 以及相关 FastAPI / SQLAlchemy / 数据库架构 epic。它们覆盖 frontend、backend/tests、docs 和 demo/tooling，均不需要内部基础设施。

## 1. Improve unified-search no-result recovery

- **Category**：frontend
- **Title**：`feat(frontend): improve unified search no-result recovery`

### Background

统一搜索在没有结果时只有文字提示；首次使用者无法直接清空查询或回到可搜索状态，尤其是在 scope 筛选后不容易发现下一步。

### Files to start

- `frontend/src/components/SearchPortalPage.jsx`
- `frontend/src/styles/search.css`
- `frontend/src/components/SearchPortalPage.test.js`（新测试文件）

### Scope

为 no-result state 增加一个可访问的“清空搜索”操作，保留当前 scope；补充一个 source-level regression test，覆盖按钮文案、事件和 `aria` 语义。

### Out of scope

不改变搜索 API、后端查询语义、scope 列表、搜索结果排序或视觉 token。

### Acceptance Criteria

- 无结果状态清楚说明查询词和下一步操作。
- 点击操作后输入框、已提交查询和结果状态一致清空。
- 按钮有可见中文文案和可访问名称。
- 现有搜索结果和错误状态不受影响。

### How to test

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

### Maintainer notes

复用现有 `EmptyState` 或 `search.css` 的 token，不新建颜色/圆角变量；不要为了这个 Issue 引入 React testing library 或其他依赖。

## 2. Add accessible labels to asset-reference pickers

- **Category**：frontend
- **Title**：`fix(frontend): label asset reference search inputs`

### Background

报表和 API 资产编辑器中的关联表/关联指标搜索框主要依赖 placeholder 识别，屏幕阅读器用户缺少稳定的字段名称。

### Files to start

- `frontend/src/components/common/AssetReferenceSelector.jsx`
- `frontend/src/components/views/ApiAssetView.test.js`
- `frontend/src/components/report/ReportEditor.jsx`

### Scope

为两个 picker 搜索 input 增加稳定的 `label` 或等价 `aria-label`，并在 disabled/readonly 状态保持现有行为；增加 source-level regression assertions。

### Out of scope

不改变候选项过滤算法、关联数据 payload、接口或 picker 的布局。

### Acceptance Criteria

- “关联表”和“关联指标”搜索框均有唯一、准确的可访问名称。
- 名称不依赖动态候选数量或用户输入。
- 正常、disabled、readonly 三种状态仍可构建。
- 测试能在缺少浏览器和私有数据的环境运行。

### How to test

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

### Maintainer notes

优先使用原生 `label` / `aria-label`；不要引入无障碍依赖或重写公共 picker。

## 3. Reuse the shared empty state in operation logs

- **Category**：frontend
- **Title**：`refactor(frontend): use shared empty state for operation logs`

### Background

`OperationLogPage` 目前直接复制 `.empty` markup，而其他页面使用公共 `EmptyState`。重复结构容易造成按钮、语义和文案行为漂移。

### Files to start

- `frontend/src/components/OperationLog/OperationLogPage.jsx`
- `frontend/src/components/common/StateCards.jsx`
- `frontend/src/components/OperationLog/operationLogQuery.test.js`

### Scope

将操作日志无结果分支改为使用现有 `EmptyState`，保留当前中文文案；如果需要，补充 reset-filter action，但不要改变加载和错误分支。

### Out of scope

不修改操作日志 API、分页、筛选字段、详情弹窗或 CSS token。

### Acceptance Criteria

- 无日志时使用共享空态组件，不再复制 `.empty` 结构。
- 筛选无结果和真正没有日志都不会显示错误状态。
- 现有 reset filter 行为（如实现 action）可验证。
- frontend tests 和 build 通过。

### How to test

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

### Maintainer notes

先阅读 `StateCards.jsx` 的公共 API；保持项目现有中文文案和 React 代码风格，不新增组件变体。

## 4. Make API-asset empty states actionable

- **Category**：frontend
- **Title**：`fix(frontend): clarify API asset empty-state guidance`

### Background

API 资产页对“没有数据”和“筛选没有结果”都只显示标题，首次贡献者和使用者无法判断应该清空筛选还是新增资产。

### Files to start

- `frontend/src/components/views/ApiAssetView.jsx`
- `frontend/src/components/views/ApiAssetView.test.js`
- `frontend/src/components/common/StateCards.jsx`

### Scope

区分 query/filter empty 与 truly empty 的说明；在已有 `EmptyState` 能力范围内补充最小的下一步文案或新增操作入口。

### Out of scope

不修改 API 资产数据模型、筛选参数、保存接口、权限模型或通用卡片组件结构。

### Acceptance Criteria

- 有筛选词时提示如何调整或清空筛选。
- 无任何 API 资产时提示当前用户可执行的合法下一步。
- 不改变列表、卡片和分组视图的结果集合。
- 有对应 regression test，`npm test` 和 build 通过。

### How to test

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

### Maintainer notes

只使用 `app.css` 已有 token 和公共 `EmptyState` API；如果新增按钮，必须遵循现有权限和 `apiAsset.create` 入口。

## 5. Cover unified-search query validation with backend tests

- **Category**：backend/tests
- **Title**：`test(search): cover empty scope and limit validation`

### Background

统一搜索路由接受 `q`、scope alias 和 limit。现有测试覆盖 disabled visibility 与 module alias，但对空查询、未知 scope 和边界 limit 的行为缺少直接回归约束。

### Files to start

- `backend/app/routes/search.py`
- `backend/app/services/search_provider.py`
- `backend/tests/test_search_visibility.py`

### Scope

根据当前实现确认并补充 route/provider tests，明确空查询、未知 scope、非数字 limit、超过最大 limit 的返回结构或错误状态；如实现当前行为不一致，只做最小修复。

### Out of scope

不改搜索 SQL、排序、索引、Provider 注册机制或 disabled module policy。

### Acceptance Criteria

- 每个边界输入都有一个可读的测试名称。
- 测试断言 status code、`scope`、`groups`/`total` 或统一 error contract。
- 不连接真实数据库，不依赖环境变量以外的私有服务。
- 完整 backend tests 通过。

### How to test

```bash
python -m unittest discover -s backend/tests -p "test_search_visibility.py"
python -m unittest discover -s backend/tests
```

### Maintainer notes

先以测试固定仓库当前意图，再判断是否需要修复；不要把未知 scope 静默映射成全量搜索。

## 6. Strengthen demo seed relation regression coverage

- **Category**：backend/tests
- **Title**：`test(demo): cover API and mapping relation integrity`

### Background

`demo/validate_demo_data.py` 已有关系检查，但 SQLite seed 测试还可以更直接地证明 API 资产引用已存在系统、字段映射引用已存在数据源，避免“静态 guard 通过、seed 后关系断裂”。

### Files to start

- `backend/tests/test_demo_seed.py`
- `demo/seed_loader.py`
- `demo/datasets/api_assets.json`
- `demo/datasets/mappings.json`

### Scope

在现有临时 SQLite 流程中增加 relation assertions，覆盖 API → system、mapping → data source，以及现有 Community-only 表边界。

### Out of scope

不新增 demo 数据、不修改 seed schema、不把可选模块 dataset 写入 Community 表，也不修改 demo 账号。

### Acceptance Criteria

- 关系断裂时测试给出包含业务 key 的失败信息。
- 重复 seed 后关系测试仍通过。
- 可选模块表边界断言保持不变。
- strict guard 和 backend demo tests 通过。

### How to test

```bash
python -m unittest discover -s backend/tests -p "test_demo_seed.py"
python demo/validate_demo_data.py --strict
```

### Maintainer notes

复用 `test_demo_seed.py` 的临时数据库和 dataset helper；不要连接 PostgreSQL 或任何共享数据库。

## 7. Add focused API request/response examples

- **Category**：docs
- **Title**：`docs(api): add copyable asset and search examples`

### Background

`docs/api-contract.md` 已描述统一格式和端点，但新贡献者仍需要在多个 frontend API 文件之间来回寻找一个最小请求/响应示例。

### Files to start

- `docs/api-contract.md`
- `frontend/src/api/assets.js`
- `frontend/src/api/search.js`
- `backend/app/routes/assets.py`
- `backend/app/routes/search.py`

### Scope

为一个只读 asset endpoint 和 unified search endpoint 增加脱敏、可复制的 HTTP 请求与最小响应示例，并链接到现有章节。

### Out of scope

不扩展 API、不改变 response shape、不添加真实连接串、真实业务数据或巨型 JSON fixture。

### Acceptance Criteria

- 示例中的 method、path、query parameter 与实现一致。
- 示例 JSON 与现有 API contract 一致，所有数据均为仓库虚构数据或通用占位符。
- 文档链接、代码块和中英文术语保持一致。

### How to test

```bash
git diff --check
python demo/validate_demo_data.py --strict
```

### Maintainer notes

实现前先以 route 和 frontend client 为 source of truth；示例不应承诺未验证的认证或数据库行为。

## 8. Document PostgreSQL migration verification checklist

- **Category**：docs
- **Title**：`docs(database): document PostgreSQL migration verification checklist`

### Background

PostgreSQL 是 Community 与完整部署的主要目标库，仓库已有 migration CLI、方言 SQL 和测试，但贡献者需要一份短 checklist 判断“offline verify 通过”与“隔离数据库 apply 通过”的区别。

### Files to start

- `backend/migrations/README.md`
- `DEVELOPMENT.md`
- `docs/architecture.md`
- `backend/scripts/schema_migrate.py`

### Scope

补充 PostgreSQL 贡献验证顺序：offline verify → plan → fresh apply → seed → repeat apply no-op，并明确 profile、隔离库、凭据脱敏和 PostgreSQL integration 的前置条件。

### Out of scope

不修改 migration runner、SQL、数据库支持范围或新增数据库方言。

### Acceptance Criteria

- 每个命令都存在于当前 CLI，参数与实现一致。
- 文档明确不得使用生产库，且不要求提交配置文件。
- 与现有 `docs/first-contribution.md`、`DEVELOPMENT.md` 互相链接而不复制完整环境变量表。

### How to test

```bash
git diff --check
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python demo/validate_demo_data.py --strict
```

### Maintainer notes

只记录仓库已经支持的流程；不要把 SQLAlchemy/Alembic 或 OS-03 demo 作为前置依赖。

## 9. Test generated demo SQL against the manifest

- **Category**：demo/tooling
- **Title**：`test(demo): verify generated SQL covers every manifest dataset`

### Background

`demo/generate_demo_sql.py` 和 `demo/manifest.json` 共同定义 SQL demo 输出，但当前没有直接测试确保每个 manifest dataset 都生成对应 SQL 文件和 `all-datasets.sql` include。

### Files to start

- `demo/generate_demo_sql.py`
- `demo/manifest.json`
- `backend/tests/test_demo_seed.py` 或新的 `backend/tests/test_demo_sql_generation.py`

### Scope

在临时输出目录运行 generator，并断言 manifest 中每个 dataset 都有对应 `.sql` 文件，入口 SQL 引用了这些文件；同时覆盖空/损坏 manifest 的明确失败行为（如当前 CLI 已定义）。

### Out of scope

不改变 SQL 方言渲染、不写入 tracked `demo/` 文件、不改变 seed dataset 或生成一键启动脚本。

### Acceptance Criteria

- 测试不污染仓库，不依赖 PostgreSQL。
- manifest 新增 dataset 时测试能发现遗漏。
- 生成器现有命令行输出和默认 git-ignored 目录行为不变。

### How to test

```bash
python -m unittest discover -s backend/tests -p "test_demo_sql_generation.py"
python demo/generate_demo_sql.py --output tmp/gfi-demo-sql
python demo/validate_demo_data.py --strict
```

### Maintainer notes

使用 Python 标准库 `tempfile`/`pathlib`；不要为该测试引入第三方包，也不要把输出目录提交进 Git。

## 10. Add a repository-local Markdown link check

- **Category**：demo/tooling
- **Title**：`chore(ci): check relative Markdown links`

### Background

README、贡献指南和 docs 之间的入口越来越多，手工检查容易遗漏重命名文件造成的 broken link。项目目前没有专门的 Markdown link check。

### Files to start

- `.github/workflows/ci.yml`
- `scripts/`（新增标准库脚本）
- `README.md`
- `CONTRIBUTING.md`

### Scope

使用 Python 标准库实现一个只检查仓库内相对 Markdown 文件链接的轻量脚本，并在 CI 中运行；忽略外部 URL、anchor 语义解析和生成的 dist/node_modules。

### Out of scope

不引入 npm/Python 依赖、不访问私有网络、不修改外部链接、不重构现有 workflow 权限，也不改变 README 内容以规避失败。

### Acceptance Criteria

- 缺失的相对文件链接会使脚本以非零状态退出并指出源文件/目标。
- 已存在的 `.md`、图片和模板链接通过。
- CI job 在没有数据库、secret 或 GitHub write token 的环境可运行。
- 本地命令和 CI 命令在 `CONTRIBUTING.md` 中有说明。

### How to test

```bash
python scripts/check_markdown_links.py
python demo/validate_demo_data.py --strict
```

### Maintainer notes

必须使用标准库最小实现，先审查现有链接类型和 CI job 边界；不要把这个 Issue 扩展成全站 URL crawler。
