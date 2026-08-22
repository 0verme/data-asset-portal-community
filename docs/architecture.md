# 架构说明

## Runtime Truth

当前后端是纯 FastAPI ASGI 运行时：

```text
Uvicorn
  ↓
backend/asgi.py
  ↓
FastAPI Native
  ↓
Application / Service
  ↓
Database Provider
```

生产和默认开发入口均为：

```bash
uvicorn backend.asgi:app --host 127.0.0.1 --port 5099
```

`backend/run.py` 已退休；不再提供 direct Flask development/WSGI runtime 或 runtime switch。

## 请求分发

```mermaid
flowchart LR
  U["Browser"] --> F["React + Vite"]
  F -->|"/api"| R["Uvicorn / backend/asgi.py"]
  R -->|"native routes"| A["FastAPI Native"]
  A --> S["Application / Service"]
  S --> P["Database Provider"]
  P --> D[("SQLite / PostgreSQL / GaussDB-DWS")]
  F -.->|"mock"| M["Controlled demo data"]
```

`backend/app/fastapi/app.py` 根据 capability map 注册 native routers；`backend/asgi.py` 只负责 FastAPI composition、CORS/security headers 和 healthz。WAIT_DB/Private routes 不注册，不通过第二套 runtime 承载。

### FastAPI primary 覆盖范围

当前 FastAPI adapter 承载下列已迁移模块；带 `*` 的模块受完整 profile / capability 控制，Community 默认不会注册：

- Indicator：`/api/indicators`
- Assets / DWM：`/api/assets`
- Field Mapping：`/api/field-mappings`
- Root：`/api/roots`
- Manual Code Table*：`/api/manual-code-tables`
- Report*：`/api/reports`
- API Asset：`/api/api-assets`
- Lineage：`/api/lineage`
- Auth：`/api/auth`（native signed-session adapter）
- Capabilities：`/api/capabilities`（native infrastructure adapter）
- Portal Stats：`/api/portal/stats`（native infrastructure adapter）
- Unified Search：`/api/search`（native infrastructure adapter）
- System Management：`/api/system`
- Operation Log：`/api/operation-logs`
- Upstream*：`/api/upstreams`

模块级 parity 和 migration 状态见 [FastAPI P4 Migration Matrix](./fastapi-p4-migration-matrix.md)。

### Scope exclusions

以下路径在 Community Native runtime 中按 gate 不注册：

- Common Code：`/api/common-codes/*`（WAIT_DB）
- Indicator Path、Common Code、Push（WAIT_DB/Private boundary）
- 任何未注册的请求返回 FastAPI `NOT_FOUND` envelope

Community profile 的 disabled/private 路径不会因为 runtime 收口而意外暴露。

## Application Boundary

HTTP adapter 只负责请求解析、认证依赖、contract validation、response envelope 和 adapter-specific error mapping：

```text
FastAPI adapter ── Application / Service Layer ── Database Provider ── Database
```

`backend/app/contracts/` 是框架中立的 API Contract，由 FastAPI native adapter 复用；Service、Contract 和 Database Layer 不因 runtime retirement 复制业务逻辑。

- `backend/asgi.py` 负责纯 FastAPI composition、CORS/security headers、native signed-session identity resolver 和 healthz。
- `backend/app/fastapi_app.py` 是保留历史 import path 的 thin compatibility facade。
- `backend/app/fastapi/app.py` 负责 FastAPI app bootstrap、explicit Service injection、capability gate 与 Router registration；`dependencies.py`、`errors.py` 和 `routers/` 承载共享 adapter seam 与模块边界。
- `backend/app/__init__.py` 的 Flask factory/blueprint 代码已退出 production composition，待 F7 清理；native package import 不再加载 Flask。
- `backend/app/services/` 和 `backend/app/db/` 是 FastAPI native 复用的业务与数据库边界。

## Rollback

F6 不再提供 Flask runtime rollback switch。应用回滚通过部署上一版已验证的 Git commit/image 完成；不回滚数据库 schema、migration、Service 或 API Contract。`uvicorn backend.asgi:app` 是唯一当前推荐入口。

## Transitional Debt

### F7 cleanup debt

F5 gate 已证明 production native composition 不加载 Flask。仓库中仍保留的 Flask factory、legacy blueprints、compatibility tests、历史文档和 Flask/Flask-Cors dependencies 属于 F7 cleanup debt，不参与 production runtime；删除前仍需按真实引用分类并保留 API/security regression evidence。

## 前端与数据层

- `frontend/src/App.jsx` 负责应用编排、登录态和模块路由；`frontend/src/api/` 统一访问 `/api`。
- `VITE_API_MODE=mock` 使用受控前端演示数据；`remote` 访问真实后端数据库。
- Schema Source of Truth 是 `backend/schema` 完整基线加 `backend/alembic` 增量 revision。
- `backend/app/db/` 隔离 SQLite、PostgreSQL、MySQL 和 GaussDB/DWS 的 Provider 差异；Community 默认启用的数据库路径由 runtime profile 控制。
- 正式部署由 Nginx 托管前端静态资源，并将 `/api` 代理到 ASGI runtime；详细环境变量、health check 与 Nginx 配置见 [DEPLOYMENT.md](../DEPLOYMENT.md)。
