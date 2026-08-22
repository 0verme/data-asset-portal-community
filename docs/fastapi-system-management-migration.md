# FastAPI System Management 模块迁移（#16 P4）

> **Historical migration record**：本文保留 P4 迁移阶段的 opt-in/parity/rollback 证据。当前 runtime 已由 F7 收口为 FastAPI Native；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

System Management 已通过 Database Lane DB_READY Gate：System User、System Dictionary、System Menu 的数据库 PR #63、#65、#68 已合并到 `origin/main`，Operation Log 数据库 PR #59 也已合并；当前没有 active Database Lane PR 修改这些 Service。

本次 PR 仅增加 opt-in FastAPI adapter、共享 response envelope contract 与 parity tests，复用现有 Service：

```text
FastAPI adapter
  -> SystemManagementService / OperationLogService
  -> existing CoreAccess / database stack
```

保留全部现有路径和 method：

- `/api/system/users`
- `/api/system/menus`
- `/api/system/param-dicts/categories`
- `/api/system/param-dicts`
- `/api/operation-logs`

FastAPI 保持 Flask 的 admin / maintainer authentication、menu visibility、status code、JSON envelope、validation/error mapping 与 capability gate。Flask blueprints 保留；不挂载 FastAPI app 即可 rollback，不需要回滚 database infrastructure 或 Service。
