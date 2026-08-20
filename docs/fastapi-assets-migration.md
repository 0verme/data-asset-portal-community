# FastAPI Assets 模块迁移（#16 P4）

Assets 已通过 Database Lane 的 DB_READY Gate：相关 SQLAlchemy Core CRUD 已进入 `origin/main`，当前没有继续修改 Assets Service 的 active Database Lane PR。本 PR 在 P3 Indicator Pilot 之上，将 Assets 作为独立模块迁移到同一 opt-in FastAPI adapter。

## 范围

- `/api/assets/tables`（普通列表与 summary pagination）；
- table detail、fields、DDL、domains、layers；
- table create/update、fields update、delete；
- 复用 `AssetsService`、Pydantic contracts、`RequestContext` 与统一 error mapping；
- 继续使用 capabilities gate，Community Edition 不注册 private Report/Push 路由。

## 兼容性与回滚

Flask route 保留，FastAPI 返回与 Flask parity tests 对比的相同 status、JSON envelope、pagination、auth 和 not-found semantics。FastAPI 仍是独立 opt-in ASGI app；不挂载该 app 即回滚，无需回滚数据库或 Flask。

## Database Lane 协调

本 PR 不修改 Provider、CoreAccess、tables、migration 或 Assets Service；仅复用已合入的 DB implementation。后续 DB Lane 若重新修改 Assets Service，需先暂停本模块 adapter 变更并 rebase 后重新运行 parity tests。
