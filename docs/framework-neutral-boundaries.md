# Framework-Neutral Boundary Audit

本文件记录 #16 P1 的边界审计结果。P1 的目标不是一次性清零所有 Flask import，而是把 HTTP runtime 依赖限制在 adapter/bootstrap 层，同时让 application primitive 可以在没有 Flask Request Context 的情况下测试。

## 已建立的基础设施

`backend/app/application/` 是 framework-neutral package，当前包含：

- `Identity`：保留当前 `admin` / `maintainer` 身份语义；
- `RequestContext`：显式传递 identity、request id 和 client address；
- `ApplicationError`：transport-independent 的错误 code/message/details/status metadata。

该 package 不允许导入 Flask 或其他 HTTP framework。Flask adapter 负责把 runtime state 转换成这些对象。

## Flask 依赖分类

| 位置 | 依赖 | 分类 | 处理 |
| --- | --- | --- | --- |
| `app/__init__.py` | `Flask`、`g`、`jsonify`、HTTP error handlers | bootstrap / HTTP adapter | KEEP；负责 app factory、middleware 和 response mapping |
| `app/core/blueprint_registry.py` | `Flask` | bootstrap / route registration | KEEP；只负责 blueprint 装配 |
| `app/routes/**` | `request`、`jsonify`、`Blueprint` | HTTP adapter | KEEP；P2/P3 逐模块替换，不在 P1 大规模重写 |
| `app/auth.py` | `session`、`jsonify` | Flask auth adapter | 已收敛；session 读写与 JSON 响应留在 adapter，身份规则进入 `app/application` |
| `app/services/operation_log_service.py` | `g`、`request` | service leak / DB Lane hotspot | WAIT；不在 Framework Lane 与 Database Lane 同时改动 |
| `app/services/**` 其他模块 | 无直接 Flask request/session 依赖（按本轮扫描） | application/service | KEEP；后续以 module DB_READY Gate 逐步接入 `RequestContext` |

## 迁移规则

1. 新 application/service code 不得 import `flask.request`、`flask.session`、`jsonify` 或 Flask Response。
2. Flask/FastAPI adapter 创建 `RequestContext`，不要让 core 读取 runtime proxy。
3. 认证只复用当前身份语义；RBAC（#32）不属于本阶段。
4. Database Lane 正在迁移的 service 不在本阶段顺手重构。
5. 每个后续模块先做 Flask/FastAPI parity，再决定是否 retire Flask route。

## 验证

- `backend/tests/test_framework_neutral_foundation.py` 在无 Flask request context 下验证身份、授权错误和 application error。
- 剩余 Flask import 使用以下审计命令复核，并按上表分类：

```text
rg -n "from flask import|import flask|jsonify|current_app|\\bg\\b|make_response|abort\\(" backend/app
```
