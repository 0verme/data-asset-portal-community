# Table Ownership

每张业务表都有**单一归属模块**。归属决定：谁负责建表（migration manifest 的
`module`）、谁可以写入、谁在 Community 版本中可用。

方向约束：

```
Community / Core
      ↑
Optional Extension（upstream / report / push / codeTable）
```

- Core 允许被 Optional 引用，但 Core **不反向依赖** Optional。
- 可选模块的表只由 docs DDL（完整部署初始化）创建；Community migration
  永不创建可选模块表。

## Community / Core（migration 0002-0006 创建，Community 与完整版共有）

| 表 | Owner 模块 | 创建来源 |
|---|---|---|
| p_system | core（Shared） | migration 0002 |
| p_data_source | core（Shared） | migration 0002 |
| p_admin_user | system | migration 0005 |
| p_asset_domain | dwm | migration 0005 |
| p_asset_layer | dwm | migration 0005 |
| p_asset_table | dwm | migration 0005 |
| p_asset_field | dwm | migration 0005 |
| p_asset_change_log | dwm | migration 0005 |
| p_root_category | root | migration 0005 |
| p_root_item | root | migration 0005 |
| p_root_change_log | root | migration 0006 |
| p_indicator_item | indicator | migration 0005 |
| p_indicator_path_config | indicator | migration 0005 |
| p_indicator_change_log | indicator | migration 0006 |
| p_operation_log | system | migration 0005 |
| p_menu | system | migration 0006 |
| p_code_category | system | migration 0006 |
| p_code_item | system | migration 0006 |
| p_api_asset | apiAsset | migration 0003 |
| p_api_param | apiAsset | migration 0003 |
| p_api_response_field | apiAsset | migration 0003 |
| p_api_relation | apiAsset | migration 0003 |
| p_field_mapping_table | mapping | migration 0004 |
| p_field_mapping_field | mapping | migration 0004 |

## Private（docs DDL 创建，仅完整版；Community 永不创建/写入）

| 表 | Owner 模块 |
|---|---|
| p_push_system / p_push_job / p_push_job_field / p_push_change_log | push |
| p_upstream_system / p_upstream_unload_time / p_upstream_change_log | upstream |
| p_report_asset | report |
| p_manual_code_table | codeTable |

## 特殊表

| 表 | 说明 |
|---|---|
| p_lineage_snapshot / p_lineage_node / p_lineage_edge | lineage 持久化快照表。由 docs DDL 创建；Community 默认 POC 模式不查询；配置 `LINEAGE_DB_PROFILE` 的 persistent 模式才使用 |
| p_field_mapping_change_log | mapping 变更日志，docs DDL 定义（migration 0004 未创建；当前 runtime 未使用） |

## 灰区禁止条款

- 禁止"表由 Push 建、Mapping 偷偷依赖"的跨模块依赖。
- API Asset 只依赖 `p_system`（不依赖 push）；Field Mapping 只依赖
  `p_data_source`（不依赖 upstream）——解耦关系见 migration 0003/0004。
- 新增表时：先确定 owner 模块，再决定进 migration（Community）还是 docs DDL（Private）。
