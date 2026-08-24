# Framework-Neutral Boundary Audit

本文件记录 #16 P1 边界在 F1-F7 完成后的收敛结果：production HTTP runtime 已为 FastAPI Native，application primitive 与 service 不依赖 Flask request-local state；历史 Flask adapter 已退出 production 并按 F7 清理。

## 已建立的基础设施

`backend/app/application/` 是 framework-neutral package，当前包含：

- `Identity`：保留当前 `admin` / `maintainer` 身份语义；
- `RequestContext`：显式传递 identity、request id 和 client address；
- `ApplicationError`：transport-independent 的错误 code/message/details/status metadata。

该 package 不允许导入 Flask 或其他 HTTP framework。FastAPI native adapter 负责把 runtime state 转换成这些对象。

## Flask 依赖分类

| 位置 | 依赖 | 分类 | 处理 |
| --- | --- | --- | --- |
| `app/__init__.py` | package marker，不导入 HTTP framework | native package boundary | KEEP；production composition 位于 `backend/asgi.py` |
| `app/core/blueprint_registry.py` | 历史 Flask blueprint registry | retired bootstrap | F7 已删除 |
| `app/routes/**` | 历史 Flask HTTP adapters | retired adapters | F7 已删除；native routers 位于 `app/fastapi/routers/` |
| `app/fastapi/auth.py` / `application/session.py` | signed session codec | FastAPI native adapter | KEEP；application-owned HMAC-SHA256 cookie；旧格式只读迁移，不导入 Flask |
| `app/services/operation_log_service.py` | neutral `RequestContext` | application/service | KEEP；不读取 Flask request-local state |
| `app/services/**` 其他模块 | 无直接 Flask request/session 依赖 | application/service | KEEP；按 module DB_READY Gate 使用 neutral `RequestContext` |

## 迁移规则

1. 新 application/service code 不得 import `flask.request`、`flask.session`、`jsonify` 或 Flask Response。
2. FastAPI adapter 创建 `RequestContext`，不要让 core 读取 runtime proxy。
3. 认证只复用当前身份语义；RBAC（#32）不属于本阶段。
4. Database Lane 正在迁移的 service 不在本阶段顺手重构。
5. 每个模块以 native contract/security regression 为准，legacy Flask route 不得重新成为 production runtime。

## 验证

- `backend/tests/test_framework_neutral_foundation.py` 在无 Flask request context 下验证身份、授权错误和 application error。
- residual historical Flask text/source 使用以下审计命令复核，并按上表分类：

```text
rg -n "from flask import|import flask|jsonify|current_app|\\bg\\b|make_response|abort\\(" backend/app
```
