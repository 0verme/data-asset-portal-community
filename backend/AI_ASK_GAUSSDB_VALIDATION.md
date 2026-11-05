# AI 问答 GaussDB/JDBC 隔离联调清单

本文用于部署方在**隔离的内网测试环境**验证 GaussDB/JayDeBeApi/JDBC 连接、执行、结果读取超时及进程隔离。它不是 CI 前置条件；Community CI 使用 JDBC/阻塞 Mock，不连接内网数据库。不得把真实 host、用户名、密码、完整 URL、Token 或授权头写入 Issue、PR、日志或截图。

## 0. 安全与前置条件

- [ ] 使用专属、可丢弃的测试 DAP Profile / GaussDB 测试对象；不得将故障注入或长查询指向生产/共享业务对象。
- [ ] 确认部署 JVM、JPype、JayDeBeApi 和目标 GaussDB JDBC JAR 版本兼容；JAR 仅从受信部署位置加载。
- [ ] 通过部署 Secret 注入凭据，确认 `AI_ASK_ENABLED`、RAG URL / Token 等仅在隔离测试环境启用。
- [ ] 使用默认限额或经维护者批准的更低值：`AI_ASK_MAX_CONCURRENCY=2`、`AI_ASK_MAX_QUEUE=4`、`AI_ASK_QUEUE_WAIT_MS=2000`、`AI_ASK_DB_TIMEOUT_SECONDS=10`。
- [ ] 准备可在测试 Profile 上执行的资产列表、字段映射、健康检查 API 验证请求；确认记录测试开始时的 worker PID、服务 PID 与日志位置（日志不得包含凭据）。

## 1. 静态配置确认（无需打印 JDBC URL）

在与服务相同的 Python/JVM 环境中检查 Profile，但只输出脱敏后的 timeout 参数和值：

- `loginTimeout` 是有限正整数秒数；
- `connectTimeout`、`socketTimeout` 是有限正整数毫秒数；
- 显式配置的较短 timeout 被保留，较长/零/重复值被收紧为有效限额；
- AI 子进程的有效 `connect_timeout`、`socket_timeout` 和 `statement_timeout_ms` 分别不超过 AI DB timeout 对应值；
- JDBC 连接初始化时会执行当前版本支持的 server-side `statement_timeout` 设置；设置失败时连接必须失败关闭，不能静默退回无限等待。

在测试数据库会话中，按目标 GaussDB 版本支持的只读命令确认实际 session statement timeout；记录验证结果和数据库版本，不记录连接信息。

## 2. 建连超时

- [ ] 使用专属测试 Profile 指向维护者批准的不可达/丢包测试端点，配置短的 `ASSET_DB_CONNECT_TIMEOUT_SECONDS`；不要扫描网段或影响共享网络。
- [ ] 触发一次 AI 问答并记录请求时间、连接错误码及总耗时；确认连接失败不超过设置的连接限额与合理进程启动开销。
- [ ] 同时检查健康检查和普通资产列表可响应；确认失败日志只含 profile/provider/错误分类，不含 JDBC URL、host、账号或密码。

## 3. SQL 执行超时

- [ ] DBA 为测试 Profile 提供目标版本认可、无业务写入、执行时间可控的测试语句/只读测试对象；不要假定不同 GaussDB 版本支持同一种睡眠函数。
- [ ] 先从该测试会话确认 server-side `statement_timeout` 生效，再让受控测试请求执行该操作。
- [ ] 记录 SQL 执行超时是否由 JDBC/服务端实际返回、耗时及安全错误码；确认连接不会被当作成功结果复用。

## 4. ResultSet 读取阻塞与可回收隔离（重点）

- [ ] 使用维护者批准的 JDBC 测试代理/网络故障注入，在测试查询已开始返回数据后阻断后续 ResultSet 网络读取；若目标环境提供等价的 JDBC 驱动级读取故障注入，可使用该机制。
- [ ] 通过 `/api/ai/ask/stream` 发起候选读取；确认日志能区分 HTTP 检索与 DAP 候选目录校验阶段，并记录候选规模、数据库调用次数和耗时。
- [ ] 等待配置的 JDBC socket timeout；若驱动仍未返回，确认父进程在数据库阶段硬期限内终止并回收**隔离 AI worker 进程**，而不是仅记录一个 Python Future/线程超时。
- [ ] 用进程清单确认该 worker PID 已退出；确认 SSE 有 `retrieval_unavailable` / `retrieval_timeout` 或与实际失败阶段相符的明确终态，未输出未验证 RAG 内容。
- [ ] 取消进行中的问答并重复提交；确认断开连接会触发 worker 停止/回收，不会持续累积 worker 进程或 `ai-ask-rag` 线程。

## 5. 并发、过载与普通 API 可用性

- [ ] 并发提交超过活动上限与有界队列容量的问答；确认接受数量不超过 `AI_ASK_MAX_CONCURRENCY`，队列不超过 `AI_ASK_MAX_QUEUE`。
- [ ] 超过容量或排队期限后，确认 SSE / JSON 返回现有结构中可解释的 `generation_unavailable` + `reasonCode=llm_busy`，并提示稍后重试；不得静默挂起。
- [ ] 在 AI worker 执行/超时期间，反复请求 `/healthz`、普通资产列表、字段映射读取 API；记录延迟和响应码，确认无 AI JDBC 调用占用 FastAPI 事件循环。
- [ ] 验证 SQLite / PostgreSQL Profile 下同一组 API 与 AI Mock 回归；报告中将本项与真实 GaussDB 结果分开。

## 6. 证据与结论记录

每项分别标记 `PASS` / `FAIL` / `NOT RUN` / `SKIPPED`，写明部署版本、JDK/JDBC 驱动版本、配置 timeout 数值、阶段耗时、返回状态、worker 是否退出，以及验证人/日期。禁止把 Mock 或未执行的内网步骤写成真实 GaussDB PASS。保存日志和截图前先清除 host、账号、连接串、Secret、Cookie 与 Authorization 数据。
