# Good First Issue 候选池

本文件是 maintainer backlog，反映 `main`（OS-03 已通过 #33 合并）上的真实候选状态。

发布标准：任务必须有明确入口、有限文件范围、可独立 PR、可公开验证，并且不要求贡献者先做架构设计。公开 Issue 以中文为主，GitHub labels 使用仓库已有英文标签。

## 已发布

### #34 优化搜索无结果时的恢复提示

- Area: `area/frontend`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/34>
- Labels: `good first issue`, `area/frontend`
- 入口: `frontend/src/components/SearchPortalPage.jsx`
- 备注: 保留当前搜索请求、URL 同步和 scope 行为；使用 Community Demo 可复现。

### #35 为关联资产搜索框补充 accessibility label

- Area: `area/frontend`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/35>
- Labels: `good first issue`, `area/frontend`
- 入口: `frontend/src/components/common/AssetReferenceSelector.jsx`
- 备注: 共享 picker 同时服务 API 资产和报表引用；Community Demo 的 API 资产页面可验证。

### #36 为统一搜索补充参数边界测试

- Area: `area/backend`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/36>
- Labels: `good first issue`, `area/backend`
- 入口: `backend/app/services/search_provider.py`、`backend/tests/test_search_visibility.py`
- 备注: 只补充 query、limit 和 scope alias 的 regression/boundary tests，不改变 production behavior。

### #37 为 API 契约补充可复制的请求与响应示例

- Area: `area/docs`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/37>
- Labels: `good first issue`, `area/docs`
- 入口: `docs/api-contract.md`，以 `backend/app/routes/assets.py`、`backend/app/routes/search.py` 和 frontend API client 为 source of truth。
- 备注: 只读文档改动，不新增接口或真实数据。

### #38 补充 PostgreSQL migration 验证 checklist

- Area: `area/docs`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/38>
- Labels: `good first issue`, `area/docs`
- 入口: `backend/schema/README.md`、`backend/scripts/schema_migrate.py`、`docs/first-contribution.md`。
- 备注: 只记录当前 CLI 和隔离数据库验证顺序，不修改 Alembic baseline 或数据库架构。

### #39 为生成的 Demo SQL 补充 manifest 覆盖测试

- Area: `area/demo`
- 状态: Open，未认领
- GitHub: <https://github.com/0verme/data-asset-portal-community/issues/39>
- Labels: `good first issue`, `area/demo`
- 入口: `demo/generate_demo_sql.py`、`demo/manifest.json`、新测试 `backend/tests/test_demo_sql_generation.py`。
- 备注: OS-03 已覆盖 bootstrap 幂等性和 runtime 隔离；本 Issue 只测试 manifest 与生成 SQL 文件的覆盖关系。

## 待发布候选

这些候选经过当前 `main` 审计，问题仍然存在且范围基本清楚，但没有放入首批六项；后续发布前仍需再次确认是否已有相似 Issue 或 PR。

### 统一操作日志空状态复用共享组件

- Area: `area/frontend`
- 当前入口: `frontend/src/components/OperationLog/OperationLogPage.jsx`、`frontend/src/components/common/StateCards.jsx`
- 状态: 待排期
- 原因: 当前仍直接渲染 `.empty`，而共享 `EmptyState` 已存在；可独立修改，但首批优先选择了搜索恢复和 accessibility 任务。

### 优化 API 资产空状态提示

- Area: `area/frontend`
- 当前入口: `frontend/src/components/views/ApiAssetView.jsx`、`frontend/src/components/common/StateCards.jsx`
- 状态: 待排期
- 原因: 当前 `ApiEmptyState` 只传标题，筛选无结果与真正没有资产的下一步提示仍可改善；与其他 Empty State 任务相近，暂不与首批混发。

### 补充 Community Demo seed 关系完整性回归测试

- Area: `area/backend`
- 当前入口: `backend/tests/test_demo_seed.py`、`demo/seed_loader.py`、`demo/datasets/api_assets.json`、`demo/datasets/mappings.json`
- 状态: 待重新拆分
- 原因: `demo/validate_demo_data.py` 已有静态关系校验，OS-03 又新增了 seed 幂等性和 Community 边界测试；若继续发布，应只补充数据库落库后的 API → system、mapping → data source 断言，避免与现有覆盖重复。

## 已跳过 / 不作为 Good First Issue

### 原候选 10：仓库内 Markdown 相对链接检查

原因：需要同时新增 Python parser、修改 CI workflow、补充贡献文档并定义仓库级链接语义，文件面和 CI 边界偏大，不适合作为首批第一次贡献。后续如拆成独立的标准库脚本测试 Issue，可重新审计。

### 原候选中的数据库 / 架构方向

FastAPI migration、DB Provider / SQLAlchemy redesign、Alembic migration architecture、MySQL Provider、RBAC 和认证架构均继续由现有架构 Issue 或 maintainer backlog 处理，不标记为 `good first issue`。

## 原 10 个候选审计记录

1. **frontend：统一搜索无结果恢复** — `REWRITE → #34`
   - 当前问题仍存在；`SearchPortalPage.jsx` 只有 no-result 文案，没有恢复操作。
   - 原提案引用的测试文件不存在，已改为明确的 source-level test 方向和真实 Demo 验证方式。

2. **frontend：关联资产搜索框 accessibility label** — `REWRITE → #35`
   - 当前共享 `Picker` 的搜索 input 没有 `label` 或 `aria-label`。
   - 原提案的入口和测试范围不准确，已收敛到共享组件和 API 资产公开 Demo 入口。

3. **frontend：操作日志复用共享空状态** — `KEEP，待发布`
   - `OperationLogPage.jsx` 仍复制 `.empty` markup，`StateCards.jsx` 已提供 `EmptyState`。
   - 范围清楚，但与首批 frontend 空状态任务相近，暂缓发布。

4. **frontend：API 资产空状态提示** — `KEEP，待发布`
   - `ApiEmptyState` 当前只有标题，仍可区分筛选无结果和无资产两种场景。
   - 任务可做但优先级和首批容量有限，暂缓发布。

5. **backend/tests：统一搜索参数边界测试** — `REWRITE → #36`
   - 当前已有 visibility、alias 和 disabled module 测试，但缺少空 query、无效/越界 limit 的直接断言。
   - 原提案对未知 scope 的期望与当前实现不一致，已移除该设计争议，只固定现有参数归一化行为。

6. **backend/tests：Demo 关系完整性回归测试** — `REWRITE，待重新拆分`
   - 当前 static guard 和 OS-03 测试已覆盖部分关系/seed 边界。
   - 仍可能补充落库后的关系断言，但必须避免与既有测试重复，因此不放入首批。

7. **docs：API 请求/响应示例** — `REWRITE → #37`
   - `docs/api-contract.md` 缺少可直接复制的最小 HTTP 请求示例。
   - 已依据当前 routes 和 frontend API client 收敛为只读、脱敏、文档-only 任务。

8. **docs：PostgreSQL migration 验证 checklist** — `REWRITE → #38`
   - 当前流程分散在 migration README、首次贡献指南和开发指南中，缺少短 checklist。
   - CLI 命令已在当前 `schema_migrate.py` 中确认存在；Issue 明确隔离数据库和不使用生产库。

9. **demo/tooling：生成 SQL 与 manifest 覆盖测试** — `REWRITE → #39`
   - `demo/generate_demo_sql.py` 和 `demo/manifest.json` 当前没有对应的自动覆盖测试。
   - OS-03 没有覆盖该关系，保留为独立、标准库、临时目录测试任务。

10. **demo/tooling：仓库内 Markdown 相对链接检查** — `SKIP`
    - 需要脚本、CI 和文档联动，超出首批 Good First Issue 的小 PR 边界；不是当前发布阻塞。

## 审计边界

- 基线：`origin/main` / `55fdf50`，包含已合并的 OS-03 #33。
- GitHub 当前未发现已有 `good first issue` 或与上述六项高度相似的 open Issue。
- 六个已发布 Issue 均未分配给任何用户，未添加 `priority:P0`。
