# 见远而行数据资产管理与血缘分析软件 API 契约

> 本文是 `data-asset-portal` 的**唯一 API 主文档**，描述全部后端接口的统一约定与各模块端点。
> 模块的页面、数据表对照见 [modules.md](./modules.md)；本文与实现以 `backend/app/routes/` 和前端 `frontend/src/api/` 为准。

## 模块总览

后端蓝图在 `backend/app/__init__.py` 注册，统一以 `/api` 为前缀：

| 模块 | 前端 API | Base Path | 说明 |
| --- | --- | --- | --- |
| 上游卸数 | `api/upstream.js` | `/api/upstreams` | 管理上游源系统与卸数状态 |
| 数据仓库 | `api/assets.js` | `/api/assets` | 管理全部已配置层级的表资产、字段、DDL |
| 字段映射 | `api/fieldMapping.js` | `/api/field-mappings` | 查询源字段到目标字段映射关系 |
| 指标维护 | `api/indicator.js` | `/api/indicators` | 管理口径指标、维度、启停状态 |
| 报表资产 | `api/report.js` | `/api/reports` | 管理报表台账、归属信息与关联引用 |
| 词根管理 | `api/root.js` | `/api/roots` | 管理命名词根字典 |
| 下游推送 | `api/push.js` | `/api/push` | 管理下游系统、推送作业与字段 |
| 系统管理 | `api/systemUsers.js`、`api/paramDicts.js` | `/api/system` | 后台用户与参数字典管理 |
| 操作日志 | `api/operationLogs.js` | `/api/operation-logs` | 查询全站操作审计日志 |
| 通用码值 | `api/commonCodes.js` | `/api/common-codes` | 全系统可复用的分类码值与下拉选项 |
| 认证 | `api/auth.js` | `/api/auth` | 登录、登出、获取当前用户 |

## 1. 总体约定

### 1.1 Base URL

- 统一使用 `/api` 作为接口前缀
- 前端使用相对路径访问，例如 `/api/assets/tables`、`/api/field-mappings/stats`、`/api/roots`

### 1.2 Content-Type

```http
Content-Type: application/json; charset=utf-8
Accept: application/json
```

### 1.3 统一返回格式

| 场景 | 返回体 |
| --- | --- |
| 列表 | `{ "items": [] }` |
| 详情 | `{ "data": {} }` |
| 新增 / 更新 | `{ "message": "ok", "data": {} }` |
| 删除 | `{ "message": "deleted" }` |

分页列表（如操作日志）在 `items` 外附带 `total`、`page`、`pageSize` 等字段。

### 1.4 统一错误格式

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

### 1.5 建议状态码

- `200 OK`：查询、更新、删除成功
- `201 Created`：新增成功
- `400 Bad Request`：请求格式错误
- `401 Unauthorized`：未登录或登录失效
- `403 Forbidden`：已登录但无权限
- `404 Not Found`：资源不存在
- `409 Conflict`：唯一键冲突
- `422 Unprocessable Entity`：业务校验失败
- `500 Internal Server Error`：服务端异常

### 1.6 前端运行模式

前端通过 `VITE_API_MODE` 切换数据来源：`mock` 走前端内置数据并使用演示登录；`remote` 统一走 `/api` 调后端真实数据库。

```env
VITE_API_MODE=remote
```

### 1.7 权限

系统管理（`/api/system`）的写操作（新增 / 更新 / 删除 / 状态变更 / 重置密码）由后端 `require_admin` 保护，需管理员登录态。业务模块维护操作允许 `admin` 或 `maintainer` 登录态；只读接口按各模块当前路由契约执行。

## 2. 数据仓库模块 `assets`

Base Path: `/api/assets`

### 2.1 核心模型

#### AssetField

```json
{
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
- `layer`：按数据层级过滤；省略时返回全部已配置层级，取值以 `GET /api/assets/layers` 返回的启用层级为准（V1.0.0 默认包含 ODS、DWD、DWA、DWM、DWS、DM、ADS）

前端数据仓库首页默认不传 `layer`，展示全部层级；DWM 是推荐筛选项。首页侧边栏提供“全部层级”和各已配置层级入口，筛选状态通过 URL 的 `layer` 参数保留并可分享、刷新及前进后退恢复。mock 与 remote 模式遵循相同的筛选语义。

### 2.4 DDL 返回

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

## 3. 字段映射模块 `field-mappings`

Base Path: `/api/field-mappings`

### 3.1 核心模型

#### FieldMappingRow

```json
{
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

- `GET /api/field-mappings/source-systems`
- `GET /api/field-mappings/stats`
- `GET /api/field-mappings/fields`
- `GET /api/field-mappings/tables`

### 3.3 查询参数

下列参数由 `stats`、`fields`、`tables` 共用：

- `keyword`：全局关键字
- `srcSystem`：源系统名，精确匹配
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

## 4. 指标维护模块 `indicators`

Base Path: `/api/indicators`

### 4.1 核心模型

#### IndicatorItem

```json
{
  "id": "CUST00001",
  "name": "个体工商户标识",
  "meaning": "客户是否为个体工商户",
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

#### UpstreamSystem

```json
{
  "id": "up_member",
  "abbr": "MEMBER",
  "name": "会员中心",
  "dbType": "Oracle",
  "host": "192.0.2.11",
  "db": "MEMBER_PROFILE",
  "schema": "public",
  "unloadTimes": ["00:30", "06:00", "12:00", "18:00"],
  "status": "enabled",
  "owner": "陈默",
  "dept": "会员运营部",
  "desc": "会员档案数据按固定时点卸数至 ODS"
}
```

### 7.2 接口

- `GET /api/upstreams/systems`
- `GET /api/upstreams/systems/{systemId}`
- `POST /api/upstreams/systems`
- `PUT /api/upstreams/systems/{systemId}`
- `PATCH /api/upstreams/systems/{systemId}/status`
- `DELETE /api/upstreams/systems/{systemId}`

### 7.3 查询参数

`GET /api/upstreams/systems`

- `keyword`：模糊匹配 `id`、`abbr`、`name`、`host`、`db`、`schema`
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

#### PushSystem

```json
{
  "id": "member_push",
  "name": "会员运营工作台",
  "abbr": "DEMO_CDP",
  "protocol": "SFTP",
  "host": "198.51.100.10",
  "port": 22,
  "account": "dw_member_push",
  "auth": "密钥认证",
  "contact": "苏瑶",
  "dept": "会员运营部",
  "desc": "会员运营下游推送",
  "status": "enabled",
  "jobs": []
}
```

#### PushJob

```json
{
  "id": "job_member_profile",
  "cn": "会员档案推送",
  "sourcePath": "/dwm/member/profile",
  "sourceFileName": "member_profile_source_${yyyyMMdd}.csv",
  "targetPath": "/push/member/profile/",
  "targetFileName": "member_profile_${yyyyMMdd}.csv",
  "freqType": "T+1",
  "freq": "",
  "delimiter": ",",
  "encoding": "UTF-8",
  "rows": "约 12 万",
  "enabled": true,
  "owner": "林晓",
  "desc": "会员档案推送作业",
  "fields": []
}
```

> **推送频率（`freqType` + `freq`）**：`freqType` 为类型，`freq` 为对应参数（落库分别对应 `freq_type` / `freq_desc`）。
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
- 返回项包含 `host`，用于展示下游服务器地址（可为 IP 或域名）；不包含端口、账号和认证方式。

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

`status` 取值：`enabled` / `disabled` / `locked`。

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

- `GET /api/system/menus`
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

提供全站操作审计的分页查询与详情查询，只读。

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

## 11. 通用码值模块 `common-codes`

Base Path: `/api/common-codes`

### 11.1 核心模型

#### CommonCodeCategory

```json
{
  "code": "UPSTREAM_DB_TYPE",
  "name": "上游数据库类型",
  "desc": "上游卸数系统数据库类型选项",
  "active": true,
  "count": 6
}
```

#### CommonCodeItem

```json
{
  "categoryCode": "UPSTREAM_DB_TYPE",
  "code": "POSTGRESQL",
  "name": "PostgreSQL",
  "value": "PostgreSQL",
  "desc": "PostgreSQL Database",
  "order": 30,
  "active": true,
  "ext": {}
}
```

### 11.2 接口

- `GET /api/common-codes/categories`
- `GET /api/common-codes/categories/{categoryCode}/items`

### 11.3 当前初始化分类

`UPSTREAM_DB_TYPE`、`UPSTREAM_DEPT`、`PUSH_PROTOCOL`、`PUSH_AUTH_TYPE`、`PUSH_DELIMITER`、`FILE_ENCODING`、`FREQ_TYPE`（推送频率，取值 T+1/T+0/准实时/每周/每月）、`SYSTEM_STATUS`。

### 11.4 使用约定

- 通用下拉项、状态项、协议项等场景统一走通用码值，页面不再硬编码。
- 已接入页面：上游卸数系统页（数据库类型）、下游推送系统页与筛选区（推送协议、认证方式、系统状态）。

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

## 13. 实施建议

- 后端返回结构尽量严格遵循本文，不要模块间各自定义一套包装格式。
- 本文是仓库内唯一的 API 契约文档；新增接口请在对应模块章节内补充，不再新开平行契约文件。
- 模块的页面与数据表对照请维护在 [modules.md](./modules.md)，避免与本文重复描述同一套接口。
