# 文档索引

## 开始使用

- [Community Demo 指南](community-demo.md)：说明仓库内一键演示和手动开发两条本地运行路径及各自边界。
- [界面截图画廊](screenshots.md)：展示使用仓库 Demo 数据运行的页面截图，并指向可复现流程。

## 部署与运维

- [部署说明](../DEPLOYMENT.md)：介绍内网单机部署、配置、数据库迁移、服务运行和验收步骤。
- [前端版本发布流程](release-versioning.md)：说明正式 Release 如何驱动构建时 Footer 版本、npm 根包同步和独立部署。
- [Backend configuration](configuration.md)：说明后端首次部署配置、可选能力和进阶运行参数。
- [数据库支持矩阵](database-support.md)：定义数据库能力等级、支持矩阵及各数据库的验证边界。
- [血缘快照采集与发布指南](lineage_bulk_import_guide.md)：说明血缘快照的数据模型、首次采集、原子发布、失败回退和定时执行。
- [DWS 部署就绪清单](dws-deployment-readiness.md)：列出 GaussDB/DWS 部署文档验收所需的环境输入和真实验证证据；文中标注的场景尚待真实环境执行。

## 架构与设计

- [架构说明](architecture.md)：介绍系统架构、主请求路径和运行时边界，并链接静态与交互架构图。
- [模块清单](modules.md)：按模块对照页面职责、接口、数据表、源码和 Demo 状态。
- [表归属说明](TABLE_OWNERSHIP.md)：说明业务表的唯一归属如何决定 schema、seed、查询和写入契约。
- [Metadata Ingestion Contract](metadata-ingestion.md)：说明外部系统向 DAP 提交资产与血缘元数据时的契约边界。
- [架构决策记录（ADR）](adr/)：记录元数据接入契约、多方言 Schema 基线和 Profile 写目标等决策。
- [授权元数据只读快照契约](catalog-snapshot.md)：定义现有资产目录的批量只读快照表示及其身份、授权和一致性约束。
- [资产风险与审计平台联动设计](asset-risk-integration-design.md)：说明门户与外部审计平台的职责边界、风险对象接口和未实现事项。
- [Framework-Neutral Boundary Audit](framework-neutral-boundaries.md)：记录 FastAPI Native 运行时与框架中立应用服务之间的边界。
- [单轮 AI 数据资产问答 MVP](ai-ask-mvp.md)：记录单轮问答的实现范围、API 契约和默认关闭等能力边界。
- [AI 问答静态 Mock 演示](ai-ask-static-mock.md)：说明静态 Mock 的运行方式及其与真实后端生产构建的隔离要求。
- [单轮 AI 问答的权威元数据表数](ai-metadata-count.md)：说明问答统计的资产范围、计数口径和 API 集成约定。
- [Built-in AI retrieval design](ai-local-retrieval-design.md)：记录内置检索方案的当前边界、兼容行为和分阶段实现说明。
- [智能问数底座与语义推荐路线](semantic-recommendation-roadmap.md)：说明语义推荐与问答的能力边界、依赖缺口及建议演进顺序。
- [RBAC 身份与授权文档](rbac/)：集中说明登录、权限契约、持久化、路由执行、前端权限和安全回归边界。
- [架构图维护说明](diagrams/README.md)：说明交互架构图、JSON 图源和静态 SVG 的维护与校验关系。
- [FastAPI Native 运行时交互图](system-architecture.html) · [Archify 图源](system-architecture.archify.json)：以交互图展示运行时组件及其职责边界，JSON 文件为对应图源。

## 开发与贡献

- [首次贡献指南](first-contribution.md)：按 Fork、选择 Issue、修改、最小验证和提交 PR 的流程介绍贡献步骤。
- [Good First Issue 候选池](good-first-issues.md)：列出具有明确入口、有限文件范围和公开验证方式的贡献任务。
- [字段映射性能与一致性验证](field-mapping-measurement.md)：记录基于合成数据和临时 SQLite 的可复现实验及其适用边界。
- [串行交付与最终验收记录](serial-closure-2026-10-17.md)：记录 2026-10-17 的交付授权、验证环境、命令结果和验收边界。

## 参考

- [API 契约](api-contract.md)：作为当前 FastAPI 端点、请求响应格式和统一约定的主文档。
- [PostgreSQL 应用 DDL](pg/)：按模块提供 PostgreSQL 目标的 DAP 应用元数据表定义。
- [DWS 应用 DDL 与检查脚本](dws/)：提供 DWS 目标的模块 DDL，以及只读健康检查和快照回滚脚本。
- [Roadmap 与待确认事项](todo.md)：列出当前尚未完成、仍需产品或架构决策的事项。
- [工程历史归档](archive/engineering-history/README.md)：说明已完成迁移与决策记录的历史用途，并提示当前行为应以正式文档和代码为准。
