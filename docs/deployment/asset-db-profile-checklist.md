# `ASSET_DB_PROFILE` 单一入口部署验收清单

本清单用于把内部认证/RBAC/血缘元数据统一到当前 DAP 数据库 Profile。它不要求本任务自动迁移用户数据、修改数据库或发布血缘快照；发现数据仍在另一数据库时必须停止并单独规划迁移。

> **验证边界：** 本次代码验证使用隔离 SQLite 与托管 CI。真实内网 PostgreSQL/MySQL/GaussDB/DWS（包括 DWS 8.1.3）未连接、未执行迁移或写入。不得把本地/离线 PASS 当作生产数据库验收。

## 1. 变更前只读盘点

- [ ] 记录待部署的精确 release/commit、维护窗口、审批人与回滚版本；确认目标不是 Community Demo 或共享测试库。
- [ ] 通过受控终端盘点应用进程、systemd/container/Secret store 的以下**变量是否设置**，不要把凭据值、DSN、JDBC URL 写入工单或日志：
  - `ASSET_DB_PROFILE`、`ASSET_DB_CONFIG_PATH`、`ASSET_RUNTIME_PROFILE`
  - 旧变量 `ASSET_AUTH_DB_PROFILE`、`LINEAGE_DB_PROFILE`、`LINEAGE_STORAGE_MODE`
  - `ASSET_DB_*` provider/连接参数覆盖（仅核对是否存在及来源，不公开其值）
- [ ] 核对最终加载的 YAML profile、Provider、数据库与有效物理 Schema。`ASSET_DB_*` 非空覆盖会应用到选中的命名 Profile；遵循既有 #414 precedence，不删除有效连接覆盖。
- [ ] 由有权限的 DBA/部署负责人只读确认选定 Profile/Schema 内存在且归属正确：用户表、角色/权限映射表、菜单/系统参数、资产相关元数据及（如已部署）`p_lineage_snapshot/node/edge`。确认记录、历史数据量及目标表归属；不要读取/导出密码哈希或业务明文到工单。
- [ ] 备份当前认证数据所在库和目标库，并确认恢复方案可用。若认证表或用户/角色/权限数据仍位于另一库，**停止切换**；本变更不自动复制、合并或删除这些数据，须先在隔离环境设计、演练并审批同方言/跨方言迁移。
- [ ] 在明确授权的目标上运行只读 `schema_migrate.py status/verify --profile <ASSET_DB_PROFILE>`，确认 #454 写目标/物理 Schema 约束与当前结构一致。不要仅因 Profile 名称相同就推断 Schema 一致。

## 2. 隔离预演

- [ ] 使用经批准的脱敏备份，在独立 staging 库/Schema 设置唯一 `ASSET_DB_PROFILE`；认证、RBAC、业务和血缘共享该 Profile。
- [ ] 先移除 `ASSET_AUTH_DB_PROFILE`。若暂时保留旧变量做过渡，它只能与 `ASSET_DB_PROFILE` 完全相同并产生弃用警告；冲突、无效值、或只设置旧变量都必须 fail closed。不得依赖 `primary` 回退。
- [ ] 从进程环境删除旧 `LINEAGE_DB_PROFILE`、`LINEAGE_STORAGE_MODE`，避免运维误以为它们仍能选择数据库/POC 模式。
- [ ] 通过测试账户验证登录、`/api/auth/me` Session 恢复、注销、无效口令、用户禁用、角色禁用及至少一组有/无权限操作。确认配置/连接故障与无效口令响应不同，错误中没有 SQL、密码、DSN 或连接串。
- [ ] 验证资产读取、管理写入、角色授权及菜单使用同一有效 Profile/Schema；确认 `PUBLIC_CATALOG_PROFILE` 的匿名目录脱敏策略未变。
- [ ] 若 staging 没有 ACTIVE 血缘快照，验收预期为既有 `no_active_snapshot` 空状态，而非 demo 图；ACTIVE 快照、Schema/表缺失及连接故障按各自状态/错误契约验证。
- [ ] Collector 必须显式传入与 `ASSET_DB_PROFILE` 相同的 `--profile`。仅在 staging 运行 `--dry-run`；正式发布是独立、需授权的写操作，不能作为“部署检查”自动执行。

## 3. 正式部署前

- [ ] 将 `ASSET_DB_PROFILE=<已审核的命名 Profile>` 写入唯一受控配置源；确认 `.env`/`.env.local`/systemd/Secret store 的加载优先级没有同名变量覆盖。
- [ ] 确认认证、角色、权限、业务和（若存在）血缘三表及数据均已位于该 Profile 的有效物理 Schema。若任何数据缺失，停止上线并执行单独批准的数据迁移计划；不得通过更改 `ASSET_AUTH_DB_PROFILE`、`primary` 或 `LINEAGE_DB_PROFILE` 绕过检查。
- [ ] 核对 `ASSET_DB_CONFIG_PATH`、JDBC Driver/JAR 路径与连接参数来源；凭据只来自权限受控文件或 Secret store。不得把密码、Token、Cookie、完整连接串或真实 `APP_SECRET_KEY` 放入仓库、命令行历史、CI 日志或截图。
- [ ] 删除已确认无用的旧认证/血缘 Profile 环境变量；不要修改 `PUBLIC_CATALOG_PROFILE`、外部数据源连接、RAG/LLM/向量 Provider 或必要 `ASSET_DB_*` 覆盖。
- [ ] 若使用危险维护 CLI（密码重置、Seed、迁移），逐项核对其预览显示的显式 Profile/目标；优先 dry-run/preview。除非另有审批，不执行 `--apply`、`--cleanup`、`--yes` 或任何正式写操作。

## 4. 上线后验收

- [ ] 后端启动并通过只读 health/readiness 检查；Profile 缺失、无效、旧配置冲突必须暴露明确配置错误，不得连接另一数据库。
- [ ] 使用批准的测试账号验证登录、Session 恢复与注销；用预设测试角色验证授权允许/拒绝结果。不要在生产中为本检查重置所有用户密码或临时提权。
- [ ] 通过审批的只读审计确认认证/RBAC 查询与业务元数据查询使用相同 Profile/Schema；不得记录完整 DB URL、凭据或用户密码哈希。
- [ ] 核对匿名目录投影仍遵循部署现有 `PUBLIC_CATALOG_PROFILE` 与导出策略；本 Issue 不更改其含义。
- [ ] 记录血缘状态：当前 Profile 可连通不等于已采集血缘。没有 ACTIVE 快照即记录为空状态；不自动触发 Collector 发布。
- [ ] 记录 Provider/方言、精确应用 SHA、只读 schema verification、认证/RBAC 回归、错误分类、血缘状态，以及每项 PASS/FAIL/NOT RUN；真实 GaussDB/DWS 版本验收须由目标环境单独执行并留证。

## 5. 回滚与停止条件

- [ ] 如代码回滚，先确认回滚版本的 Auth/RBAC Profile 选择行为不会把请求重新导向另一库；**代码回滚不是数据迁移**。
- [ ] 若统一目标缺少认证表/用户数据、身份/权限不匹配、Schema 不确定、旧变量冲突、只读验证失败或目标库不可用，立即停止流量切换；保留现状与备份，转交 DBA/维护者制定单独修复/迁移方案。
- [ ] 不执行自动合并、发布、真实数据库 migration/seed/DDL/DML 或血缘 snapshot 发布来满足本清单。
