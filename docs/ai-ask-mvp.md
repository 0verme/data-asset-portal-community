# 单轮 AI 数据资产问答 MVP（Issue #513）

> 本文档描述 DAP Community Edition 的单轮元数据问答实现边界。AI 能力默认关闭；文档和自动化 Mock 不代表内网 RAG / DeepSeek 服务已联调或生产可用。

## 当前状态（`origin/main` 基线 `f7a8450`）

本文最初为 Issue #513 的 PR 记录，后续 #516 / #521 / #526 / #534 / #542 继续演进。为避免把历史 PR 描述当成当前事实，先列明当前 `main` 的实际状态：

| 事项 | `main` 实际状态 | 依据 |
|---|---|---|
| `GET /api/ai/status` | 已实现；受 `require_public_catalog_access` 保护；只返回 `{"enabled": boolean}` | `backend/app/fastapi/routers/ai_ask.py`；`backend/tests/test_ai_ask_api.py` |
| `POST /api/ai/ask` | 已实现，JSON 响应；兼容接口，当前 UI 不直接使用 | 同上 |
| `POST /api/ai/ask/progress` | 已实现，SSE `progress` + 单个 `result`；兼容接口，当前 UI 不直接使用 | `test_progress_endpoint_emits_safe_sse_and_keeps_existing_json_api` |
| `POST /api/ai/ask/stream` | 已实现；**当前前端 UI 实际使用的传输**（`frontend/src/api/aiAskExecution.ts`），SSE 真实阶段 + 单个 `answer` + 终止 `done` | `test_execution_stream_*`；`frontend/e2e/ai-ask.spec.ts` |
| 搜索页结果区 Tab | 「搜索结果」与「AI 问答」双 Tab，带 `role="tablist"` 与方向键导航 | `frontend/src/components/SearchPortalPage.tsx` |
| 统计意图（表数/字段数） | 已实现，走 DAP 目录精确 COUNT，不复用 RAG 候选计数 | `docs/ai-metadata-count.md`；`backend/app/services/ai_metadata_count.py` |
| Mock 演示适配器 | `VITE_API_MODE=mock` 专用，动态导入；Remote 零回退 | `frontend/src/mock/aiAsk.ts`；`frontend/scripts/verify-remote-ai-isolation.mjs` |
| 真实 RAG 服务 / 真实 LLM 端点联调 | **NOT VERIFIED** | 无外部环境证据 |
| 真实回答准确率、GaussDB / LanceDB 实测 | **NOT VERIFIED** | 无外部环境证据 |

下面的“Phase 0”“回答质量修复”“本地验证结果”等章节保留为**历史 PR 记录**，数字与结论对应当时那次 PR 的本地运行，不代表当前 `main` 的 CI 结果。

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
  └─ 显式“问 AI” ─── POST /api/ai/ask/stream（当前 UI 使用：SSE 真实阶段 + 完整最终结果）
                           ├─ POST /api/ai/ask/progress（兼容：SSE progress + result）
                           ├─ POST /api/ai/ask（兼容：单次 JSON）
                           │
                           ├─ 当前请求的 public-catalog profile
                           ├─ 复用 RagSearchService + HTTP Search v1
                           ├─ DAP 当前目录 authority check / stable-ID 检查
                           ├─ 最小证据上下文（不可信文本按数据处理）
                           ├─ OpenAI-compatible LLM Provider（后端配置、有限并发/超时）
                           └─ 严格 JSON 与引用 ID 校验 → 仅返回 DAP 候选/引用
```

DAP 不加载 embedding、BGE、向量库或 dap-rag-lab 包，不执行工具调用、SQL 或业务数值查询。每个请求独立，无会话/历史/持久化；三个 SSE / JSON 入口都不流式传输 LLM token。

## 回答质量修复（起始基线 `b245fd38e52756e802857b1a4bb19fe31598c65b`；冲突整合后包含最新 main `3dc668b42c7dcb7a4d4b46a6089ae11cfd7fdbef`）

Phase 0 复核 PR #514 合入后的实现，确认根因是回答策略和证据契约过度保守，而不是 RAG 没有返回候选：旧 System Prompt 明确禁止模型复述候选表名/字段名；API 仅有 `answered` 与 `insufficient_evidence` 两种证据结果；服务把空 citations 一律变成拒答，没有二次核验证据遗漏；前端把所有已校验 RAG 候选都标为相关候选，既不能筛除无关字段，也无法表达部分回答。问答请求最多 topK 10，列表问题没有不完整标记。

后续实现调整为：

- System Prompt 定义企业数据资产助手，保留不可信元数据、Prompt Injection、禁止 SQL/越权/秘密泄露规则；模型只能返回 `questionType` 与按稳定 ID 选择的结构化 `claims`，不得产生自由文本答案。
- DAP 服务逐一校验 claim 的 `(assetId, fieldId)` 与本次目录候选完全匹配，只保留 `direct` / `related`；`context_only` 不进入回答。表名、字段名、中文名与描述全部由 DAP 使用当前校验后的目录元数据组成，避免“一个有效 citation 为整段自由文本背书”。候选卡与 citations 一一对应。
- 有候选但模型未选择时，执行最多一次更严格的结构化证据复核。复核后仍无相关 claim 才返回 `insufficient_evidence`；Provider/JSON/身份校验错误返回明确 `generation_unavailable`，不显示未筛选候选为回答。
- 新增 `partial_answer`：列表问题使用既有 RAG HTTP Search v1 topK 上限扩到最多 20（仍受管理员 topK 上限约束；只对列表问题且请求 topK 为 10 时启用），非列表请求保持原 topK。RAG 不提供完整清单保证，因此列表回答始终明确为本次有界检索的部分结果；降级检索和仅有间接线索也不冒充完整直接回答。
- 列表答案按表归组、对稳定 ID 去重，并把直接证据与相关线索分开；UI 仅显示答案引用的已校验表/字段、标明相关性并复用现有 DAP 详情导航。完整目录枚举若需要超出 RAG v1 有界搜索的改造，不在本 PR 范围内。

真实目录、RAG HTTP、DeepSeek 的准确性仍须在授权隔离环境验证；Mock 只证明结构化选取、身份校验、回退和 UI 契约，不代表真实模型效果。

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

`query` trim 后 1–500 字符；本期 `scope` 仅为 `all`；API `topK` 1–10。列表问题仅在请求 topK 为 10 时，服务端可向现有 Search v1 请求最多 20 条候选，且始终受管理员 RAG topK 上限约束；其他问题保持请求 topK，不扩大模型上下文。额外字段（包括 session/conversation ID）拒绝。RAG 是有界相关性检索，不承诺全目录枚举，列表答案标记为部分结果。

成功结构示例（仅合成 ID）：

```json
{
  "status":"answered",
  "answer":"根据当前 DAP 目录，以下资产可直接支持回答：\n- 数据表：合成表（SYNTHETIC_TABLE）\n  字段：合成字段（SYNTHETIC_FIELD）",
  "citations":[{"assetId":123,"fieldId":456,"source":"dap_catalog"}],
  "candidates":[{
    "assetId":123,"fieldId":456,"assetType":"field",
    "tableName":"SYNTHETIC_TABLE","tableDisplayName":"合成表",
    "tableDescription":"合成说明","fieldName":"SYNTHETIC_FIELD",
    "fieldDisplayName":"合成字段","fieldDescription":"合成字段说明",
    "domain":"合成主题域","layer":"DWS","source":"dap_catalog",
    "matchReason":"RAG 命中字段；字段、父表和稳定 ID 已由当前 DAP 目录校验。",
    "relevance":"direct"
  }],
  "retrievalStatus":"available",
  "generationStatus":"completed",
  "resultsTruncated":false,
  "reasonCode":null,
  "elapsedMs":12.5
}
```

状态语义：

- `answered`：至少一个 `direct` claim 精确匹配本次已校验候选；回答文字由服务端元数据组装，引用与候选一一对应。
- `partial_answer`：存在已验证的直接/相关证据，但问题为有界列表、检索降级或仅有间接线索；说明当前范围不完整，不声称完整清单。`resultsTruncated=true` 显式标记列表/降级检索受当前候选上限约束（服务不返回遗漏总数，因此表示可能截断而非精确遗漏数量）；仅有相关线索时为 `false`。
- `insufficient_evidence`：没有足以支持问题的证据；回答说明当前目录检索未找到可验证资产，不显示未筛选候选。
- `retrieval_unavailable`：RAG 禁用、不可用/超时，或降级且无有效证据；不调用 LLM，不误判成无数据。
- `generation_unavailable`：AI/LLM 禁用、未配置、超时、并发忙、非法 JSON 或引用身份无效；不显示模型自由文本或未筛选候选。
- `retrievalStatus` 另区分 `available/degraded/unavailable/not_run`；`generationStatus` 区分 `completed/unavailable/disabled/not_run`。
- 候选卡片只由服务端 DAP 回查的元数据生成。模型只能返回结构化候选身份与直接/相关关系；回答中的表/字段名也由服务端元数据生成。稳定 `assetId` / `fieldId` 是唯一详情身份。检索分数不作为可信度或准确率返回。

### `POST /api/ai/ask/progress`（兼容的状态传输）

> 当前前端 UI 不再直接调用此入口，它已由 `POST /api/ai/ask/stream` 取代；此入口继续保留并测试，供既有客户端使用。

请求体与 `POST /api/ai/ask` 相同。成功连接后以 `text/event-stream` 返回 `progress` 事件和一个 `result` 事件；进度事件不含用户问题、候选、LLM 输出或隐藏推理。`result` 仅在本请求实际执行的阶段结束后一次性携带完整 `AiAskResponse`（完整回答、DAP 校验候选和引用）；不传 LLM token 或增量文本。旧 JSON 接口仍调用相同服务并保持原响应形状。

每个进度事件仅含 `id`、`status`、`elapsedMs`，命中统计阶段另含 `tableCount` / `fieldCount`，失败阶段可含有限安全 `errorCode`。状态为 `pending`、`running`、`completed` 或 `failed`。服务只发布实际开始的阶段；例如无候选时不会出现 LLM 生成阶段。耗时由后端 `monotonic` 阶段计时，运行中的重复 `running` 心跳只更新实际经过的时间，不会合成完成状态。

阶段为问题输入规范化/配置校验、现有 RAG HTTP 检索、命中计数、候选整理、LLM 结构化候选选择与引用 ID 校验（初轮无相关 claim 时最多进行一次有界复核），以及成功时的最终响应组装。表数为当前已校验命中的不同 `assetId` 数，字段数为不同 `(assetId, fieldId)` 数；零命中 `0/0` 只会在检索成功并实际得到空列表时发送，不以 RAG 索引总量或猜测值替代。

浏览器取消会 abort SSE；服务在阶段边界检查取消信号，并尝试关闭正在读取的 RAG/LLM HTTP 响应。取消可能发生在上游连接建立阶段，届时最多等待该现有客户端的配置 timeout；页面立即呈现「已取消」，旧请求结果不会覆盖后续提交。SSE 断连/超时不改变传统搜索，也不增加上游调用。

### `POST /api/ai/ask/stream`（当前 UI 使用的执行流）

请求体与 `POST /api/ai/ask` 相同。事件名为 `step_start` / `step_complete` / `step_error` / `answer` / `done` / `keep_alive`，每个事件都带 `request_id`，前端会拒绝请求标识不一致或事件顺序异常的流：

- `step_*`：后端实际执行的阶段与 `elapsedMs`；统计意图阶段 `step_id=metadata-count`，命中数量以 `hits` 字段返回。
- `answer`：仅在本请求确实产生答案时出现一次，携带完整 `AiAskResponse`；不会出现第二个 `answer`。
- `done`：终止事件，携带 `status`（`completed` / `failed` / `cancelled`）与 `reasonCode`。
- `keep_alive`：长连接保活，不携带业务数据。

与 `/ask/progress` 的差异：`/ask/stream` 传输执行面板所需的细粒度事件，`/ask/progress` 传输进度状态加单个最终结果。两者共享同一后端服务、同一证据契约与同一 fail-closed 行为，均不逐 token 输出模型文本。

## 前端 Tab 与实际状态

搜索页结果区（`frontend/src/components/SearchPortalPage.tsx`）使用两个 `role="tab"` 项：

| Tab | 状态文案 | 触发方式 |
|---|---|---|
| 搜索结果 | 搜索中 / 搜索失败 / 已搜索 / 未搜索 | Enter 或「搜索」；只调用 `GET /api/search` |
| AI 问答 | 问答中 / 执行失败 / 已完成 / 未提问；AI 未启用时显示「暂不可用」 | 显式点击「问 AI」或零结果时的「问 AI 找资产」；调用 `/api/ai/status` 与 `/api/ai/ask/stream` |

Tab 支持 `ArrowLeft` / `ArrowRight` / `Home` / `End` 键盘导航；两个面板通过 `aria-controls` / `aria-labelledby` 关联。传统搜索永不自动切到 AI Tab，模型异常也不清空搜索结果。

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
- 「问 AI」是显式动作，独立请求 `/api/ai/ask/stream`（当前 UI）；兼容的 `/api/ai/ask/progress` 与 JSON `/api/ai/ask` 仍供既有客户端使用。常规搜索、热词、范围变化不会自动调用 LLM。
- 普通搜索成功且零结果才出现「没有找到精确匹配的资产」和「问 AI 找资产」，原问题直接沿用；部分搜索失败或接口失败不转换为空结果，也不显示无结果误导。
- 搜索结果和 AI 答案可在原页面共存；资产搜索、RAG 推荐、AI 候选按 stable ID 区分/去重。模型异常不清空普通搜索结果。
- AI 执行面板在请求期间默认展开并呈现后端实际阶段、状态、命中表/字段数和耗时；结束后折叠，可重新展开。失败/超时/取消均明确呈现；取消后可重新提交，旧响应不能覆盖新请求。模型生成期间不逐 token 输出，最终回答一次性返回。
- 检索失败、生成失败、无证据、部分回答与 RAG 降级分别呈现；AI 关闭或状态接口失败时隐藏 AI 按钮。
- 模型只输出候选稳定 ID 和相关性；回答文字、候选卡、表/字段名、中文名、描述和来源由 DAP 使用当前校验后的元数据生成，候选与 citations 一一对应。

## Mock 测试与合成样例

后端测试通过 `httpx.MockTransport` 替代 RAG HTTP 和 OpenAI-compatible LLM，验证授权头/JSON 请求、异常/超时/并发上限、慢速分块响应的绝对 deadline 与超时后并发 slot 释放、prompt 注入文本隔离、选择型 JSON Contract、稳定 ID/父表校验、空选择有界复核、直接/间接相关性及无证据降级。Mock Secret 只存在测试进程内，不能在日志/响应泄露。

样例使用合成元数据覆盖字段定位、字段解释、多个余额相关字段、主题域、未登记字段和相近但不同的命名；没有将贷款/银行词汇写成 DAP 全局硬编码规则。浏览器 E2E 模拟 `/api/ai/status` 和 `/api/ai/ask/stream` SSE，不直连真实模型。

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

## 本地验证结果（历史记录 · Issue #513 当次 PR）

> 以下数字与结论对应当时那次 PR 的本地运行，不是当前 `main` 的 CI 结果，也不代表外部服务已联调。当前状态的权威来源是 GitHub Actions 与 `main` 上的实际代码/测试。

| 检查 | 结果 |
|---|---|
| 后端全量 `python3 -m unittest discover -s backend/tests` | **PASS**：1176 tests，29 skipped（Python 3.11.2 + task-local dependencies；260.606s）。AI Ask files 36/36、LLM Provider 10/10、RAG service 13/13、RBAC route enforcement 5/5 focused tests 均通过。 |
| 前端 `npm test` | **PASS**：405 个 source tests + 2 个 API-mode tests；完整 typecheck、ESLint、Lineage build/package verify、`VITE_API_MODE=remote npm run build:frontend` 均 PASS。 |
| Browser E2E | **PASS**：`e2e/ai-ask.spec.ts` Chromium/WebKit **12/12**（合成 DAP API + SSE fixture），覆盖普通搜索隔离、部分清单、零证据、禁用、超时、重试、取消/旧响应隔离及 1440/1280/860/600px 布局检查。 |
| Community boundary / hygiene | **PASS**：Public Data Guard 扫描 374 files，BLOCKER=0、SUSPICIOUS=0；`compileall` 与 staged/working-tree `git diff --check` PASS。 |
| npm audit | **PASS**：`npm audit --audit-level=high` exit 0，0 vulnerabilities；未修改依赖或 lockfile。 |
| Migration / database | **NOT APPLICABLE**：本 PR 无 Schema/Migration/Seed/数据库依赖改动；真实数据库验证保持 **NOT RUN**。 |
| 未筛选全部 Playwright specs | **NOT RUN**：本地只运行本 Issue 的 AI Q&A E2E；其他浏览器 specs 未运行。 |

本地 Mock / synthetic 测试结果不代替 GitHub CI；PR 创建后须以远端 exact-HEAD workflow 结果为准。

## 未完成与未验证项

- dap-rag-lab #14 HTTP server 实现及内网 DeepSeek Flash 的具体 wire compatibility 尚未通过真实联调确认；不得宣称已在目标服务验证。
- 真实 GaussDB、生产、DeepSeek、内网真实 RAG、模型性能/准确率、真实业务元数据均非本 PR 自动化测试范围，保持 `NOT RUN`。

## Issue #521：权威资产目录统计

单轮问答现在可在 RAG/LLM 之外识别受控的表数意图，使用同一资产列表过滤与精确 COUNT，并通过 `metadataCount` 证据契约返回结果；SSE 进度附带 `intent=metadata_count` 与普通问答区分，不复用 RAG 候选计数步骤。审计口径、歧义/失败状态、筛选链接和与 #520 的前端集成边界见 [`ai-metadata-count.md`](ai-metadata-count.md)。统计结果不属于 RAG citation，不标记模型生成成功。
