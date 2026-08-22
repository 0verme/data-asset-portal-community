# Flask Dependency Audit（F7 final classification）

审计基线：`origin/main` `f938b5e3caa8ea494748546bd051bc0bbb3c9096`（F6/#110 merge 后、F7/#112 开始前）。

## REMOVE（已完成）

- `Flask`、`Flask-Cors`：已从 `backend/requirements.txt` 删除；native runtime 不导入。
- Flask app factory/bootstrap、`backend/app/auth.py`、`backend/app/core/blueprint_registry.py`、`backend/app/routes/**`：已删除；生产只使用 `backend/asgi.py` / FastAPI routers。
- `backend/run.py`、`RuntimeDispatcher`、`FlaskRequestContextMiddleware`、`WSGIMiddleware`、`BACKEND_RUNTIME` runtime switch：已由 F6/F7 删除。
- Flask-only route/unit/parity wrappers：已删除或改写为 FastAPI/native tests；不保留假的 rollback 测试。

## KEEP with reason

- `Werkzeug==3.1.8`：`AuthService` 直接使用 `check_password_hash` / `generate_password_hash`，不是 Flask runtime dependency。
- `itsdangerous==2.2.0`：FastAPI Native `SignedSessionCodec` 保持既有 `session` cookie 的 signed format/expiration contract。
- `FLASK_SECRET_KEY`、`FLASK_ENV`、`FLASK_CORS_ORIGINS`：历史配置名称仍是 browser/cookie/security contract；实现不导入 Flask。
- `backend/app/fastapi_app.py`：保留为无 Flask 的薄 import facade，现有 tests/integrations 使用稳定 import path；删除需另行评估公开 import compatibility。
- `backend/app/application/**`、contracts、services、database provider、FastAPI routers：native/application/database boundary。
- `common_code_service.py`、`indicator_path_service.py`、`push_service.py`：WAIT_DB/Private source boundary；没有 native route，不因 F7 删除而抢 Database Lane 或改变 edition scope。

## TEST / SECURITY REWRITE

- API Contract、auth/session、security headers/body limit、proxy trust、authorization、Community/Private/WAIT_DB boundary 改为 FastAPI/native/framework-neutral tests。
- F5 gate 以 subprocess import guard 验证 `backend.asgi:app` 在 Flask/Flask-Cors 不可导入时可启动和处理 native request。
- Flask serializer compatibility 的原始证据保留在 F2 PR #103；F7 core tests 不再依赖 Flask package。

## HISTORICAL documentation

旧 P2/P3/P4 migration notes 中的 `Flask/FastAPI parity` wording 仅描述历史阶段；当前部署、architecture、API 和 Demo docs 使用 FastAPI Native 叙事。`docs/system-architecture.html` / `docs/system-architecture.archify.json` 是 versioned architecture output，当前版本以可审计的 `origin/main` source revision 为证据，不参与 runtime；后续 runtime 变化应重新生成或明确标记为 historical snapshot。

## Conclusion

```text
Flask runtime dependency: RETIRED
Flask / Flask-Cors backend dependency: REMOVED
Production runtime: Uvicorn → FastAPI → Application / Service → Database Provider
```

WAIT_DB 与 Private routes 仍按 F4 scope gate 排除，未为“清零 Flask 命中”而公开或改动 Database Lane。
