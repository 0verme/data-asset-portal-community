# FastAPI P5 Cutover 与 Flask Compatibility Strategy（#16 / #52）

> **Historical migration record**：本文保留 F6/F7 cutover 过程、兼容性边界和验证要求。当前 runtime truth 已收口为 Uvicorn → `backend/asgi.py` → FastAPI；请以 [README](../README.md)、[架构说明](./architecture.md) 和 [API 契约](./api-contract.md) 作为 current-state truth。

## Runtime 目标

```text
F6 native runtime:
client -> Uvicorn -> FastAPI -> existing services -> existing DB stack
```

`backend/asgi.py` 是唯一 runtime wiring：

- 只创建 FastAPI native app，不再按 prefix 分发到第二个 runtime；
- `/healthz` 是无数据库查询的进程健康检查，返回 FastAPI runtime；
- WAIT_DB/Private routes 不注册，未注册请求返回 native 404 envelope。

## Protocol / deployment

- ASGI：`uvicorn backend.asgi:app --host=127.0.0.1 --port=5099`；
- Nginx 继续托管 `frontend/dist`，将 `/api/` 代理到 FastAPI runtime；
- FastAPI 使用 signed-session compatibility secret、CORS allowlist、security headers 和 database profile；
- 前端 static serving 仍由 Nginx 负责，backend 不接管 SPA fallback；
- 不通过启动时数据库查询判断 `/healthz`，避免数据库短暂不可用导致进程探针误判。

## Compatibility boundary

F2 后，FastAPI primary 的 Auth 使用 `backend/app/application/session.py` 与 `backend/app/fastapi/auth.py` 读取相同格式的 signed `session` cookie，完成 native `login/me/logout` 和 identity resolution：

- 保持现有 cookie name、签名格式、expiration、`admin` / `maintainer` identity 与安全 flags；
- F1 的 Operation Log 已通过 neutral `RequestContext` 获取 request metadata，不再需要 Flask request context；
- F6 不再创建 Flask request context；旧 Flask adapters 只作为 F7 cleanup debt 保留在源码/历史测试中；
- `ASSET_TRUST_PROXY_HEADERS` 默认仍为 deny；只有显式信任反向代理时才读取 `X-Forwarded-For`；
- FastAPI adapter 不直接读取 database Provider/CoreAccess，也不复制 Service SQL。

F5/F6/F7 已完成 native runtime gate、runtime retirement、dependency cleanup 与 legacy source/test cleanup；生成的历史 architecture artifact 另行维护。

## Cutover phases

### F6：Native runtime retirement

FastAPI/Uvicorn 成为唯一 runtime；不再提供 `BACKEND_RUNTIME` switch、WSGI fallback 或 direct Flask rollback。

### P5-B：Parity / deployment verification

必须验证 startup、`/healthz`、session auth、capability boundary、已迁移 API、fallback API、404、validation error、CORS/security headers、SQLite/PostgreSQL CI 与 frontend checks。

### F7：Dependency / legacy cleanup（完成）

已按真实引用清理 Flask、Flask-Cors、legacy blueprints/tests、obsolete runtime docs，并保留薄 `fastapi_app.py` facade 与 API/security/edition regression evidence。

## Rollback

F6 不提供 Flask runtime rollback switch。部署回滚通过恢复上一版已验证的 Git commit/image；不需要回滚数据库 schema、migration、Service 或 API Contract。
