# FastAPI Field Mapping 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Field Mapping 已通过 Database Lane DB_READY Gate（SQLAlchemy Core PR 已合入 `origin/main`），且当前没有 active Database Lane PR 修改该 Service。本 PR 将只读 Field Mapping routes 接入既有 opt-in FastAPI adapter。

## 覆盖范围

- `/api/field-mappings/source-systems`；
- `/api/field-mappings/stats`；
- `/api/field-mappings/fields`；
- `/api/field-mappings/tables`；
- 保留 `dataSourceId`、`upstreamSystemId`、`sourceSystemId` 兼容别名及分页/排序 query semantics。

FastAPI adapter 复用 `FieldMappingService`、显式 Pydantic response contracts、统一 error mapping 与 capabilities gate；不复制查询或数据库逻辑。Flask routes 保留，parity tests 通过后仍可回滚到 Flask。

## Database Lane 协调

未修改 Provider、CoreAccess、tables、migration 或 Field Mapping Service。若 Database Lane 后续重开该模块 Service，Framework Lane 需先暂停并 rebase 后重跑 parity tests。
