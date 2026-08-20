# 首次贡献指南

欢迎参与数据资产门户。第一次贡献不需要先理解整个仓库；请选择一个边界清楚的 Issue，完成一条小而可验证的改动路径。

> 贡献前请先看 [CONTRIBUTING.md](../CONTRIBUTING.md) 的项目约定、标签语义和安全要求。

## 贡献流程

```text
Fork → Clone → 选择 Issue → 创建分支 → 修改 → 运行最小验证 → 提交 PR
```

### 1. Fork 和 Clone

在 GitHub 上 Fork 本仓库，然后克隆自己的 Fork：

```bash
git clone https://github.com/<your-account>/data-asset-portal-community.git
cd data-asset-portal-community
git remote add upstream https://github.com/0verme/data-asset-portal-community.git
```

### 2. 选择 Issue

优先选择带有 `good first issue` 的开放 Issue。先阅读 Background、Scope、Out of scope、Acceptance Criteria
和 Maintainer notes；如果方向或验收条件不清楚，先在 Issue 中提问，不要直接扩大范围。

`good first issue` 和 `help wanted` 的区别见下文。

### 3. 创建分支

从最新的 `main` 创建短分支，名称说明改动类型即可：

```bash
git fetch upstream
git switch main
git pull --ff-only upstream main
git switch -c docs/short-description
```

常见前缀：`docs/`、`fix/`、`test/`、`feat/`。不要把多个不相关主题放在一个分支或 PR 中。

### 4. 修改并保持边界

从 Issue 的 Files to start 开始，优先复用现有组件、脚本和文档。不要顺手重写数据库访问层、认证架构或无关页面。
涉及用户输入、敏感数据、迁移或可能丢数据的改动时，必须遵循仓库现有校验和错误处理约定。

### 5. 运行最小验证

根据改动类别运行下列检查；PR 中写明实际运行的命令和结果。

#### Frontend changes

```bash
npm --prefix frontend test
npm --prefix frontend run build
```

只改静态文案且没有 frontend 文件时不必运行 build；只要修改了 `frontend/` 的代码，至少运行上述两条命令。

#### Backend changes

```bash
python -m unittest discover -s backend/tests
```

如果只涉及一个测试文件，也可以先运行对应的 discover pattern，但 PR 前应说明是否运行了完整 backend suite。

#### Docs-only changes

检查 Markdown 渲染、相对链接、命令、文件路径和代码块；然后运行：

```bash
git diff --check
python demo/validate_demo_data.py --strict
```

仓库当前没有单独的 Markdown linter；不要把不存在的 lint 命令写进 PR。若文档改动影响开发流程，补跑
`python scripts/release_check.py fast`。

#### Migration / database changes

除 backend tests 外，还要针对所有受影响方言执行 offline verify；至少覆盖 SQLite、PostgreSQL 和 DWS 的声明变化：

```bash
python backend/scripts/schema_migrate.py verify --offline --dialect sqlite
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python backend/scripts/schema_migrate.py verify --offline --dialect dws
```

涉及可执行 migration 时，还需要在隔离的临时数据库执行 `plan`、`apply`、重复 `apply`，确认重复应用是 no-op，
并验证 seed、表边界和回滚/失败路径。不要使用生产库，也不要运行会清空或修改真实数据的测试。

### 6. 提交 PR

```bash
git status --short
git diff --check
git push origin <your-branch>
```

然后从分支页面创建 PR，填写 [PR template](../.github/pull_request_template.md)，包括动机、影响范围、测试命令、
迁移说明和敏感数据检查。PR 应只包含对应 Issue 的改动。

## 提交 Issue 前先讨论什么？

以下情况建议先在 Issue 或 [GitHub Discussions · Q&A](https://github.com/0verme/data-asset-portal-community/discussions/categories/q-a)
说明问题，再开始实现：

- 需求会改变 API、数据库 schema、Community module boundary 或默认运行时行为；
- 有两种以上合理实现，需要维护者确认方向；
- 改动可能影响认证、安全、迁移、兼容性或生产部署；
- 你无法确认问题是否由项目 bug、环境配置或使用方式引起。

提交 Bug 前请先搜索既有 Issue，提供最小复现、版本/commit、运行模式和脱敏日志。安全漏洞不要公开提交，按
[SECURITY.md](../SECURITY.md) 使用 GitHub Private Vulnerability Reporting。

## `good first issue` 和 `help wanted`

- **`good first issue`**：面向第一次贡献者。通常必须有明确 scope、无需架构决策、小到中等文件面、已知起始文件、
  可观察的验收标准、可复现的测试方法，并且方向已由 maintainer 认可。
- **`help wanted`**：欢迎社区协助，但可能需要特定领域知识（例如数据库、CI 或无障碍设计）。问题仍必须有边界、
  可 review，不能只是“欢迎改进整个模块”。一个 Issue 可以同时拥有两个标签，但 `help wanted` 不会自动意味着适合新手。

## 不适合作为首次贡献的内容

除非已经拆成明确、独立且经 maintainer 确认的子任务，以下内容不适合直接作为第一 PR：

- 数据库 abstraction redesign 或新增数据库支持；
- FastAPI migration architecture；
- authentication / authorization architecture；
- migration strategy、baseline 重构或跨方言 schema 设计；
- 大型跨模块 refactor、整页重做或一次性替换核心框架。

这些方向可以先参与设计讨论，或从其中已经拆出的文档、测试和小范围修复开始。
