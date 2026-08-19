# P0 — Flask Security / Production Audit (Issue #16 第一阶段)

## Audit Matrix

| ID | Area | Current State | Risk | Proposed Fix | P0? |
|----|------|---------------|------|--------------|-----|
| F1 | Runtime / Dependencies | Flask==3.1.1，存在 CVE-2026-27205（低危，session 访问未设置 `Vary: Cookie`，缓存代理场景可能泄露用户级响应）；3.1.3 修复 | Medium | 升级 Flask==3.1.3（patch 级）；显式 pin Werkzeug==3.1.8（当前仅隐式 `>=3.1`，<3.1.4 有 CVE-2025-66221 Windows DoS） | ✅ |
| F2 | Runtime / Dependencies | Flask-Cors==5.0.0，存在 CVE-2024-6844（path 经 unquote_plus 规范化不一致）与 CVE-2024-6866（路径匹配大小写处理缺陷）；本项目使用 `resources={r"/api/*"}` path 模式，直接受影响 | High | 升级 Flask-Cors==6.0.1（6.0.0 修复，行为兼容） | ✅ |
| F3 | Runtime / WSGI | DEPLOYMENT.md 生产推荐 `python run.py`（Flask development server）；无 waitress/gunicorn 生产 WSGI 指引 | High | 部署文档改为推荐生产 WSGI（waitress 示例），`run.py` 标注为开发/本地入口 | ✅ |
| F4 | Runtime / Debug | `FLASK_DEBUG` 默认 false，但 production 下显式设置 `FLASK_DEBUG=true` 仍会开启 Werkzeug debugger（远程代码执行面） | High | production 环境 `FLASK_DEBUG=true` → 启动即失败（fail-fast） | ✅ |
| C1 | Session / Cookie | SECRET_KEY 缺失即启动失败；HttpOnly=True；SameSite=Lax；Secure 按 FLASK_ENV（production 默认）；PERMANENT_SESSION_LIFETIME=14d；无硬编码 secret；session 仅存 role/user/name；logout 会清除 cookie | Info | 已合规，无需代码变更；补 regression test 固化 | ❌ |
| O1 | CORS | 显式 allowlist（`FLASK_CORS_ORIGINS`），未配置即不启用 CORS；无 `*`；credentials 与 allowlist 组合正确；development 通过同一机制显式配置 | Info | 已合规；依赖升级（F2）修复底层路径匹配缺陷 | ❌ |
| P1 | Proxy / Forwarded Headers | 无 ProxyFix；`operation_log._request_context` 无条件信任 `X-Forwarded-For` 首个 IP（攻击者可直接伪造审计日志 IP；Nginx 反代场景真实 IP 依赖该头） | Medium | 默认拒绝 XFF；仅当显式配置 `ASSET_TRUST_PROXY_HEADERS=true` 时采用；文档说明 Nginx 部署启用 | ✅ |
| E1 | Error Handling | 多个 service 的 `*DataSourceError` 把底层异常（psycopg/JDBC 消息、本地文件名）拼入 message，经 `error.to_dict()` 原样返回客户端（500），泄露主机/端口/路径/连接串线索 | High | sanitize：客户端 message 替换为通用文案；底层细节只进服务端日志（保留 code/status 不变） | ✅ |
| E2 | Error Handling | 仅注册 404/500 handler；400/405/413/415 等返回 Flask 默认 HTML，结构不一致 | Medium | 补充统一 JSON error handler（不泄露内部信息，保持 404/500 结构一致） | ✅ |
| R1 | Request Boundary | 无 `MAX_CONTENT_LENGTH`（超大 JSON body 无上限）；无文件上传功能 | Medium | 增加可配置请求体上限（默认 16 MiB，env 可调）+ 413 统一 JSON 响应 | ✅ |
| R2 | Request Boundary | 分页上限（APP_PAGE_SIZE_MAX=200）、搜索 limit 上限（50）已存在；路径/查询参数多数经 int()/isdigit() 校验 | Info | 已合规，无变更 | ❌ |
| H1 | Security Headers | 无 X-Content-Type-Options / X-Frame-Options / Referrer-Policy | Medium | 增加三个无副作用 header（nosniff / SAMEORIGIN / strict-origin-when-cross-origin） | ✅ |
| H2 | Security Headers | 无 CSP | Low | P1：需先验证 Vite 构建产物兼容性，本轮不开启（避免 breaking） | ❌ |
| H3 | Security Headers | 无 HSTS | Low | P1：部署为内网 HTTP + Nginx 终止 TLS，HSTS 应在 Nginx 层配置；在 Flask 默认开启会对本地 HTTP 开发错误生效 | ❌ |
| S1 | Secrets / Config | 仓库无真实 secret（safety_scan + gitignore）；`.env.example`/`database.community.yaml` 均为占位符；SECRET_KEY 缺失 fail-fast | Info | 已合规，无变更 | ❌ |
| L1 | Logging | `facade` 的 `LOGGER.exception` 会把 DB 异常 traceback 写入日志文件（可能含连接信息，但仅本地文件、不含客户端）；审计日志敏感字段脱敏已实现；LOG_FORMAT 无敏感字段 | Low | 现有的 facade 日志行为可接受（本地文件）；完整 scrub 记入 P1 | ❌ |
| A1 | Auth / Authorization | 全部写操作有 `require_maintainer`/`require_admin`；admin 专属路由边界正确；读操作匿名是设计（门户浏览）；private 模块蓝图在 Community 不注册（`/api/upstreams`、`/api/push`、`/api/reports`、`/api/manual-code-tables` 返回 404） | Info | 已合规；跑现有 `test_disabled_modules` / `test_community_boundary` 验证 | ❌ |
| A2 | Auth / Authorization | SQL 使用 `_quote` 手写单引号转义模式（非 parameterized query）；抽查未发现可利用注入点，但属薄弱面 | Medium | P1：渐进迁移 parameterized query | ❌ |
| T1 | Regression Tests | 已有 `test_flask_security_config`、`test_repo_safety_guard`、`test_disabled_modules`、`test_community_boundary` | Info | 新增：production config fail-fast、error sanitization、request limit、proxy trust、依赖安全版本约束 | ✅ |

## P0 Implementation Plan

- P0.1 Production configuration：F1/F2（依赖升级 + pin）、F3（文档）、F4（debug fail-fast）
- P0.2 Session / Cookie / Secret hardening：C1 已合规 → 仅补测试
- P0.3 CORS / Proxy trust boundary：O1 已合规；P1（proxy trust 开关）
- P0.4 Error exposure / request boundary：E1（sanitize）、E2（统一 error handler）、R1（MAX_CONTENT_LENGTH）
- P0.5 Security regression tests：T1（覆盖 F4/P1/E1/E2/R1 + 现有 C1/O1 固化）
- P0.6 Deployment / security documentation：F3（DEPLOYMENT.md / DEVELOPMENT.md）、H3 说明

## Non-P0（记录不执行）

- H2 CSP：P1
- H3 HSTS：P1（Nginx 层）
- L1 日志 scrub：P1
- A2 参数化查询：P1
- 其余架构解耦 / API Contract：P1 / P2（见 Epic 路线）