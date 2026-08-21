# P5 FastAPI Cutover Validation（#52）

本验证覆盖 P5-A runtime wiring 以及 P5-B 的最小部署/兼容性 gate。

## Runtime checks

- `uvicorn backend.asgi:app --host=127.0.0.1 --port=51239` production-like startup：PASS
- `GET /healthz`：PASS；不访问数据库，返回 `runtime`、`fastapiPrimary`、`flaskFallback`
- `BACKEND_RUNTIME=fastapi`：已迁移 prefix 进入 FastAPI，其他 prefix 进入 Flask WSGI fallback
- `BACKEND_RUNTIME=flask`：所有业务请求进入 Flask fallback
- runtime dispatch table：Community 下 Indicator、Assets、Field Mapping、Root、API Asset、Lineage、System、Operation Log 全部覆盖
- session compatibility：Flask signed session cookie 可被 FastAPI primary 读取
- capability boundary：disabled/unmigrated routes 不会被 FastAPI adapter 意外注册

## HTTP checks

- Lineage validation error：422 / `LINEAGE_VALIDATION_FAILED`
- Lineage unknown root：404 / `LINEAGE_NOT_FOUND`
- fallback unknown route：404 / `NOT_FOUND`
- configured CORS origin：preflight 200，返回 exact `Access-Control-Allow-Origin`
- security headers：FastAPI 与 health response 包含 `X-Content-Type-Options: nosniff`

## Full regression evidence

P4 module parity tests remain the source of truth for each migrated business API. The P5 runtime test adds dispatch, auth/session, fallback, error, CORS, security-header and health coverage without changing Service or database code.
