# Issue #536 全仓 Profile 影响矩阵（Phase 0）

**基线 SHA：** `8cd31c28077d86ecc9dd21442e413c94d0257caf`（2026-11-12，同步后的 `origin/main`）。

**扫描范围：** 仓库 backend、scripts、deploy/docs、`.github`、Demo 和根配置/文档；`rg` 命中 **104 files / 331 matches**。下列 `file:line` 均为该基线的精确匹配行号，后续提交会使部分行号移动。`ASSET_DB_*` 连接/Provider/JDBC 覆盖不是 Profile selector，按 #414 precedence 保留；显式运维/测试目标不是普通服务选择器，按 #454 写目标契约保留。

## 分类与处理原则

| 类别 | 用途 / 是否运行路径 | 处理原则 |
| --- | --- | --- |
| `AUTH` | HTTP 登录、Session 当前身份、RBAC request dependency 的真实运行路径 | 身份、角色、权限统一走经校验的 `ASSET_DB_PROFILE`；旧认证 Profile 仅同值弃用警告，其余 fail closed，不回退 `primary`。 |
| `APP` | 普通业务 API / service 的真实运行路径 | 保持现有 ASSET Profile 与动态物理 Schema；不重写 CRUD/SQL，不删连接覆盖。 |
| `LINEAGE` | lineage API 或 Collector 读取/写入路径 | API 固定同一 ASSET Profile；无 ACTIVE 是空状态，连接/Schema/表故障明确报错；Collector 显式目标须等于 ASSET，未授权时不发布。 |
| `OPS` | 显式运维 CLI（迁移、Seed、密码维护、只读导出） | 保留 `--profile`、dry-run/preview、目标验证和破坏性确认；省略时只用有效 ASSET 或失败，不猜 `primary`。 |
| `EXT` | 外部源端/数据接入只读连接 | 保留显式外部 source `--profile` 和现有 source 查询；不改外部连接字段/认证方式。移除隐藏的内部 Profile fallback，Portal API 写入仍由服务端 ASSET 决定。 |
| `CI` | GitHub/离线迁移/多方言验证的 test profile | 保留明确的测试目标和 Provider 覆盖；不得将测试 Profile 变成应用默认。 |
| `TEST` | 单元/集成测试 fixture、静态配置契约 | 非生产访问路径；用合成 SQLite/显式隔离目标验证，更新过期断言而不删多 Profile/方言测试。 |
| `DOC` | 运维、开发、架构与 API 契约说明 | 对齐唯一 ASSET selector、旧变量迁移策略和 CLI 风险；保留外部 source 与显式维护目标说明。 |
| `DEMO` | Community Demo 的本地启动路径 | 子进程只选择 community SQLite；不继承旧 selector 或外部数据库覆盖，也不修改用户 `.env*` 文件。 |

## 全文件 / 行号索引

### 文档、部署、CI 与 Demo

| 文件:行号（基线） | 分类 / 用途及处理 |
| --- | --- |
| `DEVELOPMENT.md:167,168,231,240,244,259,325,328` | `DOC`：本地后端双 Profile 样例、Community runtime、迁移/只读导出示例及 Lineage 契约；删除 Auth 双 selector，保留迁移/导出显式目标。 |
| `DEPLOYMENT.md:87,88,118,292,297,302,306,312,315,319,339,347,351,359,365,369,724,778` | `DOC/OPS`：生产样例、旧 Auth 分库描述、CLI 与迁移目标；单 Profile 上线检查、旧库数据核验、停止条件、#454 Schema 写目标检查。 |
| `.github/workflows/ci.yml:283,289,297,325,493,496,508` | `CI`：PostgreSQL/MySQL 专用迁移与集成 Profile；保持显式 `pg_ci` / `mysql_ci`，仅作 CI 目标。 |
| `docs/TABLE_OWNERSHIP.md:33,34` | `DOC/LINEAGE`：Lineage 表 owner 与 selector 契约；补齐 Auth/RBAC 同库和 Collector 目标一致性。 |
| `docs/community-demo.md:127,171,227` | `DOC/DEMO`：Demo 环境隔离、命令与迁移说明；明确只设 ASSET、dotenv 也过滤外部 DB 设置。 |
| `docs/lineage_bulk_import_guide.md:39,40,41,44,45,49,87,93` | `DOC/LINEAGE`：显式 Collector 目标、dry-run、部署调度样例；说明 CLI/Service 拒绝不同于 ASSET 的 Profile，正式发布仍需单独批准。 |
| `docs/modules.md:14,70` | `DOC/APP`：Lineage API/模块数据源说明；保持真实 Remote 使用 ASSET、无快照为空，前端 Mock 边界不变。 |
| `docs/diagrams/architecture.json:344` | `DOC/LINEAGE`：架构图数据源节点；确认无独立 selector/POC 回退的描述与代码一致。 |
| `docs/configuration.md:219,222,228,243,244,245,249,254` | `DOC`：Lineage 旧变量与 Profile/override precedence；将 Auth fallback 描述改为 deprecated+fail-closed，保留 #414 的全局连接覆盖契约。 |
| `docs/architecture.md:31,86` | `DOC`：内部目录/Runtime Profile 概念；区分部署 preset、应用 DB Profile 和模块身份。 |
| `docs/ai-metadata-count.md:14` | `DOC/APP`：目录统计与 `PUBLIC_CATALOG_PROFILE` 边界；保持独立策略，不受内部 Profile 收敛影响。 |
| `docs/database-support.md:85,101,105,110` | `DOC/OPS`：只读导出源/目标安全及迁移示例；保留显式源/目标分离和方言说明，不将 Profile 简化为 Schema。 |
| `scripts/release_check.py:134,136,139` | `CI/OPS`：Release check 使用隔离 SQLite profile 执行 apply/verify；继续显式目标，不连接部署数据库。 |
| `scripts/community_demo.py:234,241,242,249,251,252,477` | `DEMO`：Demo child env、旧 selector 过滤和 bootstrap 命令；仅设置 `ASSET_DB_PROFILE=community_sqlite`，过滤宿主及 dotenv 中的 DB selectors/连接覆盖。 |
| `docs/diagrams/architecture.html:4989` | `DOC/LINEAGE`：架构图 HTML 镜像；与 JSON 图及实际单 Profile 行为保持一致。 |
| `backend/README.md:137,138,227,235,261,280,284,288,310,314,323,327,331,335,350,361` | `DOC/OPS`：环境变量、Community runtime、PostgreSQL/DWS 维护目标示例；移除 Auth Profile 行，强调认证/RBAC/Lineage 随 ASSET，保留显式 migration profile。 |
| `backend/schema/README.md:17,18,19,20,38,42` | `DOC/OPS`：Schema apply/verify/preflight 命令；保留显式目标和只读 preflight/写目标安全。 |
| `backend/alembic/REAL_DWS_VALIDATION.md:14,22,52,53,60,61,62,63,64,103` | `DOC/OPS`：真实 DWS 操作步骤；保持人工审批、显式 Profile、verify 与 Schema 检查，不能由本 Issue 自动执行。 |

### Backend 应用与数据库运行路径

| 文件:行号（基线） | 分类 / 用途及处理 |
| --- | --- |
| `backend/app/services/auth_service.py:26,204,208,215,246,248,249,259,261,262` | `AUTH`：登录、账号读取/更新及认证诊断；移除独立 Auth selector/primary fallback，统一解析与脱敏错误分类。 |
| `backend/app/authorization/repository.py:26,27,31,43,49` | `AUTH`：DB-backed 用户/角色/权限查询与 Provider physical schema；共用 Auth resolver，不改动态 schema SQL。 |
| `backend/app/db/facade.py:54,55,155` | `APP/AUTH`：默认/旧 Auth selector 常量及公共 Profile resolver；默认路径要求 ASSET、存在且配置有效，旧 Auth 仅兼容校验；底层按名 Provider API 保留。 |
| `backend/app/db/service.py:16,31` | `APP`：CoreAccess 无显式 getter 时的默认 Profile 路径；依公共 ASSET resolver fail closed。 |
| `backend/app/services/lineage_service.py:3,19,66,73` | `LINEAGE`：Lineage status/bootstrap 路径；#539 已完成 ASSET storage/空状态/错误分类，本次回归，不重发快照。 |
| `backend/app/services/metadata_ingestion_service.py:36,112,120` | `APP`：metadata ingestion service profile 注入/默认；保持 ASSET，保留受测显式组合 seam。 |
| `backend/app/services/assets_service.py:27,183,256` | `APP`：资产目录读取/写入；保持 ASSET、Provider 和目标校验。 |
| `backend/app/services/field_mapping_service.py:46,125,133` | `APP`：字段映射查询/导入；保持 ASSET 与现有 CRUD/导入合同。 |
| `backend/app/services/portal_service.py:23,54,61` | `APP`：门户聚合统计；保持 ASSET，回归连接故障分类。 |
| `backend/app/services/indicator_service.py:126` | `APP`：指标数据服务；保持当前 Profile 获取。 |
| `backend/app/services/indicator_path_service.py:22` | `APP`：指标路径读取；保持 ASSET。 |
| `backend/app/services/report_service.py:107` | `APP`：报表查询；保持 ASSET。 |
| `backend/app/services/api_asset_service.py:63` | `APP`：API 资产服务；保持 ASSET。 |
| `backend/app/services/common_code_service.py:25,71,82` | `APP`：码值服务默认 DB path；保持公共 ASSET resolver。 |
| `backend/app/services/root_service.py:80` | `APP`：词根业务服务；保持 ASSET；与 Seed CLI 选择分离。 |
| `backend/app/services/system_management_service.py:146` | `APP`：系统管理/用户角色等服务；保持 ASSET，Auth/RBAC 共 Profile。 |
| `backend/app/services/operation_log_service.py:34,106,113` | `APP`：操作日志查询/写入；保持 ASSET。 |
| `backend/app/services/search_provider.py:37,91,107` | `APP`：搜索数据源；保持 ASSET。 |
| `backend/app/services/search_hot_keyword_service.py:28` | `APP`：热词服务；保持 ASSET。 |
| `backend/app/services/upstream_service.py:139` | `APP`：上游系统/卸数元数据查询；保持 ASSET。 |
| `backend/app/services/push_service.py:157` | `APP`：下游推送服务；保持 ASSET。 |
| `backend/app/services/manual_code_table_service.py:75` | `APP`：手工码值表服务；保持 ASSET。 |
| `backend/app/services/ai_llm_daily_quota.py:212` | `APP`：全局 AI 额度存储 profile getter；仍随内部 ASSET，不改额度逻辑。 |
| `backend/app/core/profiles.py:14,27` | `DEMO`：`ASSET_RUNTIME_PROFILE` 社区部署 preset；它不是第二个 Profile 选择器，保留社区路径并只产生一个 ASSET selector。 |
| `backend/app/authorization/core.py`（由相关调用路径纳入；扫描无 selector 命中） | `AUTH`：无 DB selector 的授权核心；以 Repository 提供的同一用户/角色/权限现态运行，不改 Permission contract。 |

### Backend CLI、迁移与外部连接

| 文件:行号（基线） | 分类 / 用途及处理 |
| --- | --- |
| `backend/scripts/reset_all_user_passwords.py:14,15,30,31,78` | `OPS/AUTH`：全用户密码重置 CLI；删除 Auth-env/primary 候选，默认严格 ASSET、可显式覆盖，保留 preview/apply/二次确认并展示目标。 |
| `backend/scripts/init_menu_data.py:16` | `OPS`：菜单 Seed 兼容 CLI；移除 primary 默认，ASSET 默认/显式目标，输出实际 Profile。 |
| `backend/scripts/seed_term_roots.py:227` | `OPS`：受保护的词根测试 Seed；移除 primary 默认，ASSET/显式目标，并保持非生产标记校验、dry-run/apply/cleanup。 |
| `backend/scripts/imp_dws_comments.py:19,111,113,868,869` | `EXT`：DWS 只读 catalogue/上游映射读取并通过 Portal API 导入；保留外部 source `--profile`，默认只用有效 ASSET，不再隐式回退 `gauss_primary`；Portal API 写入仍由服务器 ASSET 决定。 |
| `backend/scripts/collect_lineage_snapshot.py:21` | `LINEAGE/OPS`：显式 Collector 入口；继续要求 `--profile`/dry-run，目标不等于 ASSET 时在源读取前拒绝。 |
| `backend/app/services/lineage_collector.py`（profile 参数由 CLI/调用方传入，原扫描无 selector 字符串命中） | `LINEAGE`：调度元数据读取和快照发布服务；新增同 Profile 校验，dry-run 只读，正式 publish 仍需独立授权，不实际运行。 |
| `backend/scripts/schema_migrate.py:28,110,139` | `OPS`：迁移/状态检查 CLI；保持 `--profile` 显式目标、内部设置同目标 ASSET 的现有行为，不自动迁移真实 DB。 |
| `backend/alembic/env.py:20,26` | `OPS`：Alembic 目标从显式 x-argument 或 ASSET 解析；保留离线/测试能力和写目标 guard。 |
| `backend/scripts/db_to_init_sql.py:31,260,284` | `OPS/EXT`：只读导出源、显式 target-schema；保留源/目标分离与不执行 replay DML 的合同。 |
| `backend/scripts/dws_verify_metadata_preflight.py:35` | `OPS`：GaussDB/DWS 只读 metadata preflight；保留必需显式目标，不连生产数据库。 |
| `backend/scripts/dws_schema_preflight.py:31` | `OPS`：受保护的 DWS schema preflight；保留显式目标和只读/rollback 契约。 |
| `backend/scripts/create_admin.py:58` | `OPS/AUTH`：管理员 bootstrap CLI 错误提示；明确缺 ASSET 时拒绝，不提供 Auth Profile fallback。 |
| `backend/scripts/seed_lineage_test_data.py:24` | `OPS/TEST`：显式 lineage 测试 Seed；保留 test-only 目标，不用于真实快照采集。 |
| `backend/scripts/seed_asset_layer_test_data.py:392` | `OPS/TEST`：显式资产层合成 Seed；保留 test-only 目标。 |
| `backend/scripts/benchmark_lineage_batch_write.py:14,232,247` | `OPS/TEST`：显式 profile、dry-run/rollback/test-only 写入基准；保留写目标保护，仅合成 DB 测试。 |
| `backend/scripts/benchmark_field_mapping_synthetic.py:79` | `OPS/TEST`：合成字段映射基准环境设置；保留隔离 Profile，不作为应用选择路径。 |

### CI/test fixtures 与回归契约

| 文件:行号（基线） | 分类 / 用途及处理 |
| --- | --- |
| `backend/tests/test_asset_ownership.py:204` | `TEST`：资产 owner 查询的合成 Profile fixture；保持显式测试配置。 |
| `backend/tests/test_catalog_list_pagination.py:49` | `TEST`：目录分页与 SQLite profile fixture；保持隔离。 |
| `backend/tests/test_database_example_config.py:39,72` | `TEST`：示例 Profile/环境模板静态校验；同步断言唯一 Auth Profile 变量不再作为部署赋值。 |
| `backend/tests/test_field_mapping_sorting.py:86` | `TEST`：字段映射排序 DB fixture；保持隔离。 |
| `backend/tests/test_lineage_bootstrap.py:57,227,311,312,313` | `TEST/LINEAGE`：ACTIVE/无快照/错误与旧 selector 忽略契约；适配公共 resolver 验证，不改变 #539 行为。 |
| `backend/tests/test_search_asset_explore.py:61` | `TEST`：资产探索 fixture；保持测试 Profile 显式。 |
| `backend/tests/test_upstream_service.py:64` | `TEST`：上游服务 DB fixture；保持 Provider/schema 隔离。 |
| `backend/tests/test_system_management_pagination_sqlite.py:40,41` | `TEST/AUTH`：系统管理/旧认证同值兼容 fixture；仅测试，确保 Auth/RBAC 不选第二库。 |
| `backend/tests/test_system_list_pagination_integration.py:80` | `TEST`：系统列表集成 SQLite profile；保持临时库。 |
| `backend/tests/test_system_list_pagination.py:43` | `TEST`：系统列表分页 fixture；保持隔离。 |
| `backend/tests/test_search_hot_keywords.py:136,142` | `TEST`：hot keywords/显式 source CLI fixture；保持测试目标。 |
| `backend/tests/test_schema_migrate_cli.py:18,19,76,84,89,95,189,208,235,250,274,291,314,329,353,364,388,406,468,527,597,641,644,645,647,655,663,669,672,673` | `TEST/OPS`：offline SQLite/Community/多 Profile migration CLI 契约；保持显式测试目标、offline 限制和写目标保护。 |
| `backend/tests/test_reset_all_user_passwords_script.py:38,42,43` | `TEST/AUTH`：密码重置 Profile 解析与 preview；更新旧 Auth-only/primary 行为断言并确保无 DML。 |
| `backend/tests/test_rbac_role_management.py:49,50` | `TEST/AUTH`：真实 Session/RBAC role management fixture；同值旧变量只触发兼容警告，不选另一库。 |
| `backend/tests/test_push_job_freq_desc_capacity.py:66,214` | `TEST`：推送作业查询/显式 profile CLI fixture；保持既有目标。 |
| `backend/tests/test_public_catalog_search_policy.py:117` | `TEST`：匿名目录策略/SQLite fixture；验证 `PUBLIC_CATALOG_PROFILE` 不变。 |
| `backend/tests/test_p5_runtime.py:63` | `TEST/LINEAGE`：运行环境 POC/lineage contract fixture；验证旧 selector 不恢复 POC。 |
| `backend/tests/test_mysql_integration.py:53,146,180` | `TEST/CI`：独立 MySQL test profile 与 CLI integration；保留隔离环境，不作 app default。 |
| `backend/tests/test_module_registry.py:68` | `TEST/DEMO`：Community runtime preset fixture；区分 preset 与 Profile selector。 |
| `backend/tests/test_menu_seed.py:49` | `TEST`：canonical menu manifest 与 seed transaction fixture；更新 CLI parser contract，保留 idempotency。 |
| `backend/tests/test_metadata_ingestion.py:199` | `TEST`：Metadata ingestion SQLite fixture；保留显式测试注入。 |
| `backend/tests/test_lineage_storage_mode_contract.py:12,46,47,57,61` | `TEST/LINEAGE`：各环境 Profile、旧 lineage vars 与配置错误契约；使用 schema mock，同时验证无 POC fallback。 |
| `backend/tests/test_lineage_persistent_read.py:32` | `TEST/LINEAGE`：持久快照读取/无活动快照回归；只使用合成 SQLite。 |
| `backend/tests/test_lineage_default_root.py:40` | `TEST/LINEAGE`：默认 lineage root 路径；保留当前 schema/数据行为。 |
| `backend/tests/test_legacy_data_access_boundary.py:177` | `TEST`：旧数据访问隔离边界；保留 Community synthetic Profile。 |
| `backend/tests/test_indicator_semantic_migration.py:156` | `TEST/OPS`：指标 migration explicit CLI fixture；保持 test target。 |
| `backend/tests/test_field_mapping_stats_consistency.py:37` | `TEST`：字段映射计数一致性 DB fixture；保持隔离。 |
| `backend/tests/test_field_mapping_filter_index_migration.py:59` | `TEST/OPS`：字段映射索引 migration explicit Profile；保持离线/SQLite test target。 |
| `backend/tests/test_field_mapping_import.py:110` | `TEST`：字段映射导入目标 DB fixture；保持隔离。 |
| `backend/tests/test_field_identity.py:179` | `TEST`：字段 identity fixture；保持隔离。 |
| `backend/tests/test_dws_verify_metadata_preflight.py:515` | `TEST/OPS`：GaussDB preflight CLI 显式 profile fake；只验证目标策略，不连真实 DWS。 |
| `backend/tests/test_dws_incremental_migrations.py:1284,1301,1454,1463,1470,1481,1494,1497,1524,1532,1541,1558,1574,1587,1591,1597` | `TEST/CI`：DWS 离线/incremental migration Profile fixtures；保持显式 synthetic adapter 与 rollback contract。 |
| `backend/tests/test_demo_seed.py:116` | `TEST/DEMO`：Community fixture/Seed；只写隔离 Demo SQLite。 |
| `backend/tests/test_create_admin_cli.py:52,53,58,59,103,110,116,119,133,136,139` | `TEST/AUTH`：创建管理员 CLI 环境加载与缺少 ASSET 错误；不允许旧 Auth selector 替代。 |
| `backend/tests/test_configuration_surface.py:24,27,38` | `TEST/DOC`：deployment template/configuration docs 静态断言；验证模板不再赋值旧 Auth selector。 |
| `backend/tests/test_community_boundary.py:31` | `TEST`：Community runtime profile fixture；保持 Community/Private 边界。 |
| `backend/tests/test_community_demo_bootstrap.py:219,230,236,246,250,253,254,409,434,444,448,452,454` | `TEST/DEMO`：子进程环境、dotenv precedence、Demo profile 隔离与 settings loader；覆盖 shell/env 文件旧 selector 和连接覆盖不能 redirect。 |
| `backend/tests/test_catalog_snapshot.py:51` | `TEST`：目录快照数据库 fixture；保持隔离。 |
| `backend/tests/test_asset_layer_seed_data.py:215,229` | `TEST/OPS`：显式合成资产 Seed；保留 test-only 目标。 |
| `backend/tests/test_asset_sync_lifecycle.py:259` | `TEST`：资产同步生命周期 DB fixture；保持隔离。 |
| `backend/tests/test_asset_identity.py:121` | `TEST`：资产 identity profile fixture；保持隔离。 |
| `backend/tests/test_ai_metadata_count.py:144` | `TEST`：AI 元数据计数 Community SQLite fixture；业务统计不改 selector。 |
| `backend/tests/test_ai_llm_daily_quota_api.py:36,37` | `TEST/AUTH`：AI quota API 的 Auth 同值兼容/ASSET fixture；保留 quota/RBAC contract，不存在第二 DB。 |
| `backend/tests/test_ai_llm_daily_quota.py:54` | `TEST`：额度持久化 profile fixture；保持 ASSET 和隔离 DB。 |
| `backend/tests/test_lineage_batch_benchmark.py:45,137,147` | `TEST/OPS`：显式 lineage benchmark/`--apply` test contract；仅模拟/隔离 DB，保留 write guard。 |
| `backend/tests/test_field_mapping_migration.py:91` | `TEST/OPS`：字段映射 migration CLI fixture；保持目标显式。 |
| `backend/tests/test_field_mapping_source_system_identity.py:35` | `TEST`：source-system identity DB fixture；保持业务身份合同。 |

## Phase 0 发现与结论

1. 常规资产、报表、字段映射、系统管理、操作日志、指标/词根、搜索、上/下游与 quota services 已用 `ASSET_DB_PROFILE` 或公共解析器；按 regression 处理，不重写 CRUD。
2. Auth 与 DB-backed RBAC 是真实的分离 selector/`primary` fallback，已在 PR #559 统一；Session/用户/角色/权限同库验证。
3. #539 已合并：Lineage API 使用 ASSET、无 ACTIVE 返回空状态，配置/连接/缺表有独立错误、无后端 POC fallback。本次对 API 做全回归；新增 Collector 显式 target 与 ASSET equality guard，未读取或发布真实快照。
4. 密码重置、菜单 Seed、词根 Seed 的旧 fallback 已移除；explicit `--profile` 仍是维护 CLI target，密码重置保留 preview/apply/交互确认并输出 profile/provider/database/schema。
5. `imp_dws_comments.py` 是混合的 DWS source adapter/Portal API client：保留外部源显式 `--profile` 与查询路径；默认不再猜 `gauss_primary`，只用有效 ASSET，Portal API 写入仍由 API 后端 Profile 决定。
6. Community Demo 只注入一个 ASSET selector；ASGI Demo dotenv loader 同时忽略旧 Auth/Lineage selector 和外部 DB URL/连接覆盖，不修改用户 `.env*`。`PUBLIC_CATALOG_PROFILE`、RAG/LLM/向量配置及必要 `ASSET_DB_*` 运行覆盖保持原契约。
7. 所有扫描命中的 migration/preflight/test profile 均保留为显式运维、测试或 CI 目标，不把测试 Profile 接入 ordinary app runtime。

**安全边界：**审计仅为静态源码/文档扫描及本地 synthetic test；不读取或连接真实内网数据库，不检查真实用户/血缘数据，不执行真实 Migration/Seed/DDL/DML。DWS 8.1.3 实例验收 `NOT RUN`。
