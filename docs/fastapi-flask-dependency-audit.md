# Flask Dependency Audit（P5-C）

审计基线：`origin/main` `f099aaa05901bb83e976721243eb9b7145970840`（F1/#99 merge 后、F2/#102 开始前）。

执行的搜索：

```bash
rg -n "from flask import|import flask|create_app|flask Blueprint|WSGI|WSGIMiddleware|backend.run" backend docs DEPLOYMENT.md
```

## 分类

### KEEP_COMPAT

- `backend/asgi.py`：`WSGIMiddleware`、`create_app`、`FlaskRequestContextMiddleware`；P5 primary/fallback dispatcher 和 Flask signed-session/request-context compatibility seam 仍在使用。
- `backend/app/__init__.py`：Flask app factory、CORS、security/error handlers；Flask imports 已延迟到 `create_app()`，fallback 与 `backend/run.py` 仍使用。
- `backend/app/core/blueprint_registry.py`：Flask blueprint registration；fallback 仍注册全部 legacy API。
- 已迁移模块的 Flask routes：Assets、Field Mapping、Indicator、Root、Manual Code Table、Report、API Asset、Lineage、System Management、Operation Log、Upstream；它们是 rollback/fallback 路径，不能删除。
- `backend/app/auth.py` 与 Flask auth routes：保留 Flask signed-session / blueprint fallback 作为 rollback boundary；默认 FastAPI primary 的 `login/me/logout` 已由 native router 承载。
- `backend/app/fastapi/auth.py` 与 `backend/app/application/session.py`：FastAPI native 读取和写入与 Flask 兼容的 signed `session` cookie；不使用 Flask `session` proxy。
- `backend/app/services/operation_log_service.py`：F1 已通过 framework-neutral `RequestContext` 获取 audit metadata；Flask adapter 仍为 fallback 路径提供 context。
- `backend/run.py`：直接 Flask WSGI emergency rollback。

### KEEP_TOOLING

- backend tests 中的 `create_app`、Flask test client 与 security regression fixtures；它们固化 Flask/FastAPI parity 与 rollback。
- `docs/community-demo.md` 的 `uvicorn backend.asgi:app`：Community demo/dev-only startup，使用 FastAPI primary，不属于生产 cutover。

### WAIT_DB

- `backend/app/routes/common_code.py` / `common_code_service.py`：legacy `fetch_all` database implementation，尚无对应已合并 Database Lane Core PR。
- `backend/app/routes/indicator_path.py` / `indicator_path_service.py`：legacy `fetch_all` database implementation，尚无对应已合并 Database Lane Core PR。
- `backend/app/routes/push.py` / `push_service.py`：尚无对应已合并 Database Lane Core PR。

这些模块不得通过 Framework Lane adapter 绕过 Database Lane Gate。

### KEEP_INFRASTRUCTURE / OUT_OF_SCOPE

- `capabilities`、`portal`、`search`：F3 已建立 thin FastAPI native infrastructure adapters；Flask common blueprints 仍保留为 fallback/rollback，不得删除。
- `docs/system-architecture.html`：生成的 architecture artifact；本轮由 `docs/system-architecture.archify.json` 更新并重新生成，后续应继续修改 source 后再 deliver。

### REMOVE

当前没有安全可证明冗余、且不被 fallback、rollback、tests、CLI 或 compatibility path 使用的 Flask adapter/dependency，因此本轮 **REMOVE = empty**。删除工作必须在后续独立 PR 中以 runtime trace、全量测试和 rollback 证据为前提。

## 结论

FastAPI 已是迁移 prefix、`/api/auth` 与 capabilities/portal/search common infrastructure 的 primary runtime；F5 native gate 已证明核心 FastAPI composition 可在 Flask import blocked 的隔离子进程中运行。Flask 仍是有意保留的 fallback/compatibility runtime，而不是未审计的遗留代码；机械删除 Flask 仍会破坏 WAIT_DB 模块、Flask rollback、fallback blueprints 或紧急 rollback，因此本阶段不执行。
