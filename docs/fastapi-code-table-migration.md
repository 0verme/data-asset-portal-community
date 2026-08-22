# FastAPI Manual Code Table 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Manual Code Table 已通过 Database Lane DB_READY Gate，且当前没有 active Database Lane PR 修改该 Service。本 PR 将 private capability 下的 list、detail、CSV export、CRUD、status update 接入 opt-in FastAPI adapter。

FastAPI 复用 Manual Code Table Service、Pydantic contracts、RequestContext 与统一 error mapping；CSV 与 JSON parity tests 固化现有行为。#116 后该仓库模块默认注册，缺少数据库配置时沿用统一 data-source error contract。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Service；不挂载 FastAPI app 即可回滚。
