# FastAPI P5 Cutover 与 Flask Compatibility Strategy（#16 / #52）

## Runtime 目标

```text
CURRENT / fallback:
client -> Flask WSGI app -> Flask blueprints -> services

P5 primary:
client -> ASGI runtime dispatcher
       -> FastAPI adapters（已迁移 prefix） -> existing services -> existing DB stack
       -> Flask WSGI fallback（未迁移 prefix） -> existing services -> existing DB stack
```

`backend/asgi.py` 是唯一的 P5 runtime wiring：

- `BACKEND_RUNTIME=fastapi`（默认）：FastAPI primary，未迁移路径委托 Flask；
- `BACKEND_RUNTIME=flask`：所有业务请求委托 Flask，作为立即 rollback；
- `/healthz` 是无数据库查询的进程健康检查，返回 runtime 模式；
- `backend/run.py` 保留为直接 Flask WSGI fallback，便于不依赖 ASGI 层的应急回退。

## Protocol / deployment

- ASGI：`uvicorn backend.asgi:app --host=127.0.0.1 --port=5099`；
- WSGI fallback：`waitress-serve --host=127.0.0.1 --port=5099 backend.run:app`；
- Nginx 继续托管 `frontend/dist`，将 `/api/` 代理到同一 runtime；
- FastAPI 与 Flask 共用 `FLASK_SECRET_KEY`、`FLASK_ENV`、CORS allowlist、security headers 和 database profile；
- 前端 static serving 仍由 Nginx 负责，backend 不接管 SPA fallback；
- 不通过启动时数据库查询判断 `/healthz`，避免数据库短暂不可用导致进程探针误判。

## Compatibility boundary

F2 后，FastAPI primary 的 Auth 使用 `backend/app/application/session.py` 与 `backend/app/fastapi/auth.py` 读取相同格式的 signed `session` cookie，完成 native `login/me/logout` 和 identity resolution：

- 保持现有 cookie name、签名格式、expiration、`admin` / `maintainer` identity 与安全 flags；
- F1 的 Operation Log 已通过 neutral `RequestContext` 获取 request metadata，不再需要 Flask request context；
- `FlaskRequestContextMiddleware` 仍只为其它 compatibility/fallback 责任建立最小 Flask request context；
- `ASSET_TRUST_PROXY_HEADERS` 默认仍为 deny；只有显式信任反向代理时才读取 `X-Forwarded-For`；
- FastAPI adapter 不直接读取 database Provider/CoreAccess，也不复制 Service SQL。

这是分阶段可回滚的 compatibility boundary。只有全部剩余 fallback route 与 runtime deletion 完成独立验证后，才允许在后续 PR 中移除 Flask runtime。

## Cutover phases

### P5-A：Primary + fallback

当前阶段完成：FastAPI 成为已迁移 prefix 的 primary；Flask 保持 fallback。通过 `BACKEND_RUNTIME=flask` 或直接 `backend.run:app` 回滚。

### P5-B：Parity / deployment verification

必须验证 startup、`/healthz`、session auth、capability boundary、已迁移 API、fallback API、404、validation error、CORS/security headers、SQLite/PostgreSQL CI 与 frontend checks。

### P5-C：Selective cleanup

只删除有证据证明不再被 runtime、tests、CLI、extension 或 compatibility path 使用的 Flask adapter。Flask auth blueprint、`common_code`、`portal`、`search`、`indicator_path`、`push` 与 Flask app factory 继续保留；不做 Big Bang 删除。

## Rollback

1. 首选：将 `BACKEND_RUNTIME=flask` 注入同一 deployment environment 并重启；
2. 若需要绕过 ASGI dispatcher：使用 `waitress ... backend.run:app`；
3. 恢复 Nginx upstream 到原 Flask WSGI process；
4. 不需要回滚数据库 schema、migration、Service 或已合并的 FastAPI adapter。
