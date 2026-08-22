# Edition Decision Report — Private Module Source Publication

> **Historical record — superseded by #116**：本文记录首次公开发布阶段的 Source/License 与旧 runtime boundary 决策。#115 已完成 Repository Truth Alignment，#116 已删除 Edition / Optional artificial runtime gating；本文中的 disabled route/table/profile 描述只保留为历史证据，不是当前产品或部署原则。
>
> 状态：**Historical Owner 决策 — ALLOW IN PUBLIC REPO**（见文末 Decision）。
> 本文回答「当时技术上是否安全、License 是否允许」；当前产品边界以仓库 manifest、canonical schema 和 #116 Owner Decision 为准。
>
> 生成时间：P4（CI / Open Source Guardrails & Release Readiness）
> 决策时间：Release Closure（首次公开发布）
> 数据来源：当前候选仓库 HEAD `ec84c99`（community-candidate）

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

## Product Strategy（历史 Owner 决策 — 已被 #116 重新审视）

**Decision：ALLOW IN PUBLIC REPO**

`upstream` / `report` / `push` / `codeTable` 四个模块的源码**随公开仓库提供**，
Edition 策略为 **Open Source but Disabled in Community Edition**（开源但 Community 版默认禁用）：

这里明确区分两个独立的维度：

- **Source / License 维度**：这些模块的源码包含在公开仓库中，依据仓库 Apache-2.0 License 提供，用户可以查看、修改、分发源码。
- **Product Edition / Runtime 维度**：Community Edition 默认 profile 不注册这些模块，对应产品能力默认不可用；这是运行时边界，不是许可证限制。

- 源码随仓库发布（Apache-2.0）；
- Community 默认 profile（`backend/configs/community.yaml`）**disabled** 这 4 个模块；
- Community 迁移不创建 Private 表，seed 不写 Private 表，启动不 import Private 实现；
- Private 路由在 Community 运行时不可达（404）；
- 搜索 / 统计不访问 disabled 模块。

决策依据：

1. **Public Data Guard**：BLOCKER = 0，SUSPICIOUS = 0。
2. **License**：Apache-2.0，源码为项目自产（Copyright 2025 Jearhe）。
3. **Community Runtime 不依赖**：Community migration / seed / startup 完全不依赖这些模块的 implementation。
4. **通用能力**：这些模块属于通用数据资产管理能力，不属于敏感业务实现。

> 这些模块源码随仓库提供，但默认 Community profile 不启用。

---

# Owner Decision — 已确定

**Private Module Source Publication: ALLOW IN PUBLIC REPO**

Edition Strategy: **Open Source but Disabled in Community Edition**

- 已决定：`upstream` / `report` / `push` / `codeTable` 源码保留在公开仓库。
- Community 默认 profile：disabled（`backend/configs/community.yaml`）。
- 不再删除这 4 个模块。

决策依据：

1. Public Data Guard：BLOCKER = 0，SUSPICIOUS = 0。
2. License：Apache-2.0，允许公开。
3. Community Runtime 完全不依赖这些 implementation。
4. 通用数据资产管理能力，非敏感业务实现。

决策时间：Release Closure（首次公开发布）。
