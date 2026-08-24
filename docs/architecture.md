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

`backend/run.py`、Waitress、WSGI fallback 和 runtime switch 均已退休；当前没有第二套 Flask runtime。`GET /healthz` 只报告进程状态，固定返回 `runtime=fastapi`、`fastapiPrimary=true`、`flaskFallback=false`，不执行数据库查询。`flaskFallback` 是显式的回归字段，不是当前架构节点。

## 请求分发

```mermaid
flowchart LR
  U["Browser"] --> F["React + Vite"]
  F -->|"/api"| R["Uvicorn / backend/asgi.py"]
  R -->|"native routes"| A["FastAPI Native"]
  A --> S["Application / Service"]
  S --> P["Database Provider"]
  P --> D[("SQLite / PostgreSQL / MySQL / GaussDB-DWS")]
  F -.->|"mock"| M["Controlled demo data"]
```

`backend/app/fastapi/app.py` 统一注册仓库 native routers；`backend/asgi.py` 只负责 FastAPI composition、CORS/security headers 和 healthz。数据库、驱动、凭据、storage 或 external integration readiness 不改变已存在 route 的注册状态。

### FastAPI current route surface

当前 FastAPI adapter 负责下列 native routes；所有仓库模块默认注册，实例菜单可见性与外部 readiness 在更上层/Service contract 中单独表达：

- Indicator：`/api/indicators`
- Assets / DWM：`/api/assets`
- Field Mapping：`/api/field-mappings`
- Root：`/api/roots`
- Manual Code Table：`/api/manual-code-tables`
- Report：`/api/reports`
- API Asset：`/api/api-assets`
- Lineage：`/api/lineage`
- Metadata Ingestion：`/api/metadata`（versioned external Asset / Lineage Contract）
- Auth：`/api/auth`（native signed-session adapter）
- Capabilities：`/api/capabilities`（native infrastructure adapter）
- Portal Stats：`/api/portal/stats`（native infrastructure adapter）
- Unified Search：`/api/search`（native infrastructure adapter）
- System Management：`/api/system`
- Operation Log：`/api/operation-logs`
- Upstream：`/api/upstreams`
- Push：`/api/push`

模块级 parity 和 migration 状态见 [FastAPI P4 Migration Matrix](./fastapi-p4-migration-matrix.md)。

### Scope exclusions

以下路径不属于当前 native module route contract：

- Common Code：`/api/common-codes/*`（WAIT_DB，保留为后续基础设施边界）
- Indicator Path：当前没有独立 native route
- 任何真正不存在的请求返回 FastAPI `NOT_FOUND` envelope；外部依赖缺失的已注册模块使用 service error contract。

仓库模块不会因为 runtime profile 名称而意外隐藏；实例菜单 status 仍可控制导航可见性。

## Application Boundary

HTTP adapter 只负责请求解析、认证依赖、contract validation、response envelope 和 adapter-specific error mapping。业务 router 默认先执行 authentication-only `require_authenticated`；只有 mutation、admin 或 sensitive read 再叠加 `require_permission(...)`，因此 Authentication 不等于 Authorization：

```text
FastAPI adapter ── Application / Service Layer ── Database Provider ── Database
```

`backend/app/contracts/` 是框架中立的 API Contract，由 FastAPI native adapter 复用；Service、Contract 和 Database Layer 不因 runtime retirement 复制业务逻辑。

- `backend/asgi.py` 负责纯 FastAPI composition、CORS/security headers、native signed-session identity resolver 和 healthz。
- `backend/app/fastapi_app.py` 是保留历史 import path 的 thin compatibility facade。
- `backend/app/fastapi/app.py` 负责 FastAPI app bootstrap、explicit Service injection、capability gate 与 Router registration；`dependencies.py`、`errors.py` 和 `routers/` 承载共享 adapter seam 与模块边界。
- `backend/app/__init__.py` 仅保留 production composition 说明；历史 Flask factory/blueprint 已删除，native package import 不加载 Flask。
- `backend/app/services/` 和 `backend/app/db/` 是 FastAPI native 复用的业务与数据库边界。

## Metadata Integration Boundary

外部元数据不直接写业务表，而是通过版本化 Contract 进入 FastAPI：

```text
External Collector / Adapter
          ↓
Versioned Metadata Contract
          ↓
/api/metadata/assets/ingestions
/api/metadata/lineage/ingestions
          ↓
MetadataIngestionService
          ↓
SQLAlchemy Core / Database Provider
          ↓
Canonical asset / lineage storage
```

`backend/app/contracts/metadata_ingestion.py` 是 framework-neutral public DTO；`backend/app/services/metadata_ingestion_service.py` 负责 source identity、normalize、natural key、idempotency、dry-run、bulk limits、transaction、snapshot activation 和 audit summary；`backend/app/fastapi/routers/metadata.py` 只负责 auth、request parsing、HTTP status mapping。Collector 不需要知道 `p_asset_*`、`p_lineage_*`、内部 PK、Provider 或 migration。完整字段与语义见 [metadata-ingestion.md](./metadata-ingestion.md) 和 [ADR-001](./adr/001-metadata-ingestion-contract.md)。

V1 lineage 只支持 self-contained `replace` snapshot：新 snapshot 先以 `INACTIVE` 写入，节点/边校验成功后在同一 transaction 内切换 `ACTIVE`。`append`、`merge`、source-specific parser、scheduler 和 connector framework 不属于 DAP Core。

## Rollback

F6 不再提供 Flask runtime rollback switch。应用回滚通过部署上一版已验证的 Git commit/image 完成；不回滚数据库 schema、migration、Service 或 API Contract。`uvicorn backend.asgi:app` 是唯一当前推荐入口。

## Transitional Debt

### F7 cleanup result

F5 gate 已证明 production native composition 不加载 Flask；F7 已删除 Flask/Flask-Cors dependencies、Flask factory/blueprints/routes 与 obsolete compatibility tests。保留的 `Werkzeug`、`itsdangerous`、signed-cookie config names 和薄 `fastapi_app.py` facade 均有明确 native reason。当前生成的 architecture artifact 以可审计 source revision 为证据；历史 migration notes 中的旧图示不应被当作 current runtime truth。

## 前端与数据层

- `frontend/src/App.jsx` 负责应用编排、登录态和模块路由；`frontend/src/api/` 统一访问 `/api`。
- `VITE_API_MODE=mock` 使用受控前端演示数据；`remote` 访问真实后端数据库。两种模式默认使用同一仓库模块集合，数据和外部执行能力可以不同。
- Schema Source of Truth 是 `backend/schema` 四方言完整 baseline 加 `backend/alembic` 增量 revision；`demo/seed_*.py` 负责完整仓库模块的虚构演示数据。
- `backend/app/db/` 隔离 SQLite、PostgreSQL、MySQL 和 GaussDB/DWS 的 Provider 差异；数据库 profile 只表达部署连接能力。`docs/pg/`、`docs/dws/` 是方言参考和部署说明，不再作为隐藏模块的 schema 边界。
- 正式部署由 Nginx 托管前端静态资源，并将 `/api` 代理到 ASGI runtime；详细环境变量、health check 与 Nginx 配置见 [DEPLOYMENT.md](../DEPLOYMENT.md)。

## 当前边界与后续 Issue

仓库已有模块均默认进入统一的 route、capability、schema、seed、search 和 portal statistics contract。`backend/configs/community.yaml` 仅保留本地演示的数据库/feature profile；`p_menu.status` 仍是实例级可见性配置。WAIT_DB 或外部存储/驱动未配置时，模块 route 仍存在，由现有 Service error contract 返回可诊断状态。
