# FastAPI Pilot（#16 P3，历史记录）

本文件记录最初 Indicator pilot 的设计与验证证据。该 pilot 已演进为 FastAPI Native runtime；当前 production 入口是 `uvicorn backend.asgi:app`，不再保留 Flask WSGI fallback 或双 runtime。

## 历史架构

```text
FastAPI Adapter → shared IndicatorService → CoreAccess → Provider
                         ↓
                  Pydantic Contract
```

Pilot 验证了：

- 复用现有 `IndicatorService`，不复制业务逻辑；
- 复用 `IndicatorRequest`、`IndicatorListResponse`、`DataEnvelope`、`MessageDataResponse`；
- 通过 dependency injection 注入 service；
- 通过 `identity_resolver` 注入 auth adapter，并转换为 framework-neutral `RequestContext`；
- 统一映射 application、service、request validation 与 HTTP errors；
- 使用 capabilities gate，Community capabilities 下不会暴露 Report/Push 或其他私有模块。

## Auth adapter seam

FastAPI 不读取 Flask `session` proxy。现行 `SignedSessionCodec` 保持原 cookie/signature contract，`identity_resolver(request) -> Identity | None` 将验证后的 session 转为 neutral identity；application/service 不感知 Flask runtime。

## Current status

F5/F6 已验证并完成纯 FastAPI/Uvicorn runtime 收口。本文中的 WAIT_DB/Private module route gate 是 pilot 阶段的历史决策；#116 后仓库模块默认注册，缺少 DB_READY/外部依赖时由现有错误契约返回诊断状态。本文保留用于解释 pilot 决策，不是当前部署说明。

## 验证

当前 native contract、authorization、Community boundary 和 Flask-free gate 见 `backend/tests/` 中的 native tests；旧 Flask/FastAPI parity wrapper 已在 F7 cleanup 中删除。
