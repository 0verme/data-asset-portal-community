# 更新日志 · Changelog

本文档记录 Data Asset Portal 的重要变更。
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

本文不是 Git 提交历史，而是基于仓库状态整理的阶段性变更摘要。

## [Unreleased]

### 优化（Changed）

- 前端完成组件化拆分：页面视图收敛到 `components/views/`、侧边栏收敛到 `components/sidebar/`，业务逻辑抽取为 `hooks/` 下的领域 hook（`useAssetModule`、`useRootModule`、`useIndicatorModule`、`usePushModule`、`useUpstreamModule`、`useSystemModule` 等）。
- 统一交互反馈：新增公共 `ConfirmDialog` / `confirmDelete` 确认弹窗与 toast 提示组件（`components/common/`），全面禁用原生 `alert` / `confirm`。
- 整理项目文档体系：重构 `README.md`，新增根级 `CHANGELOG.md` / `DEPLOYMENT.md` / `DEVELOPMENT.md`，对齐 `docs/` 下各文档。

## [0.1.0]

首个社区版本（Community Edition），聚焦"元数据可见、可查、可维护"。

### 新增（Added）

- **数据仓库**：DWM 表资产列表、详情、字段、DDL，支持新增 / 编辑 / 删除。
- **字段映射**：字段视图、表视图、统计卡片、CSV 导出（以查询治理为主，无前端编辑入口）。
- **词根管理**：列表、分类、新增 / 编辑 / 删除、批量导入（含预览）。
- **指标维护**：列表、详情、新增 / 编辑 / 启停 / 删除，支持维度与状态筛选。
- **上游卸数**：系统列表、详情、新增 / 编辑 / 启停 / 删除，支持多卸数时间点。
- **下游推送**：系统管理、作业管理、作业字段管理。
- **系统管理**：后台用户管理（启用 / 停用 / 锁定、重置密码）、参数字典管理。
- **认证**：登录、当前用户、登出（mock 演示登录 / 数据库真实登录）。
- **通用码值**：上游 / 下游选项由参数字典驱动（数据库类型、部门、推送协议、认证方式、分隔符、频率、编码、频率类型、系统状态等）。
- **数据库脚本**：按模块拆分维护两套 SQL（`docs/pg/` PostgreSQL、`docs/dws/` GaussDB / DWS），覆盖 common-codes、assets、field-mappings、indicators、roots、upstream、push、auth。
- **数据库初始化**：手动执行 `docs/pg/` 或 `docs/dws/` 下的模块 DDL（无自动初始化脚本）。

### 优化（Changed）

- **运行模式精简（4 → 1）**：前端收敛为唯一开关 `VITE_API_MODE=mock|remote`，同时决定数据来源与认证方式（`src/auth.js` 的 `AUTH_MODE` 跟随它）；后端始终连库、无模式开关。

### 移除（Removed）

- 删除前端 `VITE_AUTH_MODE` 开关。
- 删除后端 `ASSET_DATA_SOURCE`、`AUTH_MODE` 开关及各 service 的 mock 分支。
- 删除 `backend/mock_data/` 目录与 `backend/scripts/db_to_mock.py`。

> 公开仓库地址将在社区版发布时确定，届时再补充版本比较链接。
