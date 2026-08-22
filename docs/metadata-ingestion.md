# Metadata Ingestion Contract

Data Asset Portal 的外部元数据边界是：

```text
Customer System
      ↓
Collector / Adapter
      ↓
Versioned Metadata Contract
      ↓
POST /api/metadata/assets/ingestions
POST /api/metadata/lineage/ingestions
      ↓
FastAPI → MetadataIngestionService → Database Provider
```

`p_asset_table`、`p_asset_field`、`p_lineage_snapshot`、`p_lineage_node`、`p_lineage_edge`、内部 asset ID、物理 schema 和 migration 都是 DAP implementation detail。Collector 不应 import 或直接写这些表。

## DAP 与 Collector 的职责

DAP Core 负责：

```text
Receive → Validate → Normalize → Idempotency → Persist → Audit → Expose
```

Collector / Adapter 负责：

```text
connect → collect → parse → schedule → retry source access → submit HTTP
```

DAP 不负责统一调度 Collector，也不实现万能 SQL/Python/Shell parser、connector framework、OpenLineage Server、DataHub/OpenMetadata compatibility 或 plugin marketplace。内部 migration、seed、repair、maintenance 和 tests 仍可在明确内部边界内直接操作数据库。

## Versioning

当前 API resource family 为 `/api/metadata`，当前 public contract 为 `contractVersion=1.0`。`contractVersion` 是 payload schema major/minor；API path family 是 HTTP resource version。新增 optional 字段保持 additive；服务忽略未知字段。breaking field rename/remove/type change 使用新的 contract major，并在未来使用新的 API path version，例如 `/api/v2/metadata`。服务不会自动执行 schema registry migration。

## Source identity 与 Asset key

```json
{
  "source": {
    "type": "postgresql",
    "name": "warehouse-prod",
    "namespace": "finance",
    "instance": "dw-prod"
  },
  "collector": {
    "name": "postgresql-reference",
    "version": "0.1.0"
  }
}
```

- `source` 是真实被描述的系统。
- `collector` 是产生 payload 的程序；升级 collector 不会新建资产。
- `namespace` 是 source 内可选的逻辑作用域。
- Asset natural key 是 `(source, assetType, externalId)`。
- 没有 `externalId` 时使用 `qualifiedName`。
- 同一 source 的 stable `externalId` 更名会产生 update；没有 stable ID 时不会猜测 rename。
- 不同 source 的 `public.orders` 相互隔离。
- payload 默认不是 authoritative snapshot；缺失对象不会删除。`authoritative=true` 只返回 `deleteCandidate`，V1 不执行 destructive delete。

## Asset ingestion

Canonical endpoint：

```http
POST /api/metadata/assets/ingestions?dryRun=false
```

兼容 alias：`POST /api/metadata/assets:bulk-upsert`。

写入权限复用当前 `maintainer` gate（`admin` 也属于可维护身份）；Contract 和 Service 不依赖具体 auth framework。请求是 bulk payload，不是逐字段 HTTP：默认最多 1000 assets、每个 asset 1000 fields、总计 10000 fields，request body 默认上限 8 MiB。可通过 `METADATA_MAX_*` 环境变量降低/调整数量限制。

请求示例：

```json
{
  "contractVersion": "1.0",
  "source": {"type": "postgresql", "name": "warehouse-prod", "namespace": "finance"},
  "collector": {"name": "postgresql-reference", "version": "0.1.0"},
  "assets": [
    {
      "externalId": "public.orders",
      "qualifiedName": "public.orders",
      "assetType": "table",
      "catalog": "warehouse",
      "database": "analytics",
      "schema": "public",
      "name": "orders",
      "description": "订单表",
      "fields": [
        {
          "name": "order_id",
          "dataType": "integer",
          "nullable": false,
          "primaryKey": true,
          "ordinalPosition": 1,
          "description": "订单编号"
        }
      ]
    }
  ]
}
```

重复提交返回 `unchanged`，内容变化返回 `update`，首次提交返回 `create`。同一请求中的 duplicate natural key 是 conflict；语义校验在写库前完成，出现 invalid/conflict 时整批不写入。正式 ingestion 使用一个 transaction；持久化失败 rollback 整批。`dryRun=true` 或 `mode=preview` 只返回比较结果，不写业务数据，也不写 audit。

## Lineage snapshot ingestion

Canonical endpoint：

```http
POST /api/metadata/lineage/ingestions?dryRun=false
```

兼容 alias：`POST /api/metadata/lineage:snapshots`。

V1 只支持 `snapshot.mode=replace`。Snapshot 必须 self-contained：edge 的 `sourceId` / `targetId` 必须在当前 `nodes[]` 中。完全重复 node/edge 会 deterministic deduplicate；相同 identity 的不同内容返回 conflict。

```json
{
  "contractVersion": "1.0",
  "source": {"type": "postgresql", "name": "warehouse-prod", "namespace": "finance"},
  "collector": {"name": "lineage-reference", "version": "0.1.0"},
  "snapshot": {
    "externalSnapshotId": "run-2026-08-22-001",
    "generatedAt": "2026-08-22T10:00:00Z",
    "mode": "replace"
  },
  "nodes": [
    {"externalId": "table:public.orders", "type": "table", "name": "public.orders", "namespace": "public"},
    {"externalId": "table:public.orders_daily", "type": "table", "name": "public.orders_daily", "namespace": "public"}
  ],
  "edges": [
    {
      "sourceId": "table:public.orders",
      "targetId": "table:public.orders_daily",
      "type": "table_lineage",
      "evidence": {"type": "sql", "sourceRecordId": "query-1", "description": "controlled evidence"},
      "confidence": "high",
      "diagnostics": []
    }
  ]
}
```

Snapshot identity 是 `(source, importId/externalSnapshotId)`。相同 import 和相同 content hash 返回 `already_applied`；同一 import 使用不同内容返回 `409 conflict`。发布顺序为：validate → persist INACTIVE snapshot/nodes/edges → deactivate old ACTIVE → activate new → commit。失败时旧 ACTIVE 仍保持 ACTIVE。V1 不实现 append/merge。

## Result and error model

成功响应包含稳定的 `ingestionId`、`correlationId`、`status`、`summary` 和 item results：

```json
{
  "ingestionId": "6c9f...",
  "correlationId": "request-123",
  "status": "completed",
  "contractVersion": "1.0",
  "dryRun": false,
  "durationMs": 12,
  "summary": {
    "received": 1,
    "valid": 1,
    "create": 1,
    "update": 0,
    "unchanged": 0,
    "conflict": 0,
    "invalid": 0,
    "failed": 0,
    "deleteCandidate": 0
  },
  "items": [{"index": 0, "externalKey": "public.orders", "status": "create", "action": "create"}]
}
```

item-level错误包含 `index`、`externalKey`、`code`、`message` 和可选 `field`；不返回 stack trace。请求体/批量上限返回 `413`，语义校验返回 `422`，重复 lineage import 内容冲突返回 `409`。带有 `ingestionId` 的 rejected response 同时保留统一 `error` envelope 和顶层 result summary，便于 Collector 直接读取 `status/items/errors`。未知 contract major 返回明确的 `UNSUPPORTED_CONTRACT_MAJOR`。

## Audit and status

正式 Asset / Lineage ingestion 复用 `OperationLogService.batch_audit`。Audit 只记录 source、collector、ingestion ID、snapshot ID、counts、duration、result 和错误摘要；不会保存完整 metadata payload、SQL evidence 或 diagnostics。使用：

```http
GET /api/metadata/ingestions/{ingestionId}
```

查询返回同一结果 envelope 的 summary 视图，并带有 audit 记录的 `durationMs`。Dry-run 不创建 audit record，因此没有可查询的持久状态。

## Database / migration

`#116` 已将 `p_lineage_snapshot`、`p_lineage_node`、`p_lineage_edge` 纳入四方言 canonical baseline、Alembic `0003_open_repository_modules` 和 Provider contract，满足 `LINEAGE_STORAGE_READY`。`#114` 的 `0004_metadata_ingestion_identity` 增加：

- `p_asset_table` 的 source-scoped identity、qualified name、catalog/database metadata；
- source/assetType/externalId unique index；
- `p_lineage_snapshot` 的 source key、content hash、ingestion ID；
- 从旧 `table_name UNIQUE` 到 source-scoped identity 的 forward migration。

现有 legacy rows 的新增列保持 nullable；现有 CRUD 仍按原 table name 工作。升级前按仓库数据库备份策略保留 backup；仓库不提供 destructive automatic downgrade。

## Reference implementations

### PostgreSQL Reference Collector

[examples/metadata_ingestion/postgresql_collector.py](../examples/metadata_ingestion/postgresql_collector.py) 读取 PostgreSQL `information_schema` / `pg_catalog`，生成 Asset Contract，并使用 HTTP POST 调用 DAP。它是 reference implementation，不代表 DAP 自动支持所有数据库；Oracle、DWS、调度平台或报表系统的 parser/adapter 应由独立项目实现。

### Lineage JSON producer

- [sample-lineage.json](../examples/metadata_ingestion/sample-lineage.json)
- [publish_lineage.py](../examples/metadata_ingestion/publish_lineage.py)

Producer 只加载公共 JSON Contract 并通过 HTTP 调用 API，不 import DAP DB schema、Provider 或内部 Service。
