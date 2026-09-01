# 智能问数底座与语义推荐路线

> 状态：**Phase 1 — Semantic Contract：已实现基础能力**。本文描述产品定位和后续技术路线；Phase 1 已提供稳定资产引用、最小聚合契约和确定性校验，但不代表 AI 推荐或语义检索已经上线。任何后续能力仍必须完成数据口径与跨数据库方案评审。

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

以下能力仍未实现：

- 向量表、Embedding 生成与增量刷新。
- LLM 调用、结构化输出组装和推荐结果持久化。
- Semantic Retrieval 与离线评测集。
- 跨 PostgreSQL、GaussDB/DWS、Community SQLite 的统一向量检索方案。

因此不能把关键词搜索无结果直接等同于触发 LLM，也不能把 `candidate` 或现有 `suggestion` 字段表达为已认证指标。

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

### Next — Phase 2 Deterministic Retrieval + Offline Evaluation

1. 建立 golden semantic query dataset。
2. 基于 keyword / aliases / roots / fields / indicators 做确定性召回。
3. 输出 Recall@K / Precision@K 等 baseline。
4. 在没有 Embedding 的情况下评估真实召回质量。
5. 只有离线评测数据充分后，才决定是否需要 Embedding、Vector DB 或后续 LLM 组装。

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
