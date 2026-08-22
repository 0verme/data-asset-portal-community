# FastAPI Assets 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Assets 已通过 Database Lane 的 DB_READY Gate：相关 SQLAlchemy Core CRUD 已进入 `origin/main`，当前没有继续修改 Assets Service 的 active Database Lane PR。本 PR 在 P3 Indicator Pilot 之上，将 Assets 作为独立模块迁移到同一 opt-in FastAPI adapter。

## 范围

- `/api/assets/tables`（普通列表与 summary pagination）；
- table detail、fields、DDL、domains、layers；
- table create/update、fields update、delete；
- 复用 `AssetsService`、Pydantic contracts、`RequestContext` 与统一 error mapping；
- 迁移阶段的 capabilities gate 仅作为历史记录；当前 Report/Push 路由随仓库模块默认注册，外部执行能力由 service error contract 表达。

## 兼容性与回滚

Flask route 保留，FastAPI 返回与 Flask parity tests 对比的相同 status、JSON envelope、pagination、auth 和 not-found semantics。FastAPI 仍是独立 opt-in ASGI app；不挂载该 app 即回滚，无需回滚数据库或 Flask。

## Database Lane 协调

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Assets Service；仅复用已合入的 DB implementation。后续 DB Lane 若重新修改 Assets Service，需先暂停本模块 adapter 变更并 rebase 后重新运行 parity tests。
