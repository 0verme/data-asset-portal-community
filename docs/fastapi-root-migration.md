# FastAPI Root 模块迁移（#16 P4）

Root 已通过 Database Lane DB_READY Gate，且当前没有 active Database Lane PR 修改 Root Service。本 PR 将 Root 的 list、categories、detail、create/update/delete/import 接入 opt-in FastAPI adapter。

复用 Root Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留并通过 parity tests 固化 query、auth、status、JSON envelope 和错误语义。Community capabilities 下不暴露 Report、Push、Manual Code Table 等 private routes。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Root Service。FastAPI app 不挂载即可回滚到 Flask。
