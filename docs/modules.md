# 模块清单

> 本文描述当前已实现模块的页面、职责、接口入口与数据表。完整端点及请求 / 响应契约见唯一 API 主文档 [api-contract.md](./api-contract.md)。

## 总览

当前共有 12 个一级功能模块：门户首页以及下表 11 个业务导航模块。菜单是否启用、展示顺序以及位于主导航或“更多”区域，均由系统菜单配置决定。下表把 **Source / Runtime / Schema / Demo** 分开：源码存在不等于当前 Community remote route 已注册，也不等于线上静态 mock bundle 的能力范围。

| 菜单 | Source / 前端视图 | Current remote API | Schema / seed / Demo 状态 |
| --- | --- | --- | --- |
| 上游卸数 | `UpstreamView.jsx` | `/api/upstreams/*`（Community 当前未注册） | `docs/pg` / `docs/dws` 扩展 DDL；mock 有数据；full profile 需外部上游依赖 |
| 数据仓库 | `AssetView.jsx` | `/api/assets/*` | `backend/schema` baseline；Community seed；remote 与 mock 均可展示 |
| 字段映射 | `FieldMappingPage.jsx` | `/api/field-mappings/*` | mapping core 表在 baseline；变更日志 DDL 为补充；Community seed |
| 血缘分析 | `LineagePage.jsx` | `/api/lineage/*` | Community remote 默认使用 POC/in-memory；persistent `p_lineage_*` 由 `docs/pg` / `docs/dws` 补充 DDL；mock 有受控图 |
| 词根管理 | `RootView.jsx` | `/api/roots/*` | `backend/schema` baseline；Community seed；remote 与 mock 均可展示 |
| 指标维护 | `IndicatorView.jsx` | `/api/indicators/*` | indicator item/path baseline；Community seed；当前没有独立 `/api/indicator-path/*` route |
| 报表资产 | `ReportView.jsx` | `/api/reports/*`（Community 当前未注册） | `docs/pg` / `docs/dws` 扩展 DDL；mock 有数据；full profile 需对应表 |
| API 资产 | `ApiAssetView.jsx` | `/api/api-assets/*` | `backend/schema` baseline；Community seed；remote 与 mock 均可展示 |
| 下游推送 | `PushView.jsx` | `/api/push/*`（Community 当前未注册） | `docs/pg` / `docs/dws` 扩展 DDL；mock 有数据；实际推送执行不在当前职责内 |
| 码值表维护 | `ManualCodeTablePage.jsx` | `/api/manual-code-tables/*`（Community 当前未注册） | `docs/pg` / `docs/dws` 扩展 DDL；mock 有数据；当前只维护元数据 |
| 系统管理 | `SystemView.jsx` | `/api/system/*`、`/api/operation-logs/*` | system/operation-log core 表在 baseline；Community seed；按角色控制菜单 |

Community 当前 remote capability profile 注册：`portal`、`dwm`、`mapping`、`lineage`、`root`、`indicator`、`apiAsset`、`system`。`upstream`、`push`、`report`、`codeTable` 的源码和 mock 仍在仓库，但当前 profile 不注册对应 route/menu/schema；这是真实的 #115 现状，移除边界属于 [#116](https://github.com/0verme/data-asset-portal-community/issues/116)。

门户首页和统一搜索是进入各业务模块的聚合入口，不作为独立主导航模块：

- 门户统计：`/api/portal/stats`
- 统一搜索：`/api/search`
- 能力清单：`/api/capabilities`

基础能力：

- 认证：`/api/auth/*`
- 通用码值：`/api/common-codes/*`（当前 WAIT_DB，不在 Community native route surface）
- 操作日志：`/api/operation-logs/*`

## 1. 上游卸数

**页面**：系统列表（卡片 / 表格视图）、系统详情、新增系统、编辑系统。

**数据表**：`p_upstream_system`、`p_upstream_unload_time`、`p_upstream_change_log`。

**说明**：登记上游源系统、连接元数据、负责人和多个卸数时间点，支持筛选、启停及删除；数据库类型、部门和状态选项由通用码值驱动。

## 2. 数据仓库

**页面**：资产列表（列表 / 卡片 / 分组视图）、详情页（字段 / DDL 视图）、新增表、编辑表。

**数据表**：`p_asset_domain`、`p_asset_layer`、`p_asset_table`、`p_asset_field`、`p_asset_change_log`。

**说明**：展示全部已配置数据层级的表资产，支持按层级、主题域和关键字组合筛选。层级等浏览状态写入 URL，支持刷新、分享及浏览器前进后退恢复；新增 / 编辑表单保存实际选择的数据层级。

## 3. 字段映射

**页面**：字段维度视图、表维度视图、统计卡片。

**数据表**：`p_data_source`、`p_field_mapping_table`、`p_field_mapping_field`、`p_field_mapping_change_log`；运行查询不依赖 `p_upstream_system`。

**说明**：展示源系统、源表及字段到目标表字段的映射关系，支持查询、统计和 CSV 导出；当前没有前端编辑入口。

## 4. 血缘分析

**页面**：血缘节点查询、任务—表有限子图、节点详情与关系证据。

**数据表**：`p_lineage_snapshot`、`p_lineage_node`、`p_lineage_edge`。

**说明**：基于当前可用的血缘快照查询表或任务节点，可选择上游、下游或双向关系及 1～5 层深度；图中展示节点、关系、证据和置信度。Community remote Demo 默认使用 POC/in-memory 快照；配置 `LINEAGE_DB_PROFILE` 并准备对应 `p_lineage_*` 表后才进入 persistent 模式，mock 模式使用前端受控演示图。

## 5. 词根管理

**页面**：词根列表、新增词根、编辑词根、批量导入。

**数据表**：`p_root_category`、`p_root_item`、`p_root_change_log`。

**说明**：按分类维护词根及中英文信息，支持新增、编辑、删除和批量导入；批量导入先在前端预览，再混合提交新增与更新记录。

## 6. 指标维护

**页面**：指标列表（列表 / 卡片 / 分组视图）、指标详情、新增指标、编辑指标。

**数据表**：`p_indicator_item`、`p_indicator_path_config`、`p_indicator_change_log`。

**说明**：维护指标标识、业务口径、分层路径、来源字段和结果字段，支持路径 / 维度筛选、状态筛选、启停及删除；指标路径级联选项由独立配置表驱动。

## 7. 报表资产

**页面**：报表列表（列表 / 卡片 / 分组视图）、详情抽屉、新增报表、编辑报表。

**数据表**：`p_report_asset`。

**说明**：维护报表元数据台账、归属信息、时效信息、关联表引用和关联指标引用；前端采用列表、详情抽屉和编辑器组合。

## 8. API 资产

**页面**：API 列表（列表 / 卡片 / 分组视图）、详情抽屉、新增 API、编辑 API。

**数据表**：`p_api_asset`、`p_api_param`、`p_api_response_field`、`p_api_relation`。

**说明**：维护 API 基本信息、请求参数、响应字段及关联资产，支持按下游系统和状态筛选、启停及删除。

## 9. 下游推送

**页面**：系统列表（卡片 / 表格视图）、作业列表、作业详情、新增 / 编辑系统、新增 / 编辑作业。

**数据表**：`p_push_system`、`p_push_job`、`p_push_job_field`、`p_push_change_log`。

**说明**：登记下游系统连接信息、联系人、推送作业、源 / 目标路径与文件名及作业字段。协议、认证方式、分隔符、编码和推送频率等选项由通用码值驱动；本模块管理推送元数据，不执行实际推送任务。

## 10. 码值表维护

**页面**：码值表列表、详情、新增码值表、编辑码值表。

**数据表**：`p_manual_code_table`。

**说明**：登记湖仓手工码值表的表编码、名称、样式、负责人、状态和说明，支持关键字 / 样式 / 状态筛选、新增、编辑、启停、删除及 CSV 导出。当前只维护表级元数据，不维护表内码值条目。

## 11. 系统管理

**页面**：用户管理、菜单管理、参数字典管理、操作日志。

**数据表**：用户 `p_admin_user`；菜单 `p_menu`；参数字典 `p_code_category`、`p_code_item`；操作日志 `p_operation_log`。

**说明**：用户状态为 `enabled` / `disabled`，角色为 `admin` / `maintainer`。管理员可以管理用户、菜单、参数字典和操作日志；维护员可以编辑业务模块并查看操作日志，但不能进入用户、菜单和参数字典管理。菜单管理支持启停、排序、主导航 / “更多”区域布局和管理员可见性配置。

## 12. 门户首页与统一搜索

**页面**：门户统计卡片、模块入口、统一搜索结果分组。

**数据表**：没有独立业务表；统计和搜索聚合各业务模块数据。

**说明**：门户首页根据已启用菜单展示模块入口和资产统计；统一搜索按资产、上游系统、字段、词根、指标、报表、API、下游推送和码值表分组返回结果，并可跳转到对应模块。搜索/统计实体由 `backend/app/services/providers` 注册，随模块能力启停插拔。

## 13. 认证

**数据表**：`p_admin_user`。

**说明**：remote 模式由后端使用数据库用户表完成登录、会话恢复和登出，仅 `ACTIVE` 用户可以登录；`admin` 和 `maintainer` 角色决定系统管理范围与业务编辑权限。mock 模式使用前端演示登录。

## 14. 通用码值

**数据表**：`p_code_category`、`p_code_item`。

**已初始化关键分类**：`UPSTREAM_DB_TYPE`、`UPSTREAM_DEPT`、`PUSH_PROTOCOL`、`PUSH_AUTH_TYPE`、`PUSH_DELIMITER`、`FILE_ENCODING`、`FREQ_TYPE`、`SYSTEM_STATUS`。

**说明**：为上游卸数、下游推送等模块提供统一分类码值和下拉选项；分类及条目由系统管理中的参数字典页面维护。

## 15. 操作日志

**页面**：操作日志列表（分页、筛选）、日志详情。

**数据表**：`p_operation_log`。

**说明**：记录全站写操作审计，只读；支持按模块、操作类型、结果、时间范围和关键字筛选。管理员从系统管理进入完整管理界面，维护员登录后可直接进入操作日志页面。

## 16. 数据源对照

### 前端 mock 数据

`VITE_API_MODE=mock` 默认依据 `frontend/src/modules/moduleRegistry.js` 暴露源码中的全部 module registry；可用 `VITE_ENABLED_MODULES` 缩小范围。mock capability coverage 不代表 Community remote route coverage，也不代表线上静态 Demo 与当前 main 的版本。

`VITE_API_MODE=mock` 时，业务 API 使用 `frontend/src/data/` 中的演示数据或对应 API 文件内的受控演示数据。当前数据文件包括：

`apiAssets.js`、`commonCodes.js`、`fieldMappings.js`、`indicatorPathOptions.js`、`indicators.js`、`manualCodeTables.js`、`menus.js`、`operationLogs.js`、`paramDicts.js`、`pushSystems.js`、`reports.js`、`roots.js`、`systemUsers.js`、`tables.js`、`upstreamSystems.js`。

门户统计、统一搜索和血缘分析的 mock 数据分别由对应前端 API 模块聚合或内置，不使用独立数据文件。

### 后端数据

`VITE_API_MODE=remote` 时，前端统一访问后端 `/api`。后端业务模块始终通过 Database Provider 和 database profile 读写数据，不使用本地 JSON mock；route 是否可达仍由当前 capability profile 决定。

Community/local 隔离运行支持 SQLite（`type: sqlite`），其基线由 `backend/schema` + Alembic + seed 流程维护；Community 正式部署推荐 PostgreSQL（`type: postgres`），MySQL 8.0 由独立 profile/driver 支持。完整或扩展部署可使用 PostgreSQL、GaussDB/DWS，并按 `docs/pg/`、`docs/dws/` 的补充 DDL 准备 Optional 表和外部依赖。Cloudflare D1 不在支持范围内。
