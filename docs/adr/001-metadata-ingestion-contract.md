# ADR-001：建立版本化 Metadata Ingestion Contract

- 状态：Accepted
- 日期：2026-08-22
- 范围：#114 Phase A–D
- 当前说明：本文保留决策时的历史上下文；其中“未来 RBAC”措辞不代表当前授权实现。当前使用 permission-based RBAC，Contract / Service 仍保持 framework-neutral。

## Context

外部 Collector 需要提交资产和血缘元数据，但不应依赖 `p_asset_*`、`p_lineage_*`、内部主键、Provider 或 migration。仓库当前已经有 FastAPI Native、Application / Service Layer、SQLAlchemy Core、Database Provider 和 Alembic head；本 ADR 在这些边界之上增加一个 additive integration contract（deployment/integration concern，不是 `/api/capabilities` module payload），不改写现有 CRUD / read API。

## Decisions

| # | Decision | Reason | Alternatives / Consequences |
| --- | --- | --- | --- |
| 1 | 外部边界是 `Collector → JSON Metadata Contract → FastAPI /api/metadata → MetadataIngestionService`。 | Collector 与内部 schema 解耦。 | 内部 migration、seed、repair、maintenance 和 tests 仍可直接操作数据库；不制定“所有操作必须 HTTP”。 |
| 2 | `source` 表示被描述的真实系统；`collector` 表示产生 payload 的程序；`source.namespace` 是 source 内可选逻辑域。 | Collector 升级不应改变资产自然键。 | 不把 collector version 放进 asset key；source identity 以规范化 JSON 的 SHA-256 作为内部实现值。 |
| 3 | Asset 自然键是 `(source identity, assetType, externalId)`；没有 `externalId` 时以 `qualifiedName` 作为 fallback。 | 隔离不同 source 的同名对象，并支持稳定外部 ID。 | 不使用单独的 `table_name` 全局唯一键。 |
| 4 | `externalId` 不变而 `qualifiedName` 改变时执行 update/rename。 | 稳定 ID 能表达 rename。 | 没有 external ID 的 rename 会形成新 key；不会猜测旧对象。 |
| 5 | 缺失对象只在 payload 声明 `authoritative=true` 时返回 `deleteCandidate`；V1 不 destructive delete。 | 防止网络/采集失败导致全量删除。 | 后续可独立设计 inactive / review workflow。 |
| 6 | Asset Contract 使用 `contractVersion`（当前 `1.0`），JSON 响应使用 camelCase；服务同时接受 snake_case 输入。 | 与现有 API 风格一致，并方便非 Python Collector。 | 未知 major 明确拒绝；未知字段按 additive-field policy 忽略。 |
| 7 | Lineage 外部发布完整 snapshot；V1 只支持 `snapshot.mode=replace`。 | self-contained snapshot 易于校验、重试、回滚和激活。 | `append` / `merge` 保留为未来版本，不在 V1 引入孤儿边和 stale graph 算法。 |
| 8 | Snapshot identity 是 `(source identity, importId/externalSnapshotId)`；相同 identity + 相同 content hash 返回 `already_applied/unchanged`，不同内容返回 conflict。 | 重试安全且不覆盖历史 import 意义。 | 内部使用稳定 hash 生成 snapshot/import storage IDs；这些不是数据库 PK contract。 |
| 9 | Snapshot 必须 self-contained：edge 的 source/target 必须引用当前 `nodes[]`；完全重复 node/edge deterministic deduplicate，内容冲突返回 conflict。 | Referential integrity 在边界内一次完成。 | 不允许默认引用未知历史节点。 |
| 10 | Bulk limit 由环境可覆盖的常量保护：assets 1000、fields/asset 1000、total fields 10000、nodes 10000、edges 20000、body 8 MiB。 | 保护 Pydantic memory 和 DB batch，禁止逐字段 HTTP 与无限 body。 | 超限返回 413；业务语义错误在写库前汇总。 |
| 11 | Asset request validation 完成后整请求一个 transaction；任一 persistence failure rollback 全请求。 | 不产生半批资产。 | V1 不做跨 chunk partial success；未来大于上限的 chunking 属于独立演进。 |
| 12 | Lineage 采用 inactive insert → node/edge insert → deactivate old ACTIVE → activate new → commit。 | 失败时旧 ACTIVE 仍由 transaction rollback 保护。 | 不使用不跨方言的 `LOCK TABLE`；复用现有 Provider transaction seam。 |
| 13 | `dryRun=true`（或 `mode=preview`）只执行 normalize / compare / semantic validation，不写业务表，也不写 Operation Log。 | dry-run 无副作用且可用于 CI。 | 预览结果不可通过 status endpoint 查询；正式 ingestion 才有 audit record。 |
| 14 | 每次正式请求生成 UUID `ingestionId`，并返回 `correlationId`、status、summary、items/errors。 | 客户端不依赖内部 PK，便于 retry / log correlation。 | item error 只包含 index、externalKey、code、message、field，不含 stack trace。 |
| 15 | Ingestion audit 复用 `OperationLogService.batch_audit` / `p_operation_log`；`GET /api/metadata/ingestions/{id}` 从 audit summary 读取结果。 | 不创建重复的 metadata ingestion read table。 | audit 只存 source、collector、ID、counts、snapshot、result 和 error summary，不存完整 payload。 |
| 16 | API resource family 为 `/api/metadata`，当前 contract major 为 v1；breaking API 变化使用新的 `/api/v2/metadata` family，contract major 同步升级。 | 保持仓库已有 `/api` prefix，同时区分 API path version 与 `contractVersion`。 | V1 不建立 schema registry 或自动 migration registry。 |
| 17 | Ingestion 写入复用当前 `require_maintainer` auth seam；Contract / Service 不依赖 FastAPI 或具体 auth framework。 | 当前即可工作并兼容未来 #32 RBAC。 | 不在 #114 实现 RBAC；未来只替换 route dependency。 |
| 18 | Asset mapping 只把 source metadata 映射到现有 asset/field service model；`layer_code`、`domain_code` 等 DAP governance classification 不强制由 Collector 提供。 | 防止 source metadata 与 DAP enrichment 混淆。 | V1 允许这些内部分类为空，维护 API 仍保留现有语义。 |
| 19 | Reference implementation 只包含 PostgreSQL catalog collector 与 JSON lineage producer，通过 HTTP Contract 调用 DAP。 | 证明边界可被第三方实现。 | 不做 scheduler、connector framework、parser、OpenLineage、DataHub/OpenMetadata compatibility。 |

## Contract shape

Asset request 的最小公共字段为：

```json
{
  "contractVersion": "1.0",
  "source": {"type": "postgresql", "name": "warehouse-prod", "namespace": "finance"},
  "collector": {"name": "postgresql-reference", "version": "0.1.0"},
  "assets": [{
    "externalId": "public.orders",
    "qualifiedName": "public.orders",
    "assetType": "table",
    "schema": "public",
    "name": "orders",
    "description": "订单表",
    "fields": [{
      "name": "order_id",
      "dataType": "integer",
      "nullable": false,
      "primaryKey": true,
      "ordinalPosition": 1,
      "description": "订单编号"
    }]
  }]
}
```

Lineage request 的 `snapshot`、`nodes[]` 和 `edges[]` 是同一份 self-contained graph；edge 的 `sourceId` / `targetId` 只能引用当前 node identity。

## Persistence impact

`0004_metadata_ingestion_identity` 将 source-scoped identity、qualified name 和 lineage content/import bookkeeping 纳入 canonical schema。`p_asset_table.table_name` 不再承担跨 source 的 global unique 约束；legacy rows 的新增列保持 nullable。四方言 baseline、Alembic forward migration、SQLAlchemy Core table declarations 和 schema verification 同步更新。`p_lineage_snapshot`、`p_lineage_node`、`p_lineage_edge` 的 ownership 由 #116 已合入的 `0003_open_repository_modules` 固化，本 ADR 只复用，不再创建第二套 lineage storage。

## Consequences

- Collector 可以只依赖 JSON/HTTP，不需要导入任何 DAP 数据库模块。
- portal 现有 CRUD、lineage read API 及其 Public Catalog / protected ingestion boundary 保持不变；新增 ingestion contract 是 additive。
- source identity hash 是实现细节，未来替换内部表结构时只要 V1 mapping 兼容，Collector 不需修改。
- V1 的 replace-only lineage 语义使 rollback 明确，但 append/merge 需要未来单独的 contract decision。
