# FastAPI Report 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Report 已通过 DB_READY Gate（数据库 CRUD PR 已合入 `origin/main`），且当前没有 active Database Lane PR 修改 Report Service。本 PR 将 private capability 下的 Report list、detail、create/update/delete 接入 opt-in FastAPI adapter。

复用 Report Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留并通过 parity tests 固化 filter、CRUD、auth、status、JSON envelope 和 not-found semantics。Community capabilities 下 Report 仍不注册。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Report Service；不挂载 FastAPI app 即可回滚。
