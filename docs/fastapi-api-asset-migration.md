# FastAPI API Asset 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

API Asset 已通过 Database Lane DB_READY Gate（后续 SQLAlchemy Core PR 已合入 `origin/main`），当前没有 active Database Lane PR 修改该 Service。本 PR 接入 list、downstream systems、detail、CRUD、status、params/response-fields/relations routes。

复用 API Asset Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留并通过 parity tests 固化 Community module 的现有行为。不修改 Provider、CoreAccess、tables、migration 或 Service。
