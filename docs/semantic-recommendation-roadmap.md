# 智能问数底座与语义推荐路线

> 状态：**Phase 1 — Semantic Contract 已实现；DAP #503 提供默认关闭的 HTTP Client Adapter 与合成契约测试**。dap-rag-lab #14 的最终接口和真实服务联调尚未验收。普通关键词搜索仍是主路径；此工作不代表 RAG 在线可用、LLM、智能解答或经业务验收的语义准确率已经上线。

## 1. 产品定位

资产门户是智能问数的前置底座，不是问数执行引擎。门户负责沉淀可被机器理解和验证的资产、字段、指标、口径、来源与血缘；未来的问数服务消费这些可信元数据完成查询理解、指标选择和 SQL 生成。

从“资产盘点”到“问数就绪”仍需补齐：可执行指标口径、维度/过滤条件、结果字段、版本与认证状态，以及稳定的资产契约。语义推荐应定位为治理者的指标建模助手，而不是面向最终用户自由生成指标。

## 2. 当前依赖与缺口

当前仓库已有统一搜索 Provider、资产/字段/指标/词根/上下游/血缘元数据和 `/api/search` 契约。Semantic Foundation Phase 1 已实现：

- 指标通过 `source_asset_id` / `result_field_id` 稳定引用 `p_asset_table.asset_id` / `p_asset_field.field_id`。
- 保留 `result_table_name` / `result_field_name` 作为兼容与展示快照，稳定 ID 为机器校验依据。
- 提供小集合 `SUM`、`COUNT`、`COUNT_DISTINCT`、`AVG`、`MIN`、`MAX`、`NONE` 聚合契约。
- 提供独立于 `enabled` / `disabled` 的 `semantic_state` 生命周期（`candidate`、`certified`、`deprecated`）。
- 创建/更新时执行 asset、field、归属关系、聚合、生命周期和状态的 deterministic validation。
- 既有指标只在表名/字段名精确且唯一匹配时 backfill；歧义或无法匹配保持 NULL，不猜测。

DAP #503 增加了**可选、默认关闭**的 HTTP Client Adapter 与独立推荐 UI：DAP 仅向配置的 RAG Search Service 发送带服务 Bearer Token 的 HTTP 请求；本地只执行合成协议解析与 DAP 权威目录复核，不导入 RAG Python、不加载模型/索引、不执行 CLI。推荐仅使用当前请求可见的共享目录资产；远端服务失败、超时、ID 不存在或目录不可用时 fail closed，不影响确定性关键词搜索。DAP 与 RAG 服务间的最终字段/错误码仍待 Issue #14 对齐，现有 MockTransport 测试不是在线联通证据。

仍未实现或验收：

- dap-rag-lab #14 最终 HTTP 契约对齐及经授权环境的真实服务联调；DAP 当前只覆盖本地合成 HTTP contract。
- 在线索引刷新、完整快照/撤权传播契约和跨实例原子切换。
- LLM 调用、智能解答、结构化输出组装与推荐结果持久化。
- 有业务标注的 golden query 离线评测，以及不同领域的召回质量验收。
- PostgreSQL、GaussDB/DWS、Community SQLite 的统一向量存储方案；DAP 本身不读取任何 RAG 索引。

因此不能把关键词搜索无结果直接等同于触发 LLM，也不能把相关资产推荐表达为已认证指标；`candidate` 或现有 `suggestion` 仍不等于已认证口径。

## 3. 候选推荐链路

候选链路分四段：

1. **召回**：从主题域、表字段、词根和已认证指标中检索候选资产。
2. **组装**：LLM 只能在召回集合中选择并生成受 schema 约束的候选指标。
3. **校验**：未来推荐候选必须复用 Phase 1 的确定性验证，检查资产 ID、字段归属、聚合方式、来源和结果字段均真实存在。
4. **人工确认**：推荐结果进入指标维护流程，不直接成为可执行生产口径；`semantic_state=certified` 只能代表后续人工认证结果。

建议输出至少包含候选指标名称、业务定义、聚合方式、来源资产、结果字段、主题域、证据和置信度。所有引用使用稳定资产 ID，不允许模型自由编造表、字段或归属。

## 4. 存储与兼容策略

原始方案建议在 PostgreSQL 使用 `pgvector` 和本地中文 Embedding 模型。这只是一种部署候选：

- `pgvector` 不是 GaussDB/DWS 或 SQLite 的通用能力。
- 完整版可能部署在 PostgreSQL 或 GaussDB/DWS；Community/local 可能使用 SQLite。
- 不能把向量扩展写入通用初始化 DDL，也不能让未启用语义推荐的环境承担模型和扩展依赖。

落地前应在以下方案中单独决策：PostgreSQL 可选扩展、独立向量服务、离线候选索引，或先用确定性文本召回验证产品价值。默认不新增依赖、不改变现有数据库基线。

## 5. API 演进原则

- 保持现有关键词搜索行为与响应兼容。
- 语义推荐使用显式能力开关；不可用、超时或校验失败时返回正常搜索结果，不影响门户搜索。
- 推荐响应必须区分“检索命中”“模型候选”和“已认证指标”。
- LLM 输出先做严格 JSON schema 校验，再校验所有资产引用；失败结果不得展示为可信建议。
- 不向模型发送密码、连接串、账号、Token 或无关生产样例。

## 6. 建议落地顺序

### Already implemented — Phase 1 Foundation

1. 最小指标语义 contract 与聚合枚举。
2. 指标与表字段的稳定 ID 引用及兼容快照。
3. 历史数据的唯一精确匹配 migration backfill。
4. 可复用的 deterministic validator 与 API/维护页适配。

### Delivered — DAP #503 Optional Related-Asset Retrieval Adapter

1. 保持现有确定性 `/api/search` 与一个普通用户搜索框。
2. 增加独立、默认关闭的 `/api/search/recommendations` 契约和业务展示分组。
3. 仅通过独立 HTTP Client Adapter 调用预期的 RAG Search API；DAP 不依赖 `dap-rag-lab` 包，也不强制安装 LanceDB、PyTorch 或 BGE。
4. 对每次 HTTP 返回按公共目录 profile 重查 ID 和父子关系，只用 DAP 当前投影重建展示内容；不信任远端名称、描述、URL、证据或分数。
5. 管理配置有 RBAC 与审计；服务 Token 来自后端部署 Secret，不发给浏览器。管理员可显式请求 health/readiness 诊断；普通搜索失败不阻塞。
6. 与 dap-rag-lab #14 的最终契约及真实联调仍是待完成前置条件，不将 synthetic tests 描述成真实联通。

### Next — Offline Evaluation + Refresh Contract

1. 建立含授权数据边界的 golden query set，覆盖同义词、歧义、无匹配与撤权。
2. 在获批的非生产环境报告 Recall@K / Precision@K 和当前索引完整性；不可将实验/内网记录当作本仓库测试结果。
3. 设计完整目录快照、变更检测、撤权和原子更新契约后，再决定是否引入在线刷新或持久化向量服务。
4. 如未来需要 LLM/智能解答，另立范围；必须将答案来源限制为经过权威校验的候选并经人工治理评审。

## 7. 验收前置条件

### Phase 1 Foundation（已满足）

- API/Service 接受并返回稳定 asset/field ID，且保留旧字符串字段。
- field 必须属于 source asset；不存在或已删除的引用不能写入。
- 历史 backfill 只接受唯一精确匹配，歧义保持 NULL。
- `status` 继续使用 `enabled` / `disabled`，不把 `draft` 引入通用状态。
- PostgreSQL、GaussDB/DWS 和 Community SQLite 的通用 baseline 不依赖额外扩展。
- `/api/search` 保持原关键词搜索路径，不触发 AI fallback。

### 后续推荐能力

- 推荐所引用的资产和字段 100% 可解析到门户实体。
- 未认证候选不会被表达为正式指标。
- 模型不可用时关键词搜索无回归。
- 有离线评测集覆盖同义词、歧义词、无匹配、复合聚合和恶意输入。
