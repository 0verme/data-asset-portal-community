# #314 部署文档收口前置清单

2026-10-17：WAITING_ENV。主线包含 #313 的 runner，但 `backend/alembic/REAL_DWS_VALIDATION.md` 的真实 GaussDB/DWS 8.1.3 fresh、upgrade、repeat、metadata、failure/recovery 仍全为 NOT RUN。#313 仍开放。本文仅为只读准备，不替代最终部署指引，不授权连接或 apply。

## 恢复输入

维护者需明确：隔离目标或已批准恢复窗口、备份与实际恢复证据、版本 8.1.3、物理 schema 与 currentSchema 一致、可用 JDBC/Java、目标 profile（不提交主机/用户/密码/连接串）、数据快照范围与停写条件。

先完成 REAL_DWS_VALIDATION 的全部场景并记录精确 HEAD、各命令退出码、迁移前后 logical head、代表性主键/行数、重复执行与失败恢复结果。真实 DDL/autocommit/rollback 结果必须来自 DWS，不用 SQLite 或 PostgreSQL 推断。既有 schema 禁止运行 fresh baseline 探针。

## 获得真实证据后逐文件验收

| 文档 | 必须核对的内容 |
|---|---|
| `docs/deployment-windows.md` | prerequisites → `backend/.venv` → Python 依赖 → Java/JDBC → 后端/前端本地配置 → database profile → metadata preflight → plan/apply/status/verify → create_admin → 启动；Python 统一 `.\backend\.venv\Scripts\python.exe` |
| `DEPLOYMENT.md` | Linux venv、Java/JDBC、环境、服务启动与权限；生产前端明确 `VITE_API_MODE=remote`；已有部署 backup/status/preflight/plan/apply/status/verify/业务验收；失败停止、恢复后重验 |
| `DEVELOPMENT.md` | 开发 Mock 与正式 Remote 区分；本地配置不提交；不得用系统 Python 替代项目 venv；区分 Demo 与真实 DWS |
| `backend/README.md` | 动态 repository head、future revision DWS adapter、部分 DDL/ledger 失败恢复、RBAC/default menus 初始化顺序；不能把 ledger 永久写成 0001 |

不机械替换 canonical `dwp`，部署示例的 physical schema 可用 `dap`；以 resolver 和已验证 runner 的行为为准。先 schema，再 RBAC，再 default menus，不让部署者手动 INSERT 菜单。是否需额外恢复操作必须以实际失败场景为准，不编造可逆 downgrade。

## Windows / Linux 各自必须留存的应用验收

- venv interpreter、profile、currentSchema/schema、DWS metadata preflight、migration head 与 verify。
- 初始化 RBAC/menu、创建管理员；只保留成功证据，禁止记录口令。
- `/healthz`、业务 API JSON、login、`/api/auth/me`、`/api/system/menus` 非空。
- 导航、API icon、刷新后 session 保留；这是浏览器流程，不能以 HTTP 200 代替。
- 每项记录 OS、HEAD、真实/模拟环境、命令/结果、未验项；任何一个必要 gate 缺失都保持 #314 开放。

唯一恢复动作：维护者确认可恢复 DWS 目标并完成 #313 的真实验证记录，再按上表收口四份最终文档。当前没有运行任何 DWS、迁移、seed、create_admin 或生产写入。
