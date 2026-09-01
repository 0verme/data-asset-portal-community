# 数据资产门户 API 契约

> 本文是 `data-asset-portal` 的**唯一 API 主文档**，描述当前 `origin/main` development state 的 FastAPI 接口统一约定与端点。
> 模块的 Source / Runtime / Schema / Demo 对照见 [modules.md](./modules.md)；routers 由 `backend/app/fastapi/routers/` 实现并由 `backend/app/fastapi/app.py` 装配，`backend/app/fastapi_app.py` 仅保留薄 import facade。历史 Flask migration 文档不代表当前 API runtime。

## 模块总览

FastAPI Native adapter 复用 `backend/app/contracts/` 的框架中立 Contract，并统一以 `/api` 为前缀。下表是源码中的当前 route surface；所有仓库已有模块默认注册，外部 database/credential/storage readiness 通过 Service error contract 表达，不通过 Edition 隐藏 route：

| 模块 | 前端 API | Base Path | Community 当前状态 | 说明 |
| --- | --- | --- | --- | --- |
| 门户 / Repository Module Contract / 搜索 | `api/portal.js`、`api/search.js` | `/api/portal`、`/api/capabilities`、`/api/search` | 已注册 | 门户统计、兼容的仓库模块 capability contract、统一搜索 |
| 认证 | `api/auth.js` | `/api/auth` | 已注册 | 登录、登出、获取当前用户 |
| 上游卸数 | `api/upstream.js` | `/api/upstreams` | 已注册 | 管理上游源系统与卸数状态 |
| 数据仓库 | `api/assets.js` | `/api/assets` | 已注册 | 管理已配置层级的表资产、字段、DDL |
| 字段映射 | `api/fieldMapping.js` | `/api/field-mappings` | 已注册 | 查询源字段到目标字段映射关系 |
| 血缘分析 | `api/lineage.js` | `/api/lineage` | 已注册 | POC 或配置后的 persistent 快照查询 |
| 指标维护 | `api/indicator.js` | `/api/indicators` | 已注册 | 管理口径指标、维度、启停状态 |
| 报表资产 | `api/report.js` | `/api/reports` | 已注册 | 管理报表台账、归属信息与关联引用 |
| 词根管理 | `api/root.js` | `/api/roots` | 已注册 | 管理命名词根字典 |
| 下游推送 | `api/push.js` | `/api/push` | 已注册 | 管理下游系统、推送作业与字段元数据 |
| API 资产 | `api/apiAssets.js` | `/api/api-assets` | 已注册 | 管理 API 元数据、参数、响应字段与关系 |
| 码值表维护 | `api/manualCodeTables.js` | `/api/manual-code-tables` | 已注册 | 管理手工码值表元数据 |
| 系统管理 | `api/systemUsers.js`、`api/paramDicts.js`、`api/menus.js` | `/api/system` | 已注册 | 用户、菜单、参数字典与角色边界 |
| 操作日志 | `api/operationLogs.js` | `/api/operation-logs` | 已注册（随 system） | 查询全站操作审计日志 |
| 通用码值（历史） | — | `/api/common-codes` | WAIT_DB，当前未注册 | 历史数据模型；前端运行时不得调用，参数字典管理见 `/api/system/param-dicts*` |

仓库已有 module codes 默认进入同一 open runtime contract；菜单 `status`、外部依赖、database driver、credential 和 persistent lineage storage readiness 是实例/部署状态，不是 Edition feature gate。Module availability is not a licensing gate；menu visibility is not authorization，RBAC authorization is not module availability，runtime/DB profile is not feature gating。

## 1. 总体约定

### 1.1 Base URL

- 统一使用 `/api` 作为接口前缀
- 前端使用相对路径访问，例如 `/api/assets/tables`、`/api/field-mappings/stats`、`/api/roots`
- 本地 development / Community Demo 的后端默认监听 `http://127.0.0.1:5099`

### 1.2 Health 与版本语义

`GET /healthz` 不查询数据库，只报告当前 native runtime 状态：

```json
{
  "status": "ok",
  "runtime": "fastapi",
  "fastapiPrimary": true
}
```

健康响应不包含历史 runtime fallback 字段；FastAPI app 的 `version="0.2.0"` 与 frontend package/footer 的 `0.2.0` / `V0.2.0` 是当前 application/package metadata；GitHub latest published release 为 `v0.2.0`。线上静态 mock bundle 的 `V1.0.0` 仍是独立 build metadata，不是 API 或 repository release version。

本文描述 current main contract；历史 migration 文档中的旧 adapter/status 只作为历史证据。

### 1.3 Content-Type

```http
Content-Type: application/json; charset=utf-8
Accept: application/json
```

### 1.4 统一返回格式

| 场景 | 返回体 |
| --- | --- |
| 列表 | `{ "items": [] }` |
| 详情 | `{ "data": {} }` |
| 新增 / 更新 | `{ "message": "ok", "data": {} }` |
| 删除 | `{ "message": "deleted" }` |

分页列表（如操作日志）在 `items` 外附带 `total`、`page`、`pageSize` 等字段。

### 1.5 统一错误格式

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "请求参数校验失败",
    "details": [
      { "field": "name", "message": "字段不能为空" }
    ]
  }
}
```

`details` 可选；无字段级错误时可省略。

### 1.6 建议状态码

- `200 OK`：查询、更新、删除成功
- `201 Created`：新增成功
- `400 Bad Request`：请求格式错误
- `401 Unauthorized`：未登录或登录失效
- `403 Forbidden`：已登录但无权限
- `404 Not Found`：资源不存在
- `409 Conflict`：唯一键冲突
- `422 Unprocessable Entity`：业务校验失败
- `500 Internal Server Error`：服务端异常

### Binary availability status

凡表示资源当前是否可用、是否生效或是否启用的 `status` 字段，接口值统一为 `enabled` / `disabled`，展示文案统一为“启用 / 禁用”。码值表的创建、更新、筛选和状态变更接口不接受 `active`、`draft` 或其它 legacy 启停值；历史数据由 forward migration 收口。

### 1.7 前端运行模式

前端通过 `VITE_API_MODE` 切换数据来源：`mock` 走前端内置数据并使用演示登录；`remote` 统一走 `/api` 调后端真实数据库。后端唯一由 `uvicorn backend.asgi:app` 运行 FastAPI Native；真正的 WAIT_DB / 外部 storage readiness 通过可诊断的 Service error 表达，不把仓库已有源码模块伪装成不存在。

```env
VITE_API_MODE=remote
```

### 1.8 权限

系统使用 permission-based RBAC。`/auth/me` 返回当前有效的 `permissions[]`；后端路由通过 `require_permission("resource:action")` 强制授权，前端 `can(permission)` 仅用于界面 UX，不能替代后端检查。有效权限统一为 `PUBLIC_PERMISSION_CODES ∪ role_permissions`；匿名和有效登录用户继承公共目录读取能力，角色只配置增量权限。角色管理接口包括 `GET/POST/PATCH /api/system/roles`、`GET /api/system/permissions` 以及 `GET /api/system/permissions?assignableOnly=true`，用户绑定单个角色；禁用用户、禁用角色或撤销权限会在下一次授权决策中立即生效。

现阶段仍保留 `admin`、`maintainer` 等内置角色及兼容 helper，但授权事实以当前角色—权限映射与公共权限策略为准。未实现多角色绑定、ABAC/ACL、数据范围授权或外部 IAM。

### 1.9 Repository module capability contract

`GET /api/capabilities` 是历史上已经公开的兼容 endpoint。它的名称保留为 **capability**，但当前实现的唯一职责是表示仓库中 source-backed 的 open module contract；它不是通用 deployment readiness API，也不是 feature flag、license/Edition entitlement、菜单配置、RBAC 或 database profile API。

当前响应保持以下字段形状：

```json
{
  "modules": [
    { "code": "dwm", "enabled": true, "reason": null }
  ]
}
```

- `modules[].code` 与 backend module manifest、frontend module registry、menu/search/stat module keys 共用稳定 code；module codes 不是权限码。
- `modules[].enabled` 是保留的兼容字段。在当前 open repository contract 中，source-backed modules 为 `true`；它不表示 license entitlement、Community/Private Edition、`p_menu.status`、当前用户 RBAC permission、数据库连接或外部依赖可用性。
- `modules[].reason` 是保留的兼容字段；当前模块 contract 对 source-backed modules 返回 `null`。数据库/驱动/存储/外部服务未就绪时，使用各业务 service 的诊断/error contract，不通过 capability payload 隐藏模块。
- endpoint 不返回 Edition，也不根据 capability 状态取消 FastAPI router registration。当前没有为术语清理新增 `/api/modules` 或 `/api/readiness`，以避免无必要的 public API 扩张。

前端 `frontend/src/capabilities/capabilities.js` 继续请求该 endpoint，但返回对象的 `loadStatus` / `loadError` 只表示 HTTP loader 状态（请求成功或失败）。网络失败保留完整的 repository module registry；它不能被解释为模块不存在或假 404。`ModuleCapabilityError`、`resolve_capabilities()` 等 backend 名称同样是保留的 capability compatibility terminology，不代表 readiness 或 licensing gate。

### 1.10 Authentication boundary

Authentication and authorization are separate contracts:

- ordinary business catalog GET routes are explicitly public and use the
  necessary public response projection;
- mutations, administration, and sensitive reads keep their existing
  `require_permission("resource:action")` RBAC checks;
- frontend menu visibility, route guards, and OpenAPI exposure are not security
  boundaries;
- `/api/auth/me` remains a `401` probe for anonymous sessions; the frontend
  translates that result to anonymous and continues public bootstrap;
- there is no deployment feature flag: Community Edition uses the fixed
  `Public Catalog + Authenticated Management` model.

See [Public Catalog + Authenticated Management](./rbac/authenticated-read-model.md)
for the complete route classification, redaction boundary and direct API matrix.

## 2. 数据仓库模块 `assets`

Base Path: `/api/assets`

### 2.1 核心模型

#### AssetField

```json
{
  "fieldId": 1001,
  "assetId": 101,
  "name": "trans_status",
  "cn": "交易状态",
  "type": "string",
  "nullable": false,
  "pk": false,
  "part": false,
  "enum": "INIT-初始化 / SUCCESS-成功 / FAIL-失败"
}
```

#### AssetTable

```json
{
  "assetId": 101,
  "name": "dwm_trade_order_detail_di",
  "cn": "零售订单明细中间表",
  "domain": "交易",
  "layer": "DWM",
  "owner": "林晓",
  "grain": "一笔零售订单",
  "cycle": "每日增量 T+1",
  "desc": "零售订单明细表",
  "fields": []
}
```

### 2.2 接口

- `GET /api/assets/tables`
- `GET /api/assets/tables/{tableName}`
- `GET /api/assets/tables/{tableName}/fields`
- `GET /api/assets/tables/{tableName}/ddl`
- `GET /api/assets/domains`
- `GET /api/assets/layers`
- `POST /api/assets/tables`
- `PUT /api/assets/tables/{tableName}`
- `PUT /api/assets/tables/{tableName}/fields`
- `DELETE /api/assets/tables/{tableName}`

### 2.3 查询参数

`GET /api/assets/tables`

- `keyword`：模糊匹配表名、中文名、owner、desc
- `domain`：按主题域过滤
- `layer`：按数据层级过滤；省略时返回全部已配置层级，取值以 `GET /api/assets/layers` 的当前 response 为准。这里不绑定 GitHub release 或 Demo footer 版本。

前端数据仓库首页默认不传 `layer`，展示全部层级；DWM 是推荐筛选项。首页侧边栏提供“全部层级”和各已配置层级入口，筛选状态通过 URL 的 `layer` 参数保留并可分享、刷新及前进后退恢复。mock 与 remote 模式遵循相同的筛选语义。

### 2.4 DDL 返回

资产列表/详情与字段响应会以 `assetId` / `fieldId` 暴露已有稳定身份；这些 ID 只用于程序引用，展示层仍使用资产中文名、表名和字段中文名。

`GET /api/assets/tables/{tableName}/ddl`

```json
{
  "data": {
    "ddl": "CREATE TABLE IF NOT EXISTS dws_dwm.dwm_trade_order_detail_di (...)",
    "ddlDialect": "postgresql",
    "ddlDialectLabel": "PostgreSQL SQL"
  }
}
```

### 2.5 可复制的详情请求

资产详情端点属于 Public Catalog reads，无需先建立登录态。下面的示例使用仓库 Demo 中的虚构表名；本地默认服务地址为 `http://127.0.0.1:5099`，如使用其他 profile 请替换为实际服务地址。

```bash
curl --get "http://127.0.0.1:5099/api/assets/tables/DWM_MEMBER_ACTIVITY_STAT_1D" \
  --header "Accept: application/json"
```

成功响应（`200 OK`）：

```json
{
  "data": {
    "name": "DWM_MEMBER_ACTIVITY_STAT_1D",
    "cn": "会员活跃统计日表",
    "domain": "会员",
    "layer": "DWM",
    "owner": "林晓",
    "grain": "会员与日期",
    "cycle": "每日增量 T+1",
    "desc": "会员当日活跃、登录与消费行为日统计",
    "schema": "DWS_DWM",
    "fieldCount": 1,
    "fields": [
      {
        "name": "stat_date",
        "cn": "统计日期",
        "type": "DATE",
        "nullable": false,
        "pk": true,
        "part": false,
        "enum": null
      }
    ],
    "assetRisks": []
  }
}
```

不存在的表返回统一错误格式（`404 Not Found`）：

```json
{
  "error": {
    "code": "ASSET_NOT_FOUND",
    "message": "未找到数据表: missing_table"
  }
}
```

## 统一搜索

Base Path: `/api/search`

当前统一搜索属于 Public Catalog read，匿名请求返回 `200`；已登录用户不需要额外的搜索 `*:read` 权限。搜索结果只返回目录展示字段，不返回连接凭据或管理审计数据。

### 接口与查询参数

- `GET /api/search`
- `q`：搜索关键字；服务端会去除首尾空白
- `scope`：搜索范围，默认 `all`；当前别名包括 `metric` → `indicator`、`apiAsset` → `api`
- `limit`：每个结果分组的上限，默认 `5`，超过当前 `SEARCH_MAX_LIMIT`（默认 `50`）时截断

### 返回格式

成功响应包含 `query`、归一化后的 `scope`、`groups`、`total`、`estimatedTotal` 和 `hasMore`。每个分组包含 `type`、`label`、`module`、`count` 和 `items`；结果项包含 `id`、`title`、`subtitle`、`meta`、`module`、`ref`、`type`、`category` 和 `matchedFields`。

### 可复制的搜索请求

```bash
curl --get "http://127.0.0.1:5099/api/search" \
  --header "Accept: application/json" \
  --data-urlencode "q=会员" \
  --data-urlencode "scope=asset" \
  --data-urlencode "limit=5"
```

成功响应（`200 OK`）：

```json
{
  "query": "会员",
  "scope": "asset",
  "groups": [
    {
      "type": "asset",
      "label": "资产",
      "module": "dwm",
      "count": 1,
      "items": [
        {
          "id": "DWM_MEMBER_ACTIVITY_STAT_1D",
          "title": "DWM_MEMBER_ACTIVITY_STAT_1D",
          "subtitle": "会员活跃统计日表",
          "meta": "会员 / DWM / 林晓",
          "module": "dwm",
          "ref": "DWM_MEMBER_ACTIVITY_STAT_1D",
          "type": "asset",
          "category": "资产",
          "matchedFields": [
            { "label": "资产中文名", "value": "会员活跃统计日表" }
          ]
        }
      ]
    }
  ],
  "total": 1,
  "estimatedTotal": 1,
  "hasMore": false
}
```

## 3. 字段映射模块 `field-mappings`

Base Path: `/api/field-mappings`

### 3.1 核心模型

#### FieldMappingRow

`sourceSystemId` 是上游卸数系统主键（对应 `p_upstream_system.system_pk`），用于程序关联和筛选；`srcSystem` / `systemName` 只承载展示名称，`systemCode` 是用户侧消歧编码。

```json
{
  "sourceSystemId": 1,
  "systemCode": "MEM",
  "systemName": "会员中心",
  "srcSystem": "会员中心",
  "srcTable": "MEMBER_PROFILE",
  "srcTableCn": "会员档案表",
  "srcField": "MEMBER_CODE",
  "srcType": "VARCHAR(40)",
  "srcComment": "会员编码",
  "targetLayer": "DWD",
  "targetTable": "DWD_MEMBER_PROFILE",
  "targetField": "member_id",
  "mappingRule": "直接映射",
  "updatedAt": "2026-06-05"
}
```

#### FieldMappingStats

```json
{
  "sourceSystemCount": 1,
  "sourceTableCount": 2,
  "fieldCount": 12,
  "mappedFieldCount": 10,
  "unmappedFieldCount": 2,
  "emptyCommentCount": 1,
  "coverage": 83
}
```

#### TableMappingRow

`GET /api/field-mappings/tables` 返回的表维度聚合行。`loadMode` 为入仓方式码值，取值 `full`（全量）/ `incr`（增量）/ `incr_zip`（增量拉链）/ `full_zip`（全量拉链）。

```json
{
  "sourceSystemId": 1,
  "systemCode": "MEM",
  "systemName": "会员中心",
  "srcSystem": "会员中心",
  "srcTable": "MEMBER_PROFILE",
  "srcTableCn": "会员档案表",
  "targetLayer": "DWD",
  "targetTable": "DWD_MEMBER_PROFILE",
  "loadMode": "incr_zip",
  "mappedCount": 6,
  "coverage": 100,
  "updatedAt": "2026-06-05"
}
```

### 3.2 接口

`GET /api/field-mappings/source-systems` 的选项至少返回 `id`、`sourceSystemId`、`name`、`systemCode` 和 `count`。`id` / `sourceSystemId` 只供程序使用，常规 UI 不展示数据库主键；显示标签为 `name · systemCode`。

- `GET /api/field-mappings/source-systems`
- `GET /api/field-mappings/stats`
- `GET /api/field-mappings/fields`
- `GET /api/field-mappings/tables`
- `POST /api/field-mappings/import`（需要 `field_mapping:write`）

### 3.3 查询参数

下列参数由 `stats`、`fields`、`tables` 共用：

- `keyword`：全局关键字
- `sourceSystemId`：规范的上游系统主键筛选，值为 `p_upstream_system.system_pk`；“全部”不发送该参数
- `upstreamSystemId`：兼容别名，内部同样按上游系统主键（或既有唯一技术标识）解析
- `srcSystem`：deprecated 的展示名称筛选，仅按名称匹配，不承担唯一系统身份；同名系统会同时返回
- `dataSourceId`：deprecated 的公共数据源兼容筛选，不会被当作上游系统主键
- `srcTable`：源表名，模糊匹配
- `srcField`：源字段名，模糊匹配
- `emptyComment`：`yes` / `no`
- `targetTable`：目标表名，模糊匹配
- `targetField`：目标字段名，模糊匹配

`GET /api/field-mappings/fields` 额外支持：

- `page`：页码，默认 `1`
- `pageSize` / `limit`：每页条数，默认 `20`
- `sortKey`：排序字段，允许 `srcSystem` / `srcTable` / `srcField` / `srcType` / `srcComment` / `targetTable` / `targetField` / `mappingRule`
- `sortDirection`：`asc` / `desc`

### 3.4 字段分页返回

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

### 3.5 批量导入

`POST /api/field-mappings/import` 使用正式 Pydantic Contract，一次请求可提交多张表。当前只支持 `mode: "upsert"`：

```json
{
  "mode": "upsert",
  "dryRun": false,
  "items": [
    {
      "sourceSystemId": 103,
      "sourceTable": "ODS_CORE_ACCOUNT",
      "sourceTableCn": "账户信息",
      "targetLayer": "DWF",
      "targetTable": "DWF_ACCOUNT",
      "loadMode": "incr",
      "tableDesc": "账户加工",
      "fields": [
        {
          "sourceField": "ACCOUNT_NO",
          "sourceType": "VARCHAR(64)",
          "sourceComment": "账号",
          "targetField": "ACCOUNT_NO",
          "mappingRule": "直接映射",
          "fieldOrder": 1
        }
      ]
    }
  ]
}
```

表映射业务身份按当前 canonical schema 的 `sourceSystemId + sourceTable` 解析，其中 `sourceSystemId` 对应 `p_upstream_system.system_pk`；`dataSourceId` 仅作为兼容输入，只有能唯一解析到一个有效上游系统时才接受。字段映射身份按所属表的 `sourceField + targetField` 解析。已有记录会返回 `created`、`updated` 或 `unchanged`，同一请求中的异常 item 返回 `failed`、`index`、`identity` 和错误码。请求遗漏的旧字段不会被删除；table 与 fields 在每个 item 的事务内一起提交。成功的真实 create/update 会清理映射统计缓存；`unchanged` 不写入伪修改审计。`dryRun: true` 只做校验和 action 预判，不写业务表、审计或缓存。

接口返回直接的导入响应：

```json
{
  "mode": "upsert",
  "dryRun": true,
  "summary": {
    "received": 1,
    "created": 1,
    "updated": 0,
    "unchanged": 0,
    "failed": 0,
    "fieldCount": 1,
    "createdFieldCount": 1,
    "updatedFieldCount": 0,
    "unchangedFieldCount": 0
  },
  "items": [
    {
      "index": 0,
      "identity": {
        "sourceSystemId": 103,
        "upstreamSystemId": 103,
        "dataSourceId": 12,
        "sourceTable": "ODS_CORE_ACCOUNT",
        "targetTable": "DWF_ACCOUNT"
      },
      "action": "created",
      "fieldCount": 1,
      "createdFieldCount": 1,
      "updatedFieldCount": 0,
      "unchangedFieldCount": 0
    }
  ]
}
```

DWS 解析脚本保留源端只读 metadata 查询，但不再连接或写入 Portal 的 mapping business tables。脚本通过现有 signed session cookie 认证，不引入第二套 token 管理；凭据只通过安全运行时变量注入。例如：

```powershell
$env:DAP_SESSION_COOKIE = 'session=<signed-cookie-value>'
python backend/scripts/imp_dws_comments.py `
  --directory 'D:\dws-scripts' `
  --api-base-url 'http://127.0.0.1:5099' `
  --batch-size 100 `
  --dry-run
```

## 4. 指标维护模块 `indicators`

Base Path: `/api/indicators`

### 4.1 核心模型

#### IndicatorItem

```json
{
  "id": "CUST00001",
  "name": "个体工商户标识",
  "meaning": "客户是否为个体工商户",
  "sourceAssetId": 101,
  "sourceAssetName": "DWS_CUSTOMER_PROFILE",
  "sourceAssetQualifiedName": "dws.DWS_CUSTOMER_PROFILE",
  "resultFieldId": 1001,
  "resultTableName": "DWS_CUSTOMER_PROFILE",
  "resultFieldName": "customer_type_flag",
  "aggregation": "NONE",
  "semanticState": "candidate",
  "dimension": "cus",
  "caliber": "涉农信息表口径",
  "path": "CUS > 客户基础 > 涉农标签",
  "status": "enabled",
  "registrar": "叶丽芳",
  "registeredAt": "2025-06-04"
}
```

### 4.2 接口

- `GET /api/indicators`
- `GET /api/indicators/{indicatorId}`
- `POST /api/indicators`
- `PUT /api/indicators/{indicatorId}`
- `PATCH /api/indicators/{indicatorId}/status`
- `DELETE /api/indicators/{indicatorId}`

### 4.3 查询参数

`GET /api/indicators`

- `keyword`：模糊匹配 `id`、`name`、`meaning`、`caliber`、`path`、`registrar`
- `dimension`：`cus` / `con` / `due` / `emp` / `org`
- `status`：`enabled` / `disabled`

`sourceAssetId` 与 `resultFieldId` 是稳定的机器引用；`resultTableName` / `resultFieldName` 保留为展示和兼容快照。两者同时存在时，服务会校验字段属于来源资产；只提交 `resultFieldId` 时会 deterministic 推导来源资产。历史指标无法唯一精确匹配时这些 ID 可以为 `null`，不会按名称猜测。`aggregation` 只接受 `SUM`、`COUNT`、`COUNT_DISTINCT`、`AVG`、`MIN`、`MAX`、`NONE` 或 `null`；`semanticState` 与 `status` 分离，取 `candidate`、`certified`、`deprecated`，而 `status` 继续只表示 `enabled` / `disabled`。

### 4.4 状态变更

`PATCH /api/indicators/{indicatorId}/status`

```json
{ "status": "disabled" }
```

## 5. 报表资产模块 `reports`

Base Path: `/api/reports`

### 5.1 核心模型

#### ReportItem

```json
{
  "code": "RPT_SALES_DAILY",
  "name": "零售销售日报",
  "alias": "零售日结报表",
  "type": "经营分析",
  "domain": "交易",
  "freq": "日报",
  "status": "enabled",
  "effectiveDate": "2026-06-01",
  "expireDate": "",
  "purpose": "面向经营分析部门跟踪全渠道零售订单规模、成交率与异常波动。",
  "statObject": "全渠道零售订单",
  "statScope": "线上商城、小程序、门店 POS 及外卖平台渠道",
  "timeCaliber": "订单完成时间 T-1 自然日 00:00 至 23:59",
  "filterCondition": "订单状态=已完成；剔除测试门店与取消订单。",
  "specialRule": "退款订单单独列示，不冲减成交订单数。",
  "ownerDept": "经营分析部",
  "ownerName": "周婷",
  "maintainerName": "吴迪",
  "relatedTables": [
    {
      "tableName": "dwm_trade_order_detail_di",
      "tableCn": "零售订单明细中间表",
      "domain": "交易",
      "layer": "DWM"
    }
  ],
  "relatedIndicators": [
    {
      "indicatorId": "CUST00001",
      "indicatorName": "个体工商户标识",
      "dimension": "cus",
      "path": "CUS > 客户基础 > 涉农标签"
    }
  ],
  "remark": "异常峰值需与支付网关监控联动复核。",
  "updatedBy": "system",
  "updatedAt": "2026-06-29 10:00:00"
}
```

### 5.2 接口

- `GET /api/reports`
- `GET /api/reports/{reportCode}`
- `POST /api/reports`
- `PUT /api/reports/{reportCode}`
- `DELETE /api/reports/{reportCode}`

### 5.3 查询参数

`GET /api/reports`

- `keyword`：模糊匹配 `code`、`name`、`alias`、`ownerName`、`ownerDept`、`domain`、`purpose`
- `type`：按报表类型过滤
- `domain`：按主题域过滤
- `status`：如 `enabled` / `disabled`
- `ownerDept`：按归属部门过滤

### 5.4 写接口约束

- `code` 必填，格式为 `^[A-Z][A-Z0-9_-]{2,63}$`
- `name`、`type`、`status`、`ownerDept`、`ownerName` 必填
- `effectiveDate`、`expireDate` 如传入必须为 `yyyy-mm-dd`
- `expireDate` 不得早于 `effectiveDate`
- `relatedTables`、`relatedIndicators` 必须为数组，且引用对象必须在现有资产表 / 指标台账中存在
- 写操作受 `require_maintainer` 保护，`admin` 与 `maintainer` 均可执行

## 6. 词根管理模块 `roots`

Base Path: `/api/roots`

### 6.1 核心模型

#### RootItem

```json
{
  "abbr": "trans",
  "en": "transaction",
  "cn": "交易流水",
  "cat": "业务对象",
  "desc": "支付、清结算、账务场景通用词根"
}
```

- `abbr` 必填，格式为 `^[a-z0-9]+$`；下划线仅作为多个词根的连接符，不允许出现在单个词根缩写中

### 6.2 接口

- `GET /api/roots`
- `GET /api/roots/categories`
- `GET /api/roots/{abbr}`
- `POST /api/roots`
- `PUT /api/roots/{abbr}`
- `DELETE /api/roots/{abbr}`
- `POST /api/roots/import`

### 6.3 查询参数

`GET /api/roots`

- `keyword`：模糊匹配 `abbr`、`en`、`cn`、`desc`
- `cat`：按分类过滤

### 6.4 批量导入

`POST /api/roots/import`

```json
{
  "items": [
    { "abbr": "acct", "en": "account", "cn": "账户", "cat": "业务对象", "desc": "账户主体词根" }
  ]
}
```

返回建议：

```json
{ "message": "imported", "data": { "inserted": 1, "updated": 0, "items": [] } }
```

## 7. 上游卸数模块 `upstreams`

Base Path: `/api/upstreams`

### 7.1 核心模型

#### UpstreamSystem（公开目录响应）

```json
{
  "id": "up_member",
  "abbr": "MEMBER",
  "name": "会员中心",
  "dbType": "Oracle",
  "unloadTimes": ["00:30", "06:00", "12:00", "18:00"],
  "status": "enabled",
  "owner": "陈默",
  "dept": "会员运营部",
  "desc": "会员档案数据按固定时点卸数至 ODS"
}
```

`host`、`db`、`schema` 只在受 `upstream:read` 保护的
`GET /api/upstreams/systems/{systemId}/admin-detail` 响应中返回。

### 7.2 接口

- `GET /api/upstreams/systems`
- `GET /api/upstreams/systems/{systemId}`
- `POST /api/upstreams/systems`
- `PUT /api/upstreams/systems/{systemId}`
- `PATCH /api/upstreams/systems/{systemId}/status`
- `DELETE /api/upstreams/systems/{systemId}`

### 7.3 查询参数

`GET /api/upstreams/systems`

- `keyword`：模糊匹配 `id`、`abbr`、`name`、负责人、部门和说明；连接信息不属于公开搜索字段
- `status`：如 `enabled` / `disabled`
- `dbType`：如 `Oracle`、`MySQL`、`PostgreSQL`

### 7.4 状态变更

`PATCH /api/upstreams/systems/{systemId}/status`

```json
{ "status": "disabled" }
```

## 8. 下游推送模块 `push`

Base Path: `/api/push`

### 8.1 核心模型

#### PushSystem（公开目录响应）

```json
{
  "id": "member_push",
  "name": "会员运营工作台",
  "abbr": "DEMO_CDP",
  "protocol": "SFTP",
  "dept": "会员运营部",
  "desc": "会员运营下游推送",
  "status": "enabled",
  "jobs": []
}
```

`host`、`port`、`account`、`auth` 和联系人字段只在受
`push:read` 保护的 `admin-detail` 响应中使用。

#### PushJob（公开目录响应）

```json
{
  "id": "job_member_profile",
  "cn": "会员档案推送",
  "sourceFileName": "member_profile_source_${yyyyMMdd}.csv",
  "targetFileName": "member_profile_${yyyyMMdd}.csv",
  "freqType": "T+1",
  "enabled": true,
  "desc": "会员档案推送作业"
}
```

来源/目标路径、分隔符、编码、行数和字段清单属于受保护的维护详情，
不随匿名目录响应返回。

> **推送频率（`freqType` + `freq`）**：`freqType` 为类型，`freq` 为对应参数（落库分别对应 `freq_type` / `freq_desc`）。
>
> - `T+1` / `T+0`：日批，`freq` 为空（出数时间取决于上游，不维护时点）。
> - `准实时`：`freq` 为间隔分钟，取 `"5"` / `"30"` / `"60"`。
> - `每周`：`freq` 为星期,`"1"`（周一）… `"7"`（周日）。
> - `每月`：`freq` 为 `"1"`–`"28"`（每月某日）或 `"LAST"`（月末，按当月实际天数解析）。

### 8.2 接口

- `GET /api/push/systems`
- `GET /api/push/systems/{systemId}`
- `POST /api/push/systems`
- `PUT /api/push/systems/{systemId}`
- `DELETE /api/push/systems/{systemId}`
- `POST /api/push/systems/{systemId}/jobs`
- `PUT /api/push/systems/{systemId}/jobs/{jobId}`
- `DELETE /api/push/systems/{systemId}/jobs/{jobId}`

### 8.3 查询参数

`GET /api/push/systems`

- `keyword`：模糊匹配系统标识和名称
- `status`：如 `enabled` / `disabled`
- `protocol`：如 `SFTP` / `FTP` / `HTTP`
- `dept`：按归属部门过滤
- 匿名返回项只包含目录级协议和作业摘要，不包含下游服务器地址、端口、账号、认证方式、内部路径或联系人；维护详情仍受 `push:read` 保护。

## 9. 系统管理模块 `system`

Base Path: `/api/system`

包含后台用户管理与参数字典管理两组接口。写操作均需管理员登录态（`require_admin`）。

### 9.1 核心模型

#### SystemUser

```json
{
  "username": "linxiao",
  "name": "林晓",
  "role": "admin",
  "status": "enabled",
  "createdAt": "2026-06-01"
}
```

`status` 取值：`enabled` / `disabled`。

#### ParamDict

```json
{
  "id": "PUSH_PROTOCOL_SFTP",
  "categoryCode": "PUSH_PROTOCOL",
  "code": "SFTP",
  "name": "SFTP",
  "value": "SFTP",
  "status": "enabled",
  "order": 10
}
```

### 9.2 用户接口

- `GET /api/system/users`
- `POST /api/system/users`
- `PUT /api/system/users/{username}`
- `PATCH /api/system/users/{username}/status`
- `POST /api/system/users/{username}/reset-password`
- `DELETE /api/system/users/{username}`

`PATCH /api/system/users/{username}/status`

```json
{ "status": "disabled" }
```

### 9.3 参数字典接口

- `GET /api/system/param-dicts/categories`
- `PATCH /api/system/param-dicts/categories/{categoryCode}/status`
- `GET /api/system/param-dicts`（支持 `categoryCode` 过滤）
- `POST /api/system/param-dicts`
- `PUT /api/system/param-dicts/{dictId}`
- `PATCH /api/system/param-dicts/{dictId}/status`
- `DELETE /api/system/param-dicts/{dictId}`

### 9.4 菜单管理接口

- `GET /api/system/menus`（匿名只返回启用的非管理业务菜单；管理员登录后返回完整菜单管理数据）
- `POST /api/system/menus`
- `PUT /api/system/menus/{menuId}`
- `PATCH /api/system/menus/{menuId}/status`
- `PATCH /api/system/menus/{menuId}/move`
- `DELETE /api/system/menus/{menuId}`

`PATCH /api/system/menus/{menuId}/move`

```json
{ "direction": "up" }
```

菜单对象字段：`id`、`code`、`name`、`icon`、`path`、`order`、`adminOnly`、`status`（`enabled`/`disabled`）、`desc`。按角色分配菜单权限为后续预留能力。

### 9.5 数据结构

- 用户：`p_admin_user`
- 菜单：`p_menu`
- 参数字典：`p_code_category`、`p_code_item`

## 10. 操作日志模块 `operation-logs`

Base Path: `/api/operation-logs`

提供全站操作审计的分页查询与详情查询，只读；接口需要 `operation_log:read`，不属于 Public Catalog。

### 10.1 核心模型

#### OperationLog

```json
{
  "id": "log_0001",
  "module": "system",
  "operationType": "update",
  "result": "success",
  "operator": "linxiao",
  "summary": "更新用户 lihua 状态为 disabled",
  "createdAt": "2026-06-18 10:21:33"
}
```

### 10.2 接口

- `GET /api/operation-logs`
- `GET /api/operation-logs/{logId}`

### 10.3 查询参数

`GET /api/operation-logs`

- `keyword`：全局关键字
- `module`：按模块过滤
- `operationType`：操作类型，如 `create` / `update` / `delete`
- `result`：`success` / `fail`
- `startTime`、`endTime`：时间范围
- `page`、`pageSize`：分页参数

### 10.4 分页返回

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 20
}
```

## 11. 通用码值（历史/WAIT_DB）

`/api/common-codes/*` 是早期 Flask 的 Legacy Contract。FastAPI Native 迁移记录将 Common Code 保留为 `WAIT_DB`，当前没有注册 router，也不出现在 OpenAPI；前端运行时不得调用这些路径。

当前替代关系如下：

- 系统参数字典的管理契约是 `/api/system/param-dicts*`，由系统管理权限保护，数据表为 `p_code_category` / `p_code_item`。
- 报表类型是 `p_report_asset.report_type` 的领域值；报表页面从当前 `/api/reports` 列表建立 facet/编辑选项。
- 上游和推送编辑候选项从各自已注册的 `/api/upstreams`、`/api/push` 数据及集中本地默认选项建立。
- `enabled` / `disabled` 的公共展示使用共享二态状态契约“启用 / 禁用”。

Common Code service 仍可作为后端领域校验的内部数据访问实现，但这不代表恢复了一个公共 HTTP endpoint，也不构成第二套前端 API 契约。

## 12. 认证模块 `auth`

Base Path: `/api/auth`

### 12.1 核心模型

账户角色固定为 `admin` 或 `maintainer`。`admin` 可以管理用户、菜单、参数字典和全部业务模块；`maintainer` 可以维护业务模块并读取操作日志，但不能访问用户、菜单和参数字典管理。游客态 `guest` 只是前端未登录状态，不是可持久化账户角色。

#### AuthUser

```json
{ "role": "admin", "user": "linxiao", "name": "林晓" }
```

### 12.2 接口

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`

### 12.3 登录请求

`POST /api/auth/login`

```json
{ "username": "linxiao", "password": "******", "remember": true }
```

成功返回：

```json
{ "data": { "role": "admin", "user": "linxiao", "name": "林晓" } }
```

## API 资产模块 `api-assets`

Base Path: `/api/api-assets`

`ApiAsset` 字段：`code`、`name`、`method`、`path`、`version`、`domain`、`type`、`status`（`online` / `offline` / `deprecated`）、`ownerDept`、`ownerName`、`maintainerName`、`description`、`remark`、`params`、`responseFields`、`relations`。

- `GET /api/api-assets`：支持 `keyword`、`status`、`method`、`domain` 筛选。
- `GET /api/api-assets/{apiCode}`
- `POST /api/api-assets`
- `PUT /api/api-assets/{apiCode}`
- `PATCH /api/api-assets/{apiCode}/status`，请求体：`{ "status": "offline" }`
- `DELETE /api/api-assets/{apiCode}`
- `PUT /api/api-assets/{apiCode}/params`，请求体：`{ "items": [] }`
- `PUT /api/api-assets/{apiCode}/response-fields`，请求体：`{ "items": [] }`
- `PUT /api/api-assets/{apiCode}/relations`，请求体：`{ "items": [] }`

写接口均需要 `admin` 或 `maintainer` 登录。`code` 必须符合 `^[A-Z][A-Z0-9_-]{2,63}$`；`method`、`path`、`status`、归属部门和负责人为必填或受限字段。参数、响应字段与关联关系均为数组，服务端拒绝无效项并去重。

## 血缘分析模块 `lineage`

Base Path: `/api/lineage`

- `GET /api/lineage/bootstrap`：返回当前快照状态、默认根节点和节点/边数量。
- `GET /api/lineage/initial-view`：一次读取当前快照并返回初始化状态与有限血缘子图，供页面首次进入、刷新和筛选使用。
- `GET /api/lineage/assets?name=...`：按名称模糊搜索表或作业节点。
- `GET /api/lineage/subgraph`：返回有限血缘子图。

`initial-view` 与 `subgraph` 参数：

| 参数 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `rootId` | 当前快照中的节点 ID | 当前默认表节点 | 表级视图只接受表节点 |
| `view` | `table` / `detail` | `table` | 表级投影或表—作业详图 |
| `direction` | `upstream` / `downstream` / `both` | `both` | 追溯方向 |
| `depth` | 0–5 | 2 | 表跳数；作业节点不额外计层 |
| `maxNodes` | 1–300 | 100 | 返回节点上限 |

响应 `data` 包含 `snapshot`、`rootId`、`view`、`nodes`、`edges`、`truncated` 和
`diagnostics`。表级边额外包含 `viaJobs`，用于解释投影关系经过的作业。上游遍历遇到
`DWF` 或 `DWS_DWF` 表后停止该分支；下游遍历不应用此截止规则。

`initial-view` 响应 `data` 包含 `bootstrap`、`graph` 和 `noticeCode`。`bootstrap` 与
`bootstrap` 接口字段一致；快照可用时 `graph` 与 `subgraph` 响应一致，不可用或为空时
为 `null`。URL 中的根节点已失效或作业节点误用于表级视图时，接口在同一次快照读取内
回退到默认表节点，并分别返回 `ROOT_NOT_IN_SNAPSHOT` 或
`TABLE_VIEW_REQUIRES_TABLE_ROOT`。

## 13. Metadata Ingestion Contract

外部 Collector 只依赖 versioned JSON Contract，不依赖 DAP 内部表名、内部主键、Provider 或 migration。完整 ADR、字段语义和 reference examples 见 [metadata-ingestion.md](./metadata-ingestion.md) 与 [ADR-001](./adr/001-metadata-ingestion-contract.md)。

### 13.1 Asset ingestion

- `POST /api/metadata/assets/ingestions`：bulk upsert Asset Contract；兼容 alias `POST /api/metadata/assets:bulk-upsert`。
- query `dryRun=true` 或 `mode=preview`：只校验、normalize、compare，不修改业务数据或 audit。
- 请求包含 `contractVersion`、`source`、`collector`、`assets[]`；natural key 是 source identity + assetType + externalId，缺少 externalId 时使用 qualifiedName。
- 响应包含 `ingestionId`、`correlationId`、`status`、`summary` 和 item results；summary 区分 create/update/unchanged/conflict/invalid/deleteCandidate。

### 13.2 Lineage snapshot ingestion

- `POST /api/metadata/lineage/ingestions`：发布 self-contained lineage snapshot；兼容 alias `POST /api/metadata/lineage:snapshots`。
- V1 只支持 `snapshot.mode=replace`；edge source/target 必须引用当前 nodes。
- 相同 source + importId + content 返回 `already_applied`；同一 import 使用不同内容返回 `409 conflict`。
- `GET /api/metadata/ingestions/{ingestionId}`：查询正式 ingestion 的 audit summary；dry-run 不创建持久状态。

写入复用当前 `maintainer` auth seam。默认 bulk limits 为 1000 assets、1000 fields/asset、10000 total fields、10000 nodes、20000 edges 和 8 MiB body。Collector responsibilities、error model、transaction/rollback、四方言 migration 和非目标见 [metadata-ingestion.md](./metadata-ingestion.md)。

## 14. 实施建议

- 后端返回结构尽量严格遵循本文，不要模块间各自定义一套包装格式。
- 本文是仓库内唯一的 API 契约文档；新增接口请在对应模块章节内补充，不再新开平行契约文件。
- 模块的页面与数据表对照请维护在 [modules.md](./modules.md)，避免与本文重复描述同一套接口。
