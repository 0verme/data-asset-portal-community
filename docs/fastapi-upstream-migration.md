# FastAPI Upstream 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Upstream 已通过 Database Lane DB_READY Gate：Database PR #76（Upstream CRUD SQLAlchemy Core）与修正 PR #78 已合并到 `origin/main`；当前没有 active Database Lane PR 修改 `UpstreamService`。

本次 PR 仅增加 opt-in FastAPI adapter、Upstream response envelope contract 与 Flask/FastAPI parity tests，复用现有 Service 与数据库栈：

```text
FastAPI adapter
  -> existing UpstreamService
  -> existing CoreAccess / database stack
```

保持以下 Flask API contract：

- `GET /api/upstreams/systems`
- `GET /api/upstreams/systems/{system_id}`
- `GET /api/upstreams/systems/{system_id}/admin-detail`
- `POST /api/upstreams/systems`
- `PUT /api/upstreams/systems/{system_id}`
- `PATCH /api/upstreams/systems/{system_id}/status`
- `DELETE /api/upstreams/systems/{system_id}`

FastAPI 保持公开读取、maintainer 写入与 admin-detail authentication，及 201/404/409/422/500、JSON envelope、query aliases 和 capability gate。Flask blueprint 保留；不挂载 FastAPI app 即可 rollback，不需要回滚 Database Lane 或 Service。
