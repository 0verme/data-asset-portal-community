# FastAPI Field Mapping 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Field Mapping 已通过 Database Lane DB_READY Gate（SQLAlchemy Core PR 已合入 `origin/main`），且当前没有 active Database Lane PR 修改该 Service。本次主键收口继续复用 SQLAlchemy Core 和既有 FastAPI adapter，不复制查询或数据库逻辑。

## 覆盖范围

- `/api/field-mappings/source-systems`；
- `/api/field-mappings/stats`；
- `/api/field-mappings/fields`；
- `/api/field-mappings/tables`；
- `sourceSystemId` 是新的规范主键筛选参数，值为 `p_upstream_system.system_pk`；
- `upstreamSystemId` 保留为兼容别名，并在 Service 内归一到上游系统主键；
- `dataSourceId` 和 `srcSystem` 仅保留为 deprecated 兼容筛选，不承担系统身份；名称冲突时不会随机选择系统；
- 保留分页/排序 query semantics。

FastAPI adapter 复用 `FieldMappingService`、显式 Pydantic response contracts 和统一 error mapping。列表项返回程序使用的 `id` / `sourceSystemId`、系统名称和系统编码；前端只把主键作为 option value，用户看到 `名称 · 编码`。

## Database Lane 协调

未修改 Provider、CoreAccess、tables、migration 或 Field Mapping Service。若 Database Lane 后续重开该模块 Service，Framework Lane 需先暂停并 rebase 后重跑 parity tests。
