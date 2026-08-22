# FastAPI Root 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Root 已通过 Database Lane DB_READY Gate，且当前没有 active Database Lane PR 修改 Root Service。本 PR 将 Root 的 list、categories、detail、create/update/delete/import 接入 opt-in FastAPI adapter。

复用 Root Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留并通过 parity tests 固化 query、auth、status、JSON envelope 和错误语义。Community capabilities 下不暴露 Report、Push、Manual Code Table 等 private routes。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Root Service。FastAPI app 不挂载即可回滚到 Flask。
