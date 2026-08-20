# FastAPI Pilot（#16 P3）

当前 Pilot 选择 **Indicator**，而不是 health endpoint 或 Report：Indicator 已满足 DB_READY，且属于 Community Edition；Report 在 Community Edition 明确 disabled。当前仍由 Flask 作为正式入口。

## 架构

```text
Flask Adapter ─┐
               ├─ shared IndicatorService ─ CoreAccess ─ Provider
FastAPI Adapter┘
       ↓
  Pydantic Contract
```

`backend/app/fastapi_app.py` 是独立、可选的 ASGI bootstrap，仅注册 `/api/indicators`。它：

- 复用现有 `IndicatorService`，不复制业务逻辑；
- 复用 `IndicatorRequest`、`IndicatorListResponse`、`DataEnvelope`、`MessageDataResponse`；
- 通过 dependency injection 注入 service；
- 通过 `identity_resolver` 注入 auth adapter，并转换为 P1 `RequestContext`；
- 统一映射 application、service、request validation 与 HTTP errors；
- 使用 capabilities gate，Community capabilities 下不会暴露 Report/Push 或其他私有模块；
- 不改变 Flask app factory、路由注册或部署入口。

## Auth adapter seam

FastAPI 不读取 Flask `session` proxy。部署层必须显式提供 `identity_resolver(request) -> Identity | None`，测试则注入 `Identity`。这保证未来 token/session adapter 可替换，而不会把 Flask runtime 引入 application/service。

## Rollback

Pilot 是独立 ASGI app，不替换当前 WSGI entry。停用 FastAPI bootstrap 或不挂载 ASGI app 即可回滚；Flask route 与 service 不需回退。

## 验证

`backend/tests/test_fastapi_indicator_pilot.py` 覆盖：

- list request parsing 与 Flask/FastAPI JSON parity；
- authenticated create、shared service reuse 与 Pydantic contract；
- 401 auth failure；
- 422 service validation error；
- 404 not found；
- Community boundary（Report/Push 不注册）。
