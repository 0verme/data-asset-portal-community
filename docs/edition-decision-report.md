# Edition Decision Report — Private Module Source Publication

> 状态：**信息报告，不代替 Owner 决策**。本文回答「技术上是否安全、License 是否允许」，
> 最终「源码留在公开仓库还是发布前移除」由仓库 Owner 决定（见文末 OWNER DECISION REQUIRED）。
>
> 生成时间：P4（CI / Open Source Guardrails & Release Readiness）
> 数据来源：当前候选仓库 HEAD `47710fa`（community-candidate）

## 背景

Community 边界（`backend/configs/community.yaml`）把以下 4 个模块标记为 disabled：

| 模块 | 说明 |
| --- | --- |
| `upstream` | 上游卸数系统管理 |
| `push` | 下游推送（系统 / 作业 / 作业字段） |
| `report` | 报表资产 |
| `codeTable` | 码值表维护 |

这些模块的**实现源码目前仍在候选仓库中**（P3 未删除，仅通过配置禁用）。
本文按模块给出：源码规模、文件清单、License、敏感数据扫描结果、对 Community 的依赖、
以及后续独立插件化的可行性评估。

## 逐模块明细

### upstream（上游卸数）

- **后端**：`backend/app/routes/upstream.py`（122 行）、`backend/app/services/upstream_service.py`（640 行），共 762 行。
- **测试**：`test_upstream_service.py`、`test_push_upstream_routes_unit.py`。
- **前端**：6 个文件（约 39 KB）：`components/upstream/`（List / Detail / Editor / Parts）、`api/upstream.js`、`hooks/useUpstreamModule.js`。
- **文档/迁移**：`docs/pg/upstream-app-pg-ddl.sql`、`docs/dws/upstream-app-dws-ddl.sql`；migration manifest 无 upstream 专属条目（表结构在 docs DDL 中）。
- **License**：后端带 Apache-2.0 header（`# Copyright 2025 Jearhe`）。
- **敏感数据**：Public Data Guard 全仓扫描 BLOCKER=0 / SUSPICIOUS=0（含本模块文件）。
- **Community 依赖**：`mapping` 模块（Community enabled）的表关系已与 upstream 解耦（manifest 0004 "decouple_field_mapping_from_upstream"），upstream 不是 Community 运行依赖。
- **插件化可行性**：路由 + service + 前端视图 + docs DDL 边界清晰，可整体移出为独立扩展；但当前与 `push` 共享测试文件与部分公共组件（上游/下游联动视图），剥离成本中等。

### push（下游推送）

- **后端**：`backend/app/routes/push.py`（161 行）、`backend/app/services/push_service.py`（1356 行），共 1517 行 —— 4 个模块中最大的一个。
- **测试**：`test_push_job_schema.py`、`test_push_upstream_routes_unit.py`。
- **前端**：9 个文件（约 68 KB）：`components/push/`（SystemList / JobList / pushUtils / pushConstants 等）、`api/push.js`、`hooks/usePushModule.js`。
- **文档/迁移**：`docs/pg/push-app-pg-ddl.sql`、`docs/dws/push-app-dws-ddl.sql`；migration **0001**（push_system_importance）为 push 专属（仅 postgresql/dws 方言，无 sqlite —— 符合 Private 边界）。
- **License**：后端带 Apache-2.0 header（`push_service.py` 文件首字节含 UTF-8 BOM，工程整洁小问题，无 License 风险）。
- **敏感数据**：Public Data Guard BLOCKER=0 / SUSPICIOUS=0。
- **Community 依赖**：`apiAsset` 模块已与 push 解耦（manifest 0003 "decouple_api_assets_from_push"），API 资产不依赖 push。
- **插件化可行性**：体量最大，含作业调度语义（`push_service.py` 1356 行覆盖系统/作业/字段管理 + 调度），独立插件化成本最高；建议保留为整体扩展模块。

### report（报表资产）

- **后端**：`backend/app/routes/report.py`（95 行）、`backend/app/services/report_service.py`（592 行），共 687 行。
- **测试**：`test_report_routes.py`（153 行）、`test_report_routes_unit.py`。
- **前端**：5 个文件（约 43 KB）：`components/report/`（List / DetailDrawer / Editor）、`api/report.js`、`hooks/useReportModule.js`。
- **文档/迁移**：`docs/pg/reports-app-pg-ddl.sql`、`docs/dws/reports-app-dws-ddl.sql`；migration manifest 无 report 专属条目。
- **License**：后端带 Apache-2.0 header。
- **敏感数据**：Public Data Guard BLOCKER=0 / SUSPICIOUS=0。
- **Community 依赖**：无（报表资产是独立元数据维护模块）。
- **插件化可行性**：结构最轻（列表 + 详情抽屉 + 编辑器），插件化成本低。

### codeTable（码值表维护，前端命名 ManualCodeTable）

- **后端**：`backend/app/routes/manual_code_table.py`（139 行）、`backend/app/services/manual_code_table_service.py`（289 行），共 428 行。
- **测试**：`test_manual_code_table_routes_unit.py`。
- **前端**：5 个文件：`components/ManualCodeTablePage.jsx`、`components/sidebar/ManualCodeTableSidebar.jsx`、`api/manualCodeTables.js`、`hooks/useManualCodeTableModule.js`、`data/manualCodeTables.js`。
- **文档/迁移**：`docs/pg/manual-code-tables-app-pg-ddl.sql`、`docs/dws/manual-code-tables-app-dws-ddl.sql`；migration manifest 无专属条目。
- **License**：后端带 Apache-2.0 header。
- **敏感数据**：Public Data Guard BLOCKER=0 / SUSPICIOUS=0。
- **Community 依赖**：无。
- **插件化可行性**：体量最小，结构清晰，插件化成本低。

## 技术结论

**公开这些源码在技术上安全：**

1. **无敏感数据**：Public Data Guard（`demo/validate_demo_data.py`）全仓 BLOCKER=0 / SUSPICIOUS=0；
   4 个模块的代码、测试、docs DDL 均在扫描面内，未发现凭据、内网地址、真实业务数据。
2. **无私有依赖**：不依赖 GaussDB 商业 JDBC 驱动之外的任何私有包；后端依赖仅
   Flask / Flask-Cors / psycopg / PyYAML（全部精确 pin），前端依赖全部来自公共 registry 或仓库内 workspace。
3. **运行时边界干净**：Community 启动（`create_app` + `community.yaml`）不注册这 4 个模块的路由，
   `test_community_boundary` / `test_disabled_modules` / `test_root_import_audit_unit` 守护该契约；
   CI 新增加物理边界检查（Private 表 physically absent）进一步确认。

**唯一注意点（非 blocker）**：`push_service.py` 含 UTF-8 BOM 头；个别前端文件（如
`PushSystemList.jsx`）缺 Apache-2.0 文件头注释 —— 仓库级 LICENSE 已覆盖，不影响 License 合规，
仅属工程整洁建议。

## License 结论

**允许以 Apache-2.0 公开：**

- 仓库整体 LICENSE = Apache 2.0（`LICENSE` + `NOTICE`）。
- 4 个模块的代码为项目自产（Copyright 2025 Jearhe），非第三方闭源代码。
- 未发现需单独授权才能公开的第三方代码、字体、图标或数据。

## Product Strategy（Owner 决策）

模块是否公开是**产品策略 / IP 策略**问题，不是技术或 License 问题：

- 「Community feature disabled」—— 即代码随仓库公开、运行时默认关闭，靠配置与边界守护；
- 或「Commercial/private source 不应公开」—— 发布前从公开仓库移除（保留在内部仓库）。

扫描器不会替 Owner 做这个决定。当前 P4 保持现状（源码保留、配置禁用、边界守护），
不自动删除。

---

# OWNER DECISION REQUIRED

**Private Module Source Publication**

> 候选仓库当前包含 `upstream` / `report` / `push` / `codeTable` 四个模块的源码。

- 技术结论：**安全**（无敏感数据、无私有依赖、运行时边界干净）。
- License 结论：**明确**（Apache-2.0 允许公开）。
- 产品策略：**未决定**。

请 Owner 选择：

- [ ] **ALLOW IN PUBLIC REPO** —— 保留源码，Community 运行时默认禁用（当前状态）
- [ ] **REMOVE BEFORE RELEASE** —— 发布前从公开仓库移除这 4 个模块的实现源码

此决策是 Final Release 的唯一人工 gate 之一（与「首次真实 GitHub Actions 运行」并列）。
