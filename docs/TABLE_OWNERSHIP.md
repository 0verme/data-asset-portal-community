# Table Ownership

每张业务表都有单一归属模块。归属决定谁维护 schema、seed、查询和写入契约；它不决定产品 Edition。仓库中已经存在的模块和表默认属于同一 open repository contract。

## Canonical baseline

`backend/schema/{sqlite,postgresql,mysql,dws}.sql` 与 Alembic head `0006_field_mapping_upstream_identity` 共同覆盖以下 39 张 canonical tables：

| Owner | Tables |
| --- | --- |
| shared/core | `p_system`, `p_data_source` |
| system | `p_admin_user`, `p_menu`, `p_code_category`, `p_code_item`, `p_operation_log` |
| rbac | `p_role`, `p_permission`, `p_role_permission` |
| dwm | `p_asset_domain`, `p_asset_layer`, `p_asset_table`, `p_asset_field`, `p_asset_change_log` |
| mapping | `p_field_mapping_table`, `p_field_mapping_field` |
| root | `p_root_category`, `p_root_item`, `p_root_change_log` |
| indicator | `p_indicator_item`, `p_indicator_path_config`, `p_indicator_change_log` |
| apiAsset | `p_api_asset`, `p_api_param`, `p_api_response_field`, `p_api_relation` |
| upstream | `p_upstream_system`, `p_upstream_unload_time`, `p_upstream_change_log` |
| push | `p_push_system`, `p_push_job`, `p_push_job_field`, `p_push_change_log` |
| report | `p_report_asset` |
| codeTable | `p_manual_code_table` |
| lineage | `p_lineage_snapshot`, `p_lineage_node`, `p_lineage_edge` |

四方言保持相同的 table/column/primary-key/unique/foreign-key/index inventory；类型使用各数据库的等价表示。`p_asset_table` 的 source-scoped identity columns 与 `uq_p_asset_ingestion_identity` unique constraint 由 #114 contract mapping 使用，不能作为外部 Collector 的 wire shape。`p_push_system.master_system_id` 关联 shared `p_system`，用于复用现有 Push Service 的 master-system contract。

## Lineage storage boundary

`lineage` 模块、持久化 storage 和外部 collector 是三个不同概念：

- `p_lineage_snapshot`、`p_lineage_node`、`p_lineage_edge` 是仓库自身的 canonical storage，由 baseline 和 forward migration 创建；其 source/content/ingestion bookkeeping 由 `0004_metadata_ingestion_identity` 维护；
- `LINEAGE_DB_PROFILE` 选择 persistent storage profile；
- development/test 未配置 profile 时可以使用受控 POC snapshot；
- `backend/app/services/lineage_collector.py` 只有在外部 scheduler/source profile 可用时才执行采集，不影响 lineage route 和模块存在性。

缺少 storage/profile/collector 时，API 返回现有 `LINEAGE_CONFIGURATION_ERROR` 或 `LINEAGE_DATA_SOURCE_ERROR`，不使用 Edition 名义返回 404。

## Cross-module relationships

- `p_field_mapping_table.upstream_system_id` 是字段映射的系统身份，外键引用 `p_upstream_system.system_pk`；`data_source_id` 仅保留为可空的 shared `p_data_source` 兼容关系，不能用于系统身份筛选。
- `p_upstream_system.data_source_id` 引用 shared `p_data_source`；upstream 的连接信息仍是 deployment metadata，不代表实际连接已经可用。
- 字段映射查询、统计、表/字段维度和导出链路统一按 `upstream_system_id` 关联；系统名称只用于阅读，`system_abbr` 作为用户侧消歧编码。
- `p_push_system.master_system_id` 引用 `p_system`；`p_push_job` / `p_push_job_field` 通过 cascade foreign keys 维护其所属层级。
- lineage child tables 通过 `snapshot_id` cascade 引用 lineage snapshot。
- API Asset、Mapping、Report 等服务继续使用现有 SQLAlchemy Core / Provider contract，不新增数据库访问层。

## Supplementary DDL

`docs/pg/` 和 `docs/dws/` 保留为方言说明、历史迁移参考和部署 catalog。它们不能再被解释为某个仓库模块的产品锁或 baseline 排除清单。

`p_field_mapping_change_log` 的旧 DDL 目前没有对应 runtime service/SQLAlchemy declaration，也不在 canonical 39-table inventory；它作为 docs-only historical/reference artifact 保留，待实际 runtime 使用时再按正常 migration 流程纳入，不得作为当前 module availability 判据。

## Instance state versus module availability

- `p_menu.is_active` / menu `status`：管理员可以配置实例菜单是否展示；这是 instance visibility。
- `p_*.*status_code`、`enabled_flag`、`is_deleted`：业务记录状态；这是 data/business state。
- database profile、driver、credential、external API、storage profile 和 dangerous write readiness：deployment/runtime selection and diagnostics；它们不是 module availability 或 license gate。
- source/runtime module set：由仓库 manifest 和 route composition 固定为 open by default。

新增表时先确定 owner，再同时更新四方言 schema、Alembic revision、reflection/verify、seed 和相关 contract tests。禁止通过缺表、静默跳过 provider 或 route 404 制造产品 Edition 边界。
