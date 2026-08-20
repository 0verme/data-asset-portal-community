# FastAPI Manual Code Table 模块迁移（#16 P4）

Manual Code Table 已通过 Database Lane DB_READY Gate，且当前没有 active Database Lane PR 修改该 Service。本 PR 将 private capability 下的 list、detail、CSV export、CRUD、status update 接入 opt-in FastAPI adapter。

FastAPI 复用 Manual Code Table Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留，CSV 与 JSON parity tests 固化现有行为。`ASSET_EDITION=community` 时 capability gate 不注册该 private module。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Service；不挂载 FastAPI app 即可回滚。
