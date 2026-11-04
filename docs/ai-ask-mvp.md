# 单轮 AI 数据资产问答 MVP（Issue #513）

> 本文档描述 DAP Community Edition 的单轮元数据问答实现边界。AI 能力默认关闭；文档和自动化 Mock 不代表内网 RAG / DeepSeek 服务已联调或生产可用。

## Phase 0：基线审计与契约

审计基线：GitHub `main` / `origin/main` `3993e2bfc7a81c5770629401b802e0800c740af5`（2026-11-03 UTC）。相关事实：

| 范围 | 最新 GitHub main 已实现 | #513 增量 |
|---|---|---|
| 普通搜索 | `GET /api/search` 保持确定性搜索、分类、部分失败 `partial/failedGroups` 和稳定资产导航；最近 #512 合并了搜索模块事务故障隔离。 | 保留原接口和 Enter 默认行为，不将关键词搜索自动交给模型。 |
| 搜索 UI / RAG | #503 的中文 PR #505 已合并（`e70eaa38141f72aedf2212a2380a647a3093b8c4`）：单搜索框、普通资产搜索、默认关闭的 `GET /api/search/recommendations` 和可选 RAG 分组。#508 已合并（`450ddeeb13cbdef05babb061169611c4cc83a97e`）：DAP HTTP Search Service v1 客户端/契约与匿名目录投影。 | 在原页面旁增加显式“问 AI”入口、无精确匹配引导和同页单轮回答区域；RAG 建议与 AI 问答继续分离。 |
| 权威身份与可信边界 | `RagSearchService` 调用后端 RAG HTTP v1，并根据每个请求的 catalog profile，从当前 DAP 资产目录回查 table `assetId`、field `fieldId` 及字段父表；只从 DAP 元数据构造浏览器响应，不信任远端返回的名称/分数。 | 复用现有 RAG HTTP Client 与目录校验。LLM 只能引用当前 RAG 响应中的已校验 ID；候选卡片由 DAP 结构化数据生成。 |
| Provider / 配置 | 存在受保护的管理员 RAG 搜索配置及后端 `RAG_SEARCH_SERVICE_TOKEN`，不存在通用 LLM Provider、DeepSeek/OpenAI Client 或问答 API。 | 新增服务端可选 OpenAI-compatible provider 与 `AI_ASK_*` 环境配置，不向浏览器返回 URL、模型名或密钥。 |
| 详情导航 / 布局 | 搜索结果通过已有 `module=dwm` 与 stable `assetId` 进入 DAP 资产详情；结果区域上限 1200px，现有 860px / 600px 响应式规则。 | 候选表/字段卡均绑定父表 `assetId` 并复用详情路由；压缩搜索后的 Hero，增加字段/证据卡布局。 |
| 外部 RAG / 内网版本 | DAP #508 提供 HTTP v1 客户端契约；关联 `dap-rag-lab` #14 在 GitHub 当前仍 OPEN，不能据此认定外部 HTTP 服务已实现。 | 以 GitHub main 为唯一代码基线；未访问内网机器/服务，不把内网临时改动、DeepSeek Flash 部署或未合并 dap-rag-lab 工作假定为正式能力。 |

### 重叠与验收边界

- #513 与 #503 已合并的搜索 UI/RAG 推荐工作相邻，但不重建 `/api/search`、索引、Embedding 或 BGE；在保持单轮 `/api/ai/ask` 兼容的前提下，增加传输真实阶段状态和完整最终结果（不流式传 Token）的 `/api/ai/ask/progress` SSE 入口。
- #465 现有合并内容提供稳定目录/只读快照基础；#444 仍是架构 Roadmap；#414 管理显式降级；#511/#512 已修复搜索事务错误扩散。本 PR 不关闭这些关联 Issue，也不扩大到它们的范围。
- 外网自动化使用合成目录候选、Mock RAG HTTP 和 Mock LLM；不需要真实 DeepSeek、GaussDB、LanceDB 或业务数据。浏览器 E2E 只证明浏览器交互与 Mock API 契约，不代替内网链路或视觉人工验收。

## 架构

```text
DAP Search Portal
  ├─ Enter / “搜索” ── GET /api/search（原有确定性搜索）
  ├─ 可选 RAG 推荐 ─── GET /api/search/recommendations（原有 HTTP RAG adapter）
  └─ 显式“问 AI” ─── POST /api/ai/ask/progress（SSE 状态 + 完整最终结果）
                           │  原 POST /api/ai/ask JSON 接口继续兼容
                           ├─ 当前请求的 public-catalog profile
                           ├─ 复用 RagSearchService + HTTP Search v1
                           ├─ DAP 当前目录 authority check / stable-ID 检查
                           ├─ 最小证据上下文（不可信文本按数据处理）
                           ├─ OpenAI-compatible LLM Provider（后端配置、有限并发/超时）
                           └─ 严格 JSON 与引用 ID 校验 → 仅返回 DAP 候选/引用
```

DAP 不加载 embedding、BGE、向量库或 dap-rag-lab 包，不执行工具调用、SQL 或业务数值查询。每个请求独立，无会话/历史/持久化；SSE 仅传执行阶段状态及完整最终结果，不流式传输 LLM token。

## API 契约

### `GET /api/ai/status`

受现有 `require_public_catalog_access` 策略保护。只返回浏览器安全能力开关：

```json
{"enabled": false}
```

`enabled=true` 要求 `AI_ASK_ENABLED`、有效 LLM provider 配置和现有 RAG 配置/服务 Token 均就绪；不主动探测外部服务健康度。配置缺失、禁用或无法读取时前端 fail closed 并隐藏“问 AI”。服务运行时故障仍会由问答响应明确提示。

### `POST /api/ai/ask`

```json
{"query":"贷款余额在哪个表？","scope":"all","topK":10}
```

`query` trim 后 1–500 字符；本期 `scope` 仅为 `all`；`topK` 1–10，且不能超过管理员在既有 RAG 配置中的上限。额外字段（包括 session/conversation ID）拒绝。

成功结构示例（仅合成 ID）：

```json
{
  "status":"answered",
  "answer":"目录中存在可核实的相关候选，请查看下方资产卡片。",
  "citations":[{"assetId":123,"fieldId":456,"source":"dap_catalog"}],
  "candidates":[{
    "assetId":123,"fieldId":456,"assetType":"field",
    "tableName":"SYNTHETIC_TABLE","tableDisplayName":"合成表",
    "tableDescription":"合成说明","fieldName":"SYNTHETIC_FIELD",
    "fieldDisplayName":"合成字段","fieldDescription":"合成字段说明",
    "domain":"合成主题域","layer":"DWS","source":"dap_catalog",
    "matchReason":"字段、父表和稳定 ID 已由当前 DAP 目录校验。"
  }],
  "retrievalStatus":"available",
  "generationStatus":"completed",
  "reasonCode":null,
  "elapsedMs":12.5
}
```

状态语义：

- `answered`：至少一个模型引用精确匹配本次已校验候选；引用 ID 再次做 DAP 候选集合校验。
- `insufficient_evidence`：检索成功但没有可信证据，固定回答「当前元数据不足以确认。」；LLM 不得补造候选。
- `retrieval_unavailable`：RAG 禁用、不可用，或降级且无有效证据；不调用 LLM。
- `generation_unavailable`：AI/LLM 禁用、未配置、超时、并发忙、非法 JSON 或引用无效；不会伪装成无搜索结果。
- `retrievalStatus` 另区分 `available/degraded/unavailable/not_run`；`generationStatus` 区分 `completed/unavailable/disabled/not_run`。
- 候选卡片只由服务端 DAP 回查的元数据生成。模型输出不能提供表名/字段名作为可点击资产；候选的 `assetId` / `fieldId` 是唯一详情身份。检索分数不作为可信度或准确率返回。

### `POST /api/ai/ask/progress`（新增的状态传输，不替换旧接口）

请求体与 `POST /api/ai/ask` 相同。成功连接后以 `text/event-stream` 返回 `progress` 事件和一个 `result` 事件；进度事件不含用户问题、候选、LLM 输出或隐藏推理。`result` 仅在本请求实际执行的阶段结束后一次性携带完整 `AiAskResponse`（完整回答、DAP 校验候选和引用）；不传 LLM token 或增量文本。旧 JSON 接口仍调用相同服务并保持原响应形状。

每个进度事件仅含 `id`、`status`、`elapsedMs`，命中统计阶段另含 `tableCount` / `fieldCount`，失败阶段可含有限安全 `errorCode`。状态为 `pending`、`running`、`completed` 或 `failed`。服务只发布实际开始的阶段；例如无候选时不会出现 LLM 生成阶段。耗时由后端 `monotonic` 阶段计时，运行中的重复 `running` 心跳只更新实际经过的时间，不会合成完成状态。

阶段为问题输入规范化/配置校验、现有 RAG HTTP 检索、命中计数、候选整理、单次 LLM JSON 生成/引用校验，以及成功时的最终响应组装。表数为当前已校验命中的不同 `assetId` 数，字段数为不同 `(assetId, fieldId)` 数；零命中 `0/0` 只会在检索成功并实际得到空列表时发送，不以 RAG 索引总量或猜测值替代。

浏览器取消会 abort SSE；服务在阶段边界检查取消信号，并尝试关闭正在读取的 RAG/LLM HTTP 响应。取消可能发生在上游连接建立阶段，届时最多等待该现有客户端的配置 timeout；页面立即呈现「已取消」，旧请求结果不会覆盖后续提交。SSE 断连/超时不改变传统搜索，也不增加上游调用。

## LLM Provider 配置

| 环境变量 | 默认/范围 | 说明 |
|---|---|---|
| `AI_ASK_ENABLED` | `false` | 显式启用开关；默认关闭。 |
| `AI_LLM_BASE_URL` | 无 | OpenAI-compatible API base URL（例如经过批准的 HTTPS endpoint；本机 HTTP 仅限 loopback）。后端使用 `{base}/chat/completions`。 |
| `AI_LLM_MODEL` | 无 | 部署提供的模型标识，例如 DeepSeek Flash 实例对应的兼容模型名。 |
| `AI_LLM_API_KEY` | 无 | 可选 Provider 的服务端密钥；只由部署 Secret 注入，不写数据库、前端、仓库或日志。当前实现要求非空。 |
| `AI_LLM_TIMEOUT_MS` | `10000`；250–60000 | 单次 Provider 请求/响应总时限，覆盖流式 body 接收；不只是单次 read inactivity timeout。 |
| `AI_LLM_MAX_TOKENS` | `512`；64–4096 | 单次生成 token 上限。 |
| `AI_LLM_MAX_CONCURRENCY` | `2`；1–16 | DAP Provider 并发上限；满载立即返回安全的 busy 状态。 |

配置不完整、URL 不安全、取值超界或 `AI_ASK_ENABLED` 未开启时功能不可用。RAG 的 Service URL、TopK、Timeout 与 `RAG_SEARCH_SERVICE_TOKEN` 仍使用既有配置体系，LLM 配置不会覆盖它。

## 搜索与 AI 共存交互

- 首次进入保留 Hero 和原搜索；Enter 与「搜索」继续执行普通确定性搜索。
- 「问 AI」是显式动作，独立请求 `/api/ai/ask/progress`；兼容的 JSON `/api/ai/ask` 仍供既有客户端使用。常规搜索、热词、范围变化不会自动调用 LLM。
- 普通搜索成功且零结果才出现「没有找到精确匹配的资产」和「问 AI 找资产」，原问题直接沿用；部分搜索失败或接口失败不转换为空结果，也不显示无结果误导。
- 搜索结果和 AI 答案可在原页面共存；资产搜索、RAG 推荐、AI 候选按 stable ID 区分/去重。模型异常不清空普通搜索结果。
- AI 执行面板在请求期间默认展开并呈现后端实际阶段、状态、命中表/字段数和耗时；结束后折叠，可重新展开。失败/超时/取消均明确呈现；取消后可重新提交，旧响应不能覆盖新请求。模型生成期间只显示「正在生成回答」，完整 JSON 返回后一次性展示；不逐 token 输出。
- 检索失败、生成失败、无证据及 RAG 降级分别呈现；AI 关闭或状态接口失败时隐藏 AI 按钮。
- 模型摘要作为解释文本；资产名称、字段名、中文含义、来源和详情入口只由 DAP 校验后的候选卡呈现。

## Mock 测试与合成样例

后端测试通过 `httpx.MockTransport` 替代 RAG HTTP 和 OpenAI-compatible LLM，验证授权头/JSON 请求、异常/超时/并发上限、慢速分块响应的绝对 deadline 与超时后并发 slot 释放、prompt 注入文本隔离、模型输出格式、稳定 ID/父表校验及无证据拒答。Mock Secret 只存在测试进程内，不能在日志/响应泄露。

样例使用合成元数据覆盖字段定位、字段解释、多个余额相关字段、主题域、未登记字段和相近但不同的命名；没有将贷款/银行词汇写成 DAP 全局硬编码规则。浏览器 E2E 模拟 `/api/ai/status` 和 `/api/ai/ask/progress` SSE，不直连真实模型。

## 内网 DeepSeek 联调（待外部环境执行）

1. 在隔离测试部署中同步本 PR 的 DAP 后端/前端代码；确认 `dap-rag-lab` 的 HTTP Search Service v1 已实现、可用、且与 DAP #508 客户端契约匹配（当前 GitHub dap-rag-lab #14 仍 OPEN，执行前必须复核）。
2. 使用测试元数据和明确批准的目录访问 profile 配置现有 RAG Search；服务端注入 RAG Token，验证 `/api/search/recommendations` 本身能返回 DAP 回查后的真实 synthetic test assetId/fieldId。
3. 在 DAP 后端 Secret 中配置 LLM API Key；受保护的部署配置注入 HTTPS Base URL、模型名、timeout、max tokens/concurrency，并先保持 `AI_ASK_ENABLED=false`。
4. 用隔离测试账户启用 RAG 后验证 `GET /api/ai/status` 返回 `{enabled:true}`；通过 UI 显式提问，检查浏览器只访问 DAP `/api/ai/*`，不会请求 Provider URL，响应卡片 ID 与 DAP 详情接口一致。
5. 依次对正常候选、空检索、错误/失效 ID、含 prompt-injection 的合成描述、RAG 超时、LLM 超时/错误注入验证拒答与显式降级；确认 GET `/api/search` 在上述故障下仍可用。
6. 保存脱敏日志、精确 SHA、RAG/LLM 版本和实际检查结果；任何没有实际运行的项记 `NOT RUN`。本 PR 的外网 Mock CI 不替代这些证据。

本轮没有内网凭据或服务授权，真实 RAG HTTP、DeepSeek、GaussDB/LanceDB、内网浏览器和生产验证均 `NOT RUN`。

## 部署、功能关闭与回滚

- 没有 Schema/Migration/Seed 或新运行依赖；关闭 AI 不影响现有 `/api/search` / RAG 推荐配置和使用。
- 部署默认/回滚：`AI_ASK_ENABLED=false`（或 unset）、移除对应 LLM Secret/环境配置并重启 DAP 后端；`GET /api/ai/status` 应返回 `{enabled:false}`，前端隐藏按钮。
- 若 RAG/LLM 异常，保留服务状态并按日志外的安全错误码定位；不把原始问题、LLM 响应体、URL 或 Key 写入日志。恢复时先在隔离环境验证，再按普通配置流程启用。
- 回滚代码时先将 `AI_ASK_ENABLED=false` 并滚动重启，再部署上一个 DAP 版本；没有数据库回滚步骤。不要删除或更改现有 RAG 配置表/目录。
- 不执行生产部署、数据库操作或自动合并。

## 本地验证结果

| 检查 | 结果 |
|---|---|
| 后端全量 `python -m unittest discover -s backend/tests` | **PASS**：1165 tests，29 skipped；环境为 Python 3.11 + task-local 已安装依赖。最终改动后重新执行完整套件；AI API/service/LLM/RAG/RBAC focused suite **58/58 PASS**，含取消、超时、SSE、授权及 stable-ID 回归。 |
| 前端 `npm test` | **PASS**：405 个 source tests + 2 个 API-mode tests。 |
| Frontend static/build | **PASS**：`npm ci`、Lineage build/package verify、完整 typecheck、ESLint、`VITE_API_MODE=remote npm run build:frontend`；产物有既有 >500 kB bundle advisory。 |
| Browser E2E | **PASS**：`e2e/ai-ask.spec.ts` Chromium/WebKit **10/10**，覆盖完整回答、零证据、禁用、超时、重试、取消及旧响应隔离；1440/1280/860/600 宽度无横向溢出。 |
| Community boundary / hygiene | **PASS**：Public Data Guard 扫描 374 files，BLOCKER=0、SUSPICIOUS=0；`git diff --check` PASS。 |
| npm audit | **NOT RUN**：本任务未更改依赖或 lockfile；npm audit 不作为本地验收证据。 |
| Migration / database | **PASS**：offline verify（SQLite/PostgreSQL/MySQL/DWS）全通过；本改动无 Schema/Migration/Seed/数据库依赖，真实数据库联调 **NOT RUN**。 |
| 其他 Playwright specs | **NOT RUN**：仅执行本 Issue 的 AI 问答 E2E；未声称全仓浏览器套件通过。 |

本地 Mock / synthetic 测试结果不代替 PR GitHub CI；CI 在创建 PR 后由远端 exact-HEAD workflow 实测。

## 未完成与未验证项

- dap-rag-lab #14 HTTP server 实现及内网 DeepSeek Flash 的具体 wire compatibility 尚未通过真实联调确认；不得宣称已在目标服务验证。
- 真实 GaussDB、生产、DeepSeek、内网真实 RAG、模型性能/准确率、真实业务元数据均非本 PR 自动化测试范围，保持 `NOT RUN`。
