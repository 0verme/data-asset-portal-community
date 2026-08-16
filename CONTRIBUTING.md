# 贡献指南 · Contributing

感谢你对见远而行数据资产管理与血缘分析软件的关注！欢迎通过 Issue 与 Pull Request 参与共建。

## 提交 Issue

在提交前请先搜索是否已有相同 Issue。提交时请尽量说明：

- **Bug 报告**：复现步骤、期望行为、实际行为、运行模式（`mock` / `remote`）、相关日志（`logs/`）
- **功能建议**：使用场景与期望能力，可参考 [路线图](./README.md#-路线图)

## 提交 Pull Request

1. Fork 仓库并基于 `main` 创建特性分支（如 `feat/xxx`、`fix/xxx`）
2. 保持改动聚焦单一主题，提交信息清晰
3. 本地自测通过后提交 PR，并在描述中说明动机与影响范围
4. 涉及接口或数据库结构变更时，请同步更新 `docs/` 下相关文档

## 本地开发

请参考 [快速开始](./README.md#-快速开始) 与 [开发指南](./DEVELOPMENT.md)。

- 前端：React 18 + Vite 5，视图在 `frontend/src/components/views/`、业务逻辑在 `frontend/src/hooks/`、API 层按模块拆分于 `frontend/src/api/`
- 后端：Flask 3，服务层位于 `backend/app/services/`，蓝图位于 `backend/app/routes/`
- 推荐先用 `VITE_API_MODE=mock` 快速验证前端改动

## 代码风格

- 与周边既有代码保持一致的命名、缩进与注释密度
- 前端遵循项目现有的组件与 API 组织方式
- 写操作交互统一使用公共 `ConfirmDialog` / toast，禁用原生 `alert` / `confirm`
- 不提交本地环境文件（`.env.local`）、日志（`logs/`）与调试产物

## 许可证

提交贡献即表示你同意以 [Apache License 2.0](./LICENSE) 授权你的代码。
