# P5 FastAPI Cutover Validation（#52）

本验证覆盖 P5-A runtime wiring 以及 P5-B 的最小部署/兼容性 gate。

## Runtime checks

- `uvicorn backend.asgi:app --host=127.0.0.1 --port=51239` production-like startup：PASS
- `GET /healthz`：PASS；不访问数据库，返回 `runtime`、`fastapiPrimary`、`flaskFallback`
- `BACKEND_RUNTIME=fastapi`：已迁移 prefix 进入 FastAPI，其他 prefix 进入 Flask WSGI fallback
- `BACKEND_RUNTIME=flask`：所有业务请求进入 Flask fallback
- F5 native gate：Flask/Flask-Cors import blocked 子进程可加载 FastAPI composition、建立 native request context 并探测 Community native routes
- runtime dispatch table：Community 下 Auth、Capabilities、Portal Stats、Unified Search、Indicator、Assets、Field Mapping、Root、API Asset、Lineage、System、Operation Log 全部覆盖
- native session compatibility：FastAPI auth 可读取/写入 Flask-compatible signed session cookie；Flask fallback 可继续读取同一 cookie
- capability boundary：disabled/private routes 不会被 FastAPI adapter 意外注册；Common Code 仍为 WAIT_DB Flask fallback

## HTTP checks

- Lineage validation error：422 / `LINEAGE_VALIDATION_FAILED`
- Lineage unknown root：404 / `LINEAGE_NOT_FOUND`
- fallback unknown route：404 / `NOT_FOUND`
- configured CORS origin：preflight 200，返回 exact `Access-Control-Allow-Origin`
- security headers：FastAPI 与 health response 包含 `X-Content-Type-Options: nosniff`

## Full regression evidence

P4 module parity tests remain the source of truth for each migrated business API. The P5 runtime test plus F2 native-auth tests cover dispatch, signed-session compatibility, authorization, fallback, error, CORS, security-header and health behavior without changing Service or database code.
