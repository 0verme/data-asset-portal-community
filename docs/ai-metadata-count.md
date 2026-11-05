# 单轮 AI 问答的权威元数据表数（Issue #521）

本文记录 AI 问答统计能力的审计口径与 API 集成约定。它不代表任何部署具有固定的业务表数量；自动化验证仅使用合成目录，运行时统计始终读取当前 DAP 目录的精确 COUNT，不引用任何环境观察值作为常量或验收依据。

## Phase 0：数据资产页面统计审计

当前实现以 `backend/app/fastapi/routers/assets.py` 的 `GET /api/assets/tables?summary=1` 为页面分页入口，并调用同一个 `AssetsService.get_asset_table_page()`：

1. `_select_asset_rows()` 使用 `_build_asset_filters()`，以 `asset_table.is_deleted = 'N'` 为底层资产范围；可选 `domain`、`layer`、schema、owner、keyword 继续沿用现有列表过滤。
2. `domain` 和 `layer` 都存在时分别追加谓词，再以 AND 组合。域名按当前 `p_asset_domain.domain_code` 映射；分层按 `p_asset_table.layer_code` 精确过滤。
3. 正常分页通过 `COUNT(*) OVER()` 得出过滤后行数；超出范围的空页调用 `_count_asset_rows()`。页面 total 不等于当前页长度。
4. `_count_asset_rows()` 使用与列表相同的 `_build_asset_filters()`，对 `p_asset_table` 做精确 `COUNT(*)`。本次新增的 `AssetsService.count_asset_tables()` 仍调用此私有计数路径，只在其外层增加当前 facet 目录值重验；没有复制 SQL 或改成 RAG 数量。
5. `p_asset_table.asset_id` 是稳定主键；过滤计数不 join 字段表，且域表的 `domain_code` 是主键，所以表名相同但 `asset_id` / source 不同的记录仍各计一行，不会按名字错误合并。
6. 目录 API 与 AI 计数使用同一 `AssetsService` / `ASSET_DB_PROFILE`。`PUBLIC_CATALOG_PROFILE` 的现行策略是投影字段/文本可见性，不是按用户拆分资产行；页面与问答都保留相同目录行范围。`disabled` 匿名目录仍由既有 `require_public_catalog_access` 拒绝；已认证请求依既有规则使用 `internal` 投影，游客使用配置的公开 profile。当前目录不存在不同用户的资产行 ACL；若未来引入此类行级可见性，资产列表和统计须共同扩展，不能只在 AI COUNT 添加规则。
7. `get_asset_count_filter_catalog()` 取自现有资产页 domain/layer facet 查询。当前 facet 逻辑按未删除资产计算 facet count，但 facet option 本身沿用既有查询，不额外过滤维度表的 `is_active` / `is_deleted`；意图校验故意复用该页面合法值口径。

因此组合过滤使用当前资产页的精确 total；不同 page/pageSize 不改变总数。不存在按表名 distinct、按字段 join 或依赖外部 RAG 候选的计数语义。

## 受控意图解析

`backend/app/services/ai_metadata_count.py` 只识别有限的“几张/多少张表、表数量/总数、how many tables/table count”等统计表达式。`“余额在哪张表”` 不含统计意图，保持原有 RAG 路径。

识别统计问题后，域名、域代码、分层代码和分层展示名均从本次请求的 DAP facet catalog 解析。对当前配置的 layer display name，解析器只做通用文本变体（去掉展示名中的“数据”前缀和“层”后缀）；例如当前目录若登记 `数据集市层`，则“集市”可映射至**该行当前对应的 layer code**，不会预设该 code 必为 `DM`。域名/分层无法唯一解析、跨维度短语重叠、出现多个值或保留无法识别的业务词时，返回 `ambiguous_scope`，不猜测为全目录统计或最相似候选。

解析完成后，count service 在执行同一只读数据库事务内重新校验 domain code/name 和 layer code/name 仍与当前 facet catalog 对应；维度发生变化时安全返回歧义，不沿用过期映射。所有查询均经现有 SQLAlchemy Provider 和参数绑定执行，不接受模型 SQL、任意表名或业务数据查询。

## `POST /api/ai/ask` 统计响应契约

精确统计绕过 RAG 和 LLM，不把统计总量伪装成 citation 或“模型生成成功”。成功时返回：

```json
{
  "status": "metadata_count_answered",
  "answer": "当前 DAP 目录中，合成主题域、数据集市层共有 73 张数据表。",
  "citations": [],
  "candidates": [],
  "metadataCount": {
    "metric": "table_count",
    "value": 73,
    "filters": {
      "domain": {"code": "SYN521", "displayName": "合成主题域", "matchedAs": "catalog_value", "inferred": false},
      "layer": {"code": "DM", "displayName": "数据集市层", "matchedAs": "catalog_alias", "inferred": true}
    },
    "source": "dap_catalog",
    "complete": true,
    "catalogProfile": "strict",
    "sourceLink": "/data-warehouse?domain=%E5%90%88%E6%88%90%E4%B8%BB%E9%A2%98%E5%9F%9F&layer=DM"
  },
  "retrievalStatus": "not_run",
  "generationStatus": "not_run",
  "resultsTruncated": false,
  "reasonCode": null,
  "elapsedMs": 2.5
}
```

响应状态：

- `metadata_count_answered`：`metadataCount.complete=true` 且 value 来自真实 DAP COUNT；合法的 `0` 原样返回。`citations/candidates=[]`，RAG 与 generation 均为 `not_run`。
- `ambiguous_scope`：当前目录映射不唯一、词义不能确认或解析值与实时 catalog 不一致；不含数字。
- `metadata_count_unavailable`：目录/数据库读取失败、统计证据非法或无法安全生成响应链接；不含 `0` 或任何数字。
- 原有 `answered`、`partial_answer`、`insufficient_evidence`、`retrieval_unavailable`、`generation_unavailable` 的语义和引用校验不变。非 count 响应不允许携带 `metadataCount`。

`sourceLink` 是相对 DAP 路由 `/data-warehouse`，只带与当前统计完全相同的 `domain` / `layer` 参数，不生成 host 或假路径；域名称若被当前公开投影规则脱敏，则使用相同列表 Service 支持的稳定域代码。AI 文本与结构化 filters 均由后端确定性构造，LLM 不可改写值和条件。

`POST /api/ai/ask/progress` 沿用既有 SSE envelope，统计意图在 `analyzing` event 上附加可选 `intent=metadata_count`；普通资产问答不增加字段。刷新当前 running event 后，UI 可据此显示“正在查询目录统计”；count 路径不发出旧 `counting` 候选步骤（该步骤只描述 RAG candidate 数量），不把权威统计误显示为 Top-K 命中数量。计数证据仅在最终 `result.metadataCount` 返回。

## 与 #520 前端的对接边界

`frontend/src/api/aiAsk.ts` 已为三个统计状态、`metadataCount` 与可选 progress `intent` 增加严格解析，并要求 sourceLink 保持站内数据资产页；不修改 `SearchPortalPage.tsx`、搜索首页布局、组件 CSS 或 #520 双 Tab 行为。当前通用答案区域可显示确定性 `answer`；若 #520 要增加统计结果专属展示，应在 AI 结果渲染层读取 `metadataCount.value/filters/sourceLink`，不得从 answer 文本或 `candidates.length` 反解析数字。该 API Adapter 的后续交叠需在 #520 分支独立协调。

## 验证边界

自动化使用专属 SQLite 合成目录：73 个目标组合资产、其他域资产、软删除资产、两个 source 下同名资产。测试对比 AI COUNT 与现有 page total，并覆盖分页大小、零值、歧义、查询异常、RAG 仅有 4 个候选但不参与 COUNT、Profile、原 RAG 引用校验与旧单轮流程。没有读取真实内网业务目录；真实内网目录总数对照、DeepSeek、RAG HTTP、GaussDB/DWS 和生产验证均为 `NOT RUN`。
