# FastAPI Report 模块迁移（#16 P4）

Report 已通过 DB_READY Gate（数据库 CRUD PR 已合入 `origin/main`），且当前没有 active Database Lane PR 修改 Report Service。本 PR 将 private capability 下的 Report list、detail、create/update/delete 接入 opt-in FastAPI adapter。

复用 Report Service、Pydantic contracts、RequestContext 与统一 error mapping；Flask route 保留并通过 parity tests 固化 filter、CRUD、auth、status、JSON envelope 和 not-found semantics。Community capabilities 下 Report 仍不注册。

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Report Service；不挂载 FastAPI app 即可回滚。
