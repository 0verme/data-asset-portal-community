# 工程历史归档 · Engineering History Archive

本目录存放**已经完成的工程迁移阶段**留下的记录：迁移报告、审计矩阵、决策报告和兼容性矩阵。

## 这里的文件不是当前产品事实

这些文档描述的是仓库**曾经**经历的改造过程（例如 Flask → FastAPI runtime 收口、Edition 语义决策、
SQLite 定位决策、P0 安全审计）。它们的结论大多已经固化到当前代码、CI 和正式文档中。

因此：

- **使用或部署 DAP** → 请看上层文档，不要参考本目录。
- **想了解某个架构决策的历史原因** → 可以在这里追溯；但判断当前行为仍以代码与正式文档为准。
- **Git 历史本身已经完整保存了这些文件**，本目录只是为仍需追溯上下文的维护者保留的可读副本。

## 归档内容

| 文件 | 原主题 | 现状 |
| --- | --- | --- |
| [SQLITE_DECISION.md](./SQLITE_DECISION.md) | SQLite 定位决策（保留为 Community/local 后端） | 结论已生效；当前表述见 [数据库支持矩阵](../../database-support.md) |
| [edition-decision-report.md](./edition-decision-report.md) | Community Edition / 可选模块 gating 决策 | 已被 #116 移除 Edition gating，仅作历史证据 |
| [fastapi-router-convention.md](./fastapi-router-convention.md) | FastAPI native router 渐进迁移约定与模块 inventory | 迁移已完成；约定已固化在 `backend/app/fastapi/routers/` |
| [fastapi-p4-migration-matrix.md](./fastapi-p4-migration-matrix.md) | FastAPI P4 模块级 parity 矩阵 | 迁移已完成；当前 route surface 见 [架构说明](../../architecture.md) |
| [security-audit-p0-matrix.md](./security-audit-p0-matrix.md) | Issue #16 阶段的 Flask 安全审计与整改决策 | Flask 已由 F7 收口；当前安全配置见 [DEPLOYMENT.md](../../../DEPLOYMENT.md) 与 [SECURITY.md](../../../SECURITY.md) |
| [api-contracts.md](./api-contracts.md) | Pydantic API Contract 建立记录 | Contract 已落地；参考 [API 契约](../../api-contract.md) |

## 为什么删除了另一批文档

同一轮收口中，以下类型的文档被**直接删除**而不是归档：

- 各模块的 `fastapi-*-migration.md` 迁移执行记录
- `fastapi-cutover.md` / `fastapi-cutover-validation.md`
- `fastapi-flask-dependency-audit.md`
- `fastapi-pilot.md`

原因：它们记录的是一次性执行过程，其结论已经完全体现在当前代码与测试中，
继续保留只会让第一次访问仓库的人误以为项目仍处于迁移期。需要时可从 Git 历史找回。
