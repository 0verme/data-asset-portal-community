# Roadmap 与待确认事项

本文记录当前代码尚未完成、仍需产品或架构决策的事项。已实现功能与模块细节见 README、`docs/modules.md` 与代码/测试。

## 1. 授权模型后续工作

当前已实现 permission-based RBAC：后端使用权限注册表、角色—权限映射和 `require_permission` 强制授权，支持角色管理与单角色用户绑定。仍未实现：多角色绑定、ABAC/ACL、数据范围（row-level/data-scope）授权、SSO 或外部 IAM。详见 [RBAC 文档](./rbac/permission-contract.md)。

## 2. 资产风险外部接入

资产详情已有 `assetRisks` 展示骨架，但外部审计结果导入、查询、持久化、实时校验和问题闭环尚未实现。边界与建议见 [资产风险与审计平台联动设计](./asset-risk-integration-design.md)。

## 3. 智能问数与语义推荐

当前只有关键词搜索和资产元数据底座，没有向量检索、Embedding、LLM 组装或可执行语义层。候选路线见 [智能问数底座与语义推荐路线](./semantic-recommendation-roadmap.md)。

## 4. 社区版发布完善

- **界面截图**：README 的「项目预览」已引用仓库 Community Demo 的真实截图；当前截图画廊仍未覆盖血缘分析 POC 页面，后续仅需在 Demo 口径确认后补充该页面。
- **发布闭环**：~~仓库创建、首次 CI 验证、版本 tag 与 Release 发布流程~~ —— 已随 `v0.1.1` 发布完成（首次 CI 全绿，tag 与 Release 已建立）。
- **贡献者体验**：补充面向新贡献者的端到端示例（新增一个模块/字段映射的完整流程）。
