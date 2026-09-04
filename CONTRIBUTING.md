# 贡献指南 · Contributing

感谢你对数据资产门户的关注！欢迎通过 Issue 与 Pull Request 参与共建。

第一次贡献请先阅读 [首次贡献指南](./docs/first-contribution.md)，它提供从 Fork 到 PR 的最短 walkthrough；本文件保留仓库约定、Issue/PR 规则和标签语义。

## 提交 Issue

在提交前请先搜索是否已有相同 Issue 或 Discussion。提交时请尽量说明：

- **Bug 报告**：复现步骤、期望行为、实际行为、版本/commit、运行模式（`mock` / `remote`）、相关日志（`logs/`）和环境信息
- **功能建议**：实际使用场景、当前问题、期望能力和可能的替代方案；涉及 API、数据库、认证或运行时边界时，请先讨论设计
- **安全漏洞**：不要创建公开 Issue。请按 [SECURITY.md](./SECURITY.md) 使用 GitHub Private Vulnerability Reporting

Issue 模板位于 [`.github/ISSUE_TEMPLATE/`](./.github/ISSUE_TEMPLATE/)。日志、截图和示例中不得包含密码、Token、连接串、内部地址或真实业务数据。

## 提交 Pull Request

1. Fork 仓库，并从最新 `main` 创建特性分支（如 `feat/xxx`、`fix/xxx`、`docs/xxx`）
2. 保持改动聚焦单一主题，不要把架构重写和无关清理混入同一个 PR
3. 本地自测通过后提交 PR，在描述中说明动机、影响范围和准确的测试命令
4. 涉及接口或数据库结构变更时，同步更新 `docs/`，并在 PR 中说明兼容性、迁移和重复应用验证
5. 填写 [PR template](./.github/pull_request_template.md)，逐项完成敏感数据与 Community boundary 自查

仓库提供与 CI 对齐的本地发布检查：

```bash
python scripts/release_check.py fast
```

CI（`.github/workflows/ci.yml`）会运行 Public Data Guard、后端测试、PostgreSQL 集成、前端 lint/typecheck/测试/构建和 Community migration contract。

## 贡献标签语义

标签分为**问题类型/区域**、**协作状态**和**优先级**三类。标签用于帮助分诊，不替代 Issue 正文中的 scope 和验收标准。

### 协作与优先级标签

| 标签 | 语义 |
|------|------|
| `good first issue` | 严格面向第一次贡献者：有明确 scope、无需架构决策、小到中等文件面、已知起始文件、清晰验收标准、可复现测试方法，并且方向已获 maintainer 认可。 |
| `help wanted` | 欢迎社区协助；可以需要数据库、CI、无障碍等领域知识，但问题必须有边界、可 review。 |
| `maintainer` | 需要维护者确认、执行或跟进的 Issue/PR；不是贡献者身份认证。 |
| `priority:P0` | 当前必须优先处理的阻塞、安全或发布问题。 |
| `priority:P1` | 近期重要但不立即阻塞发布的工作。 |
| `priority:P2` | 有价值的常规改进或待排期工作。 |
| `blocked` | 因外部依赖、设计决策或其他 Issue 暂时无法推进；正文必须写明阻塞原因。 |
| `needs-design` | 需要先讨论方案或确认架构边界，尚不适合直接实现。 |

`good first issue` 可以与 `help wanted` 同时使用，但 `help wanted` 单独出现不表示适合新手。大型数据库 abstraction redesign、FastAPI migration、认证架构、migration strategy 和跨模块重构不得仅为增加数量而标为 `good first issue`。

### 现有区域标签

仓库已保留并由 `.github/labeler.yml` 自动应用以下区域标签：

- `area/backend`：后端 API 与 service
- `area/frontend`：前端 UI 与 client code
- `area/database`：schema、migration 与 database adapter
- `area/docs`：文档
- `area/ci`：CI 与仓库自动化
- `area/demo`：演示数据与 seed/tooling

同时继续保留既有通用标签，例如 `bug`、`enhancement`、`documentation`、`question`、`accessibility`、`dependencies`、`breaking-change`、`needs-triage` 和 `needs-reproduction`；不因本 taxonomy 删除或重命名活动标签。

## 本地开发

请参考 [快速开始](./README.md#-快速开始)、[首次贡献指南](./docs/first-contribution.md) 与 [开发指南](./DEVELOPMENT.md)。

- 前端：React 18 + Vite 7，视图在 `frontend/src/components/views/`，业务逻辑在 `frontend/src/hooks/`，API 层按模块拆分于 `frontend/src/api/`
- 后端：FastAPI Native + Uvicorn，入口为 `backend/asgi.py`；service 位于 `backend/app/services/`，native routers 位于 `backend/app/fastapi/routers/`
- 推荐先用 `VITE_API_MODE=mock` 快速验证前端改动
- `frontend/src/` 主应用与测试已完成 TypeScript 收口；新增或维护 routing、serialization、API/auth、domain contract、components 与 hooks 时使用 TypeScript/TSX
- 不要通过 `checkJs` 或其他例外绕过严格类型检查；`frontend/src/` 不应重新引入 JS/JSX fallback。仓库配置与 Node tooling 的 JavaScript 文件按各自 runtime contract 维护

最小验证命令：

```bash
# 修改 frontend/
npm --prefix frontend run lint
npm --prefix frontend run typecheck
npm --prefix frontend test
npm --prefix frontend run build

# 修改 backend/
python -m unittest discover -s backend/tests

# 修改文档或 demo 公开数据
python demo/validate_demo_data.py --strict
git diff --check
```

Migration / database 改动还要按 [首次贡献指南](./docs/first-contribution.md#migration--database-changes) 运行受影响方言的 offline verify 和隔离数据库验证。

## 代码风格与安全

- 与周边既有代码保持一致的命名、缩进与注释密度
- 前端遵循项目现有组件与 API 组织方式；写操作统一使用公共 `ConfirmDialog` / toast，禁用原生 `alert` / `confirm`
- 不提交本地环境文件（`.env.local`）、日志（`logs/`）与调试产物
- 不提交凭据、Token、私钥、真实连接串、内部地址或真实业务数据；不在公开 Issue/PR 中粘贴安全漏洞细节

## 许可证

提交贡献即表示你同意以 [Apache License 2.0](./LICENSE) 授权你的代码。
