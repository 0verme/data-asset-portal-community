# FastAPI Lineage 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

Lineage 已通过 Database Lane 的 DB_READY Gate：数据库 PR #61 已合并到 `origin/main`（merge SHA `e502e6293adc8981ad4c1882e966a19df14448d1`），当前没有 active Database Lane PR 修改 Lineage reader/service。

本次变更只增加 opt-in FastAPI adapter、Lineage response envelope contract 与 Flask/FastAPI parity tests：

```text
FastAPI Lineage adapter
  -> existing Lineage reader service
  -> existing CoreAccess / database stack
```

FastAPI 注册以下与 Flask 完全相同的路径和 query 参数：

- `GET /api/lineage/bootstrap`
- `GET /api/lineage/assets?name=...`
- `GET /api/lineage/subgraph?rootId=...&direction=...&depth=...&maxNodes=...&view=...`
- `GET /api/lineage/initial-view?rootId=...&direction=...&depth=...&maxNodes=...&view=...`

响应 envelope、nullable/default 行为、422 validation、404 root not found、503 data-source/configuration error 与 capability gate 通过 parity tests 固化。Lineage 不使用 maintainer-only auth gate，保持原有公开读取语义。

Flask blueprint 保留，FastAPI 仍是独立 opt-in ASGI app；不挂载 FastAPI app 即可回滚到 Flask，不需要回滚数据库或 Lineage service。
