# Flask Dependency Audit（F6/F7 boundary）

审计基线：`origin/main` `d9ca29302886798caf4c9f89f650d7d875bbdf80`（F5/#108 merge 后、F6/#110 开始前）。

执行的搜索：

```bash
rg -n "from flask import|import flask|create_app|flask Blueprint|WSGI|WSGIMiddleware|backend.run" backend docs DEPLOYMENT.md
```

## 分类

### KEEP_COMPAT

- `backend/asgi.py`：纯 FastAPI/Uvicorn composition、native health/CORS/security headers；不再创建 Flask application 或 WSGI bridge。
- `backend/app/__init__.py`：legacy Flask app factory、CORS、security/error handlers；production native runtime 不导入/调用，待 F7 按引用清理。
- `backend/app/core/blueprint_registry.py`：legacy Flask blueprint registration；F6 后不再由 production composition 调用，待 F7 分类清理。
- 已迁移模块的 Flask routes：Assets、Field Mapping、Indicator、Root、Manual Code Table、Report、API Asset、Lineage、System Management、Operation Log、Upstream；保留为 legacy contract/test evidence，未挂载到 production runtime。
- `backend/app/auth.py` 与 Flask auth routes：保留 signed-session compatibility source/test evidence；默认 production Auth 已由 native router 承载，待 F7 清理。
- `backend/app/fastapi/auth.py` 与 `backend/app/application/session.py`：FastAPI native 读取和写入与 Flask 兼容的 signed `session` cookie；不使用 Flask `session` proxy。
- `backend/app/services/operation_log_service.py`：F1 已通过 framework-neutral `RequestContext` 获取 audit metadata；不再依赖 Flask adapter runtime。
- `backend/run.py`：已由 F6 删除；direct Flask WSGI/emergency runtime retired。

### KEEP_TOOLING

- backend tests 中的 `create_app`、Flask test client 与 security regression fixtures；它们固化 Flask/FastAPI parity 与 rollback。
- `docs/community-demo.md` 的 `uvicorn backend.asgi:app`：Community demo/dev startup，与 production 使用同一纯 FastAPI entrypoint。

### WAIT_DB

- `backend/app/routes/common_code.py` / `common_code_service.py`：legacy `fetch_all` database implementation，尚无对应已合并 Database Lane Core PR。
- `backend/app/routes/indicator_path.py` / `indicator_path_service.py`：legacy `fetch_all` database implementation，尚无对应已合并 Database Lane Core PR。
- `backend/app/routes/push.py` / `push_service.py`：尚无对应已合并 Database Lane Core PR。

这些模块不得通过 Framework Lane adapter 绕过 Database Lane Gate。

### KEEP_INFRASTRUCTURE / OUT_OF_SCOPE

- `capabilities`、`portal`、`search`：F3 已建立 thin FastAPI native infrastructure adapters；legacy Flask common blueprints 未挂载 production，待 F7 清理。
- `docs/system-architecture.html`：生成的 architecture artifact；本轮由 `docs/system-architecture.archify.json` 更新并重新生成，后续应继续修改 source 后再 deliver。

### REMOVE / F7

F6 已移除 `RuntimeDispatcher`、`FlaskRequestContextMiddleware`、`WSGIMiddleware`、`BACKEND_RUNTIME` runtime switch 与 `backend/run.py`。F7 继续分类并清理 Flask package dependencies、legacy blueprints/tests、dead imports 与历史文档。

## 结论

FastAPI 已是唯一 production runtime，覆盖 `/api/auth`、capabilities/portal/search common infrastructure 与已满足 gate 的 Community API；F5/F6 gate 已证明 `backend.asgi:app` 可在 Flask import blocked 的隔离子进程中运行。Flask 相关 factory/blueprints/tests/dependencies 仍是 F7 legacy cleanup debt，但不再参与 production fallback/rollback runtime。
