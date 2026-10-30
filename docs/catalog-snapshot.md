# 授权元数据只读快照契约（PR 1）

Refs #467 / #465 / #444。`contractVersion=1.0`，
`projectionVersion=catalog-business-v1`。

## 边界与默认状态

这是现有资产读取的 batch/snapshot representation，不是新 Metadata 存储、
Ingestion、增量 feed、RAG 服务或索引发布器。原有列表、详情、CRUD、
`/api/search`、RBAC、Public Data Guard 和游客政策保持原义。

**默认不注入 exporter。** 新资源保留现有登录门禁；匿名访问先返回 401，已认证读取返回
503/SNAPSHOT_DISABLED。显式启用后才由独立 HTTPS workload grant 鉴权，浏览器 Cookie
不是其 fallback。不新增环境变量、启动前提、模型/网络探测、依赖、Migration 或 Seed。路由注册不代表实例启用。
本 PR 不提供 HTTP grant 签发端点、外部真实读取 client、Adapter、AI 查询或 UI。

## 受信签发与身份

`CatalogSnapshotService` 是供 **DAP-owned 受信组合层** 使用的 Python seam。
组合层显式创建服务，并通过 `create_fastapi_app(catalog_snapshot_service_instance=...)`
注入同一个实例。未注入时原有应用仍正常启动/运行。

- 使用当前状态 `AuthorizationService`；拒绝仅相信 Identity 的兼容 repository。
  生产组合层必须使用现有 `DatabaseAuthorizationRepository` 或等价的权威当前状态实现。
- `issue(issuer=..., identity=..., workload_id=..., page_size=100, ttl_seconds=300)`
  不是面向浏览器或工作负载的公开请求模型。issuer 须当前持有既有 `metadata:read`。
- `identity` 是 DAP 独立解析的投影主体：有效登录主体使用 ordinary `internal`，
  `None` 使用当前匿名 profile，且继续要求 `PUBLIC_CATALOG_EXPORT_ENABLED=true`。
  `disabled` 拒绝匿名；无效/禁用身份不能降级成游客。
- 受信调用者从 DAP 已验证上下文取得身份，**不能从客户端 JSON、profile、角色字符串、
  allowedIds 或外部服务声明构造身份**。本阶段不把它接到任意用户可调用的 mint API。
- `SnapshotLease.proof` 是独立 CSPRNG 产生的 256-bit 短期 bearer secret，
  只交付给指定构建工作负载的安全 secret channel；不是 Cookie，也不使用 APP_SECRET_KEY。
  服务只保存 proof 的 SHA-256；对象 repr 不包含 proof。
- grant 绑定 catalog/scope/snapshot、工作负载、用途 `snapshot-read`、projection/policy/data
  版本与期限。它不能认证 DAP CRUD、管理、普通搜索或未来的用户查询。
  工作负载名称本身不是凭据；每次读取必须同时证明 possession of bearer secret。
- 构建身份、投影主体与未来查询用户身份不同。快照 grant **不是** 查询用户授权，
  不能用于证明用户可检索或展示旧索引内容。

受信组合层的调用形状（身份解析、Secret 交付和部署接线由运维另行批准）：

```python
lease = exporter.issue(
    issuer=current_verified_issuer,
    identity=current_projection_identity,  # None only for an authorized guest cohort
    workload_id="catalog-builder",
    page_size=100,
    ttl_seconds=300,
)
# Deliver lease.binding and lease.proof to ONLY this workload over a trusted channel.
# Do not log/print the proof, copy a browser cookie, or expose it via public config.
```

每次 capture 前后、每页前后、最终 manifest 确认都会重新读取 issuer 和投影主体的
用户/角色/权限及当前 policy。没有跨请求认证缓存；任一授权事实/策略/配置变化即
拒绝旧 grant，一经观察到失效即销毁该 lease，恢复角色或配置也不会复活它。
权威读取失败为 unavailable，不返回旧数据。最终当前授权检查是本次读取的线性化点；
不宣称获得了跨服务永久授权或更强的并发撤权 fence。

## 只读 HTTP 资源

```http
GET /api/assets/snapshots/{catalogId}/{scopeId}/{snapshotId}
GET /api/assets/snapshots/{catalogId}/{scopeId}/{snapshotId}/manifest
Authorization: Bearer <short-lived proof>
X-DAP-Workload: <bound workload>
```

仅允许 HTTPS。应用按 ASGI transport scheme 判定，不解析客户端伪造的
`X-Forwarded-Proto`；受信 ingress/TLS/代理部署必须单独验证。不要将 secret 放 URL。
Cookie 不是该资源的认证 fallback；内部 grant 在匿名目录 disabled 时仍须验证其
原始有效登录投影授权，而不是借浏览器身份放行。

页请求仅接受 `cursor`、`pageSize`，重复参数或其它参数（如 profile/allowedIds）拒绝。
首请求省略 cursor；重试同一 cursor 幂等。pageSize 在签发时固定为 1–200，
翻页不得切换。cursor 为绑定完整快照上下文、位置、页大小与期限的 opaque MAC，
不携带名称/明文 offset，也不是增量游标。跨实例、scope、snapshot 或篡改都不能继续。

返回 JSON 的 `SnapshotPage` 形状：

```text
binding: {
  contractVersion, catalogId, scopeId, snapshotId, projectionVersion,
  policyRevision, dataRevision, workloadId, purpose
}
capturedAt, expiresAt
pageNumber: 0-based
pageSize: fixed
items: IndexDocument[]
nextCursor: opaque string | null
final: boolean
manifestHash, documentCount: present ONLY on final page
```

final 页必须 nextCursor=null、manifestHash=dataRevision，并有真实的 scoped
`documentCount`。空目录为第 0 页 `items=[]/final=true/documentCount=0`。
非 final 页须满页，不能用空页伪装部分失败。`/manifest` 返回 binding、capture/expiry、
manifestHash/count，并执行当前 grant/policy 确认；它不是未经授权的全库统计接口。
这些计数只在受保护构建资源中出现，不改变 ordinary catalog 的 `fieldCount` policy。

所有成功与受控失败均 `Cache-Control: no-store`，不提供 metadata 写操作。
安全错误只含有限 code 和通用 message，不回显 proof、身份、元数据、SQL 或异常原文：

| HTTP | code / 行为 |
|---|---|
| 401 | SNAPSHOT_AUTH_REQUIRED：proof 或原授权身份无效 |
| 403 | SNAPSHOT_FORBIDDEN：用途/工作负载/作用域/传输或当前权限不允许 |
| 409 | SNAPSHOT_POLICY_CHANGED / SNAPSHOT_CURSOR_INVALID |
| 410 | SNAPSHOT_EXPIRED：过期、撤销、丢失进程状态或不存在；不能拼接新快照 |
| 413 | SNAPSHOT_LIMIT：不能安全完成，不提供被截断的清单 |
| 422 | SNAPSHOT_INPUT_INVALID / SNAPSHOT_CONTENT_REJECTED |
| 429 | SNAPSHOT_BUSY：签发并发或容量上限，不能返回半成品 |
| 503 | SNAPSHOT_DISABLED / SNAPSHOT_UNAVAILABLE / CAPTURE_UNSUPPORTED |
| 504 | CAPTURE_TIMEOUT |

## 授权投影与稳定身份

`EntityRef` 使用 `(catalogId, entityType, assetId, fieldId)`：正整数 assetId；
table 禁止 fieldId，field 必须带自己的 fieldId 和父 assetId。不从表/字段名、
大小写、位置或 mock ID 生成持久身份。跨部署 numeric ID 不可脱离 catalogId 使用。

仅导出白名单业务元数据，并经过现有 public field policy：name、displayName、
独立 description、domain、layer/真实层级名称、grain/cycle、字段 dataType/flags/
枚举说明。字段带授权后的父表名称/显示名/说明/分类上下文与 parentProjectionHash。
不选连接配置、人员账号、source key、管理员字段、审计主体或业务行数据；不制造 schema、
分类、字段类型、更新时间或 source provenance。sourceUpdatedAt 未知时不输出采集时间代替。

- description 的缺失 key = 未暴露/未知；null = 已知存储为空；空串/实际文字保持不同。
  hash 包含 key presence，不将 cn 假补到 description。底层已丢失的历史 input presence
  不会凭空重建；SQL NULL 表示当前持久化值为空，不宣称恢复原始采集请求的历史。
- 原字段读取 additive `description=field_desc`，旧 `cn` fallback 原义不变。
  现有 summary `fields=[]` 仍仅是摘要占位，不代表字段为空。
- `fieldSetState=catalog-complete` 只表示这次读取完整枚举了 **DAP 已持久化的活跃字段**；
  `sourceFieldSetState=unknown` 明示没有证据证明源物理 schema 完整。
  当前存储未保存 source fields collection 的完整 presence 历史，不能把空集解释成
  “真实源表无字段”。数据库读取失败/未知状态直接失败，绝不转为权威空集。
- 保留已有生命周期：case-only 修改保留 fieldId；真正 rename 为软删+新 fieldId；
  字段删除后同名再出现不复活旧 ID；同 source 表恢复保留 assetId、字段重新分配 ID；
  多 source 同名不合并。没有新增实体 enabled/disabled 或增量语义。

approved 业务文本内发现凭据/连接 URI、路径或类似敏感内容时，保守拒绝整次 capture。
不把脱敏后的半成品当完整快照。合成恶意文本有回归，但正则 **不是任意自由文本零泄漏证明**；
真实元数据导出仍需要数据范围/内容审查，不允许把行级样本塞入描述或枚举。

## 一致性、资源与数据库支持

SQLite 使用现有 Provider/CoreAccess/连接：显式 `BEGIN`，第一条 catalog SELECT
建立读 view，`query_only=ON`、read_uncommitted 必须关闭；表/分类及活跃字段在同一
连接/事务内读取。capture 后 rollback 释放 view，恢复连接局部设置、清理 progress handler；
不是普通 `database_transaction`、OFFSET 翻页、双扫描或 updated_at 比较的推断。
WAL 测试在两条 SELECT 之间真实 commit 增删改，结果仍为同一旧 view；回滚日志测试
证明 writer commit 等待读 view 释放，没有表/字段撕裂。代码不修改默认 journal/连接设置。

冻结授权清单后才签发 grant，HTTP 页仅从冻结内容取数据（仍会回查授权库），
不跨 HTTP 请求持长事务。文档顺序为 `(assetId, table-before-field, fieldId)`，
字段改名、分类变化或并发插入不能令冻结页漂移。

默认上限：10000 documents、所有 retained documents 合计 32 MiB、4 个快照、
单次 issuance 并发 1、DB capture 10 秒、TTL 最多 300 秒、单字符串 16384 字符。
受信构造参数只能在代码允许的硬上限内设置。SQL 对行数和文本使用 limit+1 哨兵，
在同一 read view 内先作行数/原始字节预算检查和嵌入 NUL 检测，再传输 payload；避免 SQLite
`substr`/`length` 对 NUL 后缀的静默截断。投影时逐文档计费，
父上下文扩散也不能先生成超量清单再检查。预算查询不是一致性推断算法。
命中上限失败，不静默截断。SQLite progress handler/busy timeout 限制数据库工作，
有界投影完成后也检查总预算；不是已测的吞吐/P95 或硬实时调度保证。

| Provider | 本契约 capture | 证据 / 限制 |
|---|---|---|
| 文件型 SQLite | 支持 | 真实隔离 DB、WAL/rollback journal 并发、生命周期与安全回归 |
| SQLite :memory: | 不支持 | 共享连接/内存模式未证明本 capture 隔离边界 |
| PostgreSQL | 不支持；实际 capture NOT RUN | 尚无独立一致性实现/验证；原 CRUD/migration CI 不等于 snapshot 支持 |
| MySQL | 不支持；实际 capture NOT RUN | 同上，不依赖默认事务隔离猜测 |
| GaussDB / DWS | 不支持；实际 capture NOT RUN | 同上，无目标环境，不连接内网或生产 |

进程内清单只是一份有界短期 export，不是第二套权威元数据存储。过期访问立即拒绝，
后续签发会清理过期清单；重启销毁全部状态。没有无人访问时的物理清理 SLA。
多 worker/副本需要受信路由到签发实例；落到其它实例返回 410，**不重新扫描补页**。
本 PR 不提供分布式 grant/storage、部署脚本或生产可用性承诺。

## hash / 接收完整性

规范 JSON 为 UTF-8、sort_keys、无空白分隔、禁止 NaN；不 trim/casefold/Unicode
归一化文本。`projectionHash=SHA256({projectionVersion, document})`，document 去掉
projectionHash 本身，其余仅含授权后值（包括 null/缺失与父表上下文）。隐藏原值不能
进入公共 digest。分类/中文名/枚举/源描述等任何已投影变化都会改变相应 hash。

manifest 为按上述稳定顺序排列的 `{ref,projectionHash}` 列表，加 catalogId、scopeId、
projectionVersion、policyRevision 后作同一规范 SHA-256；即 dataRevision。
它是 authorized manifest revision，不是 DB row version 或 CDC cursor。

`SnapshotReceiver` 是可选的有界接收验证 helper，不存储索引、不提供 publish API：

1. 使用受信拿到的完整 binding；按 pageNumber 和请求 cursor 链顺序接收。
2. 验证每页 binding、capture/expiry/pageSize、不重复 cursor；拒绝中断、过期、
   漏页、重复页、乱序、非 canonical 结尾和预算超限。
3. 收齐后校验 ID 唯一/顺序、field-parent/父上下文、每文档 hash、总 count、manifest。
4. `finish(confirm=...)` 的 callback **必须实际调用带 proof 的 DAP `/manifest`**，
   不能返回缓存 manifest；比较当前确认与收到的完整清单，回调后再次检查 expiry。
   任一失败，该 receiver 永久失败，不暴露部分 documents。
5. 仅返回成功验证的 documents，由调用者自行原子发布 staging。失败时丢弃本次 staging，
   不触发 mark-and-sweep、不推导删除，不能把新旧快照的页拼起来。索引发布器不在本 PR。

## 验证、回滚与后续门禁

```bash
python -m unittest backend.tests.test_catalog_snapshot -v
python -m unittest backend.tests.test_assets_core_crud backend.tests.test_asset_identity \
  backend.tests.test_field_identity backend.tests.test_asset_sync_lifecycle \
  backend.tests.test_public_catalog_profiles backend.tests.test_public_catalog_search_policy
python -m unittest discover -s backend/tests
python demo/validate_demo_data.py --strict
# Existing offline schema checks, not a proof of live snapshot isolation:
python backend/scripts/schema_migrate.py verify --offline --dialect sqlite
python backend/scripts/schema_migrate.py verify --offline --dialect postgresql
python backend/scripts/schema_migrate.py verify --offline --dialect mysql
python backend/scripts/schema_migrate.py verify --offline --dialect dws
git diff --check
```

回滚：不注入 exporter 即关闭；`revoke(snapshotId)` 或重启销毁 lease。无数据库回滚。
必要时 revert additive 实现；外部构建者必须丢弃未完整确认的 staging。

本 PR 不证明两仓实际 wire 消费、部署 TLS/S2S/secret channel、查询用户实时
eligible/version fence、检索前 cohort/统计隔离、候选 authority 验证、物理 purge/
重建 SLA 或检索质量。PR 2 只有在本 PR 合并并独立验证这些前提后，才可另行授权；
不能仅凭快照测试通过建议上线或自动启动 Adapter/UI。
